"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SeverityBadge } from "@/components/records/record-card";
import { Spinner } from "@/components/ui/spinner";
import { MAX_RECORDING_SECONDS } from "@/lib/audio";
import { formatDuration } from "@/lib/labels";
import { createRecordFromAudio, processRecord, UserFacingError } from "@/lib/records";
import type { ProcessResult } from "@/lib/types";
import { useRecorder } from "./use-recorder";

type SendState =
  | { kind: "none" }
  | { kind: "uploading" }
  | { kind: "processing"; recordId: string }
  | { kind: "done"; recordId: string; result: ProcessResult }
  | { kind: "failed"; message: string; recordId: string | null };

const primary =
  "w-full rounded-2xl bg-teal-700 px-4 py-4 text-lg font-semibold text-white hover:bg-teal-800 disabled:opacity-60";
const secondary =
  "w-full rounded-2xl border border-zinc-300 px-4 py-3 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900";

function messageOf(err: unknown): string {
  return err instanceof UserFacingError ? err.message : "Algo deu errado. Tente de novo.";
}

export function Recorder() {
  const { state, start, stop, reset } = useRecorder();
  const [send, setSend] = useState<SendState>({ kind: "none" });

  // Avisa antes de fechar a aba com gravação ou envio em andamento.
  const busy = state.kind === "recording" || send.kind === "uploading" || send.kind === "processing";
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function runAi(recordId: string) {
    setSend({ kind: "processing", recordId });
    try {
      const result = await processRecord(recordId);
      setSend({ kind: "done", recordId, result });
    } catch (err) {
      setSend({ kind: "failed", message: messageOf(err), recordId });
    }
  }

  async function upload() {
    if (state.kind !== "recorded") return;
    setSend({ kind: "uploading" });
    let recordId: string;
    try {
      recordId = await createRecordFromAudio(state.blob, state.seconds);
    } catch (err) {
      setSend({ kind: "failed", message: messageOf(err), recordId: null });
      return;
    }
    await runAi(recordId);
  }

  // --- Envio / IA ---------------------------------------------------------
  if (send.kind === "uploading" || send.kind === "processing") {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <Spinner />
        <p className="font-medium">{send.kind === "uploading" ? "Enviando o áudio…" : "A IA está organizando sua nota…"}</p>
        <p className="text-sm text-zinc-500">Isso pode levar até um minuto. Não feche o app.</p>
      </div>
    );
  }

  if (send.kind === "done") {
    const { result, recordId } = send;
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
              ? `${result.medicationsCreated} medicamento(s) adicionado(s), com lembretes desligados até você conferir.`
              : "Nenhum medicamento com horário foi identificado."}
          </p>
          {result.medicationsNeedingReview.length > 0 ? (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <p className="font-medium">Citados sem intervalo entre doses (cadastre manualmente):</p>
              <ul className="mt-1 list-disc pl-5">
                {result.medicationsNeedingReview.map((m, i) => (
                  <li key={i}>
                    {m.name}
                    {m.dosage ? ` — ${m.dosage}` : ""}
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

  if (send.kind === "failed") {
    return (
      <div className="flex flex-col gap-4 py-8">
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {send.message}
        </p>
        {send.recordId ? (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">O áudio foi salvo. Você pode tentar de novo agora ou depois, pela nota.</p>
            <button type="button" className={primary} onClick={() => runAi(send.recordId!)}>
              Tentar de novo
            </button>
            <Link href={`/registro/?id=${send.recordId}`} className={`${secondary} text-center`}>
              Ver registro
            </Link>
          </>
        ) : (
          <button type="button" className={primary} onClick={() => setSend({ kind: "none" })}>
            Voltar
          </button>
        )}
      </div>
    );
  }

  // --- Gravação -----------------------------------------------------------
  switch (state.kind) {
    case "unsupported":
      return <p className="py-12 text-sm">Este navegador não permite gravar áudio. Atualize-o ou use outro navegador.</p>;

    case "error":
      return (
        <div className="flex flex-col gap-4 py-8">
          <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {state.message}
          </p>
          <button type="button" className={primary} onClick={reset}>
            Tentar de novo
          </button>
        </div>
      );

    case "recorded":
      return (
        <div className="flex flex-col gap-4 py-6">
          <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
            Gravação de {formatDuration(state.seconds)}. Ouça antes de enviar, se quiser.
          </p>
          <audio controls src={state.url} className="w-full" />
          <button type="button" className={primary} onClick={upload}>
            Enviar para a IA
          </button>
          <button type="button" className={secondary} onClick={reset}>
            Descartar e gravar de novo
          </button>
        </div>
      );

    case "recording":
      return (
        <div className="flex flex-col items-center gap-6 py-12">
          <div className="flex items-center gap-3" role="timer" aria-live="off">
            <span aria-hidden className="h-4 w-4 animate-pulse rounded-full bg-red-600 motion-reduce:animate-none" />
            <span className="font-mono text-4xl tabular-nums">{formatDuration(state.seconds)}</span>
          </div>
          <p className="text-sm text-zinc-500">Máximo de {MAX_RECORDING_SECONDS / 60} minutos.</p>
          <button
            type="button"
            onClick={stop}
            className="flex h-24 w-24 items-center justify-center rounded-full bg-red-600 text-white shadow-lg hover:bg-red-700"
            aria-label="Parar gravação"
          >
            <span aria-hidden className="h-8 w-8 rounded-md bg-white" />
          </button>
        </div>
      );

    default:
      return (
        <div className="flex flex-col items-center gap-6 py-12 text-center">
          <p className="max-w-xs text-zinc-600 dark:text-zinc-300">
            Conte como foi a consulta, o que está sentindo, os exames ou os remédios receitados.
          </p>
          <button
            type="button"
            onClick={start}
            disabled={state.kind === "requesting"}
            className="flex h-24 w-24 items-center justify-center rounded-full bg-teal-700 text-white shadow-lg hover:bg-teal-800 disabled:opacity-60"
            aria-label="Começar a gravar"
          >
            <span aria-hidden className="h-8 w-8 rounded-full bg-red-400" />
          </button>
          <p className="text-xs text-zinc-500">O áudio é enviado com segurança e só você tem acesso.</p>
        </div>
      );
  }
}
