/**
 * Regras de doses (puras, testáveis no Node). Espelham as funções
 * dose_slot_after / dose_slot_at_or_before do banco (supabase/schema.sql).
 *
 * Dois modos de agenda:
 *  - "interval": grade starts_at + k × interval_hours (ex.: de 8 em 8 horas);
 *  - "times": horários fixos do dia (dose_times, "HH:MM") no fuso `timezone`.
 * O banco guarda em `next_dose_at` a próxima dose ainda não registrada.
 */
import { addDays, localDate, zonedToUtc } from "./tz.ts";

export interface DoseSchedule {
  starts_at: string;
  interval_hours: number;
  ends_at: string | null;
  next_dose_at: string | null;
  is_active: boolean;
  schedule_type?: "interval" | "times";
  dose_times?: string[];
  timezone?: string;
}

export interface DoseLog {
  scheduled_for: string;
  status: "taken" | "skipped" | "missed";
}

/** Dá para marcar a dose até 1 h antes do horário. */
export const EARLY_WINDOW_MS = 60 * 60 * 1000;
/** Depois de 30 min do horário, a dose aparece como atrasada. */
export const LATE_AFTER_MS = 30 * 60 * 1000;

const isTimes = (m: DoseSchedule) => m.schedule_type === "times" && (m.dose_times?.length ?? 0) > 0;
const tzOf = (m: DoseSchedule) => m.timezone || "America/Sao_Paulo";
const stepMs = (m: DoseSchedule) => Number(m.interval_hours) * 3_600_000;
const endOf = (m: DoseSchedule) => (m.ends_at ? Date.parse(m.ends_at) : Infinity);

/**
 * Doses do modo "times" entre os dias locais de `from` e `to` (com folga de 1 dia), ordenadas.
 * `applyEnd` = false não corta no fim do tratamento (para espelhar o banco, que
 * corta depois de escolher a dose).
 */
function timesSlots(m: DoseSchedule, from: number, to: number, applyEnd = true): number[] {
  const tz = tzOf(m);
  const start = Date.parse(m.starts_at);
  const out: number[] = [];
  let day = addDays(localDate(from, tz), -1);
  const lastDay = addDays(localDate(to, tz), 1);
  while (day <= lastDay) {
    for (const t of m.dose_times ?? []) {
      const slot = zonedToUtc(day, t, tz);
      if (slot >= start && (!applyEnd || slot <= endOf(m))) out.push(slot);
    }
    day = addDays(day, 1);
  }
  return out.sort((a, b) => a - b);
}

/** Primeira dose depois de `after` (ou igual, se inclusive). null se o tratamento acabou. */
export function slotAfter(m: DoseSchedule, after: number, inclusive: boolean): number | null {
  const start = Date.parse(m.starts_at);
  let slot: number | undefined;
  if (isTimes(m)) {
    const ref = Math.max(after, start);
    slot = timesSlots(m, ref, ref + 86_400_000).find((s) => s > after || (inclusive && s === after));
  } else {
    const step = stepMs(m);
    slot = start + Math.max(0, Math.ceil((after - start) / step)) * step;
    if (!inclusive && slot <= after) slot += step;
  }
  return slot !== undefined && slot <= endOf(m) ? slot : null;
}

/** Última dose da agenda até `at` (inclusive). */
export function slotAtOrBefore(m: DoseSchedule, at: number): number | null {
  const start = Date.parse(m.starts_at);
  if (at < start) return null;
  let slot: number | undefined;
  if (isTimes(m)) {
    slot = timesSlots(m, at - 86_400_000, at, false).filter((s) => s <= at).at(-1);
  } else {
    const step = stepMs(m);
    slot = start + Math.floor((at - start) / step) * step;
  }
  return slot !== undefined && slot <= endOf(m) ? slot : null;
}

/**
 * Horário da dose que o usuário registraria agora, ou null se nenhuma está
 * devida. Com várias doses perdidas, vale a mais recente.
 */
export function dueSlot(m: DoseSchedule, now: number): Date | null {
  if (!m.is_active || !m.next_dose_at) return null;
  const next = Date.parse(m.next_dose_at);
  const limit = now + EARLY_WINDOW_MS;
  if (next > limit) return null;
  const latest = slotAtOrBefore(m, limit);
  // null aqui = a dose atual da agenda já passou do fim do tratamento (igual ao banco).
  if (latest === null) return null;
  const slot = Math.max(latest, next);
  return slot <= endOf(m) ? new Date(slot) : null;
}

/** O horário recebido (ex.: da notificação) é uma dose válida e ainda pendente? */
export function isPendingSlot(m: DoseSchedule, iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t) || !m.next_dose_at) return false;
  return slotAtOrBefore(m, t) === t && t >= Date.parse(m.next_dose_at);
}

export type DoseState = "due" | "late" | "upcoming" | "ended";

export function doseState(m: DoseSchedule, now: number): DoseState {
  if (!m.is_active || !m.next_dose_at) return "ended";
  const next = Date.parse(m.next_dose_at);
  if (next < now - LATE_AFTER_MS) return "late";
  if (next <= now + EARLY_WINDOW_MS) return "due";
  return "upcoming";
}

/**
 * Adesão nos últimos `days` dias: doses registradas como tomadas ÷ doses
 * previstas pela agenda no período. null quando ainda não havia dose prevista.
 */
export function adherence(
  m: DoseSchedule,
  logs: DoseLog[],
  now: number,
  days = 7,
): { expected: number; taken: number; percent: number | null } {
  const start = Date.parse(m.starts_at);
  const from = Math.max(start, now - days * 86_400_000);
  const to = Math.min(now, endOf(m));
  if (to < from) return { expected: 0, taken: 0, percent: null };

  let expected: number;
  if (isTimes(m)) {
    expected = timesSlots(m, from, to).filter((s) => s >= from && s <= to).length;
  } else {
    const step = stepMs(m);
    expected = Math.max(0, Math.floor((to - start) / step) - Math.ceil((from - start) / step) + 1);
  }
  const takenRaw = logs.filter((l) => {
    const t = Date.parse(l.scheduled_for);
    return l.status === "taken" && t >= from && t <= to;
  }).length;
  const taken = Math.min(takenRaw, expected);
  return { expected, taken, percent: expected ? Math.round((taken / expected) * 100) : null };
}
