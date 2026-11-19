"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { useScreen } from "@/hooks/use-screen";
import { readScreen } from "@/lib/screen-cache";
import type { Medication } from "@/lib/types";
import { PlusIcon, XIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { TimeField } from "@/components/ui/time-field";
import {
  INTERVAL_PRESETS,
  normalizeTimes,
  TIME_PRESETS,
  toDateLocal,
  toDateTimeLocal,
  validateMedicationForm,
  type FieldErrors,
  type MedicationFormValues,
  type ScheduleMode,
} from "@/lib/medication-form";
import { clearPrefill, getMedication, peekPrefill, saveMedication } from "@/lib/medications";
import { deviceTimeZone } from "@/lib/profile";
import { UserFacingError } from "@/lib/records";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const input =
  "w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 dark:border-zinc-700 dark:bg-zinc-900";
const chip = (active: boolean) =>
  `rounded-full px-4 py-2 text-sm font-medium transition ${active ? "bg-teal-700 text-white" : "border border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"}`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>
      {children}
    </section>
  );
}

function FieldError({ id, text }: { id: string; text?: string }) {
  return text ? (
    <p id={id} role="alert" className="text-xs text-red-700 dark:text-red-400">
      {text}
    </p>
  ) : null;
}

/** Próximo horário "redondo" (múltiplo de 5 min) a partir de agora. */
function nextRoundedNow(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  return d;
}

function blankValues(): MedicationFormValues {
  const prefill = peekPrefill();
  const now = nextRoundedNow();
  return {
    name: prefill?.name ?? "",
    dosage: prefill?.dosage ?? "",
    instructions: prefill?.instructions ?? "",
    mode: "times",
    times: ["08:00"],
    startDate: toDateLocal(now),
    intervalHours: "8",
    startsAt: toDateTimeLocal(now),
    durationDays: prefill?.durationDays ? String(prefill.durationDays) : "",
    notificationsEnabled: true,
  };
}

/** Sugere um novo horário: 4 h depois do último (ou 12:00). */
function suggestTime(times: string[]): string {
  const last = normalizeTimes(times).at(-1);
  if (!last) return "12:00";
  const [h, m] = last.split(":").map(Number);
  return `${String((h + 4) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function Form({ id, initial, recordId }: { id?: string; initial: MedicationFormValues; recordId: string | null }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const set = <K extends keyof MedicationFormValues>(key: K, value: MedicationFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = validateMedicationForm(values, deviceTimeZone());
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    setSaveError(null);
    try {
      const savedId = await saveMedication(result.value, id, recordId);
      clearPrefill();
      router.replace(`/medicamentos/detalhe/?id=${savedId}`);
    } catch (err) {
      setSaveError(err instanceof UserFacingError ? err.message : "Erro inesperado.");
      setBusy(false);
    }
  }

  const continuous = values.durationDays === "";
  const presetActive = (times: string[]) => normalizeTimes(values.times).join() === times.join();

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Section title="Remédio">
        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-sm text-zinc-600 dark:text-zinc-400">
            Nome
          </label>
          <input
            id="name"
            className={input}
            maxLength={200}
            placeholder="Ex.: Losartana"
            autoComplete="off"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            aria-invalid={Boolean(errors.name)}
          />
          <FieldError id="name-error" text={errors.name} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="dosage" className="text-sm text-zinc-600 dark:text-zinc-400">
            Dose (opcional)
          </label>
          <input id="dosage" className={input} maxLength={200} placeholder="Ex.: 50 mg, 1 comprimido, 10 gotas" value={values.dosage} onChange={(e) => set("dosage", e.target.value)} />
          <FieldError id="dosage-error" text={errors.dosage} />
        </div>
      </Section>

      <Section title="Quando tomar">
        <div role="radiogroup" aria-label="Tipo de horário" className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
          {(
            [
              ["times", "Horários do dia"],
              ["interval", "A cada X horas"],
            ] as [ScheduleMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={values.mode === mode}
              onClick={() => set("mode", mode)}
              className={`rounded-lg py-2 text-sm font-medium transition ${values.mode === mode ? "bg-white text-teal-800 shadow-sm dark:bg-zinc-950 dark:text-teal-200" : "text-zinc-600 dark:text-zinc-400"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {values.mode === "times" ? (
          <>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Atalhos de horários">
              {TIME_PRESETS.map((p) => (
                <button key={p.label} type="button" className={chip(presetActive(p.times))} onClick={() => set("times", p.times)}>
                  {p.label}
                </button>
              ))}
            </div>
            <ul className="flex flex-col gap-2" aria-label="Horários">
              {values.times.map((t, i) => (
                <li key={i} className="flex items-center gap-2">
                  <TimeField
                    label={`Horário ${i + 1}`}
                    value={t}
                    onChange={(next) => set("times", values.times.map((x, j) => (j === i ? next : x)))}
                  />
                  {values.times.length > 1 ? (
                    <button
                      type="button"
                      aria-label={`Remover horário ${t}`}
                      onClick={() => set("times", values.times.filter((_, j) => j !== i))}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <XIcon size={18} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {values.times.length < 12 ? (
              <button
                type="button"
                onClick={() => set("times", [...values.times, suggestTime(values.times)])}
                className="flex items-center justify-center gap-1 rounded-xl border border-dashed border-teal-600 py-2 text-sm font-medium text-teal-700 dark:text-teal-400"
              >
                <PlusIcon size={18} /> Adicionar horário
              </button>
            ) : null}
            <FieldError id="times-error" text={errors.times} />
            <div className="flex flex-col gap-1">
              <label htmlFor="startDate" className="text-sm text-zinc-600 dark:text-zinc-400">
                A partir de
              </label>
              <input id="startDate" type="date" className={input} value={values.startDate} onChange={(e) => set("startDate", e.target.value)} />
              <FieldError id="startDate-error" text={errors.startDate} />
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Intervalos comuns">
              {INTERVAL_PRESETS.map((h) => (
                <button key={h} type="button" className={chip(values.intervalHours === String(h))} onClick={() => set("intervalHours", String(h))}>
                  {h} em {h} h
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="interval" className="text-sm text-zinc-600 dark:text-zinc-400">
                Intervalo (horas)
              </label>
              <input id="interval" inputMode="decimal" className={input} value={values.intervalHours} onChange={(e) => set("intervalHours", e.target.value)} aria-invalid={Boolean(errors.intervalHours)} />
              <FieldError id="interval-error" text={errors.intervalHours} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="startsAt" className="text-sm text-zinc-600 dark:text-zinc-400">
                Primeira dose
              </label>
              {/* Dia (calendário do celular) + hora (seletor do app); juntos formam o "YYYY-MM-DDTHH:MM". */}
              <div className="grid grid-cols-[3fr_2fr] gap-2">
                <input
                  id="startsAt"
                  type="date"
                  aria-label="Dia da primeira dose"
                  className={input}
                  value={values.startsAt.slice(0, 10)}
                  onChange={(e) => set("startsAt", `${e.target.value}T${values.startsAt.slice(11, 16) || "08:00"}`)}
                  aria-invalid={Boolean(errors.startsAt)}
                />
                <TimeField
                  id="startsAt-time"
                  label="Hora da primeira dose"
                  className="py-3"
                  value={values.startsAt.slice(11, 16)}
                  onChange={(next) => set("startsAt", `${values.startsAt.slice(0, 10)}T${next}`)}
                />
              </div>
              <FieldError id="startsAt-error" text={errors.startsAt} />
            </div>
          </>
        )}
      </Section>

      <Section title="Por quanto tempo">
        <div className="flex items-center gap-3">
          <span className="flex-1 text-sm">Uso contínuo</span>
          <Switch label="Uso contínuo" checked={continuous} onChange={(next) => set("durationDays", next ? "" : "7")} />
        </div>
        {!continuous ? (
          <div className="flex items-center gap-2">
            <label htmlFor="duration" className="text-sm text-zinc-600 dark:text-zinc-400">
              Por
            </label>
            <input id="duration" inputMode="numeric" className={`${input} w-24 text-center`} value={values.durationDays} onChange={(e) => set("durationDays", e.target.value)} aria-invalid={Boolean(errors.durationDays)} />
            <span className="text-sm text-zinc-600 dark:text-zinc-400">dias</span>
          </div>
        ) : null}
        <FieldError id="duration-error" text={errors.durationDays} />
      </Section>

      <Section title="Lembrete e instruções">
        <div className="flex items-center gap-3">
          <span className="flex-1">
            <span className="block text-sm font-medium">Avisar nos horários</span>
            <span className="block text-xs text-zinc-500">Notificação no celular na hora de cada dose.</span>
          </span>
          <Switch label="Avisar nos horários" checked={values.notificationsEnabled} onChange={(next) => set("notificationsEnabled", next)} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="instructions" className="text-sm text-zinc-600 dark:text-zinc-400">
            Instruções (opcional)
          </label>
          <textarea id="instructions" rows={2} maxLength={1000} className={input} placeholder="Ex.: após as refeições" value={values.instructions} onChange={(e) => set("instructions", e.target.value)} />
          <FieldError id="instructions-error" text={errors.instructions} />
        </div>
      </Section>

      {saveError ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {saveError}
        </p>
      ) : null}

      <button type="submit" disabled={busy} className="rounded-2xl bg-teal-700 px-4 py-4 text-lg font-semibold text-white shadow-sm hover:bg-teal-800 disabled:opacity-60">
        {busy ? "Salvando…" : id ? "Salvar alterações" : "Salvar remédio"}
      </button>
    </form>
  );
}

function toValues(m: Medication): MedicationFormValues {
  const start = new Date(m.starts_at);
  const times = m.schedule_type === "times" && m.dose_times?.length;
  return {
    name: m.name,
    dosage: m.dosage ?? "",
    instructions: m.instructions ?? "",
    mode: times ? "times" : "interval",
    times: times ? m.dose_times! : ["08:00"],
    startDate: toDateLocal(start),
    intervalHours: String(Number(m.interval_hours)),
    startsAt: toDateTimeLocal(start),
    durationDays: m.duration_days ? String(m.duration_days) : "",
    notificationsEnabled: m.notifications_enabled,
  };
}

export function MedicationFormPage() {
  const id = useSearchParams().get("id") ?? "";
  const editing = UUID_RE.test(id);
  // Tela instantânea (formulário): abre com o guardado; o Form guarda os próprios
  // valores, então o que o banco trouxer depois não apaga o que a pessoa digitou.
  const screen = useScreen<{ medication: Medication; logs: unknown[] } | null>(
    `remedio:${id}`,
    () => (editing ? getMedication(id) : Promise.resolve(null)),
    {
      guard: true,
      store: editing,
      seed: editing
        ? (() => {
            const m = readScreen<Medication[]>("remedios")?.find((x) => x.id === id);
            return m ? { medication: m, logs: [] } : undefined;
          })()
        : null,
    },
  );

  if (!editing) {
    return (
      <>
        <h1 className="mb-3 text-2xl font-semibold tracking-tight">Novo remédio</h1>
        <Form initial={blankValues()} recordId={peekPrefill()?.recordId ?? null} />
      </>
    );
  }
  if (screen.loading) return <Spinner label="Carregando…" />;
  if (screen.data === null) return <p className="text-sm">Remédio não encontrado.</p>;
  if (!screen.data) return <p role="alert" className="text-sm text-red-700">{screen.error}</p>;
  return (
    <>
      <h1 className="mb-3 text-2xl font-semibold tracking-tight">Editar remédio</h1>
      <Form key={id} id={id} initial={toValues(screen.data.medication)} recordId={null} />
    </>
  );
}
