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
   - *Emails > Templates > Magic Link:* o login é por **código de 6 dígitos**, então o modelo precisa mostrar `{{ .Token }}`. Exemplo: `<h2>Seu código do Klin</h2><p>{{ .Token }}</p><p>Ele expira em 1 hora.</p>`.
   - *URL Configuration > Site URL:* o endereço do site no GitHub Pages.
   - O envio de e-mail do plano gratuito é limitado (poucos por hora). Para uso real, configure um SMTP próprio em *Emails > SMTP Settings*.
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

## Privacidade

O áudio das consultas é enviado ao Google Gemini para gerar a nota. Se ele estiver fora do ar, o áudio vai para o Groq. Nenhuma das duas chamadas guarda estado da conversa. Regras completas em [SECURITY.md](SECURITY.md).
