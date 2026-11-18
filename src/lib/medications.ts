import { getSupabase } from "./supabase";
import type { MedicationInput } from "./medication-form";
import { UserFacingError } from "./records";
import type { Medication, MedicationLog } from "./types";

/** Disparado ao registrar dose ou mudar remédios: sininho e listas recarregam. */
export const DOSES_CHANGED = "klin:doses-changed";
function dosesChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DOSES_CHANGED));
}

const COLUMNS =
  "id, record_id, name, dosage, instructions, interval_hours, schedule_type, dose_times, timezone, duration_days, starts_at, ends_at, next_dose_at, source, is_active, notifications_enabled";

export async function listMedications(): Promise<Medication[]> {
  const { data, error } = await getSupabase()
    .from("medications")
    .select(COLUMNS)
    .order("next_dose_at", { ascending: true, nullsFirst: false })
    .order("name");
  if (error) throw new UserFacingError("Não foi possível carregar os medicamentos.");
  return (data ?? []) as Medication[];
}

export async function getMedication(id: string): Promise<{ medication: Medication; logs: MedicationLog[] } | null> {
  const supabase = getSupabase();
  const [med, logs] = await Promise.all([
    supabase.from("medications").select(COLUMNS).eq("id", id).maybeSingle(),
    supabase
      .from("medication_logs")
      .select("id, scheduled_for, status, taken_at, source")
      .eq("medication_id", id)
      .order("scheduled_for", { ascending: false })
      .limit(60),
  ]);
  if (med.error || logs.error) throw new UserFacingError("Não foi possível carregar o medicamento.");
  if (!med.data) return null;
  return { medication: med.data as Medication, logs: (logs.data ?? []) as MedicationLog[] };
}

/** Cria (sem id) ou atualiza. O gatilho do banco recalcula fim e próxima dose. */
export async function saveMedication(input: MedicationInput, id?: string, recordId?: string | null): Promise<string> {
  const supabase = getSupabase();
  if (id) {
    const { error } = await supabase.from("medications").update({ ...input, is_active: true }).eq("id", id);
    if (error) throw new UserFacingError("Não foi possível salvar as alterações.");
    dosesChanged();
    return id;
  }
  const { data, error } = await supabase
    .from("medications")
    .insert({ ...input, source: "manual", record_id: recordId ?? null })
    .select("id")
    .single();
  if (error || !data) throw new UserFacingError("Não foi possível cadastrar o remédio.");
  dosesChanged();
  return data.id as string;
}

export type DoseAction = "taken" | "skipped";

/**
 * Registra a dose do horário `scheduledFor`. O gatilho avança a próxima dose.
 * Registro repetido (outro aparelho, notificação + app) não é erro.
 */
export async function recordDose(
  medicationId: string,
  scheduledFor: Date,
  action: DoseAction,
  source: "app" | "notification" = "app",
): Promise<"ok" | "already"> {
  const { error } = await getSupabase()
    .from("medication_logs")
    .insert({
      medication_id: medicationId,
      scheduled_for: scheduledFor.toISOString(),
      status: action,
      taken_at: action === "taken" ? new Date().toISOString() : null,
      source,
    });
  if (!error) {
    dosesChanged();
    return "ok";
  }
  if (error.code === "23505") {
    dosesChanged();
    return "already";
  }
  throw new UserFacingError("Não foi possível registrar a dose.");
}

export async function setReminders(id: string, enabled: boolean): Promise<void> {
  const { error } = await getSupabase().from("medications").update({ notifications_enabled: enabled }).eq("id", id);
  if (error) throw new UserFacingError("Não foi possível alterar os lembretes.");
  dosesChanged();
}

export async function endTreatment(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from("medications")
    .update({ is_active: false, notifications_enabled: false })
    .eq("id", id);
  if (error) throw new UserFacingError("Não foi possível encerrar o tratamento.");
  dosesChanged();
}

export async function deleteMedication(id: string): Promise<void> {
  const { error } = await getSupabase().from("medications").delete().eq("id", id);
  if (error) throw new UserFacingError("Não foi possível apagar o medicamento.");
  dosesChanged();
}

// ---------------------------------------------------------------------
// Pré-preenchimento vindo do resumo da IA ("cadastre manualmente").
// Fica no sessionStorage, NUNCA na URL: o GitHub Pages recebe a query
// string nos pedidos de navegação, e nome de remédio é dado de saúde.
// ---------------------------------------------------------------------
const PREFILL_KEY = "klin:med-prefill";

export interface MedicationPrefill {
  name: string;
  dosage: string | null;
  instructions: string | null;
  durationDays: number | null;
  recordId: string | null;
}

export function storePrefill(p: MedicationPrefill): void {
  try {
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify(p));
  } catch {
    // sem sessionStorage: o formulário abre vazio
  }
}

/** Lê sem apagar (o React pode montar o formulário duas vezes em desenvolvimento). */
export function peekPrefill(): MedicationPrefill | null {
  try {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    return raw ? (JSON.parse(raw) as MedicationPrefill) : null;
  } catch {
    return null;
  }
}

/** Apaga depois de salvar. */
export function clearPrefill(): void {
  try {
    sessionStorage.removeItem(PREFILL_KEY);
  } catch {
    // nada a apagar
  }
}
