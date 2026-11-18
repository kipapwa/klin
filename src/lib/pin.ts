/**
 * PIN do bloqueio de tela (puro + WebCrypto, testável no Node).
 * Guarda só um hash PBKDF2-SHA256 com sal aleatório — nunca o PIN.
 */

export interface StoredPin {
  v: 1;
  salt: string; // base64
  hash: string; // base64
  iterations: number;
}

/** Recomendação da OWASP (2023) para PBKDF2-HMAC-SHA256. */
export const PIN_ITERATIONS = 600_000;

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** null se o PIN é aceitável; senão, a mensagem do problema. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4,8}$/.test(pin)) return "O PIN deve ter de 4 a 8 números.";
  if (/^(\d)\1+$/.test(pin)) return "Evite números repetidos (ex.: 1111).";
  const digits = [...pin].map(Number);
  const step = digits[1] - digits[0];
  if (Math.abs(step) === 1 && digits.every((d, i) => i === 0 || d - digits[i - 1] === step)) {
    return "Evite sequências (ex.: 1234).";
  }
  return null;
}

export async function hashPin(pin: string, iterations = PIN_ITERATIONS): Promise<StoredPin> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { v: 1, salt: toB64(salt), hash: toB64(await derive(pin, salt, iterations)), iterations };
}

export async function verifyPin(pin: string, stored: StoredPin): Promise<boolean> {
  const actual = await derive(pin, fromB64(stored.salt), stored.iterations);
  const expected = fromB64(stored.hash);
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ (expected[i] ?? 0);
  return diff === 0;
}

/** Depois de 10 erros seguidos, o app sai da conta (recuperação pelo login por e-mail). */
export const MAX_FAILURES = 10;

/** Espera (ms) antes de aceitar nova tentativa, após `failures` erros seguidos. */
export function lockoutDelay(failures: number): number {
  if (failures < 5) return 0;
  return Math.min(30_000 * 2 ** (failures - 5), 15 * 60_000);
}
