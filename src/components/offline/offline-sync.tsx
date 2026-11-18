"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useSession } from "@/components/auth/session-provider";
import { syncDrafts } from "@/lib/sync";

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/**
 * Envia as gravações pendentes ao abrir o app e sempre que a conexão volta,
 * e mostra uma faixa enquanto estiver sem internet.
 */
export function OfflineSync() {
  const { session } = useSession();
  const online = useOnline();
  const userId = session?.user.id;

  useEffect(() => {
    if (userId && online) void syncDrafts(userId);
  }, [userId, online]);

  if (online) return null;
  return (
    <div role="status" className="bg-zinc-800 px-4 py-2 text-center text-sm text-white">
      Sem internet. Você pode gravar: o áudio fica no aparelho e é enviado quando a conexão voltar.
    </div>
  );
}
