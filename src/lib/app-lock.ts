/**
 * Bloqueio rápido de tela (PIN e/ou biometria), só neste aparelho.
 *
 * É uma barreira contra quem pega o celular já desbloqueado — não é
 * criptografia: os dados continuam protegidos pela sessão e pelo RLS.
 * A configuração fica no localStorage (só o hash do PIN e o id da credencial).
 */
import { hashPin, lockoutDelay, MAX_FAILURES, verifyPin, type StoredPin } from "./pin";

const KEY = "klin:lock";
/** Volta ao app depois de 1 min em segundo plano => pede o PIN de novo. */
export const LOCK_AFTER_MS = 60_000;

interface LockConfig {
  pin?: StoredPin;
  /** id (base64url) da credencial WebAuthn de plataforma (digital/rosto). */
  credentialId?: string;
  failures: number;
  retryAt: number;
}

function read(): LockConfig {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { failures: 0, retryAt: 0, ...(JSON.parse(raw) as Partial<LockConfig>) } : { failures: 0, retryAt: 0 };
  } catch {
    return { failures: 0, retryAt: 0 };
  }
}

function write(cfg: LockConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    // sem armazenamento: o bloqueio não é ativado
  }
  emit();
}

// ---------------------------------------------------------------------
// Estado observável (useSyncExternalStore)
// ---------------------------------------------------------------------
/**
 * Recarga com o app na tela não é "abrir o app". O Next.js recarrega a página
 * inteira ao trocar de tela quando a tela guardada é de outra versão (depois de
 * publicar). Sem isto, essa recarga pedia a digital de novo. Ao sair da página
 * com o app VISÍVEL e destravado, deixa um aviso de 5 s no sessionStorage (some
 * ao fechar o app). App fechado ou em segundo plano: o aviso é apagado e trava.
 */
const RELOAD_KEY = "klin:lock:recarga";
const RELOAD_WINDOW_MS = 5_000;

function takeReloadHandoff(): boolean {
  try {
    const at = Number(sessionStorage.getItem(RELOAD_KEY));
    sessionStorage.removeItem(RELOAD_KEY);
    const age = Date.now() - at;
    return at > 0 && age >= 0 && age < RELOAD_WINDOW_MS;
  } catch {
    return false;
  }
}

let locked = typeof window !== "undefined" && Boolean(read().pin) && !takeReloadHandoff();
let hiddenAt = 0;
let version = 0;
const listeners = new Set<() => void>();
function emit() {
  version++;
  listeners.forEach((l) => l());
}

if (typeof document !== "undefined") {
  // Ordem dos eventos: na recarga, "pagehide" vem ANTES de a página ficar
  // oculta; ao fechar ou trocar de app, ela fica oculta primeiro.
  let leaving = false;
  window.addEventListener("pagehide", () => {
    leaving = true;
    try {
      if (!locked && document.visibilityState === "visible" && read().pin) sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      // sem sessionStorage: a recarga pede o desbloqueio (mais seguro)
    }
  });
  // Voltou do cache de páginas (bfcache) sem recarregar: não está mais saindo.
  window.addEventListener("pageshow", () => {
    leaving = false;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      if (leaving) return; // recarga em andamento: mantém o aviso
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        // nada a apagar
      }
    } else if (hiddenAt && Date.now() - hiddenAt >= LOCK_AFTER_MS && read().pin) {
      locked = true;
      emit();
    }
  });
}

export function subscribeLock(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface LockSnapshot {
  enabled: boolean;
  locked: boolean;
  biometric: boolean;
}

let cached: { version: number; snap: LockSnapshot } | null = null;
export function lockSnapshot(): LockSnapshot {
  if (cached?.version !== version) {
    const cfg = read();
    cached = { version, snap: { enabled: Boolean(cfg.pin), locked: locked && Boolean(cfg.pin), biometric: Boolean(cfg.credentialId) } };
  }
  return cached.snap;
}

const SERVER: LockSnapshot = { enabled: false, locked: false, biometric: false };
export const lockServerSnapshot = () => SERVER;

export function lockNow() {
  if (read().pin) {
    locked = true;
    emit();
  }
}

// ---------------------------------------------------------------------
// PIN
// ---------------------------------------------------------------------
export async function setPin(pin: string): Promise<void> {
  const cfg = read();
  write({ ...cfg, pin: await hashPin(pin), failures: 0, retryAt: 0 });
}

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: "wrong"; remaining: number }
  | { ok: false; reason: "wait"; retryAt: number }
  | { ok: false; reason: "wipe" };

export async function unlockWithPin(pin: string): Promise<UnlockResult> {
  const cfg = read();
  if (!cfg.pin) return { ok: true };
  if (cfg.retryAt > Date.now()) return { ok: false, reason: "wait", retryAt: cfg.retryAt };

  if (await verifyPin(pin, cfg.pin)) {
    write({ ...cfg, failures: 0, retryAt: 0 });
    locked = false;
    emit();
    return { ok: true };
  }
  const failures = cfg.failures + 1;
  if (failures >= MAX_FAILURES) return { ok: false, reason: "wipe" };
  const delay = lockoutDelay(failures);
  write({ ...cfg, failures, retryAt: delay ? Date.now() + delay : 0 });
  return delay ? { ok: false, reason: "wait", retryAt: Date.now() + delay } : { ok: false, reason: "wrong", remaining: MAX_FAILURES - failures };
}

/** Desativa o bloqueio (exige o PIN atual). */
export async function disableLock(pin: string): Promise<boolean> {
  const cfg = read();
  if (cfg.pin && !(await verifyPin(pin, cfg.pin))) return false;
  clearLock();
  return true;
}

/** Apaga tudo (ao sair da conta ou após erros demais). */
export function clearLock() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nada a apagar
  }
  locked = false;
  emit();
}

// ---------------------------------------------------------------------
// Biometria (WebAuthn, autenticador do próprio aparelho)
// ---------------------------------------------------------------------
const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4)), (c) => c.charCodeAt(0));

export async function biometricAvailable(): Promise<boolean> {
  try {
    return (
      typeof PublicKeyCredential !== "undefined" &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

export async function enableBiometric(): Promise<void> {
  const cfg = read();
  if (!cfg.pin) throw new Error("Crie um PIN antes da biometria.");
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Klin", id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "klin", displayName: "Klin" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60_000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("A biometria não foi configurada.");
  write({ ...read(), credentialId: b64url(credential.rawId) });
}

export function disableBiometric() {
  const { credentialId: _removed, ...rest } = read();
  void _removed;
  write(rest);
}

/** Pede a digital/rosto. Sucesso => desbloqueia. */
export async function unlockWithBiometric(): Promise<boolean> {
  const cfg = read();
  if (!cfg.credentialId) return false;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: "public-key", id: fromB64url(cfg.credentialId) }],
        userVerification: "required",
        timeout: 60_000,
      },
    });
    if (!assertion) return false;
    write({ ...cfg, failures: 0, retryAt: 0 });
    locked = false;
    emit();
    return true;
  } catch {
    return false;
  }
}
