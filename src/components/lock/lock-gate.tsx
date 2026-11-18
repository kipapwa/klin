"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { clearLock, lockServerSnapshot, lockSnapshot, subscribeLock, unlockWithBiometric, unlockWithPin } from "@/lib/app-lock";
import { forgetUserScreens } from "@/lib/screen-cache";
import { getSupabase } from "@/lib/supabase";

export function useLock() {
  return useSyncExternalStore(subscribeLock, lockSnapshot, lockServerSnapshot);
}

/** Mostra a tela de bloqueio por cima de tudo enquanto o app estiver travado. */
export function LockGate({ children }: { children: ReactNode }) {
  const lock = useLock();
  if (lock.locked) return <LockScreen biometric={lock.biometric} />;
  return <>{children}</>;
}

function LockScreen({ biometric }: { biometric: boolean }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const autoPrompted = useRef(false);

  // Com biometria ativada, já pede a digital/rosto ao aparecer (ao abrir o app
  // e ao voltar a ele). Se o navegador exigir um toque antes (Safari às vezes
  // exige), o pedido falha em silêncio e o botão abaixo resolve.
  useEffect(() => {
    if (!biometric || autoPrompted.current) return;
    autoPrompted.current = true;
    void unlockWithBiometric();
  }, [biometric]);

  async function biometricUnlock() {
    setMessage(null);
    if (!(await unlockWithBiometric())) setMessage("Biometria não confirmada. Tente de novo ou use o PIN.");
  }

  async function forget() {
    if (!window.confirm("Sair da conta neste aparelho? Para voltar, entre de novo com o código enviado ao seu e-mail.")) return;
    clearLock();
    forgetUserScreens();
    await getSupabase().auth.signOut();
    router.replace("/entrar/");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pin) return;
    setBusy(true);
    setMessage(null);
    const result = await unlockWithPin(pin);
    setBusy(false);
    setPin("");
    if (result.ok) return;
    if (result.reason === "wipe") {
      clearLock();
      forgetUserScreens();
      await getSupabase().auth.signOut();
      router.replace("/entrar/");
      return;
    }
    setMessage(
      result.reason === "wait"
        ? `Muitas tentativas. Tente de novo às ${new Date(result.retryAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.`
        : `PIN incorreto. ${result.remaining} ${result.remaining === 1 ? "tentativa restante" : "tentativas restantes"} antes de sair da conta.`,
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <div>
        <p className="text-3xl font-semibold text-teal-700 dark:text-teal-400">Klin</p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">App bloqueado</p>
      </div>
      {biometric ? (
        <button
          type="button"
          onClick={biometricUnlock}
          className="w-full rounded-xl bg-teal-700 px-4 py-4 text-lg font-semibold text-white hover:bg-teal-800"
        >
          Desbloquear com digital / rosto
        </button>
      ) : null}
      <form onSubmit={submit} className="flex w-full flex-col gap-3">
        {biometric ? <p className="text-sm text-zinc-500">ou digite o PIN</p> : null}
        <label htmlFor="unlock-pin" className="sr-only">
          PIN
        </label>
        <input
          id="unlock-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          // Com biometria, não abre o teclado por cima do pedido de digital/rosto.
          autoFocus={!biometric}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder="Digite seu PIN"
          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-4 text-center text-2xl tracking-[0.5em] placeholder:text-base placeholder:tracking-normal dark:border-zinc-700 dark:bg-zinc-900"
        />
        {message ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {message}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || pin.length < 4}
          className={
            biometric
              ? "rounded-xl border border-zinc-300 px-4 py-3 font-medium disabled:opacity-60 dark:border-zinc-700"
              : "rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white disabled:opacity-60"
          }
        >
          {busy ? "Verificando…" : "Desbloquear com PIN"}
        </button>
      </form>
      <button type="button" onClick={forget} className="text-sm text-zinc-500 underline">
        Esqueci o PIN
      </button>
    </main>
  );
}
