/**
 * "Instalar o app". O navegador avisa UMA vez, logo ao abrir, que dá para
 * instalar (beforeinstallprompt). Por isso este módulo é importado na abertura
 * do app (ServiceWorkerRegister), não só na tela de Ajustes.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let promptEvent: InstallPromptEvent | null = null;
let installed = false;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    promptEvent = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    promptEvent = null;
    installed = true;
    emit();
  });
}

export const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(navigator.userAgent);
export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export function subscribeInstall(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Pode oferecer instalação? (some com o app já instalado e no computador sem oferta.) */
export function canInstall(): boolean {
  void version;
  return !installed && !isStandalone() && (Boolean(promptEvent) || isIos() || isAndroid());
}
export const canInstallServer = () => false;

/** true = abriu a instalação do navegador; false = mostre o passo a passo. */
export async function installNow(): Promise<boolean> {
  if (!promptEvent) return false;
  const ev = promptEvent;
  promptEvent = null; // o aviso do navegador serve para uma tentativa só
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  if (outcome === "accepted") installed = true;
  emit();
  return true;
}

export function installSteps(): string[] {
  return isIos()
    ? ["Abra este endereço no Safari.", "Toque em Compartilhar, na barra do navegador.", "Toque em Adicionar à Tela de Início.", "Toque em Adicionar."]
    : [
        "Toque no menu do navegador (os três pontinhos, no alto).",
        "Toque em Instalar app ou Adicionar à tela inicial.",
        "Confirme em Instalar.",
      ];
}
