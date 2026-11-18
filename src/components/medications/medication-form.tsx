"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  INTERVAL_PRESETS,
  toDateTimeLocal,
  validateMedicationForm,
  type FieldErrors,
  type MedicationFormValues,
} from "@/lib/medication-form";
import { clearPrefill, getMedication, peekPrefill, saveMedication } from "@/lib/medications";
import { UserFacingError } from "@/lib/records";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const input =
  "w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 dark:border-zinc-700 dark:bg-zinc-900";

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-zinc-500">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Próximo horário "redondo" (múltiplo de 5 min) a partir de agora. */
function defaultStart(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  return toDateTimeLocal(d);
}

function blankValues(): MedicationFormValues {
  const prefill = peekPrefill();
  return {
    name: prefill?.name ?? "",
    dosage: prefill?.dosage ?? "",
    instructions: prefill?.instructions ?? "",
    intervalHours: "8",
    durationDays: prefill?.durationDays ? String(prefill.durationDays) : "",
    startsAt: defaultStart(),
    notificationsEnabled: true,
  };
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
    const result = validateMedicationForm(values);
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

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field id="name" label="Medicamento" error={errors.name}>
        <input id="name" className={input} maxLength={200} value={values.name} onChange={(e) => set("name", e.target.value)} aria-invalid={Boolean(errors.name)} />
      </Field>

      <Field id="dosage" label="Dosagem" hint="Ex.: 500 mg, 1 comprimido, 10 gotas" error={errors.dosage}>
        <input id="dosage" className={input} maxLength={200} value={values.dosage} onChange={(e) => set("dosage", e.target.value)} />
      </Field>

      <Field id="interval" label="Intervalo entre doses (horas)" error={errors.intervalHours}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Intervalos comuns">
          {INTERVAL_PRESETS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => set("intervalHours", String(h))}
              aria-pressed={values.intervalHours === String(h)}
              className={`rounded-full px-4 py-2 text-sm ${values.intervalHours === String(h) ? "bg-teal-700 text-white" : "border border-zinc-300 dark:border-zinc-700"}`}
            >
              {h === 24 ? "1x ao dia" : `${h} em ${h}h`}
            </button>
          ))}
        </div>
        <input
          id="interval"
          inputMode="decimal"
          className={`${input} mt-2`}
          value={values.intervalHours}
          onChange={(e) => set("intervalHours", e.target.value)}
          aria-invalid={Boolean(errors.intervalHours)}
        />
      </Field>

      <Field id="startsAt" label="Primeira dose" error={errors.startsAt}>
        <input
          id="startsAt"
          type="datetime-local"
          className={input}
          value={values.startsAt}
          onChange={(e) => set("startsAt", e.target.value)}
          aria-invalid={Boolean(errors.startsAt)}
        />
      </Field>

      <Field id="duration" label="Duração (dias)" error={errors.durationDays}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 accent-teal-700"
            checked={continuous}
            onChange={(e) => set("durationDays", e.target.checked ? "" : "7")}
          />
          Uso contínuo
        </label>
        {!continuous ? (
          <input
            id="duration"
            inputMode="numeric"
            className={input}
            value={values.durationDays}
            onChange={(e) => set("durationDays", e.target.value)}
            aria-invalid={Boolean(errors.durationDays)}
          />
        ) : null}
      </Field>

      <Field id="instructions" label="Instruções (opcional)" hint="Ex.: após as refeições" error={errors.instructions}>
        <textarea
          id="instructions"
          rows={2}
          maxLength={1000}
          className={input}
          value={values.instructions}
          onChange={(e) => set("instructions", e.target.value)}
        />
      </Field>

      <div className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <span className="flex-1 text-sm font-medium">Lembrar nos horários das doses</span>
        <Switch
          label="Lembrar nos horários das doses"
          checked={values.notificationsEnabled}
          onChange={(next) => set("notificationsEnabled", next)}
        />
      </div>

      {saveError ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {saveError}
        </p>
      ) : null}

      <button type="submit" disabled={busy} className="rounded-2xl bg-teal-700 px-4 py-4 text-lg font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
        {busy ? "Salvando…" : id ? "Salvar alterações" : "Cadastrar medicamento"}
      </button>
    </form>
  );
}

export function MedicationFormPage() {
  const id = useSearchParams().get("id") ?? "";
  const editing = UUID_RE.test(id);
  const [loaded, setLoaded] = useState<{ values: MedicationFormValues } | { error: string } | null>(null);

  useEffect(() => {
    if (!editing) return;
    let active = true;
    getMedication(id)
      .then((found) => {
        if (!active) return;
        if (!found) return setLoaded({ error: "Medicamento não encontrado." });
        const m = found.medication;
        setLoaded({
          values: {
            name: m.name,
            dosage: m.dosage ?? "",
            instructions: m.instructions ?? "",
            intervalHours: String(Number(m.interval_hours)),
            durationDays: m.duration_days ? String(m.duration_days) : "",
            startsAt: toDateTimeLocal(new Date(m.starts_at)),
            notificationsEnabled: m.notifications_enabled,
          },
        });
      })
      .catch(() => active && setLoaded({ error: "Não foi possível carregar o medicamento." }));
    return () => {
      active = false;
    };
  }, [editing, id]);

  if (!editing) {
    return <Form initial={blankValues()} recordId={peekPrefill()?.recordId ?? null} />;
  }
  if (!loaded) return <Spinner label="Carregando…" />;
  if ("error" in loaded) return <p role="alert" className="text-sm text-red-700">{loaded.error}</p>;
  return (
    <>
      <p className="mb-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        Mudar a primeira dose ou o intervalo recalcula a próxima dose a partir de agora.
      </p>
      <Form id={id} initial={loaded.values} recordId={null} />
    </>
  );
}
