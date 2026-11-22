/**
 * "Perguntar à IA": manda à função `analisar` a pergunta e o mesmo conteúdo
 * do relatório que a pessoa vê na tela. Nada é guardado.
 */
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { ReportDoc } from "./report.ts";

export type AnalysisScope = "records" | "medications" | "pressure";

export const MIN_QUESTION_CHARS = 3;
export const MAX_QUESTION_CHARS = 500;
/** Mesmo limite da função (supabase/functions/_shared/analysis.ts). */
export const MAX_CONTEXT_CHARS = 60_000;
const CUT_NOTE = "\n[... conteúdo cortado por tamanho: os itens mais antigos não foram enviados]";

export const SUGGESTIONS: Record<AnalysisScope, string[]> = {
  records: [
    "Resuma meus registros",
    "Quais sintomas se repetem?",
    "Como está evoluindo minha pressão?",
    "O que levar para a próxima consulta?",
  ],
  medications: [
    "Como está minha adesão?",
    "Em que horários eu mais esqueço?",
    "Resuma meus remédios em uso",
    "O que perguntar ao médico sobre meus remédios?",
  ],
  pressure: [
    "Como está minha pressão?",
    "Em que horário ela fica mais alta?",
    "Melhorou em relação ao mês passado?",
    "O que levar para o médico sobre a pressão?",
  ],
};

/** Relatório em texto simples (o mesmo conteúdo do PDF), com limite de tamanho. */
export function reportToText(doc: ReportDoc, max = MAX_CONTEXT_CHARS): string {
  const lines: string[] = [doc.title, ...doc.meta, ""];
  for (const s of doc.sections) {
    lines.push(`== ${s.heading}${s.alert ? " [ALERTA]" : ""}`);
    for (const b of s.blocks) lines.push(b.label ? `${b.label}: ${b.text}` : b.text);
    lines.push("");
  }
  const text = lines.join("\n").trim();
  return text.length <= max ? text : text.slice(0, max - CUT_NOTE.length) + CUT_NOTE;
}

export class AnalysisError extends Error {}

export async function askAi(scope: AnalysisScope, question: string, context: string): Promise<{ answer: string; provider: string }> {
  const { getSupabase } = await import("./supabase");
  const { data, error } = await getSupabase().functions.invoke<{ answer: string; provider: string }>("analisar", {
    body: { scope, question: question.trim(), context },
  });
  if (error) {
    let message = "A IA não conseguiu responder. Tente de novo.";
    if (error instanceof FunctionsHttpError) {
      try {
        const body = (await error.context.json()) as { error?: unknown; detail?: unknown };
        if (typeof body.error === "string") message = body.error;
        if (typeof body.detail === "string" && body.detail) message += `\n\nDetalhe técnico: ${body.detail.slice(0, 400)}`;
      } catch {
        // resposta sem JSON
      }
    } else if (typeof navigator !== "undefined" && navigator.onLine === false) {
      message = "Sem internet. Tente de novo quando a conexão voltar.";
    }
    throw new AnalysisError(message);
  }
  if (!data?.answer) throw new AnalysisError("A IA não respondeu. Tente de novo.");
  return data;
}

/** O que foi analisado, para o histórico: "A IA vai analisar os 3 registros da lista." → "os 3 registros da lista". */
export function historyNote(scopeNote: string): string {
  return scopeNote.trim().replace(/^A IA vai analisar\s+/i, "").replace(/\.$/, "").slice(0, 300);
}
