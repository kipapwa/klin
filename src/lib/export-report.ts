import { buildPressureReport, pressureReportFilename } from "./blood-pressure";
import { listReadingsSince } from "./pressure";
import { listLogsSince, listMedications } from "./medications";
import { buildMedicationReport, medicationReportFilename } from "./medication-report";
import { deviceTimeZone } from "./profile";
import { getRecordsForReport } from "./records";
import { buildReport, reportFilename, type ReportDoc } from "./report";
import { downloadBlob, renderReportPdf } from "./report-pdf";
import { getSupabase } from "./supabase";

/**
 * Relatório pronto: o MESMO conteúdo vai para a prévia na tela e para o PDF.
 * Tudo é montado no aparelho.
 */
export interface PreparedReport {
  doc: ReportDoc;
  filename: string;
}

/** Relatório clínico dos registros indicados. */
export async function prepareRecordsReport(recordIds: string[], filtersDescription: string | null): Promise<PreparedReport> {
  const [records, medications, session] = await Promise.all([
    getRecordsForReport(recordIds),
    listMedications(),
    getSupabase().auth.getSession(),
  ]);
  const now = new Date();
  return {
    doc: buildReport({
      records,
      medications,
      email: session.data.session?.user.email ?? null,
      filtersDescription,
      generatedAt: now,
    }),
    filename: reportFilename(now),
  };
}

/** Relatório de remédios (todos, ou só `onlyId`) com o histórico dos últimos `days` dias. */
export async function prepareMedicationReport(days: number, onlyId?: string): Promise<PreparedReport> {
  const now = new Date();
  const [medications, logs, session] = await Promise.all([
    listMedications(),
    listLogsSince(new Date(now.getTime() - days * 86_400_000)),
    getSupabase().auth.getSession(),
  ]);
  return {
    doc: buildMedicationReport({
      medications: onlyId ? medications.filter((m) => m.id === onlyId) : medications,
      logs,
      days,
      email: session.data.session?.user.email ?? null,
      generatedAt: now,
      timeZone: deviceTimeZone(),
    }),
    filename: medicationReportFilename(now),
  };
}

/** Desenha o PDF do relatório já montado e baixa. */
export async function downloadReport(report: PreparedReport): Promise<void> {
  downloadBlob(await renderReportPdf(report.doc), report.filename);
}

/** Relatório de pressão dos últimos `days` dias. */
export async function preparePressureReport(days: number): Promise<PreparedReport> {
  const now = new Date();
  const [readings, session] = await Promise.all([
    listReadingsSince(new Date(now.getTime() - days * 86_400_000)),
    getSupabase().auth.getSession(),
  ]);
  return {
    doc: buildPressureReport({
      readings,
      days,
      email: session.data.session?.user.email ?? null,
      generatedAt: now,
      timeZone: deviceTimeZone(),
    }),
    filename: pressureReportFilename(now),
  };
}
