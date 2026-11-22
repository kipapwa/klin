import type { AiConfig } from "./ai.ts";

/** Configuração das IAs a partir dos segredos da função (mesma para todas as funções). */
export function aiConfigFromEnv(env: (name: string) => string | undefined): AiConfig {
  const timeout = Number(env("AI_TIMEOUT_MS"));
  return {
    geminiApiKey: env("GEMINI_API_KEY"),
    geminiModel: env("GEMINI_MODEL") ?? "gemini-3.8-flash",
    groqApiKey: env("GROQ_API_KEY"),
    groqTranscriptionModel: env("GROQ_TRANSCRIPTION_MODEL") ?? "whisper-large-v3",
    // llama-3.3-70b-versatile passou a ser plano Enterprise no Groq; gpt-oss-120b é de produção.
    groqChatModel: env("GROQ_CHAT_MODEL") ?? "openai/gpt-oss-120b",
    timeoutMs: Number.isFinite(timeout) && timeout >= 5000 ? timeout : 45000,
  };
}
