/**
 * Edge Function: marcar-dose
 *
 * "Marcar como tomado" tocado na notificação: o Service Worker manda a dose
 * e a assinatura recebidas no push (ver _shared/dose-token.ts). Sem login:
 * publicada com --no-verify-jwt; quem autoriza é a assinatura, que vale só
 * para aquela dose (remédio + dono + horário) e por até 24 h.
 *
 * Usa a chave secreta do Supabase (sem usuário na requisição) e só faz uma
 * coisa: inserir em medication_logs a dose assinada. O gatilho do banco
 * avança a próxima dose, igual a marcar pelo app.
 *
 * Segredos: CRON_SECRET (a chave de assinatura deriva dele), ALLOWED_ORIGINS.
 * Logs: só códigos, nunca nomes de remédios.
 */
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { corsHeaders } from "../_shared/cors.ts";
import { parseMarkRequest, verifyDose } from "../_shared/dose-token.ts";
import { secretKey } from "../_shared/supabase-keys.ts";

const env = (name: string) => Deno.env.get(name) || undefined;

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"), env("ALLOWED_ORIGINS"));
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "método não permitido" });

  const secret = env("CRON_SECRET");
  const serviceKey = secretKey(env);
  if (!secret || !serviceKey) {
    console.error("[marcar-dose] CRON_SECRET ou chave secreta do Supabase ausente");
    return json(503, { error: "servidor não configurado" });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "pedido inválido" });
  }
  const mark = parseMarkRequest(body);
  if (!mark) return json(400, { error: "pedido inválido" });
  if (mark.exp < Date.now()) return json(410, { error: "lembrete expirado" });

  const admin = createClient(env("SUPABASE_URL")!, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: med, error: medError } = await admin
    .from("medications")
    .select("id, user_id")
    .eq("id", mark.medicationId)
    .maybeSingle();
  if (medError) {
    console.error(`[marcar-dose] remédio: ${medError.code ?? "erro"}`);
    return json(500, { error: "falha ao registrar" });
  }
  // Remédio apagado ou assinatura inválida: mesma resposta (não revela qual).
  const valid = med && (await verifyDose(secret, { ...mark, userId: med.user_id as string }, mark.token));
  if (!valid) return json(403, { error: "não autorizado" });

  const { error } = await admin.from("medication_logs").insert({
    user_id: med.user_id,
    medication_id: mark.medicationId,
    scheduled_for: mark.scheduledFor,
    status: "taken",
    taken_at: new Date().toISOString(),
    source: "notification",
  });
  if (error?.code === "23505") return json(200, { status: "already" }); // já marcada (app ou outro toque)
  if (error) {
    console.error(`[marcar-dose] registro: ${error.code ?? "erro"}`);
    return json(500, { error: "falha ao registrar" });
  }
  console.log("[marcar-dose] dose registrada pela notificação");
  return json(200, { status: "taken" });
});
