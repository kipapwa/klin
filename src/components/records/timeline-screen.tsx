"use client";

import { useCallback, useEffect, useState } from "react";
import { listMedications } from "@/lib/medications";
import { getProfile } from "@/lib/profile";
import { prefetchScreens } from "@/lib/screen-cache";
import { listReadings } from "@/lib/pressure";
import { PendingDrafts } from "@/components/offline/pending-drafts";
import { prepareRecordsReport } from "@/lib/export-report";
import { ReportPreviewSheet } from "@/components/reports/report-preview";
import { AskAiButton } from "@/components/ai/ask-ai";
import { CATEGORY_LABEL, SEVERITY_LABEL } from "@/lib/labels";
import type { RecordFilters } from "@/lib/records";
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

  // Abas mais usadas já ficam guardadas para abrir na hora na primeira visita.
  useEffect(() => {
    void prefetchScreens({ perfil: getProfile, remedios: listMedications, pressao: listReadings });
  }, []);

  const onFiltersChange = useCallback((filters: RecordFilters, records: MedicalRecordSummary[]) => {
    setCurrent({ filters, records });
  }, []);

  // Relatório: mostra na tela primeiro; o PDF sai da prévia.
  const [preview, setPreview] = useState<{ ids: string[]; filters: string | null } | null>(null);
  function exportPdf() {
    if (!current) return;
    setPreview({ ids: current.records.map((r) => r.id), filters: describe(current.filters) });
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="flex-1 text-2xl font-semibold tracking-tight">Linha do tempo</h1>
        <button
          type="button"
          onClick={exportPdf}
          disabled={!current || current.records.length === 0}
          className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-medium shadow-sm disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
        >
          Relatório PDF
        </button>
      </div>
      <div className="mb-4">
        <AskAiButton
          scope="records"
          disabled={!current || current.records.length === 0}
          prepare={() => prepareRecordsReport(current?.records.map((r) => r.id) ?? [], current ? describe(current.filters) : null)}
          scopeNote={
            current
              ? `A IA vai analisar ${current.records.length === 1 ? "o registro" : `os ${current.records.length} registros`} da lista${describe(current.filters) ? ` (filtro: ${describe(current.filters)})` : ""}.`
              : ""
          }
        />
      </div>
      <ReportPreviewSheet
        open={preview !== null}
        onClose={() => setPreview(null)}
        title="Relatório dos registros"
        loadKey={preview ? preview.ids.join() : ""}
        load={() => prepareRecordsReport(preview?.ids ?? [], preview?.filters ?? null)}
      />
      <PendingDrafts />
      <RecordList onFiltersChange={onFiltersChange} />
    </>
  );
}
