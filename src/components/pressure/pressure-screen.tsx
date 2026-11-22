"use client";

import { useState, type FormEvent } from "react";
import { AskAiButton } from "@/components/ai/ask-ai";
import { ReportPreviewSheet } from "@/components/reports/report-preview";
import { useConfirm } from "@/components/ui/confirm";
import { Spinner } from "@/components/ui/spinner";
import { TimeField } from "@/components/ui/time-field";
import { useNow } from "@/hooks/use-now";
import { useScreen } from "@/hooks/use-screen";
import { bpText, classify, inPeriod, parseReading, PRESSURE_PERIODS, summarize, type BpLevel, type BpReading } from "@/lib/blood-pressure";
import { preparePressureReport } from "@/lib/export-report";
import { addReading, deleteReading, listReadings } from "@/lib/pressure";
import { fromLocalInputs, toLocalInputs } from "@/lib/record-edit";
import { UserFacingError } from "@/lib/records";
import { LevelBadge } from "./level-badge";
import { PressureChart } from "./pressure-chart";

const dateTime = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const messageOf = (err: unknown, fallback: string) => (err instanceof UserFacingError ? err.message : fallback);

const chip = (on: boolean) =>
  `flex-1 rounded-xl px-3 py-2 text-sm font-medium ${on ? "bg-teal-700 text-white" : "border border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"}`;

function PeriodChips({ value, onChange, label }: { value: number; onChange: (d: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-2">
      {PRESSURE_PERIODS.map((d) => (
        <button key={d} type="button" role="radio" aria-checked={value === d} onClick={() => onChange(d)} className={chip(value === d)}>
          {d} dias
        </button>
      ))}
    </div>
  );
}

/**
 * Aba Pressão: lançamento rápido (máxima, mínima, batimentos), resumo e
 * gráfico do período, lista das medições, relatório PDF e "Perguntar à IA".
 * Tela instantânea: abre com o guardado ("pressao").
 */
export function PressureScreen() {
  const now = useNow();
  const screen = useScreen("pressao", listReadings);
  const [days, setDays] = useState<number>(30);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportDays, setReportDays] = useState<number>(30);
  const [aiDays, setAiDays] = useState<number>(30);
  const confirm = useConfirm();
  const [listError, setListError] = useState<string | null>(null);

  if (screen.loading) return <Spinner label="Carregando medições…" />;
  if (!screen.data) return <p role="alert" className="text-sm text-red-700">{screen.error}</p>;

  const all = screen.data;
  const period = inPeriod(all, days, now);
  const summary = summarize(period);

  const saved = (r: BpReading) => screen.update([r, ...all].sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at)));

  async function remove(r: BpReading) {
    if (!(await confirm({ title: `Apagar a medição ${bpText(r)}?`, message: dateTime.format(new Date(r.measured_at)), confirmLabel: "Apagar", tone: "danger", icon: "🗑️" }))) return;
    setListError(null);
    try {
      await deleteReading(r.id);
      screen.update(all.filter((x) => x.id !== r.id));
    } catch (err) {
      setListError(messageOf(err, "Não foi possível apagar a medição."));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-2xl font-semibold tracking-tight">Sua pressão</h1>
        {all.length > 0 ? (
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="shrink-0 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-medium shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            Relatório PDF
          </button>
        ) : null}
      </div>
      <ReportPreviewSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title="Relatório de pressão"
        loadKey={String(reportDays)}
        load={() => preparePressureReport(reportDays)}
        controls={<PeriodChips value={reportDays} onChange={setReportDays} label="Período do relatório" />}
      />

      {all.length > 0 ? (
        <AskAiButton
          scope="pressure"
          prepare={() => preparePressureReport(aiDays)}
          scopeNote={`A IA vai analisar suas medições de pressão dos últimos ${aiDays} dias.`}
          controls={<PeriodChips value={aiDays} onChange={setAiDays} label="Período da análise" />}
        />
      ) : null}

      <NewReading onSaved={saved} />

      {all.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-5 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Anote aqui cada vez que medir a pressão. Com algumas medições, aparecem a média e o gráfico.
        </p>
      ) : (
        <>
          <PeriodChips value={days} onChange={setDays} label="Período" />
          {summary ? (
            <section aria-label="Resumo do período" className="grid grid-cols-2 gap-2">
              <div className="col-span-2 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Média em {days} dias</p>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-4xl font-semibold tabular-nums tracking-tight">{bpText({ systolic: summary.avgSystolic, diastolic: summary.avgDiastolic })}</span>
                  <span className="text-sm text-zinc-500">mmHg</span>
                  {summary.avgPulse !== null ? <span className="text-sm text-zinc-500">· {summary.avgPulse} bpm</span> : null}
                </p>
                <LevelBadge level={summary.level} className="mt-2" />
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs text-zinc-500">Medições</p>
                <p className="text-2xl font-semibold tabular-nums">{summary.count}</p>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-xs text-zinc-500">Acima de 140/90</p>
                <p className="text-2xl font-semibold tabular-nums">{summary.highCount}</p>
              </div>
            </section>
          ) : (
            <p className="text-sm text-zinc-500">Nenhuma medição nos últimos {days} dias.</p>
          )}

          {period.length ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <PressureChart readings={period} days={days} now={now} />
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Medições</h2>
            {listError ? (
              <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
                {listError}
              </p>
            ) : null}
            <ul className="flex flex-col gap-2" aria-label="Medições de pressão">
              {period.map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-zinc-500">{dateTime.format(new Date(r.measured_at))}</p>
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-xl font-semibold tabular-nums">{bpText(r)}</span>
                      {r.pulse !== null ? <span className="text-sm text-zinc-500">{r.pulse} bpm</span> : null}
                    </p>
                    <LevelBadge level={classify(r.systolic, r.diastolic)} className="mt-1" />
                    {r.note ? <p className="mt-1 break-words text-sm text-zinc-600 dark:text-zinc-400">{r.note}</p> : null}
                  </div>
                  <button
                    type="button"
                    aria-label={`Apagar medição ${bpText(r)}`}
                    onClick={() => void remove(r)}
                    className="shrink-0 rounded-xl px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950"
                  >
                    Apagar
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <p className="text-[11px] text-zinc-500">
            Classificação da Diretriz Brasileira de Hipertensão (2020), feita para medidas no consultório. Em casa, médias a partir de 130/80 já
            merecem atenção. Não substitui avaliação médica.
          </p>
        </>
      )}
    </div>
  );
}

/** Lançamento rápido: três números e salvar. Dia e hora = agora, a não ser que a pessoa mude. */
function NewReading({ onSaved }: { onSaved: (r: BpReading) => void }) {
  const [fields, setFields] = useState({ systolic: "", diastolic: "", pulse: "", note: "" });
  const [when, setWhen] = useState<{ date: string; time: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; level: BpLevel } | null>(null);

  const set = (k: keyof typeof fields) => (e: { target: { value: string } }) => {
    setResult(null);
    setFields((f) => ({ ...f, [k]: k === "note" ? e.target.value : e.target.value.replace(/\D/g, "").slice(0, 3) }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    let measuredAt = new Date().toISOString();
    if (when) {
      const parsed = fromLocalInputs(when.date, when.time, Date.now());
      if ("error" in parsed) return setError(parsed.error);
      if (Date.parse(parsed.iso) > Date.now() + 60_000) return setError("A medição não pode ser no futuro.");
      measuredAt = parsed.iso;
    }
    const reading = parseReading(fields, measuredAt);
    if ("error" in reading) return setError(reading.error);
    setError(null);
    setSaving(true);
    try {
      const saved = await addReading(reading.value);
      onSaved(saved);
      setResult({ text: bpText(saved), level: classify(saved.systolic, saved.diastolic) });
      setFields({ systolic: "", diastolic: "", pulse: "", note: "" });
      setWhen(null);
    } catch (err) {
      setError(messageOf(err, "Não foi possível salvar a medição."));
    } finally {
      setSaving(false);
    }
  }

  const num =
    "w-full rounded-xl border border-zinc-300 bg-white px-2 py-3 text-center text-2xl font-semibold tabular-nums outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 dark:border-zinc-700 dark:bg-zinc-950";

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-2xl border border-teal-200 bg-teal-50/60 p-4 dark:border-teal-900 dark:bg-teal-950/40">
      <h2 className="font-semibold">Nova medição</h2>
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-center text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Máxima
          <input id="bp-sys" inputMode="numeric" autoComplete="off" placeholder="120" value={fields.systolic} onChange={set("systolic")} className={num} />
        </label>
        <label className="flex flex-col gap-1 text-center text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Mínima
          <input id="bp-dia" inputMode="numeric" autoComplete="off" placeholder="80" value={fields.diastolic} onChange={set("diastolic")} className={num} />
        </label>
        <label className="flex flex-col gap-1 text-center text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Batimentos
          <input id="bp-pulse" inputMode="numeric" autoComplete="off" placeholder="—" value={fields.pulse} onChange={set("pulse")} className={num} />
        </label>
      </div>
      <input
        id="bp-note"
        maxLength={300}
        placeholder="Observação (opcional): ex.: em jejum, braço esquerdo"
        value={fields.note}
        onChange={set("note")}
        className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-base outline-none focus:border-teal-600 dark:border-zinc-700 dark:bg-zinc-950"
      />
      {when ? (
        <div className="grid grid-cols-[3fr_2fr] gap-2">
          <label className="flex flex-col">
            <span className="sr-only">Dia da medição</span>
            <input
              id="bp-date"
              type="date"
              value={when.date}
              onChange={(e) => setWhen((w) => w && { ...w, date: e.target.value })}
              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 text-base dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <TimeField id="bp-time" label="Horário da medição" className="py-3" value={when.time} onChange={(t) => setWhen((w) => w && { ...w, time: t })} />
        </div>
      ) : (
        <button type="button" onClick={() => setWhen(toLocalInputs(new Date().toISOString()))} className="self-start text-sm font-medium text-teal-800 underline dark:text-teal-200">
          Medida agora · mudar dia e hora
        </button>
      )}
      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}
      {result ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            Medição {result.text} salva ✓ <LevelBadge level={result.level} />
          </p>
          {result.level.tone === "critical" ? (
            <p className="rounded-xl border-2 border-red-600 bg-red-50 p-3 text-sm font-medium text-red-900 dark:bg-red-950 dark:text-red-100">
              Pressão muito alta. Descanse 5 minutos sentado e meça de novo. Se continuar alta ou se tiver dor no peito, falta de ar, dor de cabeça forte,
              fraqueza num lado do corpo ou dificuldade para falar, procure atendimento agora (SAMU 192).
            </p>
          ) : null}
        </div>
      ) : null}
      <button type="submit" disabled={saving} className="rounded-2xl bg-teal-700 px-4 py-3 text-lg font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
        {saving ? "Salvando…" : "Salvar medição"}
      </button>
    </form>
  );
}
