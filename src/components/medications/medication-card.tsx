"use client";

import Link from "next/link";
import { BellIcon } from "@/components/ui/switch";
import { doseState, dueSlot } from "@/lib/doses";
import { formatDoseTime, formatRelative, scheduleText } from "@/lib/labels";
import type { DoseAction } from "@/lib/medications";
import type { Medication } from "@/lib/types";

const STATE_STYLE = {
  late: "border-2 border-red-500 bg-red-50 dark:bg-red-950",
  due: "border-2 border-teal-600 bg-teal-50 dark:bg-teal-950",
  upcoming: "border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
  ended: "border border-zinc-200 bg-zinc-50 opacity-80 dark:border-zinc-800 dark:bg-zinc-900",
} as const;

export function MedicationCard({
  medication: m,
  now,
  busy,
  onDose,
}: {
  medication: Medication;
  now: number;
  busy: boolean;
  onDose: (m: Medication, slot: Date, action: DoseAction) => void;
}) {
  const state = doseState(m, now);
  const slot = dueSlot(m, now);

  return (
    <div className={`rounded-2xl p-4 shadow-sm ${STATE_STYLE[state]}`}>
      <Link href={`/medicamentos/detalhe/?id=${m.id}`} className="block">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">
              {m.name}
              {m.dosage ? <span className="font-normal text-zinc-600 dark:text-zinc-300"> — {m.dosage}</span> : null}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{scheduleText(m)}</p>
          </div>
          <span
            role="img"
            className={m.notifications_enabled ? "text-teal-700 dark:text-teal-400" : "text-zinc-400"}
            title={m.notifications_enabled ? "Lembretes ligados" : "Lembretes desligados"}
            aria-label={m.notifications_enabled ? "Lembretes ligados" : "Lembretes desligados"}
          >
            <BellIcon off={!m.notifications_enabled} />
          </span>
        </div>

        {state === "ended" ? (
          <p className="mt-2 text-sm text-zinc-500">Tratamento encerrado</p>
        ) : m.next_dose_at ? (
          <p
            className={`mt-2 text-sm font-medium ${state === "late" ? "text-red-800 dark:text-red-200" : state === "due" ? "text-teal-800 dark:text-teal-200" : "text-zinc-700 dark:text-zinc-300"}`}
          >
            {state === "late" ? "Atrasada: " : state === "due" ? "Hora da dose: " : "Próxima dose: "}
            {formatDoseTime(slot ? slot.toISOString() : m.next_dose_at, now)} ({formatRelative(slot ? slot.toISOString() : m.next_dose_at, now)})
          </p>
        ) : null}
      </Link>

      {slot ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDose(m, slot, "taken")}
            className="flex-1 rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
          >
            Marcar como tomado
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDose(m, slot, "skipped")}
            className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium hover:bg-white disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Pular
          </button>
        </div>
      ) : null}
    </div>
  );
}
