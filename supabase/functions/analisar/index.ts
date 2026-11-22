/**
 * Edge Function: analisar ("Perguntar à IA" em Registros e Remédios)
 *
 * POST { scope: "records" | "medications", question, context }
 *      (Authorization: Bearer <token do usuário>)
 *
 * `context` é o conteúdo do relatório que a pessoa vê na tela (registros
 * filtrados ou remédios com histórico), montado no aparelho. A função confere
 * o login, gasta 1 da cota diária de IA e pergunta ao Gemini (Groq de
 * reserva). Nada é gravado. Logs: só o tamanho e a IA que respondeu.
 *
 * Segredos: os mesmos de processar-registro (GEMINI_API_KEY, GROQ_API_KEY,
 * ALLOWED_ORIGINS e opcionais GEMINI_MODEL, GROQ_CHAT_MODEL, AI_TIMEOUT_MS,
 * AI_DAILY_LIMIT).
 */
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { AllProvidersFailed, answerText } from "../_shared/ai.ts";
import { aiConfigFromEnv } from "../_shared/ai-env.ts";
import { ANALYSIS_SYSTEM_PROMPT, analysisUserPrompt, cleanAnswer, parseAnalysisRequest } from "../_shared/analysis.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { publishableKey } from "../_shared/supabase-keys.ts";
import { safeTimeZone } from "../_shared/schedule.ts";

const env = (name: string) => Deno.env.get(name) || undefined;
const log = {
  error: (msg: string) => console.error(`[analisar] ${msg}`),
  info: (msg: string) => console.log(`[analisar] ${msg}`),
};

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("Origin"), env("ALLOWED_ORIGINS"));
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Método não permitido." });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "Pedido inválido." });
  }
  const request = parseAnalysisRequest(body);
  if (!request) return reply(400, { error: "Escreva o que você quer que a IA analise (de 3 a 500 caracteres)." });

  // Usuário: cliente com o token dele (RLS), como em processar-registro.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { error: "Sessão expirada. Entre novamente." });
  const apiKey = publishableKey(env);
  if (!apiKey) return reply(503, { error: "Servidor não configurado." });
  const supabase = createClient(env("SUPABASE_URL")!, apiKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return reply(401, { error: "Sessão expirada. Entre novamente." });

  const dailyLimit = Number(env("AI_DAILY_LIMIT")) || 30;
  const { data: quotaOk, error: quotaError } = await supabase.rpc("ai_take_quota", { p_limit: dailyLimit });
  if (quotaError) {
    log.error(`cota: ${quotaError.code ?? "erro"}`);
    return reply(500, { error: "Não foi possível analisar agora. Tente de novo." });
  }
  if (!quotaOk) return reply(429, { error: "Limite diário de uso da IA atingido. Tente amanhã." });

  const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", userData.user.id).maybeSingle();
  const today = new Intl.DateTimeFormat("pt-BR", { timeZone: safeTimeZone(profile?.timezone), dateStyle: "full" }).format(new Date());

  try {
    const answer = await answerText(ANALYSIS_SYSTEM_PROMPT, analysisUserPrompt(request, today), aiConfigFromEnv(env), log);
    const text = cleanAnswer(answer.text);
    if (!text) return reply(502, { error: "A IA não conseguiu responder. Tente de novo." });
    log.info(`ok escopo=${request.scope} dados=${request.context.length} ia=${answer.provider}`);
    return reply(200, { answer: text, provider: answer.provider });
  } catch (err) {
    if (err instanceof AllProvidersFailed) {
      if (err.notConfigured) return reply(503, { error: "IA não configurada." });
      if (err.rateLimited) return reply(503, { error: "A IA está ocupada agora. Tente de novo em instantes.", detail: err.summary });
      return reply(502, { error: "A IA não conseguiu responder. Tente de novo.", detail: err.summary });
    }
    return reply(502, { error: "A IA não conseguiu responder. Tente de novo." });
  }
});
