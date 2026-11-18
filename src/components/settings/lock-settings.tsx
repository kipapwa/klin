"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useLock } from "@/components/lock/lock-gate";
import { Switch } from "@/components/ui/switch";
import { biometricAvailable, disableBiometric, disableLock, enableBiometric, lockNow, setPin } from "@/lib/app-lock";
import { pinProblem } from "@/lib/pin";

const input =
  "w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-center text-lg tracking-[0.4em] dark:border-zinc-700 dark:bg-zinc-900";
const button =
  "rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800";

type Mode = "idle" | "create" | "disable";

export function LockSettings({ onNotice }: { onNotice: (tone: "ok" | "error", text: string) => void }) {
  const lock = useLock();
  const [mode, setMode] = useState<Mode>("idle");
  const [pin, setPinValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [canBiometric, setCanBiometric] = useState(false);

  useEffect(() => {
    let active = true;
    biometricAvailable().then((ok) => active && setCanBiometric(ok));
    return () => {
      active = false;
    };
  }, []);

  function reset() {
    setMode("idle");
    setPinValue("");
    setConfirm("");
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    const problem = pinProblem(pin);
    if (problem) return onNotice("error", problem);
    if (pin !== confirm) return onNotice("error", "Os PINs não conferem.");
    setBusy(true);
    await setPin(pin);
    setBusy(false);
    reset();
    onNotice("ok", "PIN criado. O app pede o PIN ao abrir e ao voltar depois de 1 minuto.");
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await disableLock(pin);
    setBusy(false);
    if (!ok) return onNotice("error", "PIN incorreto.");
    reset();
    onNotice("ok", "Bloqueio desativado.");
  }

  if (mode === "create" || mode === "disable") {
    const creating = mode === "create";
    return (
      <form onSubmit={creating ? create : disable} className="flex flex-col gap-2" noValidate>
        <label htmlFor="new-pin" className="text-sm font-medium">
          {creating ? (lock.enabled ? "Novo PIN (4 a 8 números)" : "Crie um PIN (4 a 8 números)") : "PIN atual"}
        </label>
        <input id="new-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={8} className={input} value={pin} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))} />
        {creating ? (
          <>
            <label htmlFor="confirm-pin" className="text-sm font-medium">
              Repita o PIN
            </label>
            <input id="confirm-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={8} className={input} value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} />
          </>
        ) : null}
        <div className="mt-1 flex gap-2">
          <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white disabled:opacity-60">
            {busy ? "Aguarde…" : creating ? "Salvar PIN" : "Desativar bloqueio"}
          </button>
          <button type="button" onClick={reset} className={button}>
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  if (!lock.enabled) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">Peça um PIN ao abrir o app neste aparelho.</p>
        <button type="button" className="rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white" onClick={() => setMode("create")}>
          Criar PIN
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-teal-800 dark:text-teal-300">✓ Bloqueio por PIN ativado</p>
      {canBiometric ? (
        <div className="flex items-center gap-3">
          <span className="flex-1 text-sm">Desbloquear com digital / rosto</span>
          <Switch
            label="Desbloquear com digital ou rosto"
            checked={lock.biometric}
            disabled={busy}
            onChange={async (next) => {
              if (!next) return disableBiometric();
              setBusy(true);
              try {
                await enableBiometric();
                onNotice("ok", "Biometria ativada.");
              } catch {
                onNotice("error", "Não foi possível ativar a biometria neste aparelho.");
              }
              setBusy(false);
            }}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={lockNow}>
          Bloquear agora
        </button>
        <button type="button" className={button} onClick={() => setMode("create")}>
          Trocar PIN
        </button>
        <button type="button" className={button} onClick={() => setMode("disable")}>
          Desativar
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        O bloqueio protege contra quem pega o aparelho destravado. Se esquecer o PIN, saia da conta e entre de novo pelo e-mail.
      </p>
    </div>
  );
}
