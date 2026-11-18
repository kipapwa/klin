// Supabase falso (só para teste E2E) + servidor estático do out/.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

export const state = {
  uploads: {}, records: [], meds: [], logs: [], calls: [], subs: [],
  profile: { id: "11111111-1111-4111-8111-111111111111", timezone: "America/Sao_Paulo", notification_privacy: "discreet" },
};
const H = 3_600_000;

/** Imita o gatilho medications_compute_schedule (tolerância de 1 h). */
function schedule(m, recompute) {
  const start = Date.parse(m.starts_at);
  m.ends_at = m.duration_days ? new Date(start + m.duration_days * 24 * H).toISOString() : null;
  if (recompute) {
    const step = Number(m.interval_hours) * H;
    const k = Math.max(0, Math.ceil((Date.now() - H - start) / step));
    m.next_dose_at = new Date(start + k * step).toISOString();
  }
  if (m.ends_at && m.next_dose_at && Date.parse(m.next_dose_at) > Date.parse(m.ends_at)) m.next_dose_at = null;
  return m;
}
const USER = {
  id: "11111111-1111-4111-8111-111111111111", email: "teste@exemplo.com", aud: "authenticated",
  role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.sig`;

const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
const send = (res, status, data, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "*", ...headers });
  res.end(data === undefined ? "" : typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data));
};

export function startSupabase(port) {
  return new Promise((ok) => http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (req.method === "OPTIONS") return send(res, 204, undefined, { "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" });
    const raw = await readBody(req);
    state.calls.push(`${req.method} ${p}`);
    const authed = (req.headers.authorization || "") === `Bearer ${JWT}`;
    const one = (req.headers.accept || "").includes("vnd.pgrst.object");

    if (p === "/auth/v1/otp") return send(res, 200, {});
    if (p === "/auth/v1/verify") {
      const b = JSON.parse(raw);
      if (b.token !== "123456") return send(res, 403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
      return send(res, 200, { access_token: JWT, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r1", user: USER });
    }
    if (p === "/auth/v1/user") return authed ? send(res, 200, USER) : send(res, 401, { msg: "invalid" });
    if (p === "/auth/v1/logout") return send(res, 204);

    if (!authed && !p.startsWith("/storage/v1/object/sign/")) return send(res, 401, { message: "no auth" });

    if (p === "/rest/v1/medical_records") {
      if (req.method === "GET") {
        const id = url.searchParams.get("id")?.replace("eq.", "");
        if (id) {
          const r = state.records.find((x) => x.id === id);
          return one ? (r ? send(res, 200, r) : send(res, 406, { code: "PGRST116" })) : send(res, 200, r ? [r] : []);
        }
        return send(res, 200, [...state.records].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at)));
      }
      if (req.method === "POST") {
        const b = JSON.parse(raw);
        const rec = {
          id: crypto.randomUUID(), title: null, recorded_at: new Date().toISOString(), category: "symptom", severity: "routine",
          chief_complaint: null, history: null, observations: null, plan: null, transcript: null, icd10_codes: [], alert_signs: [],
          follow_up_in_days: null, follow_up_date: null, audio_duration_s: null, ai_provider: null, processed_at: null, ...b,
        };
        state.records.push(rec);
        return send(res, 201, one ? { id: rec.id } : [{ id: rec.id }]);
      }
      if (req.method === "DELETE") {
        const id = url.searchParams.get("id").replace("eq.", "");
        state.records = state.records.filter((r) => r.id !== id);
        return send(res, 204);
      }
    }
    if (p === "/rest/v1/medications") {
      const eq = (k) => url.searchParams.get(k)?.replace("eq.", "");
      if (req.method === "GET") {
        if (eq("id")) {
          const m = state.meds.find((x) => x.id === eq("id"));
          return one ? (m ? send(res, 200, m) : send(res, 406, { code: "PGRST116" })) : send(res, 200, m ? [m] : []);
        }
        if (eq("record_id")) return send(res, 200, state.meds.filter((m) => m.record_id === eq("record_id")));
        return send(res, 200, [...state.meds].sort((a, b) => (a.next_dose_at ?? "9").localeCompare(b.next_dose_at ?? "9")));
      }
      if (req.method === "POST") {
        const m = schedule({
          id: crypto.randomUUID(), record_id: null, dosage: null, instructions: null, duration_days: null, source: "manual",
          is_active: true, notifications_enabled: true, ...JSON.parse(raw),
        }, true);
        state.meds.push(m);
        return send(res, 201, one ? { id: m.id } : [{ id: m.id }]);
      }
      if (req.method === "PATCH") {
        const m = state.meds.find((x) => x.id === eq("id"));
        const patch = JSON.parse(raw);
        const reschedule = "starts_at" in patch || "interval_hours" in patch;
        Object.assign(m, patch);
        schedule(m, reschedule);
        state.calls.push(`PATCH medications ${Object.keys(patch).join(",")}`);
        return send(res, 204);
      }
      if (req.method === "DELETE") {
        state.meds = state.meds.filter((x) => x.id !== eq("id"));
        state.logs = state.logs.filter((l) => l.medication_id !== eq("id"));
        return send(res, 204);
      }
    }
    if (p === "/rest/v1/profiles") {
      if (req.method === "GET") return one ? send(res, 200, state.profile) : send(res, 200, [state.profile]);
      const patch = JSON.parse(raw);
      Object.assign(state.profile, patch);
      state.calls.push(`PATCH profiles ${Object.keys(patch).join(",")}`);
      return send(res, 204);
    }
    if (p === "/rest/v1/rpc/register_push_subscription") {
      const b = JSON.parse(raw);
      state.subs = state.subs.filter((s) => s.endpoint !== b.p_endpoint);
      state.subs.push({ endpoint: b.p_endpoint, p256dh: b.p_p256dh, auth: b.p_auth, user_agent: b.p_user_agent });
      return send(res, 204);
    }
    if (p === "/rest/v1/push_subscriptions" && req.method === "DELETE") {
      const endpoint = url.searchParams.get("endpoint").replace(/^eq\./, "");
      state.subs = state.subs.filter((s) => s.endpoint !== endpoint);
      state.calls.push("DELETE push_subscriptions");
      return send(res, 204);
    }
    if (p === "/functions/v1/testar-notificacao") {
      return state.subs.length
        ? send(res, 200, { sent: state.subs.length, removed: 0 })
        : send(res, 404, { error: "Nenhum aparelho com notificações ativadas." });
    }
    if (p === "/rest/v1/medication_logs") {
      if (req.method === "GET") {
        const mid = url.searchParams.get("medication_id").replace("eq.", "");
        return send(res, 200, state.logs.filter((l) => l.medication_id === mid).sort((a, b) => b.scheduled_for.localeCompare(a.scheduled_for)));
      }
      const log = { id: crypto.randomUUID(), ...JSON.parse(raw) };
      // unique (medication_id, scheduled_for)
      if (state.logs.some((l) => l.medication_id === log.medication_id && Date.parse(l.scheduled_for) === Date.parse(log.scheduled_for))) {
        return send(res, 409, { code: "23505", message: "duplicate key value violates unique constraint" });
      }
      state.logs.push(log);
      // gatilho medication_logs_advance_schedule
      const m = state.meds.find((x) => x.id === log.medication_id);
      if (m && (!m.next_dose_at || Date.parse(m.next_dose_at) <= Date.parse(log.scheduled_for))) {
        const next = Date.parse(log.scheduled_for) + m.interval_hours * H;
        const over = m.ends_at && next > Date.parse(m.ends_at);
        m.next_dose_at = over ? null : new Date(next).toISOString();
        if (over) m.is_active = false;
      }
      return send(res, 201);
    }
    if (p.startsWith("/storage/v1/object/sign/audio/")) {
      if (req.method === "POST") return send(res, 200, { signedURL: `${p.replace("/storage/v1", "")}?token=t` });
      const key = decodeURIComponent(p.replace("/storage/v1/object/sign/audio/", ""));
      const f = state.uploads[key];
      return f ? send(res, 200, f.data, { "Content-Type": f.type }) : send(res, 404, {});
    }
    if (p.startsWith("/storage/v1/object/audio/") && req.method === "POST") {
      const key = decodeURIComponent(p.replace("/storage/v1/object/audio/", ""));
      state.uploads[key] = { data: raw, type: req.headers["content-type"], size: raw.length };
      return send(res, 200, { Key: `audio/${key}`, Id: crypto.randomUUID() });
    }
    if (p === "/storage/v1/object/audio" && req.method === "DELETE") return send(res, 200, []);
    if (p === "/functions/v1/processar-registro") {
      const { recordId } = JSON.parse(raw);
      const r = state.records.find((x) => x.id === recordId);
      if (!r) return send(res, 409, { error: "Registro não encontrado, sem áudio ou já em processamento." });
      Object.assign(r, {
        status: "ready", title: "Dor no peito ao subir escadas", category: "symptom", severity: "critical",
        chief_complaint: "Dor no peito em aperto há 2 dias, pior ao esforço.", history: "Hipertenso, usa losartana.", observations: "",
        plan: "Procurar pronto-socorro hoje.", transcript: "Estou com dor no peito...",
        icd10_codes: [{ code: "R07.4", description: "Dor torácica, não especificada" }], alert_signs: ["dor torácica aos esforços"],
        follow_up_in_days: 7, follow_up_date: "2026-11-25", ai_provider: "gemini", processed_at: new Date().toISOString(),
      });
      state.meds.push(schedule({
        id: crypto.randomUUID(), record_id: recordId, name: "Losartana", dosage: "50 mg", instructions: null, interval_hours: 24,
        duration_days: null, starts_at: new Date().toISOString(), ends_at: null, next_dose_at: null, source: "ai", is_active: true,
        notifications_enabled: false,
      }, true));
      return send(res, 200, {
        recordId, provider: "gemini", severity: "critical", medicationsCreated: 1,
        medicationsNeedingReview: [{ name: "Omeprazol", dosage: "20 mg", interval_hours: null, duration_days: null, start_time: null, instructions: null }],
      });
    }
    send(res, 404, { message: `mock sem rota ${req.method} ${p}` });
  }).listen(port, "127.0.0.1", ok));
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".woff2": "font/woff2", ".ico": "image/x-icon",
};
export function startStatic(dir, port) {
  return new Promise((ok) => http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    try {
      const data = await readFile(join(dir, p));
      res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" });
      res.end(data);
    } catch {
      try {
        const d = await readFile(join(dir, p, "index.html"));
        res.writeHead(200, { "Content-Type": TYPES[".html"] });
        res.end(d);
      } catch {
        res.writeHead(404);
        res.end("404");
      }
    }
  }).listen(port, "127.0.0.1", ok));
}
