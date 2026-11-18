/**
 * Edge Function: disparar-lembretes
 *
 * Chamada a cada minuto pelo Supabase Cron (supabase/cron.sql), com o
 * cabeçalho x-cron-secret. Publicada com --no-verify-jwt: quem protege é o
 * segredo, comparado em tempo constante.
 *
 * Usa a chave secreta do Supabase (ignora o RLS) porque não há usuário na
 * requisição; por isso só lê o mínimo: as doses reservadas por
 * claim_due_doses() e as inscrições push dos donos dessas doses.
 *
 * Segredos: CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
 * Logs: só contagens, nunca nomes de remédios.
 */
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { type DueDose, dosePayload, timingSafeEqual } from "../_shared/reminders.ts";
import { vapidFromEnv } from "../_shared/vapid-env.ts";
import { sendWebPush } from "../_shared/webpush.ts";

const env = (name: string) => Deno.env.get(name) || undefined;
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "método não permitido" });

  const secret = env("CRON_SECRET");
  if (!secret || !timingSafeEqual(req.headers.get("x-cron-secret") ?? "", secret)) {
    return json(401, { error: "não autorizado" });
  }

  const vapid = vapidFromEnv(env);
  if (!vapid) {
    console.error("[disparar-lembretes] chaves VAPID ausentes");
    return json(503, { error: "push não configurado" });
  }

  const admin = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: doses, error } = await admin.rpc("claim_due_doses");
  if (error) {
    console.error(`[disparar-lembretes] claim: ${error.code ?? "erro"}`);
    return json(500, { error: "falha ao buscar doses" });
  }
  const due = (doses ?? []) as DueDose[];
  if (due.length === 0) return json(200, { doses: 0, sent: 0 });

  const userIds = [...new Set(due.map((d) => d.user_id))];
  const { data: subs, error: subsError } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  if (subsError) {
    console.error(`[disparar-lembretes] inscrições: ${subsError.code ?? "erro"}`);
    return json(500, { error: "falha ao buscar inscrições" });
  }

  const byUser = new Map<string, typeof subs>();
  for (const s of subs ?? []) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  const jobs = due.flatMap((dose) =>
    (byUser.get(dose.user_id) ?? []).map(async (sub) => ({
      subId: sub.id as string,
      // TTL de 30 min: lembrete que chega muito depois perde o sentido.
      result: await sendWebPush(sub, dosePayload(dose), vapid, {
        ttl: 1800,
        urgency: "high",
        topic: `d${dose.medication_id.replace(/-/g, "").slice(0, 31)}`,
      }),
    })),
  );
  const results = await Promise.all(jobs);

  const gone = results.filter((r) => !r.result.ok && r.result.gone).map((r) => r.subId);
  const delivered = [...new Set(results.filter((r) => r.result.ok).map((r) => r.subId))];
  if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);
  if (delivered.length) {
    await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", delivered);
  }

  const failed = results.filter((r) => !r.result.ok && !r.result.gone);
  for (const f of failed) {
    if (!f.result.ok) console.error(`[disparar-lembretes] envio falhou: status=${f.result.status ?? "rede"}`);
  }
  console.log(`[disparar-lembretes] doses=${due.length} enviados=${results.length - failed.length - gone.length} expirados=${gone.length} falhas=${failed.length}`);
  return json(200, { doses: due.length, sent: results.length - failed.length - gone.length, removed: gone.length, failed: failed.length });
});
