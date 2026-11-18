"use client";

import { useEffect } from "react";

/**
 * Registra o Service Worker (public/sw.js) uma vez por carregamento.
 * O SW fica na raiz para ter escopo "/" e receber push de qualquer tela.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // Falha silenciosa: o app continua funcionando sem push/offline.
      });
  }, []);

  return null;
}
