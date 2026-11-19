"use client";

import { GuardedLink as Link } from "@/components/ui/guarded-link";
import { useEffect, useState } from "react";
import { useScreen } from "@/hooks/use-screen";
import { PushPrompt } from "@/components/medications/push-prompt";
import { BellIcon } from "@/components/ui/icons";
import { IconButton, Sheet } from "@/components/ui/sheet";
import { useNow } from "@/hooks/use-now";
import { doseState, dueSlot } from "@/lib/doses";
import { endOfLocalDay, formatDoseTime, formatRelative } from "@/lib/labels";
import { DOSES_CHANGED, listMedications, recordDose, type DoseAction } from "@/lib/medications";
import type { Medication } from "@/lib/types";

/**
 * Sininho do cabeçalho: número de doses na hora ou atrasadas e, ao tocar,
 * as doses de agora (com "Tomei"), as próximas de hoje e o aviso para ativar
 * as notificações neste aparelho.
 */
export function NotificationBell() {
  const now = useNow();
  const [open, setOpen] = useState(false);
  // Mesmo guardado da tela de remédios: o número aparece na hora.
  const { data: meds, refresh } = useScreen("remedios", listMedications);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const reload = () => void refresh();
    window.addEventListener(DOSES_CHANGED, reload);
    window.addEventListener("online", reload);
    return () => {
      window.removeEventListener(DOSES_CHANGED, reload);
      window.removeEventListener("online", reload);
    };
  }, [refresh]);

  const current = now; // useNow: hora real no navegador (o sininho não é pré-renderizado)
  const active = (meds ?? []).filter((m) => m.is_active && m.next_dose_at);
  const due = active.filter((m) => dueSlot(m, current) && doseState(m, current) !== "upcoming");
  const endOfDay = endOfLocalDay(current);
  const later = active
    .filter((m) => !due.includes(m) && Date.parse(m.next_dose_at!) <= endOfDay)
    .sort((a, b) => Date.parse(a.next_dose_at!) - Date.parse(b.next_dose_at!));

  async function dose(m: Medication, action: DoseAction) {
    const slot = dueSlot(m, current);
    if (!slot) return;
    setBusy(true);
    try {
      await recordDose(m.id, slot, action);
    } catch {
      // a lista recarrega e mostra o estado real
    }
    setBusy(false);
  }

  return (
    <>
      <IconButton label={due.length ? `Lembretes: ${due.length} dose(s) agora` : "Lembretes"} onClick={() => setOpen(true)}>
        <BellIcon size={21} />
        {due.length ? (
          <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-zinc-50 dark:ring-zinc-950">
            {due.length}
          </span>
        ) : null}
      </IconButton>

      <Sheet open={open} onClose={() => setOpen(false)} title="Lembretes">
        <div className="flex flex-col gap-4">
          {active.some((m) => m.notifications_enabled) ? <PushPrompt /> : null}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Agora</h3>
            {due.length === 0 ? (
              <p className="rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Nenhuma dose para tomar agora. ✓</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {due.map((m) => {
                  const late = doseState(m, current) === "late";
                  const slot = dueSlot(m, current)!;
                  return (
                    <li
                      key={m.id}
                      className={`rounded-2xl border p-3 ${late ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950" : "border-teal-200 bg-teal-50 dark:border-teal-800 dark:bg-teal-950"}`}
                    >
                      <p className="font-semibold">
                        {m.name}
                        {m.dosage ? <span className="font-normal"> — {m.dosage}</span> : null}
                      </p>
                      <p className={`text-sm ${late ? "text-red-800 dark:text-red-200" : "text-teal-800 dark:text-teal-200"}`}>
                        {late ? "Atrasada" : "Na hora"}: {formatDoseTime(slot.toISOString(), current)} ({formatRelative(slot.toISOString(), current)})
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => dose(m, "taken")}
                          className="flex-1 rounded-xl bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        >
                          Tomei
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => dose(m, "skipped")}
                          className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        >
                          Pular
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {later.length ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Mais tarde hoje</h3>
              <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {later.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className="w-12 font-semibold tabular-nums">{formatDoseTime(m.next_dose_at!, current)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {m.name}
                      {m.dosage ? ` — ${m.dosage}` : ""}
                    </span>
                    <BellIcon size={16} off={!m.notifications_enabled} className="text-zinc-400" />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <Link href="/medicamentos/" onClick={() => setOpen(false)} className="text-center text-sm font-medium text-teal-700 dark:text-teal-400">
            Ver todos os remédios
          </Link>
        </div>
      </Sheet>
    </>
  );
}
