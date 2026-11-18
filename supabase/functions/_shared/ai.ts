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
  constructor(provider: Provider, message: string, status: number | null = null) {
    super(message);
    this.provider = provider;
    this.status = status;
  }
}

export class AllProvidersFailed extends Error {
  readonly rateLimited: boolean;
  readonly notConfigured: boolean;
  constructor(errors: AiError[], notConfigured: boolean) {
    super(notConfigured ? "nenhuma IA configurada" : "todas as IAs falharam");
    this.rateLimited = errors.some((e) => e.status === 429);
    this.notConfigured = notConfigured;
  }
}

/** Gemini aceita até 20 MB por pedido; em base64 o áudio cresce 4/3. */
export const GEMINI_INLINE_MAX_BYTES = 14 * 1024 * 1024;

const USER_PROMPT = "Estruture o relato deste áudio na nota clínica em JSON.";

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
    await res.body?.cancel();
    throw new AiError(provider, `HTTP ${res.status}`, res.status);
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

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: baseMime(mime), data: bytesToBase64(audio) } },
          { text: USER_PROMPT },
        ],
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
    headers: { "x-goog-api-key": cfg.geminiApiKey, "Content-Type": "application/json" },
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

  const chat = await postJson("groq", "https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.groqChatModel,
      temperature: 0.2,
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${GROQ_JSON_INSTRUCTIONS}` },
        { role: "user", content: `Transcrição do relato:\n"""\n${transcript}\n"""` },
      ],
    }),
  }, cfg.timeoutMs);

  const choices = chat.choices as Array<{ message?: { content?: string } }> | undefined;
  const text = choices?.[0]?.message?.content ?? "";
  try {
    const note = validateClinicalNote(parseJsonObject(text), transcript);
    // A transcrição do Whisper é a fonte fiel; o LLM só reescreveria.
    note.transcript = transcript.slice(0, 100000);
    return { note, provider: "groq", model: `${cfg.groqTranscriptionModel}+${cfg.groqChatModel}` };
  } catch {
    throw new AiError("groq", "JSON inválido ou sem conteúdo");
  }
}

// ---------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------
type Step = (audio: Uint8Array, mime: string, cfg: AiConfig) => Promise<AiResult>;

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
  const chain: Array<[Provider, Step]> = [];
  if (cfg.geminiApiKey) chain.push(["gemini", steps.gemini ?? structureWithGemini]);
  if (cfg.groqApiKey) chain.push(["groq", steps.groq ?? structureWithGroq]);
  if (chain.length === 0) throw new AllProvidersFailed([], true);

  const errors: AiError[] = [];
  for (const [index, [provider, step]] of chain.entries()) {
    try {
      const result = await step(audio, mime, cfg);
      if (index > 0) log.info(`Respondido pela reserva: ${provider}`);
      return result;
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError(provider, "erro inesperado");
      log.error(`${provider} falhou: ${e.message}`);
      errors.push(e);
    }
  }
  throw new AllProvidersFailed(errors, false);
}
