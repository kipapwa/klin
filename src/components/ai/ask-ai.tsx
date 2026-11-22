"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronLeftIcon, MicIcon, XIcon } from "@/components/ui/icons";
import { useConfirm } from "@/components/ui/confirm";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useDictation } from "@/hooks/use-dictation";
import { useScreen } from "@/hooks/use-screen";
import {
  deleteAnalysis,
  deleteSavedQuestion,
  loadAiMemory,
  saveAnalysis,
  saveQuestion,
  HISTORY_LIMIT,
  type AiMemory,
  type SavedAnalysis,
} from "@/lib/ai-history";
import { AnalysisError, askAi, historyNote, MAX_QUESTION_CHARS, MIN_QUESTION_CHARS, reportToText, SUGGESTIONS, type AnalysisScope } from "@/lib/analysis";
import { appendDictation } from "@/lib/dictation";
import type { PreparedReport } from "@/lib/export-report";
import { formatDateTime } from "@/lib/labels";
import { UserFacingError } from "@/lib/records";

type SaveState = "saving" | "saved" | "failed";
type Phase =
  | { kind: "compose" }
  | { kind: "thinking" }
  | { kind: "answer"; question: string; answer: string; provider: string; saved: SaveState }
  | { kind: "history" };

const EMPTY: AiMemory = { questions: [], analyses: [] };
const userMessage = (err: unknown, fallback: string) =>
  err instanceof AnalysisError || err instanceof UserFacingError ? err.message : fallback;

/**
 * "✨ Perguntar à IA": a pessoa escreve (ou dita) o que quer saber; a IA
 * analisa o mesmo conteúdo do relatório da tela (`prepare`).
 * Perguntas podem virar favoritas (atalhos) e cada resposta fica no histórico
 * (`lib/ai-history.ts`). `scopeNote` explica o que vai ser analisado;
 * `controls` (ex.: período) fica acima.
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
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const dictation = useDictation((spoken) => setQuestion((q) => appendDictation(q, spoken).slice(0, MAX_QUESTION_CHARS)));

  // Favoritas e histórico: abrem na hora com o guardado (tela instantânea).
  const screen = useScreen(`ia:${scope}`, () => loadAiMemory(scope));
  const memory = screen.data ?? EMPTY;
  const memoryRef = useRef(memory);
  useEffect(() => {
    memoryRef.current = memory;
  }, [memory]);
  const change = (fn: (m: AiMemory) => AiMemory) => {
    const next = fn(memoryRef.current);
    memoryRef.current = next;
    screen.update(next);
  };

  const trimmed = question.trim();
  const savedMatch = memory.questions.find((s) => s.question === trimmed);
  const suggestions = SUGGESTIONS[scope].filter((s) => !memory.questions.some((m) => m.question === s));

  async function toggleFavorite(text: string) {
    const q = text.trim();
    if (q.length < MIN_QUESTION_CHARS || busy) return;
    setBusy(true);
    setError(null);
    try {
      const existing = memoryRef.current.questions.find((s) => s.question === q);
      if (existing) {
        await deleteSavedQuestion(existing.id);
        change((m) => ({ ...m, questions: m.questions.filter((s) => s.id !== existing.id) }));
      } else {
        const saved = await saveQuestion(scope, q);
        change((m) => ({ ...m, questions: [...m.questions.filter((s) => s.id !== saved.id), saved] }));
      }
    } catch (err) {
      setError(userMessage(err, "Não foi possível salvar a pergunta."));
    } finally {
      setBusy(false);
    }
  }

  async function removeAnalysis(item: SavedAnalysis) {
    const ok = await confirm({ title: "Apagar esta resposta do histórico?", confirmLabel: "Apagar", tone: "danger", icon: "🗑️" });
    if (!ok) return;
    setError(null);
    try {
      await deleteAnalysis(item.id);
      change((m) => ({ ...m, analyses: m.analyses.filter((a) => a.id !== item.id) }));
    } catch (err) {
      setError(userMessage(err, "Não foi possível apagar a resposta."));
    }
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (dictation.listening) dictation.stop();
    const q = trimmed;
    if (q.length < MIN_QUESTION_CHARS) {
      setError("Escreva o que você quer que a IA analise.");
      return;
    }
    setError(null);
    setPhase({ kind: "thinking" });
    let result: { answer: string; provider: string };
    try {
      const report = await prepare();
      result = await askAi(scope, q, reportToText(report.doc));
    } catch (err) {
      setError(userMessage(err, "A IA não conseguiu responder. Tente de novo."));
      setPhase({ kind: "compose" });
      return;
    }
    setPhase({ kind: "answer", question: q, ...result, saved: "saving" });
    // Guarda no histórico (a resposta já está na tela; falhar aqui não a perde).
    try {
      const saved = await saveAnalysis(scope, { question: q, ...result, scopeNote: historyNote(scopeNote) });
      change((m) => ({ ...m, analyses: [saved, ...m.analyses].slice(0, HISTORY_LIMIT) }));
      setPhase((p) => (p.kind === "answer" ? { ...p, saved: "saved" } : p));
    } catch {
      setPhase((p) => (p.kind === "answer" ? { ...p, saved: "failed" } : p));
    }
  }

  const errorBox =
    error || dictation.error ? (
      <p role="alert" className="whitespace-pre-line break-words rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
        {error ?? dictation.error}
      </p>
    ) : null;

  const favoriteButton = (text: string) => {
    const isSaved = memory.questions.some((s) => s.question === text.trim());
    return (
      <button
        type="button"
        disabled={busy || text.trim().length < MIN_QUESTION_CHARS}
        aria-pressed={isSaved}
        onClick={() => void toggleFavorite(text)}
        className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40 ${isSaved ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"}`}
      >
        <span aria-hidden>{isSaved ? "★" : "☆"}</span> {isSaved ? "Pergunta salva" : "Salvar pergunta"}
      </button>
    );
  };

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
        <div className="flex flex-wrap items-center gap-2">
          {favoriteButton(phase.question)}
          <span role="status" className="text-xs text-zinc-500">
            {phase.saved === "saving" ? "Guardando no histórico…" : phase.saved === "saved" ? "🕘 Guardada no histórico" : "Não foi possível guardar no histórico."}
          </span>
        </div>
        {errorBox}
        <div className="sticky -bottom-5 -mx-5 -mb-5 flex gap-2 border-t border-zinc-100 bg-white px-5 pb-5 pt-3 dark:border-zinc-800 dark:bg-zinc-900">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-zinc-300 px-4 py-3 font-medium dark:border-zinc-700">
            Fechar
          </button>
          <button
            type="button"
            onClick={() => {
              setQuestion("");
              setError(null);
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

  if (phase.kind === "history") {
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setPhase({ kind: "compose" });
          }}
          className="flex items-center gap-1 self-start rounded-full px-2 py-1 text-sm font-semibold text-teal-800 dark:text-teal-200"
        >
          <ChevronLeftIcon size={16} /> Voltar
        </button>
        <h3 className="font-semibold">Respostas guardadas</h3>
        {errorBox}
        {memory.analyses.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">Nenhuma resposta guardada ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Histórico de respostas">
            {memory.analyses.map((a) => (
              <li key={a.id}>
                <details className="group rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                  <summary className="cursor-pointer list-none px-4 py-3">
                    <span className="block text-xs text-zinc-500">{formatDateTime(a.created_at)}</span>
                    <span className="block break-words font-medium">{a.question}</span>
                  </summary>
                  <div className="flex flex-col gap-2 border-t border-zinc-100 px-4 pb-4 pt-3 dark:border-zinc-800">
                    {a.scope_note ? <p className="text-xs text-zinc-500">Analisado: {a.scope_note}</p> : null}
                    <div className="whitespace-pre-line break-words text-sm leading-relaxed">{a.answer}</div>
                    <p className="text-[11px] text-zinc-500">
                      Resposta da IA{a.provider ? ` (${a.provider})` : ""}. Pode conter erros e não substitui avaliação médica.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setQuestion(a.question);
                          setError(null);
                          setPhase({ kind: "compose" });
                        }}
                        className="flex-1 rounded-xl border border-teal-600 px-3 py-2 text-sm font-semibold text-teal-800 dark:text-teal-200"
                      >
                        Perguntar de novo
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeAnalysis(a)}
                        className="rounded-xl border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-900 dark:text-red-300"
                      >
                        Apagar
                      </button>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{scopeNote}</p>
        <button
          type="button"
          onClick={() => {
            if (dictation.listening) dictation.stop();
            setError(null);
            setPhase({ kind: "history" });
          }}
          className="shrink-0 rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium dark:border-zinc-700"
        >
          🕘 Histórico{memory.analyses.length ? ` (${memory.analyses.length})` : ""}
        </button>
      </div>
      {controls}
      {memory.questions.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Minhas perguntas</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Minhas perguntas">
            {memory.questions.map((s) => (
              <span
                key={s.id}
                className={`flex items-center rounded-full ${question === s.question ? "bg-teal-700 text-white" : "border border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"}`}
              >
                <button type="button" onClick={() => setQuestion(s.question)} className="break-words py-2 pl-3 pr-1 text-left text-sm">
                  ★ {s.question}
                </button>
                <button
                  type="button"
                  aria-label={`Tirar das minhas perguntas: ${s.question}`}
                  disabled={busy}
                  onClick={() => void toggleFavorite(s.question)}
                  className="rounded-full p-2 opacity-70 hover:opacity-100"
                >
                  <XIcon size={14} />
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {suggestions.length ? (
        <div className="flex flex-col gap-1.5">
          {memory.questions.length ? <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Sugestões</p> : null}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Sugestões">
            {suggestions.map((s) => (
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
        </div>
      ) : null}
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
      <div className="flex flex-wrap gap-2">
        {dictation.supported ? (
          <button
            type="button"
            onClick={dictation.listening ? dictation.stop : dictation.start}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${dictation.listening ? "bg-red-600 text-white" : "border border-teal-600 text-teal-800 dark:text-teal-200"}`}
          >
            <MicIcon size={16} /> {dictation.listening ? "Parar" : "Ditar"}
          </button>
        ) : null}
        {savedMatch || trimmed.length >= MIN_QUESTION_CHARS ? favoriteButton(question) : null}
      </div>
      {errorBox}
      <p className="text-[11px] text-zinc-500">
        Para responder, o conteúdo do relatório é enviado à IA (Google Gemini ou, se ele falhar, Groq). A pergunta e a resposta ficam no seu histórico, só para você. Gasta 1 do limite diário de IA.
      </p>
      <div className="sticky -bottom-5 -mx-5 -mb-5 border-t border-zinc-100 bg-white px-5 pb-5 pt-3 dark:border-zinc-800 dark:bg-zinc-900">
        <button type="submit" className="w-full rounded-2xl bg-teal-700 px-4 py-3.5 text-lg font-semibold text-white hover:bg-teal-800">
          ✨ Analisar
        </button>
      </div>
    </form>
  );
}
