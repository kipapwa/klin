"use client";

import { useState, type FormEvent } from "react";
import { Sheet } from "@/components/ui/sheet";
import { TimeField } from "@/components/ui/time-field";
import { CATEGORY_ICON, CATEGORY_LABEL, SEVERITY_LABEL } from "@/lib/labels";
import { fromLocalInputs, toLocalInputs } from "@/lib/record-edit";
import { updateRecordDetails, UserFacingError, type RecordDetails } from "@/lib/records";
import type { RecordCategory, RecordSeverity } from "@/lib/types";

const CATEGORIES = Object.keys(CATEGORY_ICON) as RecordCategory[];
const SEVERITIES: RecordSeverity[] = ["routine", "attention", "critical"];
const SEVERITY_DOT: Record<RecordSeverity, string> = { routine: "bg-teal-600", attention: "bg-amber-500", critical: "bg-red-600" };

const input =
  "w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 dark:border-zinc-700 dark:bg-zinc-900";
const chip = (on: boolean) =>
  `flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium ${on ? "bg-teal-700 text-white" : "border border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"}`;

interface Props {
  open: boolean;
  recordId: string;
  initial: { category: RecordCategory; severity: RecordSeverity; recordedAt: string };
  onClose: () => void;
  onSaved: (details: RecordDetails) => void;
}

/** Folha para mudar categoria, gravidade e dia/horário de um registro salvo. */
export function RecordEditSheet(props: Props) {
  return (
    <Sheet open={props.open} onClose={props.onClose} title="Editar registro">
      {/* Remonta a cada abertura: o formulário começa com os valores atuais. */}
      {props.open ? <EditForm {...props} /> : null}
    </Sheet>
  );
}

function EditForm({ recordId, initial, onClose, onSaved }: Props) {
  const start = toLocalInputs(initial.recordedAt);
  const [category, setCategory] = useState(initial.category);
  const [severity, setSeverity] = useState(initial.severity);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const when = fromLocalInputs(date, time, Date.now());
    if ("error" in when) {
      setError(when.error);
      return;
    }
    const details: RecordDetails = { category, severity, recordedAt: when.iso };
    setSaving(true);
    try {
      await updateRecordDetails(recordId, details);
      onSaved(details);
    } catch (err) {
      setError(err instanceof UserFacingError ? err.message : "Não foi possível salvar as alterações.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 pt-2" noValidate>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Dia e horário</span>
        <div className="grid grid-cols-[3fr_2fr] gap-2">
          <label className="flex flex-col gap-1">
            <span className="sr-only">Dia</span>
            <input id="edit-date" type="date" required className={input} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <TimeField id="edit-time" label="Horário do registro" className="py-3" value={time} onChange={setTime} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Categoria</span>
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
        <span className="text-sm font-semibold">Gravidade</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Gravidade">
          {SEVERITIES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={severity === s} onClick={() => setSeverity(s)} className={chip(severity === s)}>
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${SEVERITY_DOT[s]} ${severity === s ? "ring-2 ring-white/70" : ""}`} />
              {SEVERITY_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-zinc-300 px-4 py-3 font-medium dark:border-zinc-700">
          Cancelar
        </button>
        <button type="submit" disabled={saving} className="flex-[2] rounded-2xl bg-teal-700 px-4 py-3 font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </form>
  );
}
