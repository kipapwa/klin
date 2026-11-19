"use client";

import { useEffect } from "react";

/**
 * Sem zoom (skill sem-zoom), parte em JavaScript: o iPhone ignora
 * `user-scalable=no` desde o iOS 10, então a pinça é barrada pelos eventos
 * do Safari e pelo movimento com dois ou mais dedos.
 *
 * Só no celular: no computador o zoom do navegador (Ctrl + roda) continua,
 * porque é muito usado por quem enxerga pouco. Áreas que precisem de zoom
 * (ex.: um futuro visualizador de fotos) levam a classe `pode-zoom`.
 */
const canZoom = (target: EventTarget | null) => Boolean((target as Element | null)?.closest?.(".pode-zoom"));

export function NoZoom() {
  useEffect(() => {
    const blockGesture = (e: Event) => {
      if (!canZoom(e.target)) e.preventDefault();
    };
    // Nunca bloquear UM dedo: isso travaria a rolagem e o arrastar.
    const blockPinch = (e: TouchEvent) => {
      if (e.touches.length > 1 && !canZoom(e.target)) e.preventDefault();
    };
    const opts = { passive: false } as const; // sem isso o preventDefault é ignorado
    const gestures = ["gesturestart", "gesturechange", "gestureend"];
    gestures.forEach((t) => document.addEventListener(t, blockGesture, opts));
    document.addEventListener("touchmove", blockPinch, opts);
    return () => {
      gestures.forEach((t) => document.removeEventListener(t, blockGesture));
      document.removeEventListener("touchmove", blockPinch);
    };
  }, []);
  return null;
}
