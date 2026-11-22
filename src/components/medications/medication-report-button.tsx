"use client";

import { useState } from "react";
import { ReportPreviewSheet } from "@/components/reports/report-preview";
import { prepareMedicationReport } from "@/lib/export-report";
import { REPORT_PERIODS } from "@/lib/medication-report";

/**
 * "Relatório em PDF" dos remédios: escolhe o período, vê o relatório na tela
 * (agenda, adesão e histórico dose a dose) e baixa o PDF. Gerado no aparelho.
 * Com `medicationId`, só aquele remédio.
 */
export function MedicationReportButton({
  medicationId,
  compact = false,
  className = "",
}: {
  medicationId?: string;
  /** Botão pequeno ao lado do título (igual ao "Relatório PDF" da Linha do tempo). */
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<number>(30);

  const chip = (on: boolean) =>
    `flex-1 rounded-xl px-3 py-2.5 text-sm font-medium ${on ? "bg-teal-700 text-white" : "border border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          compact
            ? `shrink-0 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-medium shadow-sm dark:border-zinc-700 dark:bg-zinc-900 ${className}`
            : `rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900 ${className}`
        }
      >
        {compact ? "Relatório PDF" : `📄 ${medicationId ? "Relatório deste remédio" : "Relatório dos remédios"}`}
      </button>
      <ReportPreviewSheet
        open={open}
        onClose={() => setOpen(false)}
        title={medicationId ? "Relatório do remédio" : "Relatório dos remédios"}
        loadKey={String(days)}
        load={() => prepareMedicationReport(days, medicationId)}
        controls={
          <div role="radiogroup" aria-label="Período do relatório" className="flex gap-2">
            {REPORT_PERIODS.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={chip(days === d)}>
                {d} dias
              </button>
            ))}
          </div>
        }
      />
    </>
  );
}
