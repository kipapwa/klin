/** Validação do cadastro/edição de medicamento (pura, testável no Node). */

export interface MedicationFormValues {
  name: string;
  dosage: string;
  instructions: string;
  intervalHours: string;
  durationDays: string; // "" = uso contínuo
  startsAt: string; // valor de <input type="datetime-local">, horário local
  notificationsEnabled: boolean;
}

export interface MedicationInput {
  name: string;
  dosage: string | null;
  instructions: string | null;
  interval_hours: number;
  duration_days: number | null;
  starts_at: string; // ISO UTC
  notifications_enabled: boolean;
}

export type FieldErrors = Partial<Record<keyof MedicationFormValues, string>>;

/** Intervalos mais comuns, como botões de atalho. */
export const INTERVAL_PRESETS = [4, 6, 8, 12, 24] as const;

function parseNumber(value: string): number {
  return Number(value.trim().replace(",", "."));
}

export function validateMedicationForm(
  v: MedicationFormValues,
): { ok: true; value: MedicationInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};

  const name = v.name.trim();
  if (!name) errors.name = "Informe o nome do medicamento.";
  else if (name.length > 200) errors.name = "Nome muito longo (máx. 200 caracteres).";

  const dosage = v.dosage.trim();
  if (dosage.length > 200) errors.dosage = "Dosagem muito longa (máx. 200 caracteres).";

  const instructions = v.instructions.trim();
  if (instructions.length > 1000) errors.instructions = "Instruções muito longas (máx. 1000 caracteres).";

  const interval = parseNumber(v.intervalHours);
  if (!Number.isFinite(interval) || interval < 0.25 || interval > 168) {
    errors.intervalHours = "Intervalo entre 15 minutos (0,25 h) e 168 horas.";
  }

  let duration: number | null = null;
  if (v.durationDays.trim()) {
    duration = parseNumber(v.durationDays);
    if (!Number.isInteger(duration) || duration < 1 || duration > 3650) {
      errors.durationDays = "Duração em dias inteiros (1 a 3650), ou vazio para uso contínuo.";
    }
  }

  // "YYYY-MM-DDTHH:MM" sem fuso => o Date interpreta no horário local do aparelho.
  const start = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v.startsAt) ? new Date(v.startsAt) : null;
  if (!start || Number.isNaN(start.getTime())) errors.startsAt = "Informe a data e a hora da primeira dose.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      dosage: dosage || null,
      instructions: instructions || null,
      interval_hours: Math.round(interval * 100) / 100,
      duration_days: duration,
      starts_at: start!.toISOString(),
      notifications_enabled: v.notificationsEnabled,
    },
  };
}

/** Date -> valor de <input type="datetime-local"> no horário local. */
export function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
