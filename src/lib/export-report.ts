import { listLogsSince, listMedications } from "./medications";
import { buildMedicationReport, medicationReportFilename } from "./medication-report";
import { deviceTimeZone } from "./profile";
import { getRecordsForReport } from "./records";
import { buildReport, reportFilename } from "./report";
import { downloadBlob, renderReportPdf } from "./report-pdf";
import { getSupabase } from "./supabase";

/** Relatório de remédios (todos, ou só `onlyId`) com o histórico dos últimos `days` dias. */
export async function exportMedicationReport(days: number, onlyId?: string): Promise<void> {
  const now = new Date();
  const [medications, logs, session] = await Promise.all([
    listMedications(),
    listLogsSince(new Date(now.getTime() - days * 86_400_000)),
    getSupabase().auth.getSession(),
  ]);
  const doc = buildMedicationReport({
    medications: onlyId ? medications.filter((m) => m.id === onlyId) : medications,
    logs,
    days,
    email: session.data.session?.user.email ?? null,
    generatedAt: now,
    timeZone: deviceTimeZone(),
  });
  downloadBlob(await renderReportPdf(doc), medicationReportFilename(now));
}

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
