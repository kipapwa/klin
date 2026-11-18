/**
 * Content-Security-Policy entregue por <meta http-equiv> (o GitHub Pages
 * não permite cabeçalhos próprios). Limitações da versão em <meta>:
 * `frame-ancestors`, `report-uri` e `sandbox` são ignorados.
 */
const isDev = process.env.NODE_ENV === "development";

/** Origem exata do Supabase (https em produção; http no Supabase local). */
function supabaseOrigins(): { http: string; ws: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return { http: "https://*.supabase.co", ws: "wss://*.supabase.co" };
  const origin = new URL(url).origin;
  return { http: origin, ws: origin.replace(/^http/, "ws") };
}

const supabase = supabaseOrigins();

export const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  // Áudio: gravação local (blob:) e reprodução por Signed URL do Storage.
  `media-src 'self' blob: ${supabase.http}`,
  // Banco, Auth, Storage e Edge Functions. As IAs são chamadas pela Edge
  // Function, nunca pelo navegador, por isso não aparecem aqui.
  `connect-src 'self' ${supabase.http} ${supabase.ws}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");
