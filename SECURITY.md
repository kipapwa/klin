# Regras de segurança do Klin

O Klin guarda dados de saúde (dados pessoais sensíveis pela LGPD, art. 5º, II e art. 11).
Estas regras valem para todo código do repositório e têm prioridade sobre conveniência.

## 1. Chaves e segredos

- Segredos ficam só em `.env.local` (local) e nas variáveis do provedor de hospedagem. O `.gitignore` bloqueia `.env*`; apenas `.env.example`, sem valores, é versionado.
- Somente variáveis com prefixo `NEXT_PUBLIC_` chegam ao navegador. Nunca dê esse prefixo a `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `VAPID_PRIVATE_KEY` ou `CRON_SECRET`.
- Módulos que leem segredos começam com `import "server-only"`, para o build falhar se forem importados por um Client Component.
- Chamadas ao Gemini, ao Groq e ao envio de Web Push acontecem apenas em Route Handlers, Server Actions ou Edge Functions.
- A chave secreta do Supabase (que ignora o RLS) só é usada onde não existe usuário na requisição (ex.: disparo agendado de lembretes), e a rota que a usa exige `CRON_SECRET`.

## 2. Banco de dados (Supabase)

- Toda tabela em `public` tem RLS ativo e políticas `select/insert/update/delete` restritas a `auth.uid() = user_id`, apenas para o papel `authenticated`. O papel `anon` não tem acesso a nenhuma tabela.
- Relações entre tabelas usam chave estrangeira composta `(id, user_id)`, de modo que um registro nunca aponta para dado de outro usuário, mesmo que o id seja adivinhado.
- Funções `security definer` sempre declaram `set search_path = ''` e usam nomes totalmente qualificados.
- Mudanças de banco são feitas por SQL versionado em `supabase/` e aplicadas **antes** de publicar o código que depende delas.

## 3. Áudios (Supabase Storage)

- Bucket `audio` privado. Caminho obrigatório: `<user_id>/<arquivo>`; as políticas de `storage.objects` só liberam a pasta do próprio usuário.
- Reprodução apenas por Signed URL de curta duração, gerada no servidor depois de verificar o dono.
- Tipos MIME e tamanho limitados no próprio bucket.

## 4. Dados clínicos (PHI) fora do banco

- Nunca registrar transcrições, notas, nomes de remédios ou respostas da IA em `console.log`, mensagens de erro devolvidas ao cliente, analytics ou ferramentas de monitoramento. Logs carregam apenas ids e códigos de erro.
- Notificações push usam o modo discreto por padrão ("Hora da sua medicação programada"); o nome do remédio só aparece se o usuário escolher.
- Dados guardados offline (IndexedDB) ficam apenas no aparelho e são apagados após sincronizar ou ao sair da conta.

## 5. Entradas

- Todo dado vindo do cliente (incluindo o JSON devolvido pela IA) é validado no servidor por schema antes de gravar: tipos, tamanhos máximos e enums.
- Uploads: verificar tipo MIME e tamanho no servidor, não confiar na extensão.
- Nada vindo do usuário ou da IA é renderizado como HTML (`dangerouslySetInnerHTML` é proibido para esse conteúdo).

## 6. Navegador

- Cabeçalhos de segurança (CSP, HSTS, `X-Frame-Options`, `Permissions-Policy` com microfone só para o próprio site) são definidos em `next.config.ts`.
- O bloqueio de tela por PIN guarda apenas um hash derivado com PBKDF2 e sal aleatório, nunca o PIN.
