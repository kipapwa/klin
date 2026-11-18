/** Utilidades de áudio (puras, testáveis no Node). */

/** Formatos em ordem de preferência: Chrome/Android (webm), Safari/iPhone (mp4), Firefox (ogg). */
export const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

/** Primeiro formato que o navegador sabe gravar, ou "" para deixar o navegador escolher. */
export function pickRecorderMime(isSupported: (mime: string) => boolean): string {
  return RECORDER_MIME_CANDIDATES.find((m) => isSupported(m)) ?? "";
}

/** "audio/webm;codecs=opus" -> "audio/webm" (o bucket compara o tipo sem parâmetros). */
export function baseMime(mime: string): string {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (m === "audio/x-m4a") return "audio/mp4";
  return m || "audio/webm";
}

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/aac": "aac",
};

export function extensionFor(mime: string): string {
  return EXTENSIONS[baseMime(mime)] ?? "webm";
}

/**
 * 30 min a 32 kbit/s ≈ 7 MB: cabe com folga no envio direto ao Gemini (14 MB)
 * e no limite do bucket (25 MB).
 */
export const MAX_RECORDING_SECONDS = 30 * 60;
export const RECORDER_BITS_PER_SECOND = 32_000;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
