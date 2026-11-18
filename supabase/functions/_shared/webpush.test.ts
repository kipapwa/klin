import assert from "node:assert/strict";
import { test } from "node:test";
import {
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  hkdf,
  MAX_PAYLOAD_BYTES,
  sendWebPush,
  vapidAuthorization,
  type VapidKeys,
} from "./webpush.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function vapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: b64urlEncode(raw), privateKey: jwk.d!, subject: "mailto:teste@exemplo.com" };
}

/** Lado do navegador: gera a inscrição (p256dh + auth). */
async function browserSubscription() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, p256dh: b64urlEncode(pub), auth: b64urlEncode(auth) };
}

/** Decifra como o navegador faria (RFC 8291/8188), para validar a ida e volta. */
async function browserDecrypt(body: Uint8Array, sub: Awaited<ReturnType<typeof browserSubscription>>): Promise<string> {
  const salt = body.subarray(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  assert.equal(rs, 4096);
  assert.equal(idlen, 65);

  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, sub.pair.privateKey, 256));
  const uaPublic = b64urlDecode(sub.p256dh);
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(b64urlDecode(sub.auth), ecdh, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  let end = padded.length - 1;
  while (padded[end] === 0) end--;
  assert.equal(padded[end], 2, "delimitador do último registro");
  return dec.decode(padded.subarray(0, end));
}

test("base64url ida e volta", () => {
  const bytes = crypto.getRandomValues(new Uint8Array(33));
  assert.deepEqual(b64urlDecode(b64urlEncode(bytes)), bytes);
  assert.doesNotMatch(b64urlEncode(bytes), /[+/=]/);
});

test("HKDF confere com o vetor de teste da RFC 5869 (caso 1)", async () => {
  const hex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
  const okm = await hkdf(hex("000102030405060708090a0b0c"), hex("0b".repeat(22)), hex("f0f1f2f3f4f5f6f7f8f9"), 42);
  assert.equal(
    [...okm].map((b) => b.toString(16).padStart(2, "0")).join(""),
    "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
  );
});

test("conteúdo cifrado só o aparelho inscrito decifra", async () => {
  const sub = await browserSubscription();
  const message = JSON.stringify({ title: "Klin", body: "Hora da sua medicação programada." });
  const body = await encryptPayload(enc.encode(message), sub.p256dh, sub.auth);
  assert.equal(await browserDecrypt(body, sub), message);
  assert.ok(!dec.decode(body).includes("medicação"), "texto não aparece em claro");

  const other = await browserSubscription();
  await assert.rejects(browserDecrypt(body, { ...other, p256dh: sub.p256dh, auth: sub.auth }), "outra chave não decifra");
});

test("confere byte a byte com o exemplo do Apêndice A da RFC 8291", async () => {
  const asPublic = b64urlDecode("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(asPublic.subarray(1, 33)),
    y: b64urlEncode(asPublic.subarray(33, 65)),
    d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  };
  const localKeys = {
    privateKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]),
    publicKey: await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, true, []),
  };
  const body = await encryptPayload(
    enc.encode("When I grow up, I want to be a watermelon"),
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    "BTBZMqHH6r4Tts7J_aSIgg",
    { localKeys, salt: b64urlDecode("DGv6ra1nlYgDCS1FRnbzlw") },
  );
  assert.equal(
    b64urlEncode(body),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
});

test("conteúdo grande demais é recusado", async () => {
  const sub = await browserSubscription();
  await assert.rejects(encryptPayload(new Uint8Array(MAX_PAYLOAD_BYTES + 1), sub.p256dh, sub.auth));
});

test("JWT VAPID: assinatura ES256 válida e claims corretas", async () => {
  const keys = await vapidKeys();
  const now = 1_800_000_000;
  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, now);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(m);
  assert.equal(m[2], keys.publicKey);
  const [h, p, s] = m[1].split(".");
  assert.deepEqual(JSON.parse(dec.decode(b64urlDecode(h))), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(JSON.parse(dec.decode(b64urlDecode(p))), {
    aud: "https://fcm.googleapis.com",
    exp: now + 12 * 3600,
    sub: "mailto:teste@exemplo.com",
  });
  const pub = await crypto.subtle.importKey("raw", b64urlDecode(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64urlDecode(s), enc.encode(`${h}.${p}`)));
});

test("sendWebPush: cabeçalhos, sucesso e inscrição expirada", async () => {
  const keys = await vapidKeys();
  const sub = await browserSubscription();
  const subscription = { endpoint: "https://push.exemplo/x", p256dh: sub.p256dh, auth: sub.auth };
  let seen: RequestInit | undefined;
  const fake = (status: number) =>
    (async (_url: string | URL | Request, init?: RequestInit) => {
      seen = init;
      return new Response(null, { status });
    }) as typeof fetch;

  assert.deepEqual(await sendWebPush(subscription, { a: 1 }, keys, { ttl: 1800, urgency: "high", topic: "dose:abc-1" }, fake(201)), { ok: true });
  const h = seen!.headers as Record<string, string>;
  assert.equal(h["Content-Encoding"], "aes128gcm");
  assert.equal(h.TTL, "1800");
  assert.equal(h.Urgency, "high");
  assert.equal(h.Topic, "doseabc-1");
  assert.match(h.Authorization, /^vapid t=/);
  assert.equal(await browserDecrypt(new Uint8Array(seen!.body as ArrayBuffer | Uint8Array), sub), '{"a":1}');

  assert.deepEqual(await sendWebPush(subscription, {}, keys, { ttl: 60 }, fake(410)), { ok: false, status: 410, gone: true });
  assert.deepEqual(await sendWebPush(subscription, {}, keys, { ttl: 60 }, fake(429)), { ok: false, status: 429, gone: false });
});
