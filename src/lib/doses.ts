/**
 * Regras de doses (puras, testáveis no Node).
 *
 * A agenda é uma grade: starts_at + k × intervalo. O banco guarda em
 * `next_dose_at` a próxima dose ainda não registrada e avança a grade quando
 * uma dose é registrada em medication_logs (gatilho).
 */

export interface DoseSchedule {
  starts_at: string;
  interval_hours: number;
  ends_at: string | null;
  next_dose_at: string | null;
  is_active: boolean;
}

export interface DoseLog {
  scheduled_for: string;
  status: "taken" | "skipped" | "missed";
}

/** Dá para marcar a dose até 1 h antes do horário. */
export const EARLY_WINDOW_MS = 60 * 60 * 1000;
/** Depois de 30 min do horário, a dose aparece como atrasada. */
export const LATE_AFTER_MS = 30 * 60 * 1000;

const stepMs = (m: DoseSchedule) => Number(m.interval_hours) * 3_600_000;

/**
 * Horário (da grade) da dose que o usuário registraria agora, ou null se
 * nenhuma dose está devida. Com várias doses perdidas, vale a mais recente:
 * tomar agora não "paga" as anteriores.
 */
export function dueSlot(m: DoseSchedule, now: number): Date | null {
  if (!m.is_active || !m.next_dose_at) return null;
  const next = Date.parse(m.next_dose_at);
  const limit = now + EARLY_WINDOW_MS;
  if (next > limit) return null;

  const start = Date.parse(m.starts_at);
  const step = stepMs(m);
  const k = Math.max(0, Math.floor((limit - start) / step));
  const slot = Math.max(start + k * step, next);
  if (m.ends_at && slot > Date.parse(m.ends_at)) return null;
  return new Date(slot);
}

/** O horário recebido (ex.: da notificação) é uma dose válida e ainda pendente? */
export function isPendingSlot(m: DoseSchedule, iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t) || !m.next_dose_at) return false;
  const offset = (t - Date.parse(m.starts_at)) / stepMs(m);
  const onGrid = Math.abs(offset - Math.round(offset)) < 1e-6 && offset >= 0;
  const notEnded = !m.ends_at || t <= Date.parse(m.ends_at);
  return onGrid && notEnded && t >= Date.parse(m.next_dose_at);
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
 * previstas pela grade no período. null quando ainda não havia dose prevista.
 */
export function adherence(
  m: DoseSchedule,
  logs: DoseLog[],
  now: number,
  days = 7,
): { expected: number; taken: number; percent: number | null } {
  const start = Date.parse(m.starts_at);
  const step = stepMs(m);
  const from = Math.max(start, now - days * 86_400_000);
  const to = Math.min(now, m.ends_at ? Date.parse(m.ends_at) : now);
  if (to < from) return { expected: 0, taken: 0, percent: null };

  const firstK = Math.ceil((from - start) / step);
  const lastK = Math.floor((to - start) / step);
  const expected = Math.max(0, lastK - firstK + 1);
  const taken = logs.filter((l) => {
    const t = Date.parse(l.scheduled_for);
    return l.status === "taken" && t >= from && t <= to;
  }).length;

  return {
    expected,
    taken: Math.min(taken, expected),
    percent: expected ? Math.round((Math.min(taken, expected) / expected) * 100) : null,
  };
}
