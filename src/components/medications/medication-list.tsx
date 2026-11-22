"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useScreen } from "@/hooks/use-screen";
import { useDoseMarked } from "@/hooks/use-dose-marked";
import { MedicationReportButton } from "./medication-report-button";
import { Spinner } from "@/components/ui/spinner";
import { useNow } from "@/hooks/use-now";
import { dueSlot, isPendingSlot } from "@/lib/doses";
import { formatDoseTime } from "@/lib/labels";
import { DOSES_CHANGED, listMedications, recordDose, type DoseAction } from "@/lib/medications";
import { UserFacingError } from "@/lib/records";
import type { Medication } from "@/lib/types";
import { PillIcon } from "@/components/ui/icons";
import { MedicationCard } from "./medication-card";
import { PushPrompt } from "./push-prompt";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function messageOf(err: unknown) {
  return err instanceof UserFacingError ? err.message : "Erro inesperado.";
}

export function MedicationList() {
  const now = useNow();
  const router = useRouter();
  const params = useSearchParams();
  // Tela instantânea: os remédios guardados aparecem na hora (o sininho usa o mesmo guardado).
  const screen = useScreen("remedios", listMedications);
  useDoseMarked(() => void screen.refresh());
  const { refresh } = screen;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    // Dose marcada pelo sininho (ou outra tela): atualiza a lista.
    const reload = () => void refresh();
    window.addEventListener(DOSES_CHANGED, reload);
    return () => window.removeEventListener(DOSES_CHANGED, reload);
  }, [refresh]);

  const state = screen.data
    ? ({ kind: "ready", meds: screen.data } as const)
    : screen.error
      ? ({ kind: "error", message: screen.error } as const)
      : ({ kind: "loading" } as const);

  async function handleDose(m: Medication, slot: Date, action: DoseAction, source: "app" | "notification" = "app") {
    setBusy(true);
    setNotice(null);
    try {
      const result = await recordDose(m.id, slot, action, source);
      setNotice({
        tone: "ok",
        text:
          result === "already"
            ? "Essa dose já estava registrada."
            : action === "taken"
              ? `Dose de ${m.name} registrada ✓`
              : `Dose de ${m.name} pulada.`,
      });
    } catch (err) {
      setNotice({ tone: "error", text: messageOf(err) });
    }
    await refresh();
    setBusy(false);
  }

  if (state.kind === "loading") return <Spinner label="Carregando medicamentos…" />;
  if (state.kind === "error") return <p role="alert" className="text-sm text-red-700">{state.message}</p>;

  // Vindo da notificação: ?tomar=<id>&horario=<ISO>
  const tomarId = params.get("tomar") ?? "";
  const fromNotification = UUID_RE.test(tomarId) ? state.meds.find((m) => m.id === tomarId) : undefined;
  const horario = params.get("horario") ?? "";
  const notificationSlot = fromNotification
    ? isPendingSlot(fromNotification, horario)
      ? new Date(horario)
      : dueSlot(fromNotification, now)
    : null;
  const clearParams = () => router.replace("/medicamentos/");

  const active = state.meds.filter((m) => m.is_active && m.next_dose_at);
  const ended = state.meds.filter((m) => !(m.is_active && m.next_dose_at));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-2xl font-semibold tracking-tight">Seus remédios</h1>
        {state.meds.length > 0 ? <MedicationReportButton compact /> : null}
      </div>
      {fromNotification ? (
        <div role="dialog" aria-label="Confirmar dose" className="rounded-2xl border-2 border-teal-600 bg-teal-50 p-4 dark:bg-teal-950">
          {notificationSlot ? (
            <>
              <p className="font-semibold">
                Confirmar a dose de {fromNotification.name} das {formatDoseTime(notificationSlot.toISOString(), now)}?
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    await handleDose(fromNotification, notificationSlot, "taken", "notification");
                    clearParams();
                  }}
                  className="flex-1 rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white disabled:opacity-60"
                >
                  Tomei
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    await handleDose(fromNotification, notificationSlot, "skipped", "notification");
                    clearParams();
                  }}
                  className="rounded-xl border border-zinc-300 px-4 py-3 text-sm dark:border-zinc-700"
                >
                  Pular
                </button>
                <button type="button" onClick={clearParams} className="px-2 text-sm text-zinc-600">
                  Agora não
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm">Essa dose já foi registrada.</p>
              <button type="button" onClick={clearParams} className="text-sm text-teal-700">
                OK
              </button>
            </div>
          )}
        </div>
      ) : null}

      {notice ? (
        <p
          role="status"
          className={`rounded-xl px-4 py-2 text-sm ${notice.tone === "ok" ? "bg-teal-700 text-white" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"}`}
        >
          {notice.text}
        </p>
      ) : null}

      {active.some((m) => m.notifications_enabled) ? <PushPrompt /> : null}

      {active.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-6 py-10 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
            <PillIcon size={32} />
          </span>
          <p className="text-lg font-semibold">Cadastre seus remédios</p>
          <p className="max-w-xs text-sm text-zinc-600 dark:text-zinc-400">
            Escolha os horários e o Klin avisa no celular na hora de cada dose.
          </p>
          <Link href="/medicamentos/editar/" className="mt-1 rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white hover:bg-teal-800">
            Adicionar remédio
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {active.map((m) => (
            <li key={m.id}>
              <MedicationCard medication={m} now={now} busy={busy} onDose={handleDose} />
            </li>
          ))}
        </ul>
      )}

      {ended.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Tratamentos encerrados ({ended.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-3">
            {ended.map((m) => (
              <li key={m.id}>
                <MedicationCard medication={m} now={now} busy={busy} onDose={handleDose} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
