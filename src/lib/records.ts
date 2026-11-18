import { FunctionsHttpError } from "@supabase/supabase-js";
import { baseMime, extensionFor, MAX_UPLOAD_BYTES } from "./audio";
import { getSupabase } from "./supabase";
import type { MedicalRecord, MedicalRecordSummary, Medication, ProcessResult } from "./types";

const SUMMARY_COLUMNS = "id, title, recorded_at, category, severity, status, chief_complaint";
const RECORD_COLUMNS =
  `${SUMMARY_COLUMNS}, history, observations, plan, transcript, icd10_codes, alert_signs, ` +
  "follow_up_in_days, follow_up_date, audio_path, audio_duration_s, ai_provider, processed_at";

/** Erro com mensagem já pronta para mostrar ao usuário (sem dados clínicos). */
export class UserFacingError extends Error {}

export async function listRecords(limit = 50): Promise<MedicalRecordSummary[]> {
  const { data, error } = await getSupabase()
    .from("medical_records")
    .select(SUMMARY_COLUMNS)
    .order("recorded_at", { ascending: false })
    .limit(limit);
  if (error) throw new UserFacingError("Não foi possível carregar os registros.");
  return data as MedicalRecordSummary[];
}

export async function getRecord(id: string): Promise<{ record: MedicalRecord; medications: Medication[] } | null> {
  const supabase = getSupabase();
  const [rec, meds] = await Promise.all([
    supabase.from("medical_records").select(RECORD_COLUMNS).eq("id", id).maybeSingle(),
    supabase
      .from("medications")
      .select("id, name, dosage, instructions, interval_hours, duration_days, starts_at, ends_at, next_dose_at, source, is_active, notifications_enabled")
      .eq("record_id", id)
      .order("name"),
  ]);
  if (rec.error || meds.error) throw new UserFacingError("Não foi possível carregar o registro.");
  if (!rec.data) return null;
  // Sem tipos gerados do banco: a lista de colunas é montada por concatenação,
  // então o supabase-js não infere o tipo; os tipos em ./types espelham o schema.
  return { record: rec.data as unknown as MedicalRecord, medications: (meds.data ?? []) as Medication[] };
}

/**
 * Envia o áudio ao bucket privado (pasta do usuário) e cria o registro em
 * rascunho. Se a criação falhar, apaga o áudio enviado.
 */
export async function createRecordFromAudio(audio: Blob, durationSeconds: number): Promise<string> {
  const supabase = getSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new UserFacingError("Sessão expirada. Entre novamente.");
  if (audio.size === 0) throw new UserFacingError("A gravação ficou vazia. Tente de novo.");
  if (audio.size > MAX_UPLOAD_BYTES) throw new UserFacingError("A gravação ficou grande demais (máx. 25 MB).");

  const mime = baseMime(audio.type);
  const clientId = crypto.randomUUID();
  const path = `${userId}/${clientId}.${extensionFor(mime)}`;

  const upload = await supabase.storage.from("audio").upload(path, audio, { contentType: mime, upsert: false });
  if (upload.error) throw new UserFacingError("Não foi possível enviar o áudio. Verifique a conexão.");

  const { data, error } = await supabase
    .from("medical_records")
    .insert({
      client_id: clientId,
      audio_path: path,
      audio_mime_type: mime,
      audio_duration_s: Math.round(durationSeconds),
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !data) {
    await supabase.storage.from("audio").remove([path]);
    throw new UserFacingError("Não foi possível salvar o registro.");
  }
  return data.id as string;
}

/** Chama a Edge Function que estrutura a nota (Gemini, com Groq de reserva). */
export async function processRecord(recordId: string): Promise<ProcessResult> {
  const { data, error } = await getSupabase().functions.invoke<ProcessResult>("processar-registro", {
    body: { recordId },
  });
  if (error) {
    let message = "A IA não conseguiu processar o áudio. Tente de novo.";
    if (error instanceof FunctionsHttpError) {
      try {
        const body = (await error.context.json()) as { error?: unknown };
        if (typeof body.error === "string") message = body.error;
      } catch {
        // resposta sem JSON: fica a mensagem genérica
      }
    }
    throw new UserFacingError(message);
  }
  if (!data) throw new UserFacingError("Resposta vazia da IA.");
  return data;
}

/** URL temporária (5 min) para ouvir o áudio; só funciona para o dono (RLS). */
export async function signedAudioUrl(path: string): Promise<string> {
  const { data, error } = await getSupabase().storage.from("audio").createSignedUrl(path, 300);
  if (error || !data) throw new UserFacingError("Não foi possível carregar o áudio.");
  return data.signedUrl;
}

/** Apaga o registro e o áudio. Os remédios ficam (sem vínculo com o registro). */
export async function deleteRecord(record: Pick<MedicalRecord, "id" | "audio_path">): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("medical_records").delete().eq("id", record.id);
  if (error) throw new UserFacingError("Não foi possível apagar o registro.");
  if (record.audio_path) await supabase.storage.from("audio").remove([record.audio_path]);
}
