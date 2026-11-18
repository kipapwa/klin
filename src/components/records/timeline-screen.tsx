"use client";

import { useCallback, useEffect, useState } from "react";
import { listMedications } from "@/lib/medications";
import { getProfile } from "@/lib/profile";
import { prefetchScreens } from "@/lib/screen-cache";
import { PendingDrafts } from "@/components/offline/pending-drafts";
import { exportReport } from "@/lib/export-report";
import { CATEGORY_LABEL, SEVERITY_LABEL } from "@/lib/labels";
import { UserFacingError, type RecordFilters } from "@/lib/records";
import type { MedicalRecordSummary } from "@/lib/types";
import { RecordList } from "./record-list";

function describe(f: RecordFilters): string | null {
  const parts = [
    ...(f.severities ?? []).map((s) => SEVERITY_LABEL[s]),
    ...(f.categories ?? []).map((c) => CATEGORY_LABEL[c]),
    ...(f.query ? [`busca "${f.query}"`] : []),
  ];
  return parts.length ? parts.join(", ") : null;
}

/** Linha do tempo + botão de relatório em PDF do que está filtrado. */
export function TimelineScreen() {
  const [current, setCurrent] = useState<{ filters: RecordFilters; records: MedicalRecordSummary[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Abas mais usadas já ficam guardadas para abrir na hora na primeira visita.
  useEffect(() => {
    void prefetchScreens({ perfil: getProfile, remedios: listMedications });
  }, []);

  const onFiltersChange = useCallback((filters: RecordFilters, records: MedicalRecordSummary[]) => {
    setCurrent({ filters, records });
  }, []);

  async function exportPdf() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await exportReport(current.records.map((r) => r.id), describe(current.filters));
    } catch (err) {
      setError(err instanceof UserFacingError ? err.message : "Não foi possível gerar o PDF.");
    }
    setBusy(false);
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="flex-1 text-2xl font-semibold tracking-tight">Linha do tempo</h1>
        <button
          type="button"
          onClick={exportPdf}
          disabled={busy || !current || current.records.length === 0}
          className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-medium shadow-sm disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {busy ? "Gerando…" : "Relatório PDF"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}
      <PendingDrafts />
      <RecordList onFiltersChange={onFiltersChange} />
    </>
  );
}
