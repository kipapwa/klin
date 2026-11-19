"use client";

import { useEffect, useRef } from "react";

/**
 * A dose foi marcada pela notificação (public/sw.js avisa "klin:dose-marcada"):
 * a tela aberta busca de novo para mostrar a próxima dose.
 */
export function useDoseMarked(onMarked: () => void) {
  const ref = useRef(onMarked);
  useEffect(() => {
    ref.current = onMarked;
  });
  useEffect(() => {
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (!sw) return;
    const listener = (e: MessageEvent) => {
      if ((e.data as { type?: unknown } | null)?.type === "klin:dose-marcada") ref.current();
    };
    sw.addEventListener("message", listener);
    return () => sw.removeEventListener("message", listener);
  }, []);
}
