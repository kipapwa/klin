"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { buildFollowUpIcs, downloadIcs } from "@/lib/ics";
import { CATEGORY_LABEL, formatDate, formatDateTime, formatDuration, intervalText, STATUS_LABEL } from "@/lib/labels";
import { deleteRecord, getRecord, processRecord, signedAudioUrl, UserFacingError } from "@/lib/records";
import type { MedicalRecord, Medication } from "@/lib/types";
import { SeverityBadge } from "./record-card";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type State =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "error"; message: string }
  | { kind: "ready"; record: MedicalRecord; medications: Medication[] };

const button =
  "rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900";

function messageOf(err: unknown): string {
  return err instanceof UserFacingError ? err.message : "Erro inesperado.";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {children}
    </section>
  );
}

function TextSection({ title, text }: { title: string; text: string | null }) {
  if (!text) return null;
  return (
    <Section title={title}>
      {/* Texto puro: conteúdo do usuário/IA nunca é renderizado como HTML. */}
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
    </Section>
  );
}

export function RecordView() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "audio" | "ai" | "delete">(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!UUID_RE.test(id)) return { kind: "notFound" } as const;
    try {
      const found = await getRecord(id);
      return found ? ({ kind: "ready", ...found } as const) : ({ kind: "notFound" } as const);
    } catch (err) {
      return { kind: "error", message: messageOf(err) } as const;
    }
  }, [id]);

  useEffect(() => {
    let active = true;
    load().then((s) => active && setState(s));
    return () => {
      active = false;
    };
  }, [load]);

  if (state.kind === "loading") return <Spinner label="Carregando…" />;
  if (state.kind === "notFound") return <p className="py-12 text-sm">Registro não encontrado.</p>;
  if (state.kind === "error") return <p role="alert" className="py-12 text-sm text-red-700">{state.message}</p>;

  const { record, medications } = state;
  const critical = record.severity === "critical";

  async function playAudio() {
    if (!record.audio_path) return;
    setBusy("audio");
    setActionError(null);
    try {
      setAudioUrl(await signedAudioUrl(record.audio_path));
    } catch (err) {
      setActionError(messageOf(err));
    }
    setBusy(null);
  }

  async function runAi() {
    setBusy("ai");
    setActionError(null);
    try {
      await processRecord(record.id);
    } catch (err) {
      setActionError(messageOf(err));
    }
    setState(await load());
    setBusy(null);
  }

  async function remove() {
    if (!window.confirm("Apagar este registro e o áudio? Os medicamentos cadastrados continuam na lista.")) return;
    setBusy("delete");
    setActionError(null);
    try {
      await deleteRecord(record);
      router.replace("/");
    } catch (err) {
      setActionError(messageOf(err));
      setBusy(null);
    }
  }

  function addFollowUpToCalendar() {
    if (!record.follow_up_date) return;
    downloadIcs(
      `retorno-${record.follow_up_date}.ics`,
      buildFollowUpIcs({ uid: record.id, date: record.follow_up_date }),
    );
  }

  return (
    <article className="flex flex-col gap-3">
      <header
        className={`rounded-2xl p-4 ${critical ? "border-2 border-red-500 bg-red-50 dark:bg-red-950" : "border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"}`}
      >
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>{formatDateTime(record.recorded_at)}</span>
          <span aria-hidden>·</span>
          <span>{CATEGORY_LABEL[record.category]}</span>
          <span className="ml-auto">
            <SeverityBadge severity={record.severity} />
          </span>
        </div>
        <h1 className={`mt-1 text-lg font-semibold ${critical ? "text-red-900 dark:text-red-100" : ""}`}>
          {record.title || "Registro sem título"}
        </h1>
        {record.alert_signs.length > 0 ? (
          <div className={`mt-3 text-sm ${critical ? "text-red-800 dark:text-red-200" : "text-amber-900 dark:text-amber-100"}`}>
            <p className="font-semibold">Sinais de alerta:</p>
            <ul className="list-disc pl-5">
              {record.alert_signs.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            {critical ? <p className="mt-2 font-semibold">Em caso de piora ou emergência, procure atendimento (SAMU 192).</p> : null}
          </div>
        ) : null}
      </header>

      {record.status !== "ready" ? (
        <Section title="Processamento">
          <p className="text-sm">{STATUS_LABEL[record.status]}</p>
          {record.status === "processing" ? (
            <button type="button" className={`${button} mt-3`} onClick={async () => setState(await load())}>
              Atualizar
            </button>
          ) : (
            <button type="button" className={`${button} mt-3`} onClick={runAi} disabled={busy !== null}>
              {busy === "ai" ? "Processando…" : "Processar com IA"}
            </button>
          )}
        </Section>
      ) : null}

      <TextSection title="Queixa principal" text={record.chief_complaint} />
      <TextSection title="Histórico" text={record.history} />
      <TextSection title="Observações" text={record.observations} />
      <TextSection title="Conduta" text={record.plan} />

      {record.icd10_codes.length > 0 ? (
        <Section title="CID-10 sugeridos">
          <ul className="flex flex-col gap-1 text-sm">
            {record.icd10_codes.map((c) => (
              <li key={c.code}>
                <span className="font-mono font-semibold">{c.code}</span> — {c.description}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-500">Sugestões automáticas; não substituem o diagnóstico de um profissional.</p>
        </Section>
      ) : null}

      {record.follow_up_date ? (
        <Section title="Retorno">
          <p className="text-sm">
            {formatDate(record.follow_up_date)}
            {record.follow_up_in_days ? ` (em ${record.follow_up_in_days} dias)` : ""}
          </p>
          <button type="button" className={`${button} mt-3`} onClick={addFollowUpToCalendar}>
            Adicionar ao calendário
          </button>
        </Section>
      ) : null}

      {medications.length > 0 ? (
        <Section title="Medicamentos">
          <ul className="flex flex-col gap-3 text-sm">
            {medications.map((m) => (
              <li key={m.id}>
                <Link href={`/medicamentos/detalhe/?id=${m.id}`} className="font-medium text-teal-800 underline-offset-2 hover:underline dark:text-teal-300">
                  {m.name}
                  {m.dosage ? ` — ${m.dosage}` : ""}
                </Link>
                <p className="text-zinc-600 dark:text-zinc-400">
                  {intervalText(Number(m.interval_hours))}
                  {m.duration_days ? `, por ${m.duration_days} dias` : ", uso contínuo"}
                  {m.instructions ? ` · ${m.instructions}` : ""}
                </p>
                <p className="text-xs text-zinc-500">
                  Início: {formatDateTime(m.starts_at)} · Lembretes {m.notifications_enabled ? "ligados" : "desligados"}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {record.audio_path ? (
        <Section title="Áudio">
          {audioUrl ? (
            <audio controls autoPlay src={audioUrl} className="w-full" />
          ) : (
            <button type="button" className={button} onClick={playAudio} disabled={busy !== null}>
              {busy === "audio" ? "Carregando…" : `Ouvir gravação${record.audio_duration_s ? ` (${formatDuration(record.audio_duration_s)})` : ""}`}
            </button>
          )}
        </Section>
      ) : null}

      {record.transcript ? (
        <details className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-zinc-500">Transcrição</summary>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{record.transcript}</p>
        </details>
      ) : null}

      {actionError ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {actionError}
        </p>
      ) : null}

      <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
        <span>{record.ai_provider && record.ai_provider !== "manual" ? `Estruturado por IA (${record.ai_provider})` : ""}</span>
        <button type="button" onClick={remove} disabled={busy !== null} className="rounded-lg px-3 py-2 text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950">
          {busy === "delete" ? "Apagando…" : "Apagar registro"}
        </button>
      </div>
    </article>
  );
}
