"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useScreen } from "@/hooks/use-screen";
import { forgetScreen, readScreen } from "@/lib/screen-cache";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ui/confirm";
import { PushPrompt } from "./push-prompt";
import { useNow } from "@/hooks/use-now";
import { adherence } from "@/lib/doses";
import { formatDateTime, formatDoseTime, scheduleText } from "@/lib/labels";
import { deleteMedication, endTreatment, getMedication, setReminders } from "@/lib/medications";
import { UserFacingError } from "@/lib/records";
import type { Medication, MedicationLog } from "@/lib/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Loaded = { medication: Medication; logs: MedicationLog[] } | null; // null = não existe

/** Primeira visita: desenha na hora com o remédio que veio da lista (o histórico chega depois). */
function seedFromList(id: string): Loaded | undefined {
  const medication = readScreen<Medication[]>("remedios")?.find((m) => m.id === id);
  return medication ? { medication, logs: [] } : undefined;
}

const STATUS_TEXT: Record<MedicationLog["status"], { icon: string; text: string; tone: string }> = {
  taken: { icon: "✓", text: "Tomada", tone: "text-teal-700 dark:text-teal-400" },
  skipped: { icon: "–", text: "Pulada", tone: "text-amber-700 dark:text-amber-400" },
  missed: { icon: "✕", text: "Perdida", tone: "text-red-700 dark:text-red-400" },
};

function messageOf(err: unknown) {
  return err instanceof UserFacingError ? err.message : "Erro inesperado.";
}

function AdherenceStat({ label, value }: { label: string; value: ReturnType<typeof adherence> }) {
  return (
    <div className="flex-1 rounded-xl bg-zinc-50 p-3 text-center dark:bg-zinc-800">
      <p className="text-2xl font-semibold tabular-nums">{value.percent === null ? "—" : `${value.percent}%`}</p>
      <p className="text-xs text-zinc-500">
        {label}
        {value.expected ? ` · ${value.taken}/${value.expected} doses` : ""}
      </p>
    </div>
  );
}

export function MedicationDetail() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const now = useNow();
  const validId = UUID_RE.test(id);
  const screen = useScreen<Loaded>(`remedio:${id}`, () => (validId ? getMedication(id) : Promise.resolve(null)), {
    seed: validId ? seedFromList(id) : null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  if (screen.loading) return <Spinner label="Carregando…" />;
  if (screen.data === null) return <p className="text-sm">Remédio não encontrado.</p>;
  if (!screen.data) return <p role="alert" className="text-sm text-red-700">{screen.error}</p>;

  const { medication: m, logs } = screen.data;

  async function run(action: () => Promise<void>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (after) after();
      else await screen.refresh();
    } catch (err) {
      setError(messageOf(err));
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold">
          {m.name}
          {m.dosage ? <span className="font-normal text-zinc-600 dark:text-zinc-300"> — {m.dosage}</span> : null}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {scheduleText(m)}
          {m.duration_days ? `, por ${m.duration_days} dias` : ", uso contínuo"}
        </p>
        {m.instructions ? <p className="mt-1 text-sm">{m.instructions}</p> : null}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-zinc-500">Início</dt>
            <dd>{formatDateTime(m.starts_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Término</dt>
            <dd>{m.ends_at ? formatDateTime(m.ends_at) : "Uso contínuo"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Próxima dose</dt>
            <dd>{m.is_active && m.next_dose_at ? formatDoseTime(m.next_dose_at, now) : "Encerrado"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Origem</dt>
            <dd>{m.source === "ai" ? "Extraído pela IA" : "Cadastro manual"}</dd>
          </div>
        </dl>
        {m.record_id ? (
          <Link href={`/registro/?id=${m.record_id}`} className="mt-3 inline-block text-sm text-teal-700 dark:text-teal-400">
            Ver registro de origem →
          </Link>
        ) : null}
      </section>

      {m.is_active && m.notifications_enabled ? <PushPrompt /> : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <span className="flex-1">
            <span className="block font-medium">Lembretes</span>
            <span className="block text-xs text-zinc-500">
              Aviso no horário de cada dose. As notificações são ativadas por aparelho, em{" "}
              <Link href="/ajustes/" className="text-teal-700 underline dark:text-teal-400">
                Ajustes
              </Link>
              .
            </span>
          </span>
          <Switch
            label="Lembretes"
            checked={m.notifications_enabled}
            disabled={busy || !m.is_active}
            onChange={(next) => run(() => setReminders(m.id, next))}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Adesão</h2>
        <div className="flex gap-2">
          <AdherenceStat label="7 dias" value={adherence(m, logs, now, 7)} />
          <AdherenceStat label="30 dias" value={adherence(m, logs, now, 30)} />
        </div>
        <h2 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">Histórico</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhuma dose registrada ainda.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {logs.map((l) => {
              const s = STATUS_TEXT[l.status];
              return (
                <li key={l.id} className="flex items-center gap-3 py-2">
                  <span aria-hidden className={`w-4 text-center font-bold ${s.tone}`}>
                    {s.icon}
                  </span>
                  <span className="flex-1">Dose de {formatDateTime(l.scheduled_for)}</span>
                  <span className={`text-xs ${s.tone}`}>
                    {s.text}
                    {l.taken_at ? ` às ${formatDoseTime(l.taken_at, Date.parse(l.taken_at))}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/medicamentos/editar/?id=${m.id}`}
          className="flex-1 rounded-xl bg-teal-700 px-4 py-3 text-center font-medium text-white hover:bg-teal-800"
        >
          Editar horários
        </Link>
        {m.is_active ? (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const ok = await confirm({ icon: "⏹️", title: "Encerrar este tratamento?", message: "Os lembretes deste remédio param.", confirmLabel: "Encerrar" });
              if (ok) void run(() => endTreatment(m.id));
            }}
            className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium dark:border-zinc-700"
          >
            Encerrar
          </button>
        ) : null}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          const ok = await confirm({
            icon: "🗑️",
            title: "Apagar este remédio?",
            message: "O histórico de doses também será apagado.",
            confirmLabel: "Apagar",
            tone: "danger",
          });
          if (!ok) return;
          await run(
            () => deleteMedication(m.id),
            () => {
              forgetScreen(`remedio:${m.id}`);
              router.replace("/medicamentos/");
            },
          );
        }}
        className="self-end rounded-lg px-3 py-2 text-xs text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
      >
        Apagar remédio
      </button>
    </div>
  );
}
