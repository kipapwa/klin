"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, TICK_MS);
  // Ao voltar para o app (tela bloqueada, outra aba), atualiza na hora.
  document.addEventListener("visibilitychange", onChange);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/** Arredondado a 30 s: o valor fica estável entre os ticks, como o React exige. */
const getSnapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const getServerSnapshot = () => 0;

/** Hora atual (ms) que se atualiza sozinha a cada 30 s. 0 no build estático. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
