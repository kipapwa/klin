/**
 * CORS restrito às origens do app (segredo ALLOWED_ORIGINS, separado por
 * vírgula, ex.: "https://usuario.github.io,http://localhost:3000").
 */
export function corsHeaders(origin: string | null, allowedCsv: string | undefined): Record<string, string> {
  const allowed = (allowedCsv ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
