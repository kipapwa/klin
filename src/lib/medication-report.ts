/**
 * Relatório de remédios: conteúdo (puro, testável no Node). O desenho em PDF
 * é o mesmo do relatório clínico (report-pdf.ts). Gerado no aparelho.
 *
 * Para cada remédio: agenda, período, instruções, adesão no período e o
 * histórico dose a dose (tomada / pulada / sem registro), mais recente primeiro.
 */
import { slotAfter } from "./doses.ts";
import { scheduleText } from "./labels.ts";
import type { ReportBlock, ReportDoc, ReportSection } from "./report.ts";
import type { Medication, MedicationLog } from "./types.ts";

export interface ReportLog extends MedicationLog {
  medication_id: string;
}

export const REPORT_PERIODS = [7, 30, 90] as const;
/** Dose dentro desta janela ainda não conta como "sem registro". */
const PENDING_MS = 60 * 60 * 1000;
/** Limite de linhas de histórico por remédio (evita PDF gigante em remédio de 1 em 1 h). */
const MAX_HISTORY = 400;

function formatter(timeZone: string, withTime: boolean) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export interface HistoryLine {
  at: number;
  status: "taken" | "skipped" | "missed" | "none" | "pending";
  takenAt: string | null;
  source: MedicationLog["source"] | null;
}

/** Horários previstos no período + registros (inclusive fora da grade), mais recente primeiro. */
export function doseHistory(m: Medication, logs: MedicationLog[], from: number, now: number): HistoryLine[] {
  const byTime = new Map(logs.map((l) => [Date.parse(l.scheduled_for), l]));
  const lines = new Map<number, HistoryLine>();
  const to = Math.min(now, m.ends_at ? Date.parse(m.ends_at) : Infinity);
  let slot = slotAfter(m, Math.max(from, Date.parse(m.starts_at)), true);
  let guard = 0;
  while (slot !== null && slot <= to && guard++ < 5000) {
    lines.set(slot, { at: slot, status: now - slot < PENDING_MS ? "pending" : "none", takenAt: null, source: null });
    slot = slotAfter(m, slot, false);
  }
  for (const [at, l] of byTime) {
    if (at < from || at > now + PENDING_MS) continue;
    lines.set(at, { at, status: l.status, takenAt: l.taken_at, source: l.source });
  }
  return [...lines.values()].sort((a, b) => b.at - a.at);
}

function statusText(line: HistoryLine, time: Intl.DateTimeFormat): string {
  switch (line.status) {
    case "taken": {
      const when = line.takenAt ? ` em ${time.format(new Date(line.takenAt))}` : "";
      return `Tomada${when}${line.source === "notification" ? " (pela notificação)" : ""}`;
    }
    case "skipped":
      return "Pulada";
    case "missed":
      return "Não tomada";
    case "pending":
      return "Pendente";
    default:
      return "Sem registro";
  }
}

export function medicationSection(m: Medication, logs: MedicationLog[], from: number, now: number, timeZone: string): ReportSection {
  const dt = formatter(timeZone, true);
  const d = formatter(timeZone, false);
  const history = doseHistory(m, logs, from, now);
  const past = history.filter((h) => h.status !== "pending");
  const taken = past.filter((h) => h.status === "taken").length;
  const active = m.is_active && m.next_dose_at !== null;

  const blocks: ReportBlock[] = [
    { label: "Quando tomar", text: scheduleText(m) },
    {
      label: "Período",
      text: `Desde ${dt.format(new Date(m.starts_at))}${
        m.ends_at ? ` até ${dt.format(new Date(m.ends_at))}` : m.duration_days ? ` por ${m.duration_days} dias` : " (uso contínuo)"
      }`,
    },
  ];
  if (m.instructions) blocks.push({ label: "Instruções", text: m.instructions });
  blocks.push({
    label: "Adesão no período",
    text: past.length
      ? `${taken} de ${past.length} ${past.length === 1 ? "dose tomada" : "doses tomadas"} (${Math.round((taken / past.length) * 100)}%)`
      : "Nenhuma dose prevista no período.",
  });
  if (history.length) {
    const shown = history.slice(0, MAX_HISTORY);
    const text = shown.map((h) => `${dt.format(new Date(h.at))} - ${statusText(h, dt)}`).join("\n");
    blocks.push({
      label: "Histórico de doses",
      text: history.length > shown.length ? `${text}\n... e mais ${history.length - shown.length} doses anteriores (${d.format(new Date(history.at(-1)!.at))} em diante).` : text,
    });
  }
  return {
    heading: `${m.name}${m.dosage ? ` (${m.dosage})` : ""} · ${active ? "Em uso" : "Encerrado"}`,
    alert: false,
    blocks,
  };
}

export function buildMedicationReport(input: {
  medications: Medication[];
  logs: ReportLog[];
  days: number;
  email: string | null;
  generatedAt: Date;
  timeZone: string;
}): ReportDoc {
  const now = input.generatedAt.getTime();
  const from = now - input.days * 86_400_000;
  const d = formatter(input.timeZone, false);
  // Remédios em uso (mesmo que a 1ª dose ainda não tenha chegado) e os que valeram no período.
  const inUse = (m: Medication) => m.is_active && m.next_dose_at !== null;
  const meds = input.medications.filter((m) => inUse(m) || (Date.parse(m.starts_at) <= now && (!m.ends_at || Date.parse(m.ends_at) >= from)));
  const ordered = [...meds].sort((a, b) => Number(b.is_active && b.next_dose_at !== null) - Number(a.is_active && a.next_dose_at !== null) || a.name.localeCompare(b.name, "pt-BR"));

  const meta = [
    `Período: ${d.format(new Date(from))} a ${d.format(input.generatedAt)} (últimos ${input.days} dias)`,
    `Gerado em ${formatter(input.timeZone, true).format(input.generatedAt)}`,
    ...(input.email ? [`Conta: ${input.email}`] : []),
    `${ordered.length} ${ordered.length === 1 ? "remédio" : "remédios"}`,
  ];
  const sections = ordered.map((m) =>
    medicationSection(m, input.logs.filter((l) => l.medication_id === m.id), from, now, input.timeZone),
  );
  if (!sections.length) sections.push({ heading: "Nenhum remédio no período", blocks: [{ text: "Não há remédios em uso nem encerrados neste período." }] });

  return {
    title: "Relatório de remédios",
    meta,
    sections,
    footer: "Klin · Documento gerado pelo próprio paciente. \"Sem registro\" = a dose não foi marcada no app (pode ter sido tomada sem marcar).",
  };
}

/** Nome do arquivo sem dado clínico. */
export function medicationReportFilename(date: Date): string {
  return `klin-remedios-${date.toISOString().slice(0, 10)}.pdf`;
}
