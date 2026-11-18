import { FunctionsHttpError } from "@supabase/supabase-js";
import { UserFacingError } from "./records";
import { getSupabase } from "./supabase";

export type PushSupport = "ok" | "unsupported" | "ios-needs-install" | "not-configured";

export interface DevicePushState {
  support: PushSupport;
  permission: NotificationPermission | "unknown";
  subscribed: boolean;
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (!VAPID_PUBLIC_KEY) return "not-configured";
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // No iPhone/iPad, o push só existe com o app instalado na Tela de Início (iOS 16.4+).
  if (isIos() && !isStandalone()) return "ios-needs-install";
  return capable ? "ok" : "unsupported";
}

/** Espera o Service Worker ficar pronto (com limite, para não travar a tela). */
async function registration(): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new UserFacingError("O serviço de notificações do app não iniciou. Recarregue a página.")), 10_000),
  );
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

export async function devicePushState(): Promise<DevicePushState> {
  const support = pushSupport();
  if (support !== "ok") return { support, permission: "unknown", subscribed: false };
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  return { support, permission: Notification.permission, subscribed: Boolean(sub) };
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Pede permissão, inscreve o aparelho e registra a inscrição no banco. */
export async function enablePush(): Promise<void> {
  if (pushSupport() !== "ok") throw new UserFacingError("Este aparelho não aceita notificações do app.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new UserFacingError("Permissão negada. Libere as notificações do Klin nas configurações do navegador.");
  }
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY) }));
  const { endpoint, keys } = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new UserFacingError("O navegador devolveu uma inscrição inválida.");

  const { error } = await getSupabase().rpc("register_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
    p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) {
    await sub.unsubscribe().catch(() => {});
    throw new UserFacingError("Não foi possível ativar as notificações. Tente de novo.");
  }
}

/** Desinscreve ESTE aparelho (no navegador e no banco). */
export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const { error } = await getSupabase().from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  if (error) throw new UserFacingError("Não foi possível desativar. Tente de novo.");
  await sub.unsubscribe();
}

/**
 * Ao sair da conta: este aparelho para de receber lembretes desta pessoa.
 * Melhor esforço e rápido — não pode impedir o logout.
 */
export async function forgetThisDevice(): Promise<void> {
  if (typeof window === "undefined" || pushSupport() !== "ok") return;
  await Promise.race([disablePush().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
}

export async function sendTestNotification(): Promise<void> {
  const { error } = await getSupabase().functions.invoke("testar-notificacao", { body: {} });
  if (!error) return;
  let message = "Não foi possível enviar o teste.";
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: unknown };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // mantém a mensagem genérica
    }
  }
  throw new UserFacingError(message);
}
