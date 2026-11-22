import { FunctionsHttpError } from "@supabase/supabase-js";
import { baseMime, extensionFor, MAX_UPLOAD_BYTES } from "./audio";
import { getSupabase } from "./supabase";
import type {
  MedicalRecord,
  MedicalRecordSummary,
  Medication,
  ProcessResult,
  RecordCategory,
  RecordSeverity,
} from "./types";

const SUMMARY_COLUMNS = "id, title, recorded_at, category, severity, status, chief_complaint";
const RECORD_COLUMNS =
  `${SUMMARY_COLUMNS}, history, observations, plan, transcript, icd10_codes, alert_signs, ` +
  "follow_up_in_days, follow_up_date, audio_path, audio_duration_s, ai_provider, processed_at";

/** Erro com mensagem já pronta para mostrar ao usuário (sem dados clínicos). */
export class UserFacingError extends Error {}

/** Sem conexão: o chamador pode guardar a gravação no aparelho e tentar depois. */
export class OfflineError extends UserFacingError {
  constructor() {
    super("Sem conexão com a internet.");
  }
}

/** Erros de rede do fetch: Chrome ("Failed to fetch"), Firefox ("NetworkError"), Safari ("Load failed"). */
export function isNetworkFailure(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const text = err instanceof Error ? `${err.name} ${err.message}` : typeof err === "object" && err ? JSON.stringify(err) : String(err);
  return /Failed to fetch|NetworkError|Load failed|network/i.test(text);
}

export interface RecordFilters {
  categories?: RecordCategory[];
  severities?: RecordSeverity[];
  /** Busca em português no título e nas seções da nota (índice `search`). */
  query?: string;
}

export async function listRecords(filters: RecordFilters = {}, limit = 200): Promise<MedicalRecordSummary[]> {
  let q = getSupabase().from("medical_records").select(SUMMARY_COLUMNS);
  if (filters.categories?.length) q = q.in("category", filters.categories);
  if (filters.severities?.length) q = q.in("severity", filters.severities);
  const text = filters.query?.trim().slice(0, 100);
  if (text) q = q.textSearch("search", text, { config: "portuguese", type: "websearch" });
  const { data, error } = await q.order("recorded_at", { ascending: false }).limit(limit);
  if (error) throw new UserFacingError(`Não foi possível carregar os registros${error.code ? ` (código ${error.code})` : ""}.`);
  return data as MedicalRecordSummary[];
}

export async function getRecord(id: string): Promise<{ record: MedicalRecord; medications: Medication[] } | null> {
  const supabase = getSupabase();
  const [rec, meds] = await Promise.all([
    supabase.from("medical_records").select(RECORD_COLUMNS).eq("id", id).maybeSingle(),
    supabase
      .from("medications")
      .select("id, name, dosage, instructions, interval_hours, schedule_type, dose_times, timezone, duration_days, starts_at, ends_at, next_dose_at, source, is_active, notifications_enabled")
      .eq("record_id", id)
      .order("name"),
  ]);
  if (rec.error || meds.error) throw new UserFacingError("Não foi possível carregar o registro.");
  if (!rec.data) return null;
  // Sem tipos gerados do banco: a lista de colunas é montada por concatenação,
  // então o supabase-js não infere o tipo; os tipos em ./types espelham o schema.
  return { record: rec.data as unknown as MedicalRecord, medications: (meds.data ?? []) as Medication[] };
}

/** Registros completos para o relatório (até 200, mais recentes primeiro). */
export async function getRecordsForReport(ids: string[]): Promise<MedicalRecord[]> {
  if (ids.length === 0) return [];
  const { data, error } = await getSupabase()
    .from("medical_records")
    .select(RECORD_COLUMNS)
    .in("id", ids.slice(0, 200))
    .order("recorded_at", { ascending: false });
  if (error) throw new UserFacingError("Não foi possível montar o relatório.");
  return data as unknown as MedicalRecord[];
}

/**
 * Envia o áudio ao bucket privado (pasta do usuário) e cria o registro em
 * rascunho. Idempotente pelo `clientId`: reenviar uma gravação offline que já
 * tinha chegado (áudio ou registro) não duplica nada.
 * Sem rede, lança OfflineError.
 */
export async function createRecordFromAudio(
  audio: Blob,
  durationSeconds: number,
  opts: { clientId: string; recordedAt?: string },
): Promise<string> {
  if (audio.size === 0) throw new UserFacingError("A gravação ficou vazia. Tente de novo.");
  if (audio.size > MAX_UPLOAD_BYTES) throw new UserFacingError("A gravação ficou grande demais (máx. 25 MB).");
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new OfflineError();

  const supabase = getSupabase();
  // getSession lê a sessão salva (sem rede); o servidor confere o token de qualquer forma.
  const userId = (await supabase.auth.getSession()).data.session?.user.id;
  if (!userId) throw new UserFacingError("Sessão expirada. Entre novamente.");

  const mime = baseMime(audio.type);
  const path = `${userId}/${opts.clientId}.${extensionFor(mime)}`;

  const upload = await supabase.storage.from("audio").upload(path, audio, { contentType: mime, upsert: false });
  if (upload.error) {
    const already = /duplicate|already exists/i.test(upload.error.message) || (upload.error as { statusCode?: string }).statusCode === "409";
    if (!already) {
      if (isNetworkFailure(upload.error)) throw new OfflineError();
      throw new UserFacingError("Não foi possível enviar o áudio. Verifique a conexão.");
    }
  }

  const { data, error } = await supabase
    .from("medical_records")
    .insert({
      client_id: opts.clientId,
      audio_path: path,
      audio_mime_type: mime,
      audio_duration_s: Math.round(durationSeconds),
      status: "draft",
      ...(opts.recordedAt ? { recorded_at: opts.recordedAt } : {}),
    })
    .select("id")
    .single();
  if (!error && data) return data.id as string;

  // Já criado numa tentativa anterior (unique user_id + client_id).
  if (error?.code === "23505") {
    const existing = await supabase.from("medical_records").select("id").eq("client_id", opts.clientId).maybeSingle();
    if (existing.data) return existing.data.id as string;
  }
  if (isNetworkFailure(error)) throw new OfflineError();
  await supabase.storage.from("audio").remove([path]);
  // O código (ex.: 42501, 23514) não tem dado clínico e permite diagnosticar.
  throw new UserFacingError(`Não foi possível salvar o registro${error?.code ? ` (código ${error.code})` : ""}.`);
}

export const MIN_TEXT_CHARS = 10;
export const MAX_TEXT_CHARS = 20000;

export interface TextRecordInput {
  text: string;
  /** true: a IA organiza (queixa, histórico, conduta, CID-10, remédios). */
  useAi: boolean;
  /** Só sem IA: */
  title?: string;
  category?: RecordCategory;
  severity?: RecordSeverity;
}

/**
 * Registro escrito à mão (sem gravação). O texto fica em `transcript`.
 * Com IA: entra como rascunho e o chamador pede processRecord(id).
 * Sem IA: já entra pronto, com o texto como queixa principal.
 */
export async function createTextRecord(input: TextRecordInput): Promise<string> {
  const text = input.text.trim();
  if (text.length < MIN_TEXT_CHARS) throw new UserFacingError("Escreva um pouco mais sobre o que aconteceu.");
  if (text.length > MAX_TEXT_CHARS) throw new UserFacingError(`Texto muito longo (máx. ${MAX_TEXT_CHARS} caracteres).`);
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new UserFacingError("Sem internet. O texto continua aqui: tente de novo quando a conexão voltar.");
  }

  const base = { client_id: crypto.randomUUID(), transcript: text };
  const row = input.useAi
    ? { ...base, status: "draft" }
    : {
        ...base,
        status: "ready",
        title: (input.title?.trim() || text.split("\n")[0]).slice(0, 80),
        category: input.category ?? "symptom",
        severity: input.severity ?? "routine",
        chief_complaint: text.slice(0, 5000),
        ai_provider: "manual",
        processed_at: new Date().toISOString(),
      };
  const { data, error } = await getSupabase().from("medical_records").insert(row).select("id").single();
  if (error || !data) {
    if (isNetworkFailure(error)) throw new UserFacingError("Sem internet. O texto continua aqui: tente de novo quando a conexão voltar.");
    throw new UserFacingError(`Não foi possível salvar o registro${error?.code ? ` (código ${error.code})` : ""}.`);
  }
  // Sem apagar o guardado da linha do tempo: ela abre na hora e acrescenta o
  // registro novo quando o banco responder (regra da tela instantânea).
  return data.id as string;
}

/** Chama a Edge Function que estrutura a nota (Gemini, com Groq de reserva). */
export async function processRecord(recordId: string): Promise<ProcessResult> {
  const { data, error } = await getSupabase().functions.invoke<ProcessResult>("processar-registro", {
    body: { recordId },
  });
  if (error) {
    let message = "A IA não conseguiu processar. Tente de novo.";
    if (error instanceof FunctionsHttpError) {
      try {
        const body = (await error.context.json()) as { error?: unknown; detail?: unknown };
        if (typeof body.error === "string") message = body.error;
        // Motivo técnico (sem dado clínico): ajuda a corrigir quando a IA falha.
        if (typeof body.detail === "string" && body.detail) message += `

Detalhe técnico: ${body.detail.slice(0, 400)}`;
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

export interface RecordDetails {
  category: RecordCategory;
  severity: RecordSeverity;
  recordedAt: string; // ISO
}

const CATEGORIES: RecordCategory[] = ["exam", "symptom", "blood_pressure", "prescription", "follow_up", "procedure"];
const SEVERITIES: RecordSeverity[] = ["routine", "attention", "critical"];

/** Muda categoria, gravidade e dia/horário de um registro (RLS: só os próprios). */
export async function updateRecordDetails(id: string, details: RecordDetails): Promise<void> {
  if (!CATEGORIES.includes(details.category) || !SEVERITIES.includes(details.severity) || Number.isNaN(Date.parse(details.recordedAt))) {
    throw new UserFacingError("Confira os campos e tente de novo.");
  }
  const { data, error } = await getSupabase()
    .from("medical_records")
    .update({ category: details.category, severity: details.severity, recorded_at: details.recordedAt })
    .eq("id", id)
    .select("id");
  if (error) {
    if (isNetworkFailure(error)) throw new UserFacingError("Sem internet. Tente de novo quando a conexão voltar.");
    throw new UserFacingError(`Não foi possível salvar as alterações${error.code ? ` (código ${error.code})` : ""}.`);
  }
  if (!data?.length) throw new UserFacingError("Registro não encontrado.");
}

/** Apaga o registro e o áudio. Os remédios ficam (sem vínculo com o registro). */
export async function deleteRecord(record: Pick<MedicalRecord, "id" | "audio_path">): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("medical_records").delete().eq("id", record.id);
  if (error) throw new UserFacingError("Não foi possível apagar o registro.");
  if (record.audio_path) await supabase.storage.from("audio").remove([record.audio_path]);
}
