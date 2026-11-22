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
 *   "dose":  { "medicationId": "<uuid>", "scheduledFor": "<ISO 8601>",    // opcional
 *              "exp": <ms>, "token": "<assinatura>", "markUrl": "<função marcar-dose>" }
 * }
 *
 * "Marcar como tomado": com exp/token/markUrl, o SW registra a dose direto
 * (função marcar-dose, que confere a assinatura daquela dose) e mostra
 * "Dose registrada". Sem eles, ou se falhar (sem internet, expirado), abre o
 * app na tela de medicamentos, que registra com o login.
 *
 * PRIVACIDADE: o texto já chega pronto do servidor, que decide entre o modo
 * discreto (padrão) e o modo com nome do remédio, conforme a preferência do
 * usuário. Sem payload válido, mostramos sempre a mensagem discreta.
 */

const DISCREET_TITLE = "Klin";
const DISCREET_BODY = "Hora da sua medicação programada.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------
// Cache do app (modo offline). SÓ arquivos do próprio site: páginas,
// JavaScript, CSS e ícones — que não contêm dados de saúde (as telas são
// montadas no aparelho). Pedidos ao Supabase (outra origem) nunca passam
// por aqui. Trocar CACHE_VERSION apaga os caches antigos.
// ---------------------------------------------------------------------
const CACHE_VERSION = "klin-v6";
const APP_PAGES = ["", "gravar/", "medicamentos/", "medicamentos/detalhe/", "medicamentos/editar/", "pressao/", "registro/", "ajustes/", "entrar/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll([...APP_PAGES.map(inScope), inScope("manifest.webmanifest"), inScope("icons/icon-192.png")]))
      .catch(() => {}) // sem rede na instalação: o cache se forma com o uso
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function putInCache(request, response) {
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(CACHE_VERSION);
    await cache.put(request, response.clone());
  }
  return response;
}

/** Arquivos com hash no nome nunca mudam: cache primeiro. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  return cached ?? putInCache(request, await fetch(request));
}

/**
 * Páginas e dados de navegação do Next: entrega o guardado NA HORA e busca a
 * versão nova em segundo plano (vale na próxima abertura). As páginas são só
 * a "casca" do app — os dados de saúde vêm do Supabase, que nunca passa por
 * aqui —, então são as mesmas para qualquer ?id=: guardamos sem a query.
 */
function pageKey(request) {
  const url = new URL(request.url);
  url.search = "";
  return url.href;
}

async function staleWhileRevalidate(event) {
  const { request } = event;
  const key = pageKey(request);
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(key);
  const network = fetch(request)
    .then(async (res) => {
      if (res.ok && res.type === "basic") await cache.put(key, res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network); // atualiza sem fazer a pessoa esperar
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  if (request.mode === "navigate") {
    const home = await cache.match(inScope("")); // offline e página nunca aberta: abre o início
    if (home) return home;
  }
  return Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(self.registration.scope)) return;
  const path = new URL(request.url).pathname;
  if (path.includes("/_next/static/") || path.includes("/icons/")) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(event));
  }
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

/** Só a função marcar-dose do Supabase (ou o Supabase local dos testes). */
const MARK_URL_RE = /^(https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/(127\.0\.0\.1|localhost):\d+)\/functions\/v1\/marcar-dose$/;

function parseDose(value) {
  if (!value || typeof value !== "object") return null;
  const { medicationId, scheduledFor, exp, token, markUrl } = value;
  if (typeof medicationId !== "string" || !UUID_RE.test(medicationId)) return null;
  if (typeof scheduledFor !== "string" || Number.isNaN(Date.parse(scheduledFor))) return null;
  const dose = { medicationId, scheduledFor };
  if (Number.isSafeInteger(exp) && typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) && typeof markUrl === "string" && MARK_URL_RE.test(markUrl)) {
    Object.assign(dose, { exp, token, markUrl });
  }
  return dose;
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
    // Android: o "badge" é o ícone pequeno da esquerda (cruz do Klin). O "icon"
    // é a imagem grande da direita; sem ele o Android mostra as iniciais do
    // site. Uma imagem transparente deixa esse espaço vazio.
    icon: inScope("icons/transparent-192.png"),
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
 * Reserva do "Marcar como tomado": abre o app na tela de medicamentos com a
 * dose na URL; o app (com a sessão do usuário) grava em medication_logs.
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
  if (event.action === "mark-taken" && dose) {
    event.waitUntil(markFromNotification(dose));
    return;
  }
  event.waitUntil(focusOrOpen(url));
});

/** Registra a dose sem abrir o app; se não der, abre o app para registrar lá. */
async function markFromNotification(dose) {
  if (dose.token && dose.markUrl) {
    try {
      const res = await fetch(dose.markUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ medicationId: dose.medicationId, scheduledFor: dose.scheduledFor, exp: dose.exp, token: dose.token }),
      });
      if (res.ok) {
        const { status } = await res.json().catch(() => ({}));
        await confirmTaken(status === "already" ? "Essa dose já estava registrada ✓" : "Dose registrada ✓", dose.medicationId);
        return;
      }
    } catch {
      // sem internet: cai para abrir o app
    }
  }
  return focusOrOpen(markTakenPath(dose));
}

/** Aviso curto (some sozinho) e telas abertas do app atualizam. */
async function confirmTaken(body, medicationId) {
  const tag = `tomada-${medicationId}`;
  await self.registration.showNotification(DISCREET_TITLE, {
    body,
    tag,
    silent: true,
    icon: inScope("icons/transparent-192.png"),
    badge: inScope("icons/badge-96.png"),
    data: { url: "medicamentos/" },
  });
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type: "klin:dose-marcada" });
  await new Promise((resolve) => setTimeout(resolve, 4000));
  for (const n of await self.registration.getNotifications({ tag })) n.close();
}
