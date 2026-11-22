# Regras de segurança do Klin

O Klin guarda dados de saúde (dados pessoais sensíveis pela LGPD, art. 5º, II e art. 11).
Estas regras valem para todo código do repositório e têm prioridade sobre conveniência.

## 0. Arquitetura

- O **site** é estático (export do Next.js) no **GitHub Pages**: tudo o que está nele é público, inclusive variáveis `NEXT_PUBLIC_*`.
- O **servidor** são as **Supabase Edge Functions** (`supabase/functions/`). É o único lugar onde existem segredos.
- O navegador fala direto com o Supabase (banco, Auth, Storage) usando a chave pública; quem protege os dados é o RLS.

## 1. Chaves e segredos

- Segredos ficam só nos segredos das Edge Functions (gravados pelo workflow `deploy-functions.yml` a partir dos Secrets do GitHub) e, localmente, em `supabase/functions/.env`. O `.gitignore` bloqueia `.env*`; só os `.env.example`, sem valores, são versionados.
- O site recebe apenas valores públicos: URL do Supabase, chave publishable e chave VAPID **pública**. Nunca dê o prefixo `NEXT_PUBLIC_` a `GEMINI_API_KEY`, `GROQ_API_KEY`, `VAPID_PRIVATE_KEY` ou a chave secreta do Supabase.
- Gemini, Groq e envio de Web Push são chamados apenas pelas Edge Functions.
- As Edge Functions trabalham com o **token do próprio usuário** (chave pública + RLS). A chave secreta do Supabase (que ignora o RLS) só pode ser usada onde não há usuário na requisição (ex.: disparo agendado de lembretes), em função protegida por segredo próprio.
- CORS das funções: só as origens de `ALLOWED_ORIGINS`.

## 2. Banco de dados (Supabase)

- Toda tabela em `public` tem RLS ativo e políticas `select/insert/update/delete` restritas a `auth.uid() = user_id`, apenas para o papel `authenticated`. O papel `anon` não tem acesso a nenhuma tabela.
- Relações entre tabelas usam chave estrangeira composta `(id, user_id)`, de modo que um registro nunca aponta para dado de outro usuário, mesmo que o id seja adivinhado.
- Funções `security definer` sempre declaram `set search_path = ''` e usam nomes totalmente qualificados.
- Tabelas de controle (ex.: `ai_usage`, cota de IA) não têm política para o usuário: só funções `security definer` gravam nelas.
- Mudanças de banco são feitas em `supabase/schema.sql` (idempotente), testadas com `npm run test:db` e aplicadas **antes** de publicar o código que depende delas.

## 3. Áudios (Supabase Storage)

- Bucket `audio` privado. Caminho obrigatório: `<user_id>/<arquivo>`; as políticas de `storage.objects` só liberam a pasta do próprio usuário.
- Reprodução apenas por Signed URL de curta duração.
- Tipos MIME e tamanho limitados no próprio bucket e conferidos de novo na Edge Function.

## 4. Dados clínicos (PHI) fora do banco

- Nunca registrar transcrições, notas, nomes de remédios ou respostas da IA em `console.log`, mensagens de erro devolvidas ao cliente, analytics ou ferramentas de monitoramento. Logs carregam apenas ids, nome da IA, status HTTP e códigos de erro (há teste para isso em `ai.test.ts`).
- Quando as IAs falham, a resposta ao app (e o log) traz um diagnóstico técnico por IA (`safeDetail` em `_shared/ai.ts`). Ele contém o código HTTP, o status/código do provedor e a mensagem de erro do provedor **sem nenhum trecho entre aspas**, que é onde os provedores repetem valores do pedido. Fica limitado a 160 caracteres por IA. Mensagens de erro dos provedores descrevem o pedido (campo inválido, modelo inexistente, limite), não o conteúdo.
- **Perguntar à IA** (`analisar`): só a pedido da pessoa, que vê antes o aviso de que o conteúdo do relatório vai para a IA (Gemini; Groq se ele falhar). Exige login e gasta a cota diária. A função não grava pergunta, dados nem resposta e registra no log só o escopo, o tamanho e a IA que respondeu. Os dados vão delimitados e a IA é instruída a tratá-los como dados, não como instruções. A resposta é exibida como texto puro. Pergunta e resposta ficam no histórico da pessoa (`ai_analyses`), e as perguntas favoritas em `ai_saved_questions`; as duas tabelas têm RLS do dono, sem acesso de visitante. O app grava pelo token do usuário (a função continua sem gravar nada).
- O Gemini é chamado por `generateContent` (sem estado guardado no Google), não pela Interactions API, que armazena as interações por padrão.
- Notificações push usam o modo discreto por padrão ("Hora da sua medicação programada"); o nome do remédio só aparece se o usuário escolher (Ajustes). O conteúdo do push é cifrado ponta a ponta (RFC 8291) para o aparelho: o serviço de push (Google/Apple/Mozilla) não lê o texto nem o id do remédio.
- Ao sair da conta, a inscrição push daquele aparelho é apagada; ao entrar com outra conta no mesmo aparelho, `register_push_subscription` remove a inscrição da conta anterior. Ninguém recebe lembretes de outra pessoa.
- **Marcar dose pela notificação** (`marcar-dose`, sem login): cada lembrete leva uma assinatura HMAC-SHA256 que autoriza só marcar **aquela** dose (remédio + dono + horário) como tomada, até 24 h depois do horário. A chave deriva do `CRON_SECRET` com rótulo próprio e nunca sai do servidor. A assinatura vai cifrada ponta a ponta até o aparelho (RFC 8291). A função recusa assinatura inválida ou vencida com a mesma resposta para remédio inexistente, não lê nem devolve dado clínico e só insere em `medication_logs`. O `sw.js` só envia para a URL da função no domínio do Supabase. Quem copiar a assinatura de um lembrete consegue, no máximo, marcar aquela dose como tomada.
- `disparar-lembretes` não tem login (é chamada pelo Supabase Cron). Ela é protegida pelo `CRON_SECRET`, comparado em tempo constante, e guardado no Vault do Supabase, nunca em arquivo do repositório. A função só chama `claim_due_doses()` (permitido apenas para `service_role`) e lê as inscrições dos donos dessas doses.
- Dados guardados offline (IndexedDB) ficam apenas no aparelho e são apagados após sincronizar ou ao sair da conta.

## 5. Entradas

- Todo dado vindo do cliente é validado na Edge Function antes de gravar (tipos, tamanhos, enums). A saída de qualquer IA passa por `validateClinicalNote` antes de chegar ao banco.
- Uploads: o tipo MIME e o tamanho são verificados no servidor, sem confiar na extensão.
- Nada vindo do usuário ou da IA é renderizado como HTML (`dangerouslySetInnerHTML` é proibido para esse conteúdo).
- A cota diária de IA por usuário (`ai_take_quota`) limita abuso e custo.

## 6. Navegador

- O GitHub Pages não permite cabeçalhos próprios. A CSP vai numa `<meta>` (`src/lib/csp.ts`); `frame-ancestors`, `X-Frame-Options` e `Permissions-Policy` não podem ser aplicados. HTTPS é garantido pelo próprio GitHub Pages ("Enforce HTTPS").
- **Bloqueio de tela (PIN/biometria)** — `src/lib/app-lock.ts`:
  - guarda só um hash PBKDF2-SHA256 (600 mil iterações, sal aleatório), nunca o PIN; recusa repetições e sequências;
  - trava ao abrir o app e ao voltar depois de 1 min em segundo plano. Uma **recarga com o app visível** (o Next.js recarrega a página ao trocar de tela quando a tela guardada é de outra versão) não trava: ao sair da página visível e destravada, fica um aviso no sessionStorage válido por 5 s. Se a página ficou oculta antes de sair (app fechado ou trocado), o aviso é apagado e o app trava;
  - após 5 erros seguidos, espera crescente (30 s até 15 min); com 10 erros, sai da conta;
  - a biometria usa WebAuthn com o autenticador do próprio aparelho (`userVerification: "required"`);
  - **limite assumido:** é uma barreira contra quem pega o celular desbloqueado, não criptografia. Alguém com acesso técnico ao aparelho pode descobrir um PIN curto por força bruta a partir do hash. A proteção dos dados continua sendo a sessão + RLS, e a sessão pode ser encerrada pelo login.
- **Modo offline:**
  - gravações sem internet ficam no IndexedDB do aparelho (sem criptografia própria, protegidas pelo sistema do aparelho) só até serem enviadas;
  - ao sair da conta, as pendentes são apagadas, com aviso antes;
  - o Service Worker guarda em cache apenas os arquivos do próprio site (páginas, JS, CSS, ícones), que não contêm dados de saúde; pedidos ao Supabase nunca são guardados.
- **Telas instantâneas** (`src/lib/screen-cache.ts`): a última versão de cada tela (registros, notas, remédios, perfil) fica guardada no localStorage do aparelho, separada por conta, para a tela abrir na hora.
  - É apagada ao sair da conta, no "Esqueci o PIN" e após erros demais no PIN.
  - Não aumenta a exposição: a sessão de login fica no mesmo armazenamento e já dá acesso a tudo.
  - Buscas com termo digitado não são guardadas, e nada clínico vai no nome das chaves.
- **Relatórios PDF** (registros e remédios): gerados no aparelho (jsPDF, carregado sob demanda); os dados não passam por nenhum serviço externo. A transcrição bruta fica fora do relatório, e o nome do arquivo não leva dado clínico.
- **Ditado** (registro escrito): usa o reconhecimento de voz do próprio navegador. O áudio do ditado vai para o serviço de voz do sistema (Google no Android/Chrome, Apple no iPhone), não para o Supabase nem para as IAs do app. Isso está escrito ao lado do botão, e o ditado só começa quando a pessoa toca em "Ditar". O texto reconhecido fica só no campo até a pessoa salvar.
- **Nada clínico na URL:** o termo de busca da linha do tempo e os nomes de remédios não vão para a URL (o GitHub Pages recebe a query string).
