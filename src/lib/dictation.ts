/**
 * Montagem do texto ditado (puro, testável no Node).
 *
 * O reconhecimento de voz devolve trechos sem pontuação ("dor de cabeça há
 * dois dias vírgula pior à noite"). Aqui: comandos falados viram pontuação,
 * a primeira letra de cada frase fica maiúscula e o trecho é emendado no que
 * já estava escrito com o espaço certo.
 */

/** Comandos falados -> pontuação (mais longos primeiro). */
const COMMANDS: [RegExp, string][] = [
  [/\s*\b(ponto de interroga[çc][ãa]o)\b/gi, "?"],
  [/\s*\b(ponto de exclama[çc][ãa]o)\b/gi, "!"],
  [/\s*\b(ponto final)\b/gi, "."],
  [/\s*\b(ponto e v[íi]rgula)\b/gi, ";"],
  [/\s*\b(dois pontos)\b/gi, ":"],
  [/\s*\b(v[íi]rgula)\b/gi, ","],
  [/\s*\b(nova linha|novo par[áa]grafo|par[áa]grafo)\b\s*/gi, "\n"],
];

export function applyCommands(text: string): string {
  let out = text;
  for (const [re, mark] of COMMANDS) out = out.replace(re, mark);
  // espaço depois da pontuação, nunca antes
  return out
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])(?=[^\s\d])/g, "$1 ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/[ \t]{2,}/g, " ");
}

/** Maiúscula no início do texto e depois de . ! ? ou nova linha. */
export function capitalizeSentences(text: string, startsSentence: boolean): string {
  let capitalizeNext = startsSentence;
  let out = "";
  for (const ch of text) {
    if (capitalizeNext && /\p{L}/u.test(ch)) {
      out += ch.toLocaleUpperCase("pt-BR");
      capitalizeNext = false;
    } else {
      out += ch;
      if (/[.!?\n]/.test(ch)) capitalizeNext = true;
      else if (/\p{L}|\d/u.test(ch)) capitalizeNext = false;
    }
  }
  return out;
}

/** Emenda um trecho ditado no texto que já existe. */
export function appendDictation(existing: string, spoken: string): string {
  const piece = applyCommands(spoken.trim());
  if (!piece) return existing;
  const before = existing.replace(/[ \t]+$/, "");
  const startsSentence = before === "" || /[.!?\n]$/.test(before);
  const formatted = capitalizeSentences(piece, startsSentence);
  if (before === "") return formatted;
  const glue = /^[,.;:!?\n]/.test(formatted) || before.endsWith("\n") ? "" : " ";
  return before + glue + formatted;
}
