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

export function intervalText(hours: number): string {
  if (hours === 24) return "1 vez ao dia";
  if (hours < 1) return `a cada ${Math.round(hours * 60)} minutos`;
  if (24 % hours === 0) return `de ${hours} em ${hours} horas (${24 / hours}x ao dia)`;
  return `de ${String(hours).replace(".", ",")} em ${String(hours).replace(".", ",")} horas`;
}

/** "Todos os dias às 08:00 e 20:00" ou "de 8 em 8 horas (3x ao dia)". */
export function scheduleText(m: { schedule_type?: string; dose_times?: string[]; interval_hours: number }): string {
  if (m.schedule_type === "times" && m.dose_times?.length) {
    const t = m.dose_times;
    const list = t.length === 1 ? t[0] : `${t.slice(0, -1).join(", ")} e ${t.at(-1)}`;
    return `Todos os dias às ${list}`;
  }
  return intervalText(Number(m.interval_hours));
}

const relative = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

/** "em 2 horas", "há 30 minutos", "agora". */
export function formatRelative(iso: string, now: number): string {
  const diffMin = Math.round((Date.parse(iso) - now) / 60_000);
  if (Math.abs(diffMin) < 1) return "agora";
  if (Math.abs(diffMin) < 60) return relative.format(diffMin, "minute");
  const diffH = Math.round(diffMin / 60);
  if (Math.abs(diffH) < 48) return relative.format(diffH, "hour");
  return relative.format(Math.round(diffH / 24), "day");
}

const timeOnly = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const weekdayTime = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });

/** "14:00" se for hoje; senão "qua., 19 14:00". */
export function formatDoseTime(iso: string, now: number): string {
  const d = new Date(iso);
  return d.toDateString() === new Date(now).toDateString() ? timeOnly.format(d) : weekdayTime.format(d);
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
