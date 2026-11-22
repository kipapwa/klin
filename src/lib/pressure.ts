/** Medições de pressão (`bp_readings`, só do dono pelo RLS). Regras em ./blood-pressure. */
import type { BpInput, BpReading } from "./blood-pressure";
import { getSupabase } from "./supabase";
import { isNetworkFailure, UserFacingError } from "./records";

const COLUMNS = "id, measured_at, systolic, diastolic, pulse, note";

const fail = (what: string, error: { code?: string } | null) =>
  isNetworkFailure(error)
    ? new UserFacingError("Sem internet. Tente de novo quando a conexão voltar.")
    : new UserFacingError(`Não foi possível ${what}${error?.code ? ` (código ${error.code})` : ""}.`);

/** Últimas medições (até 1 ano), mais recente primeiro. */
export async function listReadings(): Promise<BpReading[]> {
  const since = new Date(Date.now() - 366 * 86_400_000).toISOString();
  const { data, error } = await getSupabase()
    .from("bp_readings")
    .select(COLUMNS)
    .gte("measured_at", since)
    .order("measured_at", { ascending: false })
    .limit(2000);
  if (error) throw fail("carregar as medições", error);
  return (data ?? []) as BpReading[];
}

/** Medições desde `since` (relatório e IA). */
export async function listReadingsSince(since: Date): Promise<BpReading[]> {
  const { data, error } = await getSupabase()
    .from("bp_readings")
    .select(COLUMNS)
    .gte("measured_at", since.toISOString())
    .order("measured_at", { ascending: false })
    .limit(2000);
  if (error) throw fail("carregar as medições", error);
  return (data ?? []) as BpReading[];
}

export async function addReading(input: BpInput): Promise<BpReading> {
  const { data, error } = await getSupabase()
    .from("bp_readings")
    .insert({
      systolic: input.systolic,
      diastolic: input.diastolic,
      pulse: input.pulse,
      note: input.note,
      measured_at: input.measuredAt,
    })
    .select(COLUMNS)
    .single();
  if (error || !data) throw fail("salvar a medição", error);
  return data as BpReading;
}

export async function deleteReading(id: string): Promise<void> {
  const { error } = await getSupabase().from("bp_readings").delete().eq("id", id);
  if (error) throw fail("apagar a medição", error);
}
