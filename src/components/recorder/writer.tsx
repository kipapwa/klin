"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { CATEGORY_ICON, CATEGORY_LABEL, SEVERITY_LABEL } from "@/lib/labels";
import { useLeaveGuard } from "@/lib/leave-guard";
import { createTextRecord, MAX_TEXT_CHARS, MIN_TEXT_CHARS, processRecord, UserFacingError } from "@/lib/records";
import type { ProcessResult, RecordCategory, RecordSeverity } from "@/lib/types";
import { AiResultView } from "./ai-result";

const CATEGORIES = Object.keys(CATEGORY_ICON) as RecordCategory[];
const SEVERITIES: RecordSeverity[] = ["routine", "attention", "critical"];
const SEVERITY_DOT: Record<RecordSeverity, string> = { routine: "bg-teal-600", attention: "bg-amber-500", critical: "bg-red-600" };

type Phase =
  | { kind: "editing" }
  | { kind: "saving" }
  | { kind: "processing"; recordId: string }
  | { kind: "done"; recordId: string; result: ProcessResult }
  | { kind: "aiFailed"; recordId: string; message: string };

const input =
  "w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 dark:border-zinc-700 dark:bg-zinc-900";
const chip = (on: boolean) =>
  `flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium ${on ? "bg-teal-700 text-white" : "border border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"}`;

function messageOf(err: unknown) {
  return err instanceof UserFacingError ? err.message : "Algo deu errado. Tente de novo.";
}

/**
 * Registro escrito à mão (sem gravação). Com "Organizar com IA" ligado, a IA
 * estrutura o texto como faz com o áudio; desligado, salva como está.
 */
export function Writer() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<RecordCategory>("symptom");
  const [severity, setSeverity] = useState<RecordSeverity>("routine");
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });
  const [error, setError] = useState<string | null>(null);

  const unsaved = text.trim() !== "" && (phase.kind === "editing" || phase.kind === "saving");
  useLeaveGuard(unsaved ? "O texto ainda não foi salvo e será perdido." : null);

  async function runAi(recordId: string) {
    setPhase({ kind: "processing", recordId });
    try {
      setPhase({ kind: "done", recordId, result: await processRecord(recordId) });
    } catch (err) {
      setPhase({ kind: "aiFailed", recordId, message: messageOf(err) });
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (text.trim().length < MIN_TEXT_CHARS) {
      setError("Escreva um pouco mais sobre o que aconteceu.");
      return;
    }
    setPhase({ kind: "saving" });
    let recordId: string;
    try {
      recordId = await createTextRecord({ text, useAi, title, category, severity });
    } catch (err) {
      setError(messageOf(err)); // o texto continua no campo
      setPhase({ kind: "editing" });
      return;
    }
    if (useAi) await runAi(recordId);
    else router.replace(`/registro/?id=${recordId}`);
  }

  if (phase.kind === "processing" || (phase.kind === "saving" && useAi)) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <Spinner />
        <p className="font-medium">A IA está organizando sua nota…</p>
        <p className="text-sm text-zinc-500">Isso leva alguns segundos.</p>
      </div>
    );
  }
  if (phase.kind === "done") return <AiResultView result={phase.result} recordId={phase.recordId} />;
  if (phase.kind === "aiFailed") {
    return (
      <div className="flex flex-col gap-4 py-6">
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {phase.message}
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">O texto foi salvo. Você pode tentar de novo agora ou depois, pela nota.</p>
        <button type="button" onClick={() => runAi(phase.recordId)} className="rounded-2xl bg-teal-700 px-4 py-4 text-lg font-semibold text-white">
          Tentar de novo
        </button>
        <button
          type="button"
          onClick={() => router.replace(`/registro/?id=${phase.recordId}`)}
          className="rounded-2xl border border-zinc-300 px-4 py-3 font-medium dark:border-zinc-700"
        >
          Ver registro
        </button>
      </div>
    );
  }

  const saving = phase.kind === "saving";
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <section className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <label htmlFor="record-text" className="text-sm font-semibold">
          O que aconteceu?
        </label>
        <textarea
          id="record-text"
          rows={8}
          maxLength={MAX_TEXT_CHARS}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex.: Consulta com a cardiologista hoje. Pressão 14 por 9. Ela receitou losartana 50 mg uma vez ao dia e pediu retorno em 30 dias."
          className={`${input} min-h-40 resize-y leading-relaxed`}
        />
        <p className="text-right text-xs text-zinc-400" aria-live="off">
          {text.length.toLocaleString("pt-BR")}/{MAX_TEXT_CHARS.toLocaleString("pt-BR")}
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-xl dark:bg-teal-950">
            ✨
          </span>
          <span className="flex-1">
            <span className="block text-sm font-semibold">Organizar com IA</span>
            <span className="block text-xs text-zinc-500">
              {useAi
                ? "Separa queixa, histórico e conduta, sugere CID-10, identifica alertas e remédios."
                : "Salva o texto como está. Você escolhe título, categoria e gravidade."}
            </span>
          </span>
          <Switch label="Organizar com IA" checked={useAi} onChange={setUseAi} />
        </div>

        {!useAi ? (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor="record-title" className="text-sm text-zinc-600 dark:text-zinc-400">
                Título (opcional)
              </label>
              <input id="record-title" maxLength={80} className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Consulta com a cardiologista" />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">Categoria</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Categoria">
                {CATEGORIES.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={category === c} onClick={() => setCategory(c)} className={chip(category === c)}>
                    <span aria-hidden>{CATEGORY_ICON[c]}</span>
                    {CATEGORY_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">Gravidade</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Gravidade">
                {SEVERITIES.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={severity === s} onClick={() => setSeverity(s)} className={chip(severity === s)}>
                    <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${SEVERITY_DOT[s]} ${severity === s ? "ring-2 ring-white/70" : ""}`} />
                    {SEVERITY_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </section>

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={saving} className="rounded-2xl bg-teal-700 px-4 py-4 text-lg font-semibold text-white shadow-sm hover:bg-teal-800 disabled:opacity-60">
        {saving ? "Salvando…" : useAi ? "✨ Organizar com IA" : "Salvar registro"}
      </button>
    </form>
  );
}
