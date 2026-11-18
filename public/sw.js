/* Klin — Service Worker
 *
 * Recebe Web Push e trata cliques nas notificações.
 * O cache offline (IndexedDB + sincronização) entra numa fase posterior.
 * Hospedado no GitHub Pages: todos os caminhos são relativos ao escopo
 * (self.registration.scope), que já inclui o basePath.
 *
 * Contrato do payload enviado pelo servidor (JSON):
 * {
 *   "title": "Klin",                              // opcional
 *   "body":  "Hora da sua medicação programada.", // opcional
 *   "url":   "medicamentos/",                     // caminho relativo ao escopo
 *   "tag":   "dose-<medication_id>",              // agrupa/substitui notificações
 *   "dose":  { "medicationId": "<uuid>", "scheduledFor": "<ISO 8601>" } // opcional
 * }
 *
 * PRIVACIDADE: o texto já chega pronto do servidor, que decide entre o modo
 * discreto (padrão) e o modo com nome do remédio, conforme a preferência do
 * usuário. Sem payload válido, mostramos sempre a mensagem discreta.
 */

const DISCREET_TITLE = "Klin";
const DISCREET_BODY = "Hora da sua medicação programada.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** URL absoluta dentro do escopo do app (o basePath já está no escopo). */
function inScope(path) {
  return new URL(path, self.registration.scope).href;
}

/** Aceita só caminhos relativos do próprio app (evita abrir sites externos). */
function safePath(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9/_?=&.-]*$/i.test(value)) {
    return "";
  }
  return value.slice(0, 300);
}

function text(value, fallback, max) {
  return typeof value === "string" && value.trim() ? value.slice(0, max) : fallback;
}

function parseDose(value) {
  if (!value || typeof value !== "object") return null;
  const { medicationId, scheduledFor } = value;
  if (typeof medicationId !== "string" || !UUID_RE.test(medicationId)) return null;
  if (typeof scheduledFor !== "string" || Number.isNaN(Date.parse(scheduledFor))) return null;
  return { medicationId, scheduledFor };
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const dose = parseDose(payload.dose);
  const options = {
    body: text(payload.body, DISCREET_BODY, 200),
    icon: inScope("icons/icon-192.png"),
    badge: inScope("icons/badge-96.png"),
    tag: text(payload.tag, undefined, 100),
    renotify: Boolean(payload.tag),
    requireInteraction: Boolean(dose),
    vibrate: [100, 50, 100],
    data: { url: safePath(payload.url), dose },
    actions: dose ? [{ action: "mark-taken", title: "Marcar como tomado" }] : [],
  };

  event.waitUntil(
    self.registration.showNotification(text(payload.title, DISCREET_TITLE, 80), options),
  );
});

/**
 * "Marcar como tomado": abre o app na tela de medicamentos com a dose na URL;
 * o app (com a sessão do usuário) grava em medication_logs, protegido pelo RLS.
 * O SW não tem o token de login, por isso não grava sozinho.
 */
function markTakenPath(dose) {
  const q = new URLSearchParams({ tomar: dose.medicationId, horario: dose.scheduledFor });
  return `medicamentos/?${q.toString()}`;
}

async function focusOrOpen(path) {
  const url = inScope(path);
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (client.url.startsWith(self.registration.scope) && "focus" in client) {
      if ("navigate" in client) await client.navigate(url).catch(() => {});
      return client.focus();
    }
  }
  return self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
  const { url = "", dose = null } = event.notification.data || {};
  event.notification.close();
  const target = event.action === "mark-taken" && dose ? markTakenPath(dose) : url;
  event.waitUntil(focusOrOpen(target));
});
