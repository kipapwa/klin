"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useSession } from "@/components/auth/session-provider";
import { saveDraft } from "@/lib/offline-store";
import { Spinner } from "@/components/ui/spinner";
import { MAX_RECORDING_SECONDS } from "@/lib/audio";
import { formatDuration } from "@/lib/labels";
import { createRecordFromAudio, OfflineError, processRecord, UserFacingError } from "@/lib/records";
import type { ProcessResult } from "@/lib/types";
import { useLeaveGuard } from "@/lib/leave-guard";
import { AiResultView } from "./ai-result";
import { useRecorder } from "./use-recorder";

type SendState =
  | { kind: "none" }
  | { kind: "uploading" }
  | { kind: "processing"; recordId: string }
  | { kind: "savedOffline" }
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
  const { session } = useSession();
  const { state, start, stop, reset: resetRecorder } = useRecorder();
  const [send, setSend] = useState<SendState>({ kind: "none" });
  const clientIdRef = useRef<string | null>(null);
  const reset = () => {
    clientIdRef.current = null;
    resetRecorder();
  };

  // Sair no meio da gravação/envio: o menu e o voltar do app pedem confirmação
  // na caixa do próprio app (sem o aviso do navegador, que é caixa do sistema).
  const busy = state.kind === "recording" || state.kind === "recorded" || send.kind === "uploading" || send.kind === "processing";
  useLeaveGuard(busy ? "A gravação ainda não foi enviada e será perdida." : null);

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
    // Um id por gravação: tentar de novo (ou sincronizar depois) não duplica.
    clientIdRef.current ??= crypto.randomUUID();
    const clientId = clientIdRef.current;
    setSend({ kind: "uploading" });
    let recordId: string;
    try {
      recordId = await createRecordFromAudio(state.blob, state.seconds, { clientId, recordedAt: state.startedAt });
    } catch (err) {
      if (err instanceof OfflineError && session) {
        try {
          await saveDraft({
            clientId,
            userId: session.user.id,
            blob: state.blob,
            durationSeconds: state.seconds,
            recordedAt: state.startedAt,
            attempts: 0,
          });
          setSend({ kind: "savedOffline" });
          return;
        } catch {
          // IndexedDB indisponível (ex.: navegação privada): cai no erro abaixo
        }
      }
      setSend({ kind: "failed", message: messageOf(err), recordId: null });
      return;
    }
    await runAi(recordId);
  }

  // --- Envio / IA ---------------------------------------------------------
  if (send.kind === "savedOffline") {
    return (
      <div className="flex flex-col gap-4 py-8 text-center">
        <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
          <strong className="block text-base">Gravação salva no aparelho</strong>
          Sem internet agora. Ela será enviada para a IA automaticamente quando a conexão voltar.
        </p>
        <Link href="/" className={`${primary} text-center`}>
          Voltar à linha do tempo
        </Link>
      </div>
    );
  }

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
    return <AiResultView result={send.result} recordId={send.recordId} />;
  }

  if (send.kind === "failed") {
    return (
      <div className="flex flex-col gap-4 py-8">
        <p role="alert" className="whitespace-pre-line break-words rounded-xl bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
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
          <p role="alert" className="whitespace-pre-line break-words rounded-xl bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
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
