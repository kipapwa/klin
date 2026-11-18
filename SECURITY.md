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
- O Gemini é chamado por `generateContent` (sem estado guardado no Google), não pela Interactions API, que armazena as interações por padrão.
- Notificações push usam o modo discreto por padrão ("Hora da sua medicação programada"); o nome do remédio só aparece se o usuário escolher (Ajustes). O conteúdo do push é cifrado ponta a ponta (RFC 8291) para o aparelho: o serviço de push (Google/Apple/Mozilla) não lê o texto nem o id do remédio.
- Ao sair da conta, a inscrição push daquele aparelho é apagada; ao entrar com outra conta no mesmo aparelho, `register_push_subscription` remove a inscrição da conta anterior. Ninguém recebe lembretes de outra pessoa.
- `disparar-lembretes` não tem login (é chamada pelo Supabase Cron). Ela é protegida pelo `CRON_SECRET`, comparado em tempo constante, e guardado no Vault do Supabase, nunca em arquivo do repositório. A função só chama `claim_due_doses()` (permitido apenas para `service_role`) e lê as inscrições dos donos dessas doses.
- Dados guardados offline (IndexedDB) ficam apenas no aparelho e são apagados após sincronizar ou ao sair da conta.

## 5. Entradas

- Todo dado vindo do cliente é validado na Edge Function antes de gravar (tipos, tamanhos, enums). A saída de qualquer IA passa por `validateClinicalNote` antes de chegar ao banco.
- Uploads: o tipo MIME e o tamanho são verificados no servidor, sem confiar na extensão.
- Nada vindo do usuário ou da IA é renderizado como HTML (`dangerouslySetInnerHTML` é proibido para esse conteúdo).
- A cota diária de IA por usuário (`ai_take_quota`) limita abuso e custo.

## 6. Navegador

- O GitHub Pages não permite cabeçalhos próprios. A CSP vai numa `<meta>` (`src/lib/csp.ts`); `frame-ancestors`, `X-Frame-Options` e `Permissions-Policy` não podem ser aplicados. HTTPS é garantido pelo próprio GitHub Pages ("Enforce HTTPS").
- O bloqueio de tela por PIN guarda apenas um hash derivado com PBKDF2 e sal aleatório, nunca o PIN.
