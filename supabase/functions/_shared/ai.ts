/**
 * Estruturação clínica do áudio: Gemini primeiro, Groq como reserva.
 *
 * Qualquer falha passa a vez para a próxima IA: rede, status != 2xx,
 * tempo esgotado, JSON inválido ou sem conteúdo clínico.
 *
 * PRIVACIDADE: nada do conteúdo (áudio, transcrição, resposta) vai para
 * os logs — só o nome da IA, o status HTTP e o motivo genérico.
 *
 * Módulo sem dependências do Deno: a configuração chega por parâmetro.
 */
import {
  CLINICAL_NOTE_JSON_SCHEMA,
  type ClinicalNote,
  GROQ_JSON_INSTRUCTIONS,
  parseJsonObject,
  SYSTEM_PROMPT,
  validateClinicalNote,
} from "./clinical-note.ts";

export type Provider = "gemini" | "groq";

export interface AiConfig {
  geminiApiKey?: string;
  geminiModel: string;
  groqApiKey?: string;
  groqTranscriptionModel: string;
  groqChatModel: string;
  timeoutMs: number;
}

export interface AiResult {
  note: ClinicalNote;
  provider: Provider;
  model: string;
}

export class AiError extends Error {
  readonly provider: Provider;
  readonly status: number | null;
  /** Motivo técnico devolvido pela IA (sem conteúdo clínico; ver safeDetail). */
  readonly detail: string | null;
  constructor(provider: Provider, message: string, status: number | null = null, detail: string | null = null) {
    super(message);
    this.provider = provider;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Motivo técnico do erro da IA, seguro para mostrar e registrar: só o código,
 * o status e a mensagem SEM trechos entre aspas (onde um valor do pedido —
 * dado clínico — poderia aparecer), cortada em 160 caracteres.
 */
export function safeDetail(body: unknown): string | null {
  const err = (body as { error?: unknown } | null)?.error;
  if (!err || typeof err !== "object") return null;
  const e = err as { status?: unknown; code?: unknown; type?: unknown; message?: unknown };
  const parts = [e.status, e.code, e.type]
    .filter((v) => typeof v === "string" || typeof v === "number")
    .map(String)
    .filter((v, i, all) => all.indexOf(v) === i);
  if (typeof e.message === "string") {
    parts.push(
      e.message
        .replace(/"[^"]*"|'[^']*'|`[^`]*`|“[^”]*”/g, "…")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160),
    );
  }
  return parts.join(" ").trim() || null;
}

export class AllProvidersFailed extends Error {
  readonly rateLimited: boolean;
  readonly notConfigured: boolean;
  /** Ex.: "gemini: HTTP 400 (INVALID_ARGUMENT …) · groq: HTTP 404 (model_not_found …)". */
  readonly summary: string;
  constructor(errors: AiError[], notConfigured: boolean) {
    super(notConfigured ? "nenhuma IA configurada" : "todas as IAs falharam");
    this.rateLimited = errors.some((e) => e.status === 429);
    this.notConfigured = notConfigured;
    this.summary = errors.map((e) => `${e.provider}: ${e.message}${e.detail ? ` (${e.detail})` : ""}`).join(" · ");
  }
}

/** Gemini aceita até 20 MB por pedido; em base64 o áudio cresce 4/3. */
export const GEMINI_INLINE_MAX_BYTES = 14 * 1024 * 1024;

const USER_PROMPT = "Estruture o relato deste áudio na nota clínica em JSON.";
const USER_PROMPT_TEXT = "Estruture o relato escrito abaixo na nota clínica em JSON.";

/** Tamanho máximo do relato escrito enviado à IA. */
export const MAX_TEXT_CHARS = 20000;

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

/** "audio/webm;codecs=opus" -> "audio/webm"; normaliza variações de m4a. */
export function baseMime(mime: string): string {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (m === "audio/x-m4a" || m === "audio/mp4") return "audio/m4a";
  if (m === "audio/mp3") return "audio/mpeg";
  return m;
}

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "m4a",
  "audio/wav": "wav",
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function postJson(
  provider: Provider,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new AiError(provider, timedOut ? "tempo esgotado" : "erro de rede");
  }
  if (!res.ok) {
    let detail: string | null = null;
    try {
      detail = safeDetail(await res.json());
    } catch {
      // corpo sem JSON
    }
    throw new AiError(provider, `HTTP ${res.status}`, res.status, detail);
  }
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new AiError(provider, "resposta não é JSON", res.status);
  }
}

/** Gemini 3+ aceita thinkingLevel; o 2.5 usa outro formato e recusaria o pedido. */
function supportsThinkingLevel(model: string): boolean {
  const m = /^gemini-(\d+)/.exec(model);
  return m ? Number(m[1]) >= 3 : false;
}

// ---------------------------------------------------------------------
// Gemini: recebe o áudio direto e devolve JSON no esquema (generateContent,
// sem armazenamento de estado no Google, ao contrário da Interactions API).
// ---------------------------------------------------------------------
export async function structureWithGemini(
  audio: Uint8Array,
  mime: string,
  cfg: AiConfig,
): Promise<AiResult> {
  if (!cfg.geminiApiKey) throw new AiError("gemini", "sem chave");
  if (audio.byteLength > GEMINI_INLINE_MAX_BYTES) {
    throw new AiError("gemini", "áudio grande demais para envio direto");
  }
  return geminiNote(
    [{ inlineData: { mimeType: baseMime(mime), data: bytesToBase64(audio) } }, { text: USER_PROMPT }],
    cfg,
  );
}

/** Relato escrito (registro manual): mesmo esquema e mesma validação. */
export async function structureTextWithGemini(text: string, cfg: AiConfig): Promise<AiResult> {
  if (!cfg.geminiApiKey) throw new AiError("gemini", "sem chave");
  const result = await geminiNote([{ text: `${USER_PROMPT_TEXT}\n"""\n${text}\n"""` }], cfg);
  result.note.transcript = text.slice(0, 100000); // o texto da pessoa é a fonte fiel
  return result;
}

async function geminiNote(userParts: unknown[], cfg: AiConfig): Promise<AiResult> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: userParts,
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: CLINICAL_NOTE_JSON_SCHEMA,
      maxOutputTokens: 16384,
      ...(supportsThinkingLevel(cfg.geminiModel) ? { thinkingConfig: { thinkingLevel: "LOW" } } : {}),
    },
  };

  const data = await postJson("gemini", url, {
    method: "POST",
    headers: { "x-goog-api-key": cfg.geminiApiKey!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, cfg.timeoutMs);

  const candidate = (data.candidates as Array<Record<string, unknown>> | undefined)?.[0];
  if (!candidate) throw new AiError("gemini", "sem resposta (bloqueada ou vazia)");
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    throw new AiError("gemini", `finalizou com ${String(candidate.finishReason)}`);
  }
  const parts = ((candidate.content as Record<string, unknown> | undefined)?.parts ?? []) as Array<
    { text?: string; thought?: boolean }
  >;
  const text = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");

  try {
    return { note: validateClinicalNote(parseJsonObject(text)), provider: "gemini", model: cfg.geminiModel };
  } catch {
    throw new AiError("gemini", "JSON inválido ou sem conteúdo");
  }
}

// ---------------------------------------------------------------------
// Groq: Whisper transcreve, depois o Llama estrutura em modo JSON.
// ---------------------------------------------------------------------
export async function structureWithGroq(
  audio: Uint8Array,
  mime: string,
  cfg: AiConfig,
): Promise<AiResult> {
  if (!cfg.groqApiKey) throw new AiError("groq", "sem chave");
  const auth = { Authorization: `Bearer ${cfg.groqApiKey}` };
  const type = baseMime(mime);

  const form = new FormData();
  form.append("file", new Blob([audio as BlobPart], { type }), `audio.${EXTENSIONS[type] ?? "webm"}`);
  form.append("model", cfg.groqTranscriptionModel);
  form.append("language", "pt");
  form.append("temperature", "0");
  form.append("response_format", "json");

  const transcription = await postJson(
    "groq",
    "https://api.groq.com/openai/v1/audio/transcriptions",
    { method: "POST", headers: auth, body: form },
    cfg.timeoutMs,
  );
  const transcript = typeof transcription.text === "string" ? transcription.text.trim() : "";
  if (!transcript) throw new AiError("groq", "transcrição vazia");
  return groqNote(transcript, "Transcrição do relato", cfg, cfg.groqTranscriptionModel + "+" + cfg.groqChatModel);
}

/** Relato escrito: vai direto ao Llama (sem transcrição). */
export async function structureTextWithGroq(text: string, cfg: AiConfig): Promise<AiResult> {
  if (!cfg.groqApiKey) throw new AiError("groq", "sem chave");
  return groqNote(text, "Relato escrito pelo paciente", cfg, cfg.groqChatModel);
}

async function groqNote(transcript: string, label: string, cfg: AiConfig, model: string): Promise<AiResult> {
  const auth = { Authorization: "Bearer " + cfg.groqApiKey };
  const chat = await postJson("groq", "https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.groqChatModel,
      temperature: 0.2,
      max_completion_tokens: 8192,
      // Modelos de raciocínio (gpt-oss): pouco raciocínio basta e sobra espaço para o JSON.
      ...(cfg.groqChatModel.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${GROQ_JSON_INSTRUCTIONS}` },
        { role: "user", content: `${label}:\n"""\n${transcript}\n"""` },
      ],
    }),
  }, cfg.timeoutMs);

  const choices = chat.choices as Array<{ message?: { content?: string } }> | undefined;
  const text = choices?.[0]?.message?.content ?? "";
  try {
    const note = validateClinicalNote(parseJsonObject(text), transcript);
    // O texto original (Whisper ou digitado) é a fonte fiel; o LLM só reescreveria.
    note.transcript = transcript.slice(0, 100000);
    return { note, provider: "groq", model };
  } catch {
    throw new AiError("groq", "JSON inválido ou sem conteúdo");
  }
}

// ---------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------
type Step = (audio: Uint8Array, mime: string, cfg: AiConfig) => Promise<AiResult>;
type TextStep = (text: string, cfg: AiConfig) => Promise<AiResult>;

export interface Logger {
  error: (msg: string) => void;
  info: (msg: string) => void;
}

export async function structureAudio(
  audio: Uint8Array,
  mime: string,
  cfg: AiConfig,
  log: Logger,
  steps: Partial<Record<Provider, Step>> = {},
): Promise<AiResult> {
  return runChain(cfg, log, {
    gemini: () => (steps.gemini ?? structureWithGemini)(audio, mime, cfg),
    groq: () => (steps.groq ?? structureWithGroq)(audio, mime, cfg),
  });
}

/** Registro escrito à mão: Gemini primeiro, Groq de reserva. */
export async function structureText(
  text: string,
  cfg: AiConfig,
  log: Logger,
  steps: Partial<Record<Provider, TextStep>> = {},
): Promise<AiResult> {
  const clean = text.trim().slice(0, MAX_TEXT_CHARS);
  return runChain(cfg, log, {
    gemini: () => (steps.gemini ?? structureTextWithGemini)(clean, cfg),
    groq: () => (steps.groq ?? structureTextWithGroq)(clean, cfg),
  });
}

// ---------------------------------------------------------------------
// Texto livre ("Perguntar à IA"): mesma cadeia Gemini -> Groq, sem JSON.
// ---------------------------------------------------------------------
export interface TextAnswer {
  text: string;
  provider: Provider;
  model: string;
}

export async function answerWithGemini(system: string, user: string, cfg: AiConfig): Promise<TextAnswer> {
  if (!cfg.geminiApiKey) throw new AiError("gemini", "sem chave");
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel)}:generateContent`;
  const data = await postJson("gemini", url, {
    method: "POST",
    headers: { "x-goog-api-key": cfg.geminiApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: 4096,
        ...(supportsThinkingLevel(cfg.geminiModel) ? { thinkingConfig: { thinkingLevel: "LOW" } } : {}),
      },
    }),
  }, cfg.timeoutMs);
  const candidate = (data.candidates as Array<Record<string, unknown>> | undefined)?.[0];
  if (!candidate) throw new AiError("gemini", "sem resposta (bloqueada ou vazia)");
  if (candidate.finishReason && candidate.finishReason !== "STOP" && candidate.finishReason !== "MAX_TOKENS") {
    throw new AiError("gemini", `finalizou com ${String(candidate.finishReason)}`);
  }
  const parts = ((candidate.content as Record<string, unknown> | undefined)?.parts ?? []) as Array<{ text?: string; thought?: boolean }>;
  const text = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
  if (!text) throw new AiError("gemini", "resposta vazia");
  return { text, provider: "gemini", model: cfg.geminiModel };
}

export async function answerWithGroq(system: string, user: string, cfg: AiConfig): Promise<TextAnswer> {
  if (!cfg.groqApiKey) throw new AiError("groq", "sem chave");
  const chat = await postJson("groq", "https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + cfg.groqApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.groqChatModel,
      temperature: 0.3,
      max_completion_tokens: 4096,
      ...(cfg.groqChatModel.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  }, cfg.timeoutMs);
  const choices = chat.choices as Array<{ message?: { content?: string } }> | undefined;
  const text = (choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!text) throw new AiError("groq", "resposta vazia");
  return { text, provider: "groq", model: cfg.groqChatModel };
}

type AnswerStep = (system: string, user: string, cfg: AiConfig) => Promise<TextAnswer>;

/** Pergunta livre: Gemini primeiro, Groq de reserva. */
export async function answerText(
  system: string,
  user: string,
  cfg: AiConfig,
  log: Logger,
  steps: Partial<Record<Provider, AnswerStep>> = {},
): Promise<TextAnswer> {
  return runChain(cfg, log, {
    gemini: () => (steps.gemini ?? answerWithGemini)(system, user, cfg),
    groq: () => (steps.groq ?? answerWithGroq)(system, user, cfg),
  });
}

async function runChain<T>(cfg: AiConfig, log: Logger, calls: Record<Provider, () => Promise<T>>): Promise<T> {
  const chain: Array<[Provider, () => Promise<T>]> = [];
  if (cfg.geminiApiKey) chain.push(["gemini", calls.gemini]);
  if (cfg.groqApiKey) chain.push(["groq", calls.groq]);
  if (chain.length === 0) throw new AllProvidersFailed([], true);

  const errors: AiError[] = [];
  for (const [index, [provider, call]] of chain.entries()) {
    try {
      const result = await call();
      if (index > 0) log.info(`Respondido pela reserva: ${provider}`);
      return result;
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError(provider, "erro inesperado");
      log.error(`${provider} falhou: ${e.message}${e.detail ? ` (${e.detail})` : ""}`);
      errors.push(e);
    }
  }
  throw new AllProvidersFailed(errors, false);
}
