"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/auth/session-provider";
import { formatDateTime, formatDuration } from "@/lib/labels";
import { deleteDraft, DRAFTS_CHANGED, listDrafts, type Draft } from "@/lib/offline-store";
import { syncDrafts } from "@/lib/sync";
import { useOnline } from "./offline-sync";

/** Gravações guardadas no aparelho, aguardando envio. */
export function PendingDrafts() {
  const { session } = useSession();
  const userId = session?.user.id;
  const online = useOnline();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (userId) listDrafts(userId).then(setDrafts);
  }, [userId]);

  useEffect(() => {
    refresh();
    window.addEventListener(DRAFTS_CHANGED, refresh);
    return () => window.removeEventListener(DRAFTS_CHANGED, refresh);
  }, [refresh]);

  if (drafts.length === 0) return null;

  return (
    <section aria-label="Gravações não enviadas" className="mb-4 rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 p-4 dark:bg-amber-950">
      <p className="font-semibold text-amber-950 dark:text-amber-100">
        {drafts.length} {drafts.length === 1 ? "gravação aguardando envio" : "gravações aguardando envio"}
      </p>
      <p className="text-xs text-amber-900 dark:text-amber-200">
        {online ? "Enviando… se não sair daqui, toque em Enviar agora." : "Serão enviadas automaticamente quando a internet voltar."}
      </p>
      <ul className="mt-2 flex flex-col gap-2 text-sm">
        {drafts.map((d) => (
          <li key={d.clientId} className="flex items-center gap-2">
            <span className="flex-1">
              {formatDateTime(d.recordedAt)} · {formatDuration(d.durationSeconds)}
              {d.lastError ? <span className="block text-xs text-red-700 dark:text-red-300">{d.lastError}</span> : null}
            </span>
            <button
              type="button"
              className="text-xs text-red-700 underline dark:text-red-300"
              onClick={() => window.confirm("Descartar esta gravação? Ela ainda não foi enviada.") && deleteDraft(d.clientId)}
            >
              Descartar
            </button>
          </li>
        ))}
      </ul>
      {online && userId ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await syncDrafts(userId);
            setBusy(false);
          }}
          className="mt-3 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Enviando…" : "Enviar agora"}
        </button>
      ) : null}
    </section>
  );
}
