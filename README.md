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

Testes: `npm test` (Edge Functions), `npm run test:db` (schema e RLS), `npm run check:functions` (tipos no Deno).

## Configuração (uma vez)

1. **Supabase:** crie o projeto e execute `supabase/schema.sql` no SQL Editor.
2. **GitHub Pages:** Settings > Pages > Source: **GitHub Actions**.
3. **GitHub > Settings > Secrets and variables > Actions**
   - *Variables* (públicas): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` e, opcionalmente, `ALLOWED_ORIGINS` e `GEMINI_MODEL`.
   - *Secrets:* `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `GEMINI_API_KEY` e `GROQ_API_KEY` (criar em https://console.groq.com/keys).

A cada push na `main`, os workflows publicam o site e as Edge Functions. Veja `supabase/functions/.env.example` para a lista completa de segredos das funções.

## Privacidade

O áudio das consultas é enviado ao Google Gemini para gerar a nota. Se ele estiver fora do ar, o áudio vai para o Groq. Nenhuma das duas chamadas guarda estado da conversa. Regras completas em [SECURITY.md](SECURITY.md).
