/**
 * Edge Function: processar-registro
 *
 * POST { "recordId": "<uuid>" }  (Authorization: Bearer <token do usuário>)
 *
 * 1. Confere o usuário e gasta 1 da cota diária de IA.
 * 2. "Reserva" o registro (status draft/failed -> processing).
 * 3. Pega o áudio do bucket privado (token do usuário, RLS) ou, no registro
 *    escrito à mão, o texto guardado em `transcript`.
 * 4. Gemini estrutura a nota; se falhar, Groq (Whisper + Llama).
 * 5. Grava a nota, o retorno e os medicamentos extraídos (source = 'ai').
 *
 * Tudo roda com o token do próprio usuário (chave pública + RLS):
 * a função não usa a chave secreta do Supabase.
 *
 * Segredos: GEMINI_API_KEY, GROQ_API_KEY, ALLOWED_ORIGINS e, opcionais,
 * GEMINI_MODEL, GROQ_TRANSCRIPTION_MODEL, GROQ_CHAT_MODEL, AI_TIMEOUT_MS, AI_DAILY_LIMIT.
 */
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { AllProvidersFailed, baseMime, MAX_TEXT_CHARS, structureAudio, structureText } from "../_shared/ai.ts";
import { aiConfigFromEnv } from "../_shared/ai-env.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { publishableKey } from "../_shared/supabase-keys.ts";
import { addDays, localDate, medicationStart, safeTimeZone } from "../_shared/schedule.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_MIME = new Set(["audio/webm", "audio/ogg", "audio/m4a", "audio/mpeg", "audio/aac", "audio/wav"]);
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const STALE_PROCESSING_MS = 5 * 60 * 1000;
/** Relato escrito mínimo para a IA analisar. */
const MIN_TEXT_CHARS = 10;

const env = (name: string) => Deno.env.get(name) || undefined;

const aiConfig = () => aiConfigFromEnv(env);

const log = {
  error: (msg: string) => console.error(`[processar-registro] ${msg}`),
  info: (msg: string) => console.log(`[processar-registro] ${msg}`),
};

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("Origin"), env("ALLOWED_ORIGINS"));
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Método não permitido." });

  // --- Entrada -------------------------------------------------------
  let recordId: unknown;
  try {
    ({ recordId } = await req.json());
  } catch {
    return reply(400, { error: "Corpo inválido." });
  }
  if (typeof recordId !== "string" || !UUID_RE.test(recordId)) {
    return reply(400, { error: "Registro inválido." });
  }

  // --- Usuário (cliente com o token dele: tudo passa pelo RLS) --------
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { error: "Sessão expirada. Entre novamente." });

  const apiKey = publishableKey(env);
  if (!apiKey) return reply(503, { error: "Servidor não configurado." });
  const supabase = createClient(env("SUPABASE_URL")!, apiKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return reply(401, { error: "Sessão expirada. Entre novamente." });
  const userId = userData.user.id;

  // --- Cota (uma vez por pedido, antes das IAs) ----------------------
  const dailyLimit = Number(env("AI_DAILY_LIMIT")) || 30;
  const { data: quotaOk, error: quotaError } = await supabase.rpc("ai_take_quota", { p_limit: dailyLimit });
  if (quotaError) {
    log.error(`cota: ${quotaError.code ?? "erro"}`);
    return reply(500, { error: "Não foi possível processar agora. Tente de novo." });
  }
  if (!quotaOk) return reply(429, { error: "Limite diário de processamentos por IA atingido." });

  // --- Reserva o registro --------------------------------------------
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const { data: record, error: claimError } = await supabase
    .from("medical_records")
    .update({ status: "processing" })
    .eq("id", recordId)
    .or(`status.in.(draft,failed),and(status.eq.processing,updated_at.lt."${staleBefore}")`)
    .select("id, audio_path, audio_mime_type, recorded_at, transcript")
    .maybeSingle();
  if (claimError) {
    log.error(`reserva: ${claimError.code ?? "erro"}`);
    return reply(500, { error: "Não foi possível processar agora. Tente de novo." });
  }
  if (!record) {
    return reply(409, { error: "Registro não encontrado ou já em processamento." });
  }

  const fail = async (status: number, message: string, detail?: string) => {
    await supabase.from("medical_records").update({ status: "failed" }).eq("id", recordId);
    return reply(status, detail ? { error: message, detail } : { error: message });
  };

  // --- Entrada: áudio gravado OU relato escrito (registro manual) -----------
  const writtenText = typeof record.transcript === "string" ? record.transcript.trim() : "";
  let input: { kind: "audio"; audio: Uint8Array; mime: string } | { kind: "text"; text: string };
  if (record.audio_path) {
    const { data: blob, error: downloadError } = await supabase.storage.from("audio").download(record.audio_path);
    if (downloadError || !blob) {
      log.error(`download do áudio falhou (registro ${recordId})`);
      return fail(404, "Áudio não encontrado.");
    }
    const mime = baseMime(record.audio_mime_type || blob.type || "audio/webm");
    if (!ALLOWED_MIME.has(mime)) return fail(415, "Formato de áudio não suportado.");
    if (blob.size === 0 || blob.size > MAX_AUDIO_BYTES) return fail(413, "Áudio vazio ou grande demais.");
    input = { kind: "audio", audio: new Uint8Array(await blob.arrayBuffer()), mime };
  } else if (writtenText.length >= MIN_TEXT_CHARS) {
    input = { kind: "text", text: writtenText.slice(0, MAX_TEXT_CHARS) };
  } else {
    return fail(400, "Escreva um pouco mais sobre o que aconteceu para a IA analisar.");
  }

  // --- IA --------------------------------------------------------------
  let result;
  try {
    result =
      input.kind === "audio"
        ? await structureAudio(input.audio, input.mime, aiConfig(), log)
        : await structureText(input.text, aiConfig(), log);
  } catch (err) {
    if (err instanceof AllProvidersFailed) {
      if (err.notConfigured) return fail(503, "IA não configurada.");
      if (err.rateLimited) return fail(503, "A IA está ocupada agora. Tente de novo em instantes.", err.summary);
      // Motivo técnico sem dado clínico (ver safeDetail): permite diagnosticar sem logs.
      return fail(502, `A IA não conseguiu processar ${input.kind === "audio" ? "o áudio" : "o texto"}. Tente de novo.`, err.summary);
    }
    return fail(502, `A IA não conseguiu processar ${input.kind === "audio" ? "o áudio" : "o texto"}. Tente de novo.`);
  }
  const { note } = result;

  // --- Grava a nota -----------------------------------------------------
  const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  const timeZone = safeTimeZone(profile?.timezone);
  const recordedAt = new Date(record.recorded_at);
  const recordedDay = localDate(recordedAt, timeZone);

  const { error: updateError } = await supabase
    .from("medical_records")
    .update({
      title: note.title,
      category: note.category,
      severity: note.severity,
      chief_complaint: note.chief_complaint,
      history: note.history,
      observations: note.observations,
      plan: note.plan,
      transcript: note.transcript,
      icd10_codes: note.icd10,
      alert_signs: note.alert_signs,
      follow_up_in_days: note.follow_up_in_days,
      follow_up_date: note.follow_up_in_days ? addDays(recordedDay, note.follow_up_in_days) : null,
      ai_provider: result.provider,
      ai_model: result.model.slice(0, 100),
      processed_at: new Date().toISOString(),
      status: "ready",
    })
    .eq("id", recordId);
  if (updateError) {
    log.error(`gravar nota: ${updateError.code ?? "erro"}`);
    return fail(500, "Não foi possível salvar a nota. Tente de novo.");
  }

  // --- Medicamentos -----------------------------------------------------
  // Reprocessar substitui só os que a IA tinha extraído deste registro.
  await supabase.from("medications").delete().eq("record_id", recordId).eq("source", "ai");

  const complete = note.medications.filter((m) => m.interval_hours !== null);
  let needsReview = note.medications.filter((m) => m.interval_hours === null);
  let created = complete.length;
  const startFrom = new Date(Math.max(Date.now(), recordedAt.getTime()));

  if (complete.length > 0) {
    const { error: medsError } = await supabase.from("medications").insert(
      complete.map((m) => ({
        record_id: recordId,
        name: m.name,
        dosage: m.dosage,
        instructions: m.instructions,
        interval_hours: m.interval_hours,
        duration_days: m.duration_days,
        starts_at: medicationStart(startFrom, m.start_time, timeZone).toISOString(),
        timezone: timeZone,
        source: "ai",
        // Extraído pela IA: o usuário confere antes de ligar os lembretes.
        notifications_enabled: false,
      })),
    );
    if (medsError) {
      // A nota já foi salva; os remédios voltam para o usuário cadastrar.
      log.error(`gravar medicamentos: ${medsError.code ?? "erro"}`);
      created = 0;
      needsReview = note.medications;
    }
  }

  log.info(`ok registro=${recordId} ia=${result.provider} meds=${created}/${note.medications.length}`);
  return reply(200, {
    recordId,
    provider: result.provider,
    severity: note.severity,
    medicationsCreated: created,
    // Sem intervalo definido na fala: o app pede para o usuário completar.
    medicationsNeedingReview: needsReview,
  });
});
