import { listMedications } from "./medications";
import { getRecordsForReport } from "./records";
import { buildReport, reportFilename } from "./report";
import { downloadBlob, renderReportPdf } from "./report-pdf";
import { getSupabase } from "./supabase";

/** Monta e baixa o relatório em PDF dos registros indicados (tudo no aparelho). */
export async function exportReport(recordIds: string[], filtersDescription: string | null): Promise<void> {
  const [records, medications, session] = await Promise.all([
    getRecordsForReport(recordIds),
    listMedications(),
    getSupabase().auth.getSession(),
  ]);
  const now = new Date();
  const doc = buildReport({
    records,
    medications,
    email: session.data.session?.user.email ?? null,
    filtersDescription,
    generatedAt: now,
  });
  downloadBlob(await renderReportPdf(doc), reportFilename(now));
}
