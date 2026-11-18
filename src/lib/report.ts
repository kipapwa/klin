/**
 * Relatório clínico: conteúdo (puro, testável no Node) separado do desenho
 * em PDF (report-pdf.ts). Gerado no aparelho; os dados não saem dele.
 */
import { CATEGORY_LABEL, formatDate, formatDateTime, intervalText, SEVERITY_LABEL } from "./labels.ts";
import type { MedicalRecord, Medication } from "./types.ts";

export interface ReportBlock {
  label?: string;
  text: string;
}

export interface ReportSection {
  heading: string;
  /** Destaque vermelho (registro com alerta). */
  alert?: boolean;
  blocks: ReportBlock[];
}

export interface ReportDoc {
  title: string;
  meta: string[];
  sections: ReportSection[];
  footer: string;
}

/**
 * As fontes padrão do PDF (Helvetica, WinAnsi) cobrem o Latin-1: acentos do
 * português funcionam, mas travessões, aspas curvas, emojis etc. não.
 */
export function pdfSafe(text: string): string {
  return text
    .replace(/[–—−]/g, "-")
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/…/g, "...")
    .replace(/[•●]/g, "-")
    .replace(/ /g, " ")
    .replace(/[^\u0000-ÿ]/gu, "")
    .replace(/[ \t]+\n/g, "\n");
}

function medicationLine(m: Medication): ReportBlock {
  const parts = [
    intervalText(Number(m.interval_hours)),
    m.duration_days ? `por ${m.duration_days} dias` : "uso contínuo",
    `início ${formatDateTime(m.starts_at)}`,
  ];
  if (m.instructions) parts.push(m.instructions);
  return { label: `${m.name}${m.dosage ? ` (${m.dosage})` : ""}`, text: parts.join("; ") };
}

function recordSection(r: MedicalRecord): ReportSection {
  const blocks: ReportBlock[] = [];
  const add = (label: string, text: string | null | undefined) => {
    if (text && text.trim()) blocks.push({ label, text: text.trim() });
  };
  add("Gravidade", r.severity === "routine" ? null : SEVERITY_LABEL[r.severity].toUpperCase());
  add("Sinais de alerta", r.alert_signs.join("; "));
  add("Queixa principal", r.chief_complaint);
  add("Histórico", r.history);
  add("Observações", r.observations);
  add("Conduta", r.plan);
  add("CID-10 (sugestões)", r.icd10_codes.map((c) => `${c.code} ${c.description}`).join("; "));
  add("Retorno", r.follow_up_date ? formatDate(r.follow_up_date) : null);
  if (blocks.length === 0) blocks.push({ text: r.status === "ready" ? "Sem detalhes." : "Nota ainda não processada pela IA." });

  return {
    heading: `${formatDateTime(r.recorded_at)} · ${CATEGORY_LABEL[r.category]} · ${r.title || "Registro sem título"}`,
    alert: r.severity === "critical",
    blocks,
  };
}

export function buildReport(input: {
  records: MedicalRecord[];
  medications: Medication[];
  email: string | null;
  filtersDescription: string | null;
  generatedAt: Date;
}): ReportDoc {
  const active = input.medications.filter((m) => m.is_active && m.next_dose_at);
  const meta = [
    `Gerado em ${formatDateTime(input.generatedAt.toISOString())}`,
    ...(input.email ? [`Conta: ${input.email}`] : []),
    `${input.records.length} ${input.records.length === 1 ? "registro" : "registros"}${input.filtersDescription ? ` (filtro: ${input.filtersDescription})` : ""}`,
  ];
  const critical = input.records.filter((r) => r.severity === "critical").length;
  if (critical) meta.push(`ATENÇÃO: ${critical} ${critical === 1 ? "registro com alerta" : "registros com alerta"}`);

  const sections: ReportSection[] = [];
  if (active.length) sections.push({ heading: "Medicamentos em uso", blocks: active.map(medicationLine) });
  sections.push(...input.records.map(recordSection));

  return {
    title: "Relatório clínico",
    meta,
    sections,
    footer:
      "Klin · Documento gerado pelo próprio paciente a partir de relatos gravados. Os CID-10 são sugestões automáticas e não substituem avaliação profissional.",
  };
}

/** Nome do arquivo sem dado clínico. */
export function reportFilename(date: Date): string {
  return `klin-relatorio-${date.toISOString().slice(0, 10)}.pdf`;
}
