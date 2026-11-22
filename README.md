# Klin

PWA de registros médicos por voz: grava o relato, a IA estrutura a nota clínica (com CID-10, categoria e gravidade), extrai medicamentos com lembretes de dose e monta a linha do tempo do paciente.

- **Site:** Next.js 16 (export estático) + TypeScript + Tailwind CSS 4, hospedado no **GitHub Pages**.
- **Servidor:** Supabase (Postgres com RLS, Auth, Storage) e **Edge Functions** com as chaves das IAs.
- **IA:** Google Gemini, com o Groq (Whisper + Llama) como reserva automática.

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # só valores públicos
npm run dev                  # http://localhost:3000
```

Testes: `npm test` (funções puras do site e das Edge Functions), `npm run test:deno` (os testes das funções no runtime Deno), `npm run test:db` (schema e RLS), `npm run check:functions` (tipos no Deno) e `npm run test:e2e` (fluxo completo no Chromium com Supabase falso; antes, uma vez: `npx playwright install chromium`).

## Configuração (uma vez)

1. **Supabase:** crie o projeto e execute `supabase/schema.sql` no SQL Editor. Depois, em **Authentication**:
   - *Sign In / Providers > Email:* deixe o e-mail ativo.
   - *Emails > SMTP Settings:* **obrigatório**. Sem SMTP próprio, o Supabase não deixa editar os modelos de e-mail, e o envio gratuito é de poucos e-mails por hora. Opção sem custo: o próprio Gmail com uma **senha de app**, criada em https://myaccount.google.com/apppasswords (exige a verificação em duas etapas). Configuração: host `smtp.gmail.com`, porta `587`, usuário e remetente = o endereço Gmail, senha = a senha de app. O limite fica em cerca de 500 envios por dia.
   - *Emails > Templates:* o login é por **código de 6 dígitos**. Os modelos **Magic link** e **Confirm sign up** (usado no 1º acesso de cada pessoa) precisam mostrar `{{ .Token }}`. Exemplo: `<h2>Seu código do Klin</h2><p>{{ .Token }}</p><p>Ele expira em 1 hora.</p>`.
   - *URL Configuration > Site URL:* o endereço do site no GitHub Pages.
2. **GitHub Pages:** Settings > Pages > Source: **GitHub Actions**.
3. **GitHub > Settings > Secrets and variables > Actions**
   - *Variables* (públicas): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` e, opcionalmente, `ALLOWED_ORIGINS` e `GEMINI_MODEL`.
   - *Secrets:* `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `GEMINI_API_KEY` e `GROQ_API_KEY` (criar em https://console.groq.com/keys).

4. **Lembretes por notificação (push):**
   1. Gere o par de chaves: `npx web-push generate-vapid-keys`. A pública vai na *Variable* `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; a privada vai no *Secret* `VAPID_PRIVATE_KEY`. Crie também a *Variable* `VAPID_SUBJECT` (`mailto:seu-email`).
   2. Gere um segredo para o agendador (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) e cadastre no *Secret* `CRON_SECRET`.
   3. Depois que o workflow publicar as funções, rode o **Passo 1** de `supabase/cron.sql` no SQL Editor: guarda no Vault a URL do projeto e o mesmo `CRON_SECRET`. Em seguida, rode o restante do arquivo, que agenda o disparo a cada minuto.
   4. No app: **Ajustes > Ativar notificações** e depois **Enviar teste**. No iPhone, primeiro instale o app pela opção "Adicionar à Tela de Início".

A cada push na `main`, os workflows publicam o site e as Edge Functions. Veja `supabase/functions/.env.example` para a lista completa de segredos das funções.

## Cópia de segurança (semanal)

O plano grátis do Supabase não tem cópia para baixar. Todo domingo às 04:00 (Brasília) o workflow
**Cópia de segurança** (`.github/workflows/copia-seguranca.yml`) lê as tabelas com a chave secreta,
junta tudo num arquivo **criptografado** com a sua senha e guarda por 90 dias em Actions › Artifacts.
Também dá para rodar na hora (Actions › Cópia de segurança › Run workflow).

- Entram: perfis, registros (notas), remédios, histórico de doses, medições de pressão, perguntas
  salvas e respostas da IA. **Não entram**: áudios do Storage, inscrições de push, contas de login e
  a contagem da cota de IA.
- Segredos do repositório: `SUPABASE_SECRET_KEY` (Supabase › Project Settings › API Keys › Secret key)
  e `BACKUP_SENHA` (12+ caracteres, inventada por você). **Sem a `BACKUP_SENHA`, nenhuma cópia abre**:
  guarde num gerenciador de senhas, fora do GitHub. Se trocar a senha, guarde a antiga por 90 dias.

### Restaurar

1. Uma vez só: Supabase › SQL Editor › colar `supabase/restaurar-copia.sql` › Run.
2. GitHub › Actions › **Cópia de segurança** › execução da data desejada › **Artifacts** › baixar o `.zip`.
3. Na pasta do projeto: `node scripts/restaurar-copia.mjs "C:Users<você>Downloadscopia-12.zip"`
4. Colar a senha da cópia e a chave secreta (não aparecem na tela).
5. Conferir a simulação (na cópia, já existem, faltam, sem conta) e digitar `RESTAURAR`.

Opções: `--tabelas bp_readings,medications`; `--remedio <id>` (um remédio e o histórico de doses);
`--registro <id>` (um registro); `--sobrescrever` (o que existe volta a ficar igual à cópia; use junto
com `--tabelas`); `--sim` (não pergunta). Pode repetir sem duplicar.

Cuidados: restaurar no banco de produção também traz de volta o que foi apagado **de propósito**
depois da cópia (limite com as opções acima). Os áudios não voltam: a nota escrita continua, mas o
player fica sem o som. Projeto novo (Supabase perdido): rode `schema.sql`, `cron.sql` e
`restaurar-copia.sql`, faça `$env:SUPABASE_URL = "https://<novo>.supabase.co"` antes do comando e
use a chave do projeto novo; as pessoas entram de novo com o mesmo e-mail, mas só voltam os dados
de contas com o mesmo id.

## Privacidade

O áudio das consultas é enviado ao Google Gemini para gerar a nota. Se ele estiver fora do ar, o áudio vai para o Groq. Nenhuma das duas chamadas guarda estado da conversa. Regras completas em [SECURITY.md](SECURITY.md).
