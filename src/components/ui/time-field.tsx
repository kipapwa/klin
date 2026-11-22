"use client";

import { useState } from "react";
import { ClockIcon } from "./icons";
import { Sheet } from "./sheet";

/**
 * Campo de horário do próprio app. Substitui o <input type="time">, cujo
 * seletor do Android abria uma janela com o botão "Definir" fora da tela.
 * Abre uma folha com as horas e os minutos (de 5 em 5) e o botão
 * "Confirmar" sempre visível embaixo.
 */

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const pad = (n: number) => String(n).padStart(2, "0");

function parse(value: string): { h: number; m: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return { h: 8, m: 0 };
  return { h: Math.min(23, Number(match[1])), m: Math.min(59, Number(match[2])) };
}

export function TimeField({
  value,
  onChange,
  label,
  id,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Nome do campo para o leitor de tela e para o título da folha. */
  label: string;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        id={id}
        aria-label={`${label}: ${value || "escolher"}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-left text-base tabular-nums outline-none focus-visible:border-teal-600 focus-visible:ring-2 focus-visible:ring-teal-600/20 dark:border-zinc-700 dark:bg-zinc-900 ${className}`}
      >
        <span className={value ? "font-medium" : "text-zinc-400"}>{value || "--:--"}</span>
        <ClockIcon size={18} className="text-zinc-400" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        {/* Remonta a cada abertura: começa no horário atual do campo. */}
        {open ? (
          <Picker
            initial={value}
            onCancel={() => setOpen(false)}
            onConfirm={(next) => {
              onChange(next);
              setOpen(false);
            }}
          />
        ) : null}
      </Sheet>
    </>
  );
}

function Picker({ initial, onCancel, onConfirm }: { initial: string; onCancel: () => void; onConfirm: (value: string) => void }) {
  const start = parse(initial);
  const [hour, setHour] = useState(start.h);
  const [minute, setMinute] = useState(start.m);
  // Minuto fora dos múltiplos de 5 (ex.: vindo da IA) continua escolhível.
  const minutes = MINUTES.includes(start.m) ? MINUTES : [...MINUTES, start.m].sort((a, b) => a - b);

  const cell = (on: boolean) =>
    `h-11 rounded-xl text-base font-medium tabular-nums transition ${on ? "bg-teal-700 text-white shadow-sm" : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"}`;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-center text-4xl font-semibold tabular-nums tracking-tight" aria-live="polite">
        {pad(hour)}:{pad(minute)}
      </p>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Hora</span>
        <div role="radiogroup" aria-label="Hora" className="grid grid-cols-6 gap-1.5">
          {HOURS.map((h) => (
            <button key={h} type="button" role="radio" aria-checked={hour === h} aria-label={`${pad(h)} h`} onClick={() => setHour(h)} className={cell(hour === h)}>
              {pad(h)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Minutos</span>
        <div role="radiogroup" aria-label="Minutos" className="grid grid-cols-6 gap-1.5">
          {minutes.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={minute === m} aria-label={`${pad(m)} min`} onClick={() => setMinute(m)} className={cell(minute === m)}>
              :{pad(m)}
            </button>
          ))}
        </div>
      </div>

      {/* Sempre visível, mesmo em tela pequena (a folha rola por baixo). */}
      <div className="sticky -bottom-5 -mx-5 -mb-5 flex gap-2 border-t border-zinc-100 bg-white px-5 pb-5 pt-3 dark:border-zinc-800 dark:bg-zinc-900">
        <button type="button" onClick={onCancel} className="flex-1 rounded-2xl border border-zinc-300 px-4 py-3 font-medium dark:border-zinc-700">
          Cancelar
        </button>
        <button type="button" onClick={() => onConfirm(`${pad(hour)}:${pad(minute)}`)} className="flex-[2] rounded-2xl bg-teal-700 px-4 py-3 font-semibold text-white hover:bg-teal-800">
          Confirmar
        </button>
      </div>
    </div>
  );
}
