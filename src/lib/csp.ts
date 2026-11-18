/**
 * Content-Security-Policy entregue por <meta http-equiv> (o GitHub Pages
 * não permite cabeçalhos próprios). Limitações da versão em <meta>:
 * `frame-ancestors`, `report-uri` e `sandbox` são ignorados.
 */
const isDev = process.env.NODE_ENV === "development";

function supabaseHost(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return url ? new URL(url).host : "*.supabase.co";
}

const host = supabaseHost();

export const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  // Áudio: gravação local (blob:) e reprodução por Signed URL do Storage.
  `media-src 'self' blob: https://${host}`,
  // Banco, Auth, Storage e Edge Functions. As IAs são chamadas pela Edge
  // Function, nunca pelo navegador, por isso não aparecem aqui.
  `connect-src 'self' https://${host} wss://${host}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");
