import type { RecordCategory, RecordSeverity, RecordStatus } from "./types";

export const CATEGORY_LABEL: Record<RecordCategory, string> = {
  exam: "Exames",
  symptom: "Sintomas",
  prescription: "Receitas",
  follow_up: "Retornos",
  procedure: "Procedimentos",
};

export const SEVERITY_LABEL: Record<RecordSeverity, string> = {
  routine: "Rotina",
  attention: "Atenção",
  critical: "Alerta",
};

export const STATUS_LABEL: Record<RecordStatus, string> = {
  draft: "Aguardando IA",
  processing: "Processando…",
  ready: "Pronto",
  failed: "Falhou",
};

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" });

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** Datas "YYYY-MM-DD" (sem hora) não podem sofrer conversão de fuso. */
export function formatDate(ymd: string): string {
  return dateOnly.format(new Date(`${ymd}T00:00:00Z`));
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
