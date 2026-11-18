/** Validação do cadastro/edição de medicamento (pura, testável no Node). */
import { addDays, zonedToUtc } from "./tz.ts";

export type ScheduleMode = "times" | "interval";

export interface MedicationFormValues {
  name: string;
  dosage: string;
  instructions: string;
  /** "times": horários fixos do dia (padrão, mais natural); "interval": a cada X horas. */
  mode: ScheduleMode;
  times: string[]; // "HH:MM"
  startDate: string; // "YYYY-MM-DD" (modo horários)
  intervalHours: string;
  startsAt: string; // <input type="datetime-local"> (modo intervalo)
  durationDays: string; // "" = uso contínuo
  notificationsEnabled: boolean;
}

export interface MedicationInput {
  name: string;
  dosage: string | null;
  instructions: string | null;
  schedule_type: ScheduleMode;
  dose_times: string[];
  timezone: string;
  interval_hours: number;
  duration_days: number | null;
  starts_at: string; // ISO UTC
  notifications_enabled: boolean;
}

export type FieldErrors = Partial<Record<keyof MedicationFormValues, string>>;

/** Atalhos de horários fixos. */
export const TIME_PRESETS: { label: string; times: string[] }[] = [
  { label: "1x ao dia", times: ["08:00"] },
  { label: "2x ao dia", times: ["08:00", "20:00"] },
  { label: "3x ao dia", times: ["08:00", "14:00", "20:00"] },
  { label: "4x ao dia", times: ["06:00", "12:00", "18:00", "00:00"] },
];

/** Intervalos mais comuns (modo "a cada X horas"). */
export const INTERVAL_PRESETS = [4, 6, 8, 12] as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Ordena e remove repetidos ("20:00","08:00","08:00" -> "08:00","20:00"). */
export function normalizeTimes(times: string[]): string[] {
  return [...new Set(times.filter((t) => TIME_RE.test(t)))].sort();
}

function parseNumber(value: string): number {
  return Number(value.trim().replace(",", "."));
}

export function validateMedicationForm(
  v: MedicationFormValues,
  timeZone: string,
  now: number = Date.now(),
): { ok: true; value: MedicationInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};

  const name = v.name.trim();
  if (!name) errors.name = "Informe o nome do medicamento.";
  else if (name.length > 200) errors.name = "Nome muito longo (máx. 200 caracteres).";

  const dosage = v.dosage.trim();
  if (dosage.length > 200) errors.dosage = "Dosagem muito longa (máx. 200 caracteres).";

  const instructions = v.instructions.trim();
  if (instructions.length > 1000) errors.instructions = "Instruções muito longas (máx. 1000 caracteres).";

  let duration: number | null = null;
  if (v.durationDays.trim()) {
    duration = parseNumber(v.durationDays);
    if (!Number.isInteger(duration) || duration < 1 || duration > 3650) {
      errors.durationDays = "Duração em dias inteiros (1 a 3650), ou marque uso contínuo.";
    }
  }

  let schedule: Pick<MedicationInput, "schedule_type" | "dose_times" | "interval_hours" | "starts_at"> | null = null;
  if (v.mode === "times") {
    const times = normalizeTimes(v.times);
    if (times.length === 0) errors.times = "Escolha pelo menos um horário.";
    else if (times.length > 12) errors.times = "No máximo 12 horários por dia.";
    else if (v.times.some((t) => !TIME_RE.test(t))) errors.times = "Horário inválido.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.startDate)) errors.startDate = "Informe a data de início.";
    if (!errors.times && !errors.startDate) {
      // Começa à meia-noite do dia escolhido, no fuso do usuário. Se o dia é
      // HOJE, começa agora (com 1 h de tolerância): doses de antes do cadastro
      // não contam como perdidas na adesão.
      const midnight = zonedToUtc(v.startDate, "00:00", timeZone);
      const isToday = midnight <= now && now < zonedToUtc(addDays(v.startDate, 1), "00:00", timeZone);
      schedule = {
        schedule_type: "times",
        dose_times: times,
        interval_hours: 24,
        starts_at: new Date(isToday ? Math.max(midnight, now - 3_600_000) : midnight).toISOString(),
      };
    }
  } else {
    const interval = parseNumber(v.intervalHours);
    if (!Number.isFinite(interval) || interval < 0.25 || interval > 168) {
      errors.intervalHours = "Intervalo entre 15 minutos (0,25 h) e 168 horas.";
    }
    // "YYYY-MM-DDTHH:MM" sem fuso => o Date interpreta no horário local do aparelho.
    const start = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v.startsAt) ? new Date(v.startsAt) : null;
    if (!start || Number.isNaN(start.getTime())) errors.startsAt = "Informe a data e a hora da primeira dose.";
    if (!errors.intervalHours && !errors.startsAt) {
      schedule = {
        schedule_type: "interval",
        dose_times: [],
        interval_hours: Math.round(interval * 100) / 100,
        starts_at: start!.toISOString(),
      };
    }
  }

  if (Object.keys(errors).length > 0 || !schedule) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      dosage: dosage || null,
      instructions: instructions || null,
      ...schedule,
      timezone: timeZone,
      duration_days: duration,
      notifications_enabled: v.notificationsEnabled,
    },
  };
}

/** Date -> valor de <input type="datetime-local"> no horário local. */
export function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Date -> "YYYY-MM-DD" no horário local. */
export function toDateLocal(date: Date): string {
  return toDateTimeLocal(date).slice(0, 10);
}
