/**
 * Edge Function: testar-notificacao
 *
 * POST (Authorization: Bearer <token do usuário>) — envia uma notificação de
 * teste para os aparelhos inscritos do PRÓPRIO usuário (leitura pelo RLS).
 *
 * Segredos: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, ALLOWED_ORIGINS.
 */
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { corsHeaders } from "../_shared/cors.ts";
import { publishableKey } from "../_shared/supabase-keys.ts";
import { testPayload } from "../_shared/reminders.ts";
import { vapidFromEnv } from "../_shared/vapid-env.ts";
import { sendWebPush } from "../_shared/webpush.ts";

const env = (name: string) => Deno.env.get(name) || undefined;

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("Origin"), env("ALLOWED_ORIGINS"));
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Método não permitido." });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { error: "Sessão expirada. Entre novamente." });

  const vapid = vapidFromEnv(env);
  if (!vapid) return reply(503, { error: "Notificações ainda não configuradas no servidor." });

  const apiKey = publishableKey(env);
  if (!apiKey) return reply(503, { error: "Servidor não configurado." });
  const supabase = createClient(env("SUPABASE_URL")!, apiKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: user } = await supabase.auth.getUser(token);
  if (!user.user) return reply(401, { error: "Sessão expirada. Entre novamente." });

  const { data: subs, error } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth");
  if (error) return reply(500, { error: "Não foi possível buscar os aparelhos." });
  if (!subs?.length) return reply(404, { error: "Nenhum aparelho com notificações ativadas." });

  const results = await Promise.all(
    subs.map(async (s) => ({ id: s.id as string, result: await sendWebPush(s, testPayload(), vapid, { ttl: 120, urgency: "normal" }) })),
  );
  const gone = results.filter((r) => !r.result.ok && r.result.gone).map((r) => r.id);
  // RLS: o usuário pode apagar as próprias inscrições.
  if (gone.length) await supabase.from("push_subscriptions").delete().in("id", gone);

  const sent = results.filter((r) => r.result.ok).length;
  return sent > 0
    ? reply(200, { sent, removed: gone.length })
    : reply(502, { error: "O serviço de notificações recusou o envio. Desative e ative de novo neste aparelho." });
});
