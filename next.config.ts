import type { NextConfig } from "next";

/**
 * Hospedagem: GitHub Pages (somente arquivos estáticos).
 *
 * - `output: "export"` gera o site em `out/`. Não há servidor Next:
 *   nada de Route Handlers, Server Actions, Proxy nem `headers()`.
 * - Todo código com segredo (IA, Web Push, agendamentos) roda em
 *   Supabase Edge Functions (`supabase/functions/`).
 * - A CSP vai numa <meta> em `src/app/layout.tsx` (ver `src/lib/csp.ts`).
 * - NEXT_PUBLIC_BASE_PATH: "" com domínio próprio; "/<repo>" quando o site
 *   fica em https://<usuario>.github.io/<repo>/.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
