"use client";

import { useEffect, useState } from "react";
import { BellIcon } from "@/components/ui/icons";
import { devicePushState, enablePush, type DevicePushState } from "@/lib/push";
import { UserFacingError } from "@/lib/records";

/**
 * Aviso para ativar as notificações NESTE aparelho, mostrado onde o usuário
 * cadastra lembretes — sem precisar descobrir a tela de Ajustes.
 */
export function PushPrompt() {
  const [state, setState] = useState<DevicePushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    devicePushState()
      .then((s) => active && setState(s))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!state || state.subscribed || state.support === "unsupported" || state.support === "not-configured") return null;

  const box = "flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100";

  if (state.support === "ios-needs-install") {
    return (
      <div className={box}>
        <BellIcon className="mt-0.5 shrink-0" size={20} />
        <p>
          Para receber os avisos no iPhone, instale o Klin: no Safari, toque em <strong>Compartilhar</strong> →{" "}
          <strong>Adicionar à Tela de Início</strong>, e abra pelo ícone.
        </p>
      </div>
    );
  }
  if (state.permission === "denied") {
    return (
      <div className={box}>
        <BellIcon className="mt-0.5 shrink-0" size={20} off />
        <p>As notificações do Klin estão bloqueadas neste navegador. Libere nas configurações do site para receber os avisos.</p>
      </div>
    );
  }
  return (
    <div className={box}>
      <BellIcon className="mt-0.5 shrink-0" size={20} />
      <div className="flex-1">
        <p className="font-semibold">Ative as notificações neste aparelho</p>
        <p className="text-xs">Sem isso, os lembretes dos horários não chegam.</p>
        {error ? <p className="mt-1 text-xs text-red-700 dark:text-red-300">{error}</p> : null}
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await enablePush();
              setState(await devicePushState());
            } catch (err) {
              setError(err instanceof UserFacingError ? err.message : "Não foi possível ativar.");
            }
            setBusy(false);
          }}
          className="mt-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {busy ? "Ativando…" : "Ativar notificações"}
        </button>
      </div>
    </div>
  );
}
