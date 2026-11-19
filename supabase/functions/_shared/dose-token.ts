/**
 * "Marcar como tomado" direto da notificação, sem abrir o app.
 *
 * O Service Worker não tem o login. Por isso cada lembrete leva uma assinatura
 * (HMAC-SHA256) que autoriza só UMA coisa: marcar AQUELA dose (remédio + dono
 * + horário) como tomada, até 24 h depois do horário. A chave deriva do
 * CRON_SECRET (rótulo próprio), então não há segredo novo para cadastrar.
 * O payload vai cifrado ponta a ponta até o aparelho (RFC 8291).
 *
 * TS puro com WebCrypto: roda no Node (testes) e no Deno (Edge Function).
 */

export const DOSE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const LABEL = "klin:marcar-dose:v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DoseClaims {
  medicationId: string;
  userId: string;
  scheduledFor: string; // ISO
  exp: number; // ms
}

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(message));
}

function message(c: DoseClaims): string {
  return ["v1", c.medicationId.toLowerCase(), c.userId.toLowerCase(), new Date(c.scheduledFor).toISOString(), String(c.exp)].join("\n");
}

export async function signDose(secret: string, claims: DoseClaims): Promise<string> {
  const subkey = await hmac(enc.encode(secret), LABEL);
  return b64url(await hmac(subkey, message(claims)));
}

function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function verifyDose(secret: string, claims: DoseClaims, token: string): Promise<boolean> {
  return sameText(await signDose(secret, claims), token);
}

export interface MarkRequest {
  medicationId: string;
  scheduledFor: string;
  exp: number;
  token: string;
}

/** Valida o corpo enviado pelo Service Worker (nada além do necessário). */
export function parseMarkRequest(body: unknown): MarkRequest | null {
  if (!body || typeof body !== "object") return null;
  const { medicationId, scheduledFor, exp, token } = body as Record<string, unknown>;
  if (typeof medicationId !== "string" || !UUID_RE.test(medicationId)) return null;
  if (typeof scheduledFor !== "string" || scheduledFor.length > 40 || Number.isNaN(Date.parse(scheduledFor))) return null;
  if (typeof exp !== "number" || !Number.isSafeInteger(exp)) return null;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return { medicationId, scheduledFor: new Date(scheduledFor).toISOString(), exp, token };
}
