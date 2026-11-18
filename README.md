# Klin

PWA de registros médicos por voz: grava o relato, a IA estrutura a nota clínica (com CID-10, categoria e gravidade), extrai medicamentos com lembretes de dose e monta a linha do tempo do paciente.

Stack: Next.js 16 (App Router) + TypeScript + Tailwind CSS 4, Supabase (Postgres, Auth, Storage), Gemini com Groq de reserva.

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha os valores
npm run dev                  # http://localhost:3000
```

Para testar Web Push localmente é preciso HTTPS: `npx next dev --experimental-https`.

## Banco de dados

Execute `supabase/schema.sql` no SQL Editor do Supabase. O script é idempotente e cria tabelas, enums, índices, gatilhos, políticas de RLS e o bucket privado `audio`.

## Segurança

Leia [SECURITY.md](SECURITY.md) antes de mexer em backend, autenticação ou banco.
