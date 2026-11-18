/**
 * Web Push sem bibliotecas, só com WebCrypto (roda no Deno e no Node 24):
 *  - RFC 8292 (VAPID): JWT ES256 que identifica o servidor de aplicação;
 *  - RFC 8291 + RFC 8188 (aes128gcm): o conteúdo vai cifrado para o aparelho,
 *    ilegível para o serviço de push (Google, Apple, Mozilla).
 */

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const buf = (bytes: Uint8Array) => bytes as unknown as BufferSource;

/** HKDF-SHA256 (extract + expand) com `length` bytes de saída. */
export async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ---------------------------------------------------------------------
// VAPID (RFC 8292)
// ---------------------------------------------------------------------
export interface VapidKeys {
  /** Chave pública, base64url do ponto P-256 não comprimido (65 bytes). */
  publicKey: string;
  /** Chave privada, base64url do escalar "d" (32 bytes) — formato do `web-push generate-vapid-keys`. */
  privateKey: string;
  /** "mailto:..." ou "https://..." */
  subject: string;
}

async function importVapidPrivateKey(keys: VapidKeys): Promise<CryptoKey> {
  const pub = b64urlDecode(keys.publicKey);
  const d = b64urlDecode(keys.privateKey);
  if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) throw new Error("chaves VAPID inválidas");
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: b64urlEncode(pub.subarray(1, 33)),
      y: b64urlEncode(pub.subarray(33, 65)),
      d: keys.privateKey,
      ext: false,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** Cabeçalho Authorization: "vapid t=<JWT>, k=<chave pública>". */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: keys.subject })),
  );
  const unsigned = `${header}.${claims}`;
  const key = await importVapidPrivateKey(keys);
  // WebCrypto devolve a assinatura no formato r||s (IEEE P1363), que é o do JWS.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, buf(enc.encode(unsigned))),
  );
  return `vapid t=${unsigned}.${b64urlEncode(signature)}, k=${keys.publicKey}`;
}

// ---------------------------------------------------------------------
// Criptografia do conteúdo (RFC 8291, aes128gcm)
// ---------------------------------------------------------------------
const RECORD_SIZE = 4096;

/** Máximo de bytes de conteúdo que cabem num único registro. */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - 16 /* tag */ - 1 /* delimitador */ - 86 /* cabeçalho */;

/** Só para testes (vetor da RFC 8291): par de chaves e salt fixos. */
export interface FixedEncryptionParams {
  localKeys: CryptoKeyPair;
  salt: Uint8Array;
}

export async function encryptPayload(
  plaintext: Uint8Array,
  p256dh: string,
  authSecret: string,
  fixed?: FixedEncryptionParams,
): Promise<Uint8Array> {
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error("conteúdo do push grande demais");
  const uaPublic = b64urlDecode(p256dh);
  const auth = b64urlDecode(authSecret);
  if (uaPublic.length !== 65 || auth.length !== 16) throw new Error("inscrição push inválida");

  // Par de chaves efêmero do servidor (um por mensagem).
  const local =
    fixed?.localKeys ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", buf(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as EcdhKeyDeriveParams, local.privateKey, 256),
  );

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(auth, ecdhSecret, keyInfo, 32);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", buf(cek), "AES-GCM", false, ["encrypt"]);
  // Registro único: conteúdo + delimitador 0x02 (último registro).
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(nonce) }, aesKey, buf(concat(plaintext, new Uint8Array([2])))),
  );

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

// ---------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------
export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendOptions {
  /** Segundos que o serviço de push guarda a mensagem se o aparelho estiver offline. */
  ttl: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  /** Mensagens com o mesmo tópico substituem a anterior ainda não entregue. */
  topic?: string;
}

export type SendResult = { ok: true } | { ok: false; status: number | null; gone: boolean };

export async function sendWebPush(
  sub: PushSubscriptionKeys,
  payload: unknown,
  keys: VapidKeys,
  options: SendOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  if (!sub.endpoint.startsWith("https://")) return { ok: false, status: null, gone: true };
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), sub.p256dh, sub.auth);
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, keys),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(options.ttl),
    Urgency: options.urgency ?? "normal",
  };
  if (options.topic) headers.Topic = options.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);

  try {
    const res = await fetchImpl(sub.endpoint, {
      method: "POST",
      headers,
      body: buf(body),
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel();
    if (res.ok) return { ok: true };
    // 404/410: a inscrição não existe mais (app desinstalado, permissão revogada).
    return { ok: false, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch {
    return { ok: false, status: null, gone: false };
  }
}
