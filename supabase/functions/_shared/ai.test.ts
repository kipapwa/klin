import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  type AiConfig,
  AiError,
  AllProvidersFailed,
  GEMINI_INLINE_MAX_BYTES,
  structureAudio,
  structureWithGemini,
  structureWithGroq,
} from "./ai.ts";

const cfg: AiConfig = {
  geminiApiKey: "g-key",
  geminiModel: "gemini-3.8-flash",
  groqApiKey: "q-key",
  groqTranscriptionModel: "whisper-large-v3",
  groqChatModel: "llama-3.3-70b-versatile",
  timeoutMs: 5000,
};
const audio = new Uint8Array([1, 2, 3]);
const noteJson = JSON.stringify({ title: "Cefaleia", chief_complaint: "Dor de cabeça", category: "symptom" });
const silent = { error: () => {}, info: () => {} };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Call = { url: string; init: RequestInit };
function mockFetch(responses: Array<Response | Error>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("chamada inesperada");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return calls;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("Gemini: envia áudio inline com esquema e lê a resposta", async () => {
  const calls = mockFetch([
    json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "pensamento", thought: true }, { text: noteJson }] } }] }),
  ]);
  const r = await structureWithGemini(audio, "audio/webm;codecs=opus", cfg);
  assert.equal(r.provider, "gemini");
  assert.equal(r.note.title, "Cefaleia");

  assert.match(calls[0].url, /models\/gemini-3\.8-flash:generateContent$/);
  assert.equal((calls[0].init.headers as Record<string, string>)["x-goog-api-key"], "g-key");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.contents[0].parts[0].inlineData.mimeType, "audio/webm");
  assert.equal(body.contents[0].parts[0].inlineData.data, "AQID");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.ok(body.generationConfig.responseJsonSchema.properties.medications);
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "LOW");
});

test("Gemini 2.5 não recebe thinkingLevel", async () => {
  const calls = mockFetch([json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: noteJson }] } }] })]);
  await structureWithGemini(audio, "audio/webm", { ...cfg, geminiModel: "gemini-2.5-flash" });
  assert.equal(JSON.parse(String(calls[0].init.body)).generationConfig.thinkingConfig, undefined);
});

test("Gemini: resposta cortada (MAX_TOKENS) é falha", async () => {
  mockFetch([json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] })]);
  await assert.rejects(structureWithGemini(audio, "audio/webm", cfg), AiError);
});

test("Gemini: áudio acima do limite inline nem é enviado", async () => {
  const calls = mockFetch([]);
  await assert.rejects(structureWithGemini(new Uint8Array(GEMINI_INLINE_MAX_BYTES + 1), "audio/webm", cfg), AiError);
  assert.equal(calls.length, 0);
});

test("Groq: transcreve, estrutura e mantém a transcrição do Whisper", async () => {
  const calls = mockFetch([
    json({ text: "paciente com dor de cabeça" }),
    json({ choices: [{ message: { content: JSON.stringify({ title: "Cefaleia", chief_complaint: "Dor", transcript: "reescrito" }) } }] }),
  ]);
  const r = await structureWithGroq(audio, "audio/mp4", cfg);
  assert.equal(r.provider, "groq");
  assert.equal(r.note.transcript, "paciente com dor de cabeça");

  assert.match(calls[0].url, /audio\/transcriptions$/);
  const form = calls[0].init.body as FormData;
  assert.equal(form.get("model"), "whisper-large-v3");
  assert.equal(form.get("language"), "pt");
  assert.equal((form.get("file") as File).name, "audio.m4a");

  const chat = JSON.parse(String(calls[1].init.body));
  assert.equal(chat.model, "llama-3.3-70b-versatile");
  assert.deepEqual(chat.response_format, { type: "json_object" });
  assert.match(chat.messages[0].content, /JSON/);
});

test("structureAudio: Gemini falha (500) e o Groq responde", async () => {
  const logs: string[] = [];
  mockFetch([
    json({ error: "x" }, 500),
    json({ text: "relato" }),
    json({ choices: [{ message: { content: noteJson } }] }),
  ]);
  const r = await structureAudio(audio, "audio/webm", cfg, { error: (m) => logs.push(m), info: (m) => logs.push(m) });
  assert.equal(r.provider, "groq");
  assert.deepEqual(logs, ["gemini falhou: HTTP 500", "Respondido pela reserva: groq"]);
});

test("structureAudio: tempo esgotado também passa a vez", async () => {
  mockFetch([
    new DOMException("timeout", "TimeoutError"),
    json({ text: "relato" }),
    json({ choices: [{ message: { content: noteJson } }] }),
  ]);
  assert.equal((await structureAudio(audio, "audio/webm", cfg, silent)).provider, "groq");
});

test("structureAudio: todas falham com 429 => rateLimited", async () => {
  mockFetch([json({}, 429), json({}, 429)]);
  await assert.rejects(structureAudio(audio, "audio/webm", cfg, silent), (e: unknown) => {
    assert.ok(e instanceof AllProvidersFailed);
    assert.equal(e.rateLimited, true);
    return true;
  });
});

test("structureAudio: sem chaves => notConfigured; só Groq => vai direto ao Groq", async () => {
  await assert.rejects(
    structureAudio(audio, "audio/webm", { ...cfg, geminiApiKey: undefined, groqApiKey: undefined }, silent),
    (e: unknown) => e instanceof AllProvidersFailed && e.notConfigured,
  );
  const calls = mockFetch([json({ text: "relato" }), json({ choices: [{ message: { content: noteJson } }] })]);
  await structureAudio(audio, "audio/webm", { ...cfg, geminiApiKey: undefined }, silent);
  assert.ok(calls.every((c) => c.url.includes("groq.com")));
});

test("logs nunca contêm o conteúdo clínico", async () => {
  const logs: string[] = [];
  mockFetch([
    json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"title":"" }' }] } }] }),
    json({ text: "segredo clínico" }),
    json({ choices: [{ message: { content: "não é json segredo clínico" } }] }),
  ]);
  await assert.rejects(structureAudio(audio, "audio/webm", cfg, { error: (m) => logs.push(m), info: (m) => logs.push(m) }));
  assert.ok(logs.every((l) => !l.includes("segredo")));
});
