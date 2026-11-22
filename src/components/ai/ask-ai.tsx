"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { MicIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useDictation } from "@/hooks/use-dictation";
import { AnalysisError, askAi, MAX_QUESTION_CHARS, MIN_QUESTION_CHARS, reportToText, SUGGESTIONS, type AnalysisScope } from "@/lib/analysis";
import { appendDictation } from "@/lib/dictation";
import type { PreparedReport } from "@/lib/export-report";
import { UserFacingError } from "@/lib/records";

type Phase = { kind: "compose" } | { kind: "thinking" } | { kind: "answer"; question: string; answer: string; provider: string };

/**
 * "✨ Perguntar à IA": a pessoa escreve (ou dita) o que quer saber; a IA
 * analisa o mesmo conteúdo do relatório da tela (`prepare`). Nada é guardado.
 * `scopeNote` explica o que vai ser analisado; `controls` (ex.: período) fica acima.
 */
export function AskAiButton({
  scope,
  prepare,
  scopeNote,
  controls,
  disabled = false,
}: {
  scope: AnalysisScope;
  prepare: () => Promise<PreparedReport>;
  scopeNote: string;
  controls?: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-200"
      >
        <span aria-hidden>✨</span> Perguntar à IA {scope === "records" ? "sobre seus registros" : "sobre seus remédios"}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Perguntar à IA">
        {open ? <AskAi scope={scope} prepare={prepare} scopeNote={scopeNote} controls={controls} onClose={() => setOpen(false)} /> : null}
      </Sheet>
    </>
  );
}

function AskAi({
  scope,
  prepare,
  scopeNote,
  controls,
  onClose,
}: {
  scope: AnalysisScope;
  prepare: () => Promise<PreparedReport>;
  scopeNote: string;
  controls?: ReactNode;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });
  const [error, setError] = useState<string | null>(null);
  const dictation = useDictation((spoken) => setQuestion((q) => appendDictation(q, spoken).slice(0, MAX_QUESTION_CHARS)));

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (dictation.listening) dictation.stop();
    const q = question.trim();
    if (q.length < MIN_QUESTION_CHARS) {
      setError("Escreva o que você quer que a IA analise.");
      return;
    }
    setError(null);
    setPhase({ kind: "thinking" });
    try {
      const report = await prepare();
      const { answer, provider } = await askAi(scope, q, reportToText(report.doc));
      setPhase({ kind: "answer", question: q, answer, provider });
    } catch (err) {
      setError(err instanceof AnalysisError || err instanceof UserFacingError ? err.message : "A IA não conseguiu responder. Tente de novo.");
      setPhase({ kind: "compose" });
    }
  }

  if (phase.kind === "thinking") {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Spinner />
        <p className="font-medium">A IA está analisando…</p>
        <p className="text-sm text-zinc-500">Isso leva alguns segundos.</p>
      </div>
    );
  }

  if (phase.kind === "answer") {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          <span className="font-semibold">Você: </span>
          {phase.question}
        </p>
        {/* Texto puro: a resposta da IA nunca vira HTML. */}
        <div aria-label="Resposta da IA" className="whitespace-pre-line break-words rounded-xl border border-teal-200 bg-teal-50/50 p-4 text-sm leading-relaxed dark:border-teal-900 dark:bg-teal-950/40">
          {phase.answer}
        </div>
        <p className="text-[11px] text-zinc-500">
          Resposta da IA ({phase.provider}). Pode conter erros e não substitui avaliação médica.
        </p>
        <div className="sticky -bottom-5 -mx-5 -mb-5 flex gap-2 border-t border-zinc-100 bg-white px-5 pb-5 pt-3 dark:border-zinc-800 dark:bg-zinc-900">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-zinc-300 px-4 py-3 font-medium dark:border-zinc-700">
            Fechar
          </button>
          <button
            type="button"
            onClick={() => {
              setQuestion("");
              setPhase({ kind: "compose" });
            }}
            className="flex-[2] rounded-2xl bg-teal-700 px-4 py-3 font-semibold text-white hover:bg-teal-800"
          >
            Perguntar outra coisa
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{scopeNote}</p>
      {controls}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Sugestões">
        {SUGGESTIONS[scope].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setQuestion(s)}
            className={`rounded-full px-3 py-2 text-sm ${question === s ? "bg-teal-700 text-white" : "border border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"}`}
          >
            {s}
          </button>
        ))}
      </div>
      <label htmlFor="ai-question" className="text-sm font-semibold">
        O que você quer saber?
      </label>
      <textarea
        id="ai-question"
        rows={3}
        maxLength={MAX_QUESTION_CHARS}
        readOnly={dictation.listening}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ex.: minha pressão melhorou desde que comecei a losartana?"
        className={`w-full resize-y rounded-xl border bg-white px-4 py-3 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 dark:bg-zinc-900 ${dictation.listening ? "border-red-400" : "border-zinc-300 dark:border-zinc-700"}`}
      />
      {dictation.listening && dictation.interim ? <p className="text-sm italic text-zinc-500">{dictation.interim}…</p> : null}
      {dictation.supported ? (
        <button
          type="button"
          onClick={dictation.listening ? dictation.stop : dictation.start}
          className={`flex items-center gap-2 self-start rounded-full px-4 py-2 text-sm font-semibold ${dictation.listening ? "bg-red-600 text-white" : "border border-teal-600 text-teal-800 dark:text-teal-200"}`}
        >
          <MicIcon size={16} /> {dictation.listening ? "Parar" : "Ditar"}
        </button>
      ) : null}
      {error || dictation.error ? (
        <p role="alert" className="whitespace-pre-line break-words rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error ?? dictation.error}
        </p>
      ) : null}
      <p className="text-[11px] text-zinc-500">
        Para responder, o conteúdo do relatório é enviado à IA (Google Gemini ou, se ele falhar, Groq). Nada fica guardado. Gasta 1 do limite diário de IA.
      </p>
      <div className="sticky -bottom-5 -mx-5 -mb-5 border-t border-zinc-100 bg-white px-5 pb-5 pt-3 dark:border-zinc-800 dark:bg-zinc-900">
        <button type="submit" className="w-full rounded-2xl bg-teal-700 px-4 py-3.5 text-lg font-semibold text-white hover:bg-teal-800">
          ✨ Analisar
        </button>
      </div>
    </form>
  );
}
