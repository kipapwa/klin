"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SeverityBadge } from "@/components/records/record-card";
import { storePrefill } from "@/lib/medications";
import type { ProcessResult } from "@/lib/types";

const primary =
  "w-full rounded-2xl bg-teal-700 px-4 py-4 text-lg font-semibold text-white hover:bg-teal-800 disabled:opacity-60";
const secondary =
  "w-full rounded-2xl border border-zinc-300 px-4 py-3 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900";

/** Resumo do que a IA fez (gravação ou texto escrito): alerta, remédios e atalhos. */
export function AiResultView({ result, recordId }: { result: ProcessResult; recordId: string }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4">
      <div
        className={`rounded-2xl p-4 ${result.severity === "critical" ? "border-2 border-red-500 bg-red-50 dark:bg-red-950" : "border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"}`}
      >
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Nota criada</h2>
          <span className="ml-auto">
            <SeverityBadge severity={result.severity} />
          </span>
        </div>
        {result.severity === "critical" ? (
          <p className="mt-2 text-sm font-semibold text-red-800 dark:text-red-200">
            A IA identificou sinais de alerta. Se houver piora ou emergência, procure atendimento imediatamente (SAMU 192).
          </p>
        ) : null}
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          {result.medicationsCreated > 0
            ? `${result.medicationsCreated} remédio(s) adicionado(s), com lembretes desligados até você conferir.`
            : "Nenhum remédio com horário foi identificado."}
        </p>
        {result.medicationsNeedingReview.length > 0 ? (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <p className="font-medium">Citados sem intervalo entre doses (cadastre manualmente):</p>
            <ul className="mt-2 flex flex-col gap-2">
              {result.medicationsNeedingReview.map((m, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="flex-1">
                    {m.name}
                    {m.dosage ? ` — ${m.dosage}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      storePrefill({
                        name: m.name,
                        dosage: m.dosage,
                        instructions: m.instructions,
                        durationDays: m.duration_days,
                        recordId,
                      });
                      router.push("/medicamentos/editar/");
                    }}
                    className="rounded-lg bg-amber-200 px-3 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-300"
                  >
                    Cadastrar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <Link href={`/registro/?id=${recordId}`} className={`${primary} text-center`}>
        Abrir nota
      </Link>
      <Link href="/" className={`${secondary} text-center`}>
        Voltar aos registros
      </Link>
    </div>
  );
}
