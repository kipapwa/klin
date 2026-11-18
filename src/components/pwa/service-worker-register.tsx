"use client";

import { useEffect } from "react";
import { withBase } from "@/lib/base-path";

/**
 * Registra o Service Worker (public/sw.js) uma vez por carregamento.
 * O escopo é a raiz do app (basePath) para receber push de qualquer tela.
 * `updateViaCache: "none"` substitui o cabeçalho no-cache, que o GitHub
 * Pages não deixa configurar.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register(withBase("/sw.js"), { scope: withBase("/"), updateViaCache: "none" })
      .catch(() => {
        // Falha silenciosa: o app continua funcionando sem push/offline.
      });
  }, []);

  return null;
}
