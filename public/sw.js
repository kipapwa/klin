/* Klin — Service Worker
 *
 * Fase 1: recebe Web Push e trata cliques nas notificações.
 * O cache offline (IndexedDB + sincronização) entra numa fase posterior.
 *
 * Contrato do payload enviado pelo servidor (JSON):
 * {
 *   "title": "Klin",                         // opcional
 *   "body":  "Hora da sua medicação programada.", // opcional
 *   "url":   "/medicamentos",                // caminho relativo do app
 *   "tag":   "dose-<medication_id>",         // agrupa/substitui notificações
 *   "dose":  { "medicationId": "<uuid>", "scheduledFor": "<ISO 8601>" } // opcional
 * }
 *
 * PRIVACIDADE: o texto já chega pronto do servidor, que decide entre o modo
 * discreto (padrão) e o modo com nome do remédio, conforme a preferência do
 * usuário. Sem payload válido, mostramos sempre a mensagem discreta.
 */

const DISCREET_TITLE = "Klin";
const DISCREET_BODY = "Hora da sua medicação programada.";
const MARK_TAKEN_ENDPOINT = "/api/doses/taken";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** Aceita só caminhos do próprio app (evita abrir sites externos). */
function safePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
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
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
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

async function focusOrOpen(path) {
  const url = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin === self.location.origin && "focus" in client) {
      if ("navigate" in client) await client.navigate(url).catch(() => {});
      return client.focus();
    }
  }
  return self.clients.openWindow(url);
}

async function markTaken(dose, fallbackPath) {
  try {
    const res = await fetch(MARK_TAKEN_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...dose, source: "notification" }),
    });
    if (res.ok) return;
  } catch {
    // sem rede ou sessão expirada: cai no fallback abaixo
  }
  // Não deu para registrar em segundo plano: abre o app para o usuário confirmar.
  await focusOrOpen(fallbackPath);
}

self.addEventListener("notificationclick", (event) => {
  const { url = "/", dose = null } = event.notification.data || {};
  event.notification.close();

  if (event.action === "mark-taken" && dose) {
    event.waitUntil(markTaken(dose, url));
    return;
  }
  event.waitUntil(focusOrOpen(url));
});
