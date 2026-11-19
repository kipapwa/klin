"use client";

import { useState } from "react";
import { Recorder } from "./recorder";
import { Writer } from "./writer";

type Mode = "voice" | "text";
const KEY = "klin:novo-registro"; // só a última escolha (Falar/Escrever), sem dado clínico

function lastMode(): Mode {
  try {
    return localStorage.getItem(KEY) === "text" ? "text" : "voice";
  } catch {
    return "voice";
  }
}

/** Novo registro: falar (gravação) ou escrever (texto), os dois com a IA. */
export function NewRecord() {
  const [mode, setMode] = useState<Mode>(lastMode);

  function choose(m: Mode) {
    setMode(m);
    try {
      localStorage.setItem(KEY, m);
    } catch {
      // sem armazenamento: só não lembra a escolha
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Como registrar" className="grid grid-cols-2 gap-1 rounded-2xl bg-zinc-200/70 p-1 dark:bg-zinc-800">
        {(
          [
            ["voice", "🎙️", "Falar"],
            ["text", "✍️", "Escrever"],
          ] as [Mode, string, string][]
        ).map(([m, icon, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => choose(m)}
            className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition ${mode === m ? "bg-white text-teal-800 shadow-sm dark:bg-zinc-950 dark:text-teal-200" : "text-zinc-600 dark:text-zinc-400"}`}
          >
            <span aria-hidden>{icon}</span>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{mode === "voice" ? <Recorder /> : <Writer />}</div>
    </div>
  );
}
