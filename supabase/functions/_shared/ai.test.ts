import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  type AiConfig,
  AiError,
  AllProvidersFailed,
  answerText,
  GEMINI_INLINE_MAX_BYTES,
  MAX_TEXT_CHARS,
  safeDetail,
  structureText,
  structureTextWithGroq,
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

// --- Registro escrito (sem áudio) --------------------------------------------
test("texto: Gemini recebe só texto (sem áudio) e a transcrição é o texto original", async () => {
  const calls = mockFetch([json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: noteJson }] } }] })]);
  const r = await structureText("  Dor de cabeça há 2 dias, tomei dipirona.  ", cfg, silent);
  assert.equal(r.provider, "gemini");
  assert.equal(r.note.transcript, "Dor de cabeça há 2 dias, tomei dipirona.");
  const parts = JSON.parse(String(calls[0].init.body)).contents[0].parts;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].inlineData, undefined);
  assert.match(parts[0].text, /relato escrito[\s\S]*Dor de cabeça há 2 dias/);
});

test("texto: reserva no Groq vai direto ao Llama (sem Whisper)", async () => {
  const calls = mockFetch([json({}, 503), json({ choices: [{ message: { content: noteJson } }] })]);
  const r = await structureText("Febre de 38,5 desde ontem.", cfg, silent);
  assert.equal(r.provider, "groq");
  assert.equal(r.model, "llama-3.3-70b-versatile");
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /chat\/completions$/);
  assert.match(JSON.parse(String(calls[1].init.body)).messages[1].content, /Relato escrito pelo paciente:[\s\S]*Febre de 38,5/);
  assert.equal(r.note.transcript, "Febre de 38,5 desde ontem.");
});

test("texto: corta no tamanho máximo antes de enviar", async () => {
  const calls = mockFetch([json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: noteJson }] } }] })]);
  await structureText("x".repeat(MAX_TEXT_CHARS + 500), cfg, silent);
  const sent = JSON.parse(String(calls[0].init.body)).contents[0].parts[0].text as string;
  assert.ok(sent.length < MAX_TEXT_CHARS + 200);
});

// --- Diagnóstico quando as IAs falham -------------------------------------------
test("safeDetail: código e motivo sem trechos entre aspas (onde poderia haver dado clínico)", () => {
  // Formato real: valores do pedido vêm entre aspas nas mensagens dos provedores.
  const google = { error: { code: 400, status: "INVALID_ARGUMENT", message: 'Invalid value at "contents[0].parts[0].text" ("Dor no peito, segredo")' } };
  const d = safeDetail(google)!;
  assert.equal(d, "INVALID_ARGUMENT 400 Invalid value at … (…)");
  assert.ok(!d.includes("segredo") && !d.includes("Dor"));
  assert.equal(safeDetail({ error: { message: "The model `llama-x` does not exist", type: "invalid_request_error", code: "model_not_found" } }), "model_not_found invalid_request_error The model … does not exist");
  assert.equal(safeDetail("não é objeto"), null);
  assert.ok(safeDetail({ error: { message: "x".repeat(500) } })!.length <= 160);
});

test("falha das duas IAs: resumo técnico por IA (sem conteúdo)", async () => {
  mockFetch([
    json({ error: { code: 400, status: "INVALID_ARGUMENT", message: 'Unknown name "foo"' } }, 400),
    json({ error: { message: "The model `llama` does not exist", code: "model_not_found" } }, 404),
  ]);
  await assert.rejects(structureText("Febre desde ontem, segredo clínico.", cfg, silent), (e: unknown) => {
    assert.ok(e instanceof AllProvidersFailed);
    assert.equal(e.summary, "gemini: HTTP 400 (INVALID_ARGUMENT 400 Unknown name …) · groq: HTTP 404 (model_not_found The model … does not exist)");
    assert.ok(!e.summary.includes("segredo"));
    return true;
  });
});

test("gpt-oss no Groq recebe reasoning_effort; outros modelos não", async () => {
  const gpt = mockFetch([json({ choices: [{ message: { content: noteJson } }] })]);
  await structureTextWithGroq("Febre.", { ...cfg, groqChatModel: "openai/gpt-oss-120b" });
  assert.equal(JSON.parse(String(gpt[0].init.body)).reasoning_effort, "low");
  const llama = mockFetch([json({ choices: [{ message: { content: noteJson } }] })]);
  await structureTextWithGroq("Febre.", cfg);
  assert.equal(JSON.parse(String(llama[0].init.body)).reasoning_effort, undefined);
});

// --- Perguntar à IA (texto livre) -----------------------------------------------
test("pergunta livre: Gemini sem JSON (sem esquema) e Groq de reserva", async () => {
  const calls = mockFetch([
    json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "rascunho", thought: true }, { text: "Sua pressão subiu na última semana." }] } }] }),
  ]);
  const a = await answerText("sistema", "pedido", cfg, silent);
  assert.deepEqual([a.provider, a.text], ["gemini", "Sua pressão subiu na última semana."]);
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.generationConfig.responseMimeType, undefined, "resposta em texto, não JSON");
  assert.equal(body.systemInstruction.parts[0].text, "sistema");

  mockFetch([json({ error: { code: 503, status: "UNAVAILABLE", message: "overloaded" } }, 503), json({ choices: [{ message: { content: "<think>x</think>Resposta do Groq." } }] })]);
  const b = await answerText("sistema", "pedido", cfg, silent);
  assert.deepEqual([b.provider, b.text], ["groq", "Resposta do Groq."]);
});

test("pergunta livre: resposta vazia passa a vez", async () => {
  mockFetch([json({ candidates: [{ finishReason: "STOP", content: { parts: [] } }] }), json({ choices: [{ message: { content: "" } }] })]);
  await assert.rejects(answerText("s", "p", cfg, silent), AllProvidersFailed);
});
