"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { exportMedicationReport } from "@/lib/export-report";
import { REPORT_PERIODS } from "@/lib/medication-report";
import { UserFacingError } from "@/lib/records";

/**
 * "Relatório em PDF" dos remédios: escolhe o período e baixa o PDF com a
 * agenda, a adesão e o histórico dose a dose. Gerado no aparelho.
 * Com `medicationId`, só aquele remédio.
 */
export function MedicationReportButton({ medicationId, className = "" }: { medicationId?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<number>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      await exportMedicationReport(days, medicationId);
      setOpen(false);
    } catch (err) {
      setError(err instanceof UserFacingError ? err.message : "Não foi possível gerar o PDF.");
    }
    setBusy(false);
  }

  const chip = (on: boolean) =>
    `flex-1 rounded-xl px-3 py-3 text-sm font-medium ${on ? "bg-teal-700 text-white" : "border border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"}`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={`rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900 ${className}`}
      >
        📄 {medicationId ? "Relatório deste remédio em PDF" : "Relatório dos remédios em PDF"}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={medicationId ? "Relatório do remédio" : "Relatório dos remédios"}>
        <div className="flex flex-col gap-4 pt-1">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Horários, adesão e o histórico de cada dose (tomada, pulada ou sem registro). O PDF é gerado no seu celular.
          </p>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Período</span>
            <div role="radiogroup" aria-label="Período do relatório" className="flex gap-2">
              {REPORT_PERIODS.map((d) => (
                <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={chip(days === d)}>
                  {d} dias
                </button>
              ))}
            </div>
          </div>
          {error ? (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
              {error}
            </p>
          ) : null}
          <button type="button" onClick={download} disabled={busy} className="rounded-2xl bg-teal-700 px-4 py-4 text-lg font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
            {busy ? "Gerando PDF…" : "Baixar PDF"}
          </button>
        </div>
      </Sheet>
    </>
  );
}
