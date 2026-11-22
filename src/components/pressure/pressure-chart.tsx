"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { bpText, chartDomain, classify, type BpReading } from "@/lib/blood-pressure";
import { LevelBadge } from "./level-badge";

const H = 220;
const PAD = { top: 14, right: 40, bottom: 26, left: 34 };
const DAY = 86_400_000;

const day = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const dayTime = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Evolução da pressão no período: máxima (azul) e mínima (laranja), um eixo só
 * (mmHg), linhas de referência em 140 e 90. Batimentos ficam no toque e na
 * lista (outra unidade: não divide o eixo). Tocar/passar o dedo mostra a medição.
 * Cores: paleta categórica da skill dataviz (slots 1 e 2, validados claro/escuro).
 */
export function PressureChart({ readings, days, now }: { readings: BpReading[]; days: number; now: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const points = [...readings].sort((a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at));
  const [lo, hi] = chartDomain(points);
  const start = now - days * DAY;
  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (iso: string) => PAD.left + ((Date.parse(iso) - start) / (now - start)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;
  const path = (key: "systolic" | "diastolic") => points.map((p, i) => `${i ? "L" : "M"}${x(p.measured_at).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");

  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += 20) ticks.push(v);
  const xTicks = [start, start + (now - start) / 2, now];

  function pick(e: PointerEvent<SVGRectElement>) {
    if (!points.length) return;
    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(x(points[i].measured_at) - px) < Math.abs(x(points[best].measured_at) - px)) best = i;
    }
    setActive(best);
  }

  const sel = active !== null ? points[active] : null;
  const last = points[points.length - 1];
  // Rótulos do fim: separa se ficarem colados.
  const endSys = last ? y(last.systolic) : 0;
  const endDia = last ? Math.max(y(last.diastolic), endSys + 14) : 0;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-center gap-4 text-xs text-zinc-600 dark:text-zinc-300">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-[#2a78d6] dark:bg-[#3987e5]" aria-hidden /> Máxima
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-[#eb6834] dark:bg-[#d95926]" aria-hidden /> Mínima
        </span>
        <span className="ml-auto text-zinc-500">mmHg</span>
      </figcaption>
      <div ref={box} className="relative">
        <svg
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          role="img"
          aria-label={`Gráfico da pressão nos últimos ${days} dias: ${points.length} medições`}
          className="block select-none overflow-visible"
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(v) + 3.5} textAnchor="end" className="fill-zinc-500 text-[10px]">
                {v}
              </text>
            </g>
          ))}
          {[140, 90].map((v) => (
            <g key={`ref-${v}`}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} className="stroke-zinc-400 dark:stroke-zinc-500" strokeWidth={1} />
              <text x={PAD.left + 4} y={y(v) - 4} className="fill-zinc-500 text-[10px]">
                limite {v}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text
              key={t}
              x={PAD.left + (i / 2) * plotW}
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
              className="fill-zinc-500 text-[10px]"
            >
              {day.format(new Date(t))}
            </text>
          ))}

          {sel ? (
            <line x1={x(sel.measured_at)} x2={x(sel.measured_at)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-zinc-400 dark:stroke-zinc-500" strokeWidth={1} />
          ) : null}

          {(["systolic", "diastolic"] as const).map((key) => (
            <g key={key} className={key === "systolic" ? "stroke-[#2a78d6] dark:stroke-[#3987e5] fill-[#2a78d6] dark:fill-[#3987e5]" : "stroke-[#eb6834] dark:stroke-[#d95926] fill-[#eb6834] dark:fill-[#d95926]"}>
              {points.length > 1 ? <path d={path(key)} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
              {points.map((p, i) => (
                <circle
                  key={p.id}
                  cx={x(p.measured_at)}
                  cy={y(p[key])}
                  r={i === active ? 6 : 4}
                  strokeWidth={2}
                  className="stroke-white dark:stroke-zinc-900"
                />
              ))}
            </g>
          ))}

          {last ? (
            <g className="fill-zinc-700 text-[11px] font-semibold dark:fill-zinc-200">
              <text x={width - PAD.right + 6} y={endSys + 4}>
                {last.systolic}
              </text>
              <text x={width - PAD.right + 6} y={endDia + 4}>
                {last.diastolic}
              </text>
            </g>
          ) : null}

          {/* Área de toque maior que os pontos. */}
          <rect
            x={PAD.left - 10}
            y={0}
            width={plotW + 20}
            height={H}
            fill="transparent"
            style={{ touchAction: "pan-y" }}
            onPointerDown={pick}
            onPointerMove={pick}
            onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
          />
        </svg>

        {sel ? (
          // Abaixo do gráfico (não cobre os pontos).
          <div role="status" className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-800/60">
            <span className="text-zinc-500">{dayTime.format(new Date(sel.measured_at))}</span>
            <span className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {bpText(sel)} <span className="text-xs font-normal text-zinc-500">mmHg</span>
            </span>
            {sel.pulse !== null ? <span className="text-zinc-600 dark:text-zinc-300">{sel.pulse} bpm</span> : null}
            <LevelBadge level={classify(sel.systolic, sel.diastolic)} />
          </div>
        ) : (
          <p className="mt-1 px-1 text-xs text-zinc-500">Toque no gráfico para ver cada medição.</p>
        )}
      </div>
    </figure>
  );
}
