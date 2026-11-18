"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Spinner } from "@/components/ui/spinner";
import { CATEGORY_LABEL, SEVERITY_LABEL } from "@/lib/labels";
import { DRAFTS_CHANGED } from "@/lib/offline-store";
import { listRecords, UserFacingError, type RecordFilters } from "@/lib/records";
import { groupByMonth, toggle } from "@/lib/timeline";
import type { MedicalRecordSummary, RecordCategory, RecordSeverity } from "@/lib/types";
import { RecordCard } from "./record-card";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; records: MedicalRecordSummary[] };

const CATEGORIES = Object.keys(CATEGORY_LABEL) as RecordCategory[];
const SEVERITIES: RecordSeverity[] = ["critical", "attention", "routine"];

const DOT: Record<RecordSeverity, string> = {
  critical: "bg-red-600 ring-red-200 dark:ring-red-900",
  attention: "bg-amber-500 ring-amber-100 dark:ring-amber-900",
  routine: "bg-teal-600 ring-teal-100 dark:ring-teal-900",
};

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${active ? "bg-teal-700 text-white" : "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"}`}
    >
      {children}
    </button>
  );
}

/**
 * Linha do tempo do paciente: registros agrupados por mês, com filtros por
 * categoria e gravidade e busca no texto das notas. Os filtros ficam só na
 * memória da tela (o termo buscado é dado de saúde: nunca vai para a URL).
 */
export function RecordList({ onFiltersChange }: { onFiltersChange?: (f: RecordFilters, records: MedicalRecordSummary[]) => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [categories, setCategories] = useState<RecordCategory[]>([]);
  const [severities, setSeverities] = useState<RecordSeverity[]>([]);
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // Recarrega quando gravações offline são enviadas ou a conexão volta.
  useEffect(() => {
    const reload = () => setReloadKey((k) => k + 1);
    window.addEventListener(DRAFTS_CHANGED, reload);
    window.addEventListener("online", reload);
    return () => {
      window.removeEventListener(DRAFTS_CHANGED, reload);
      window.removeEventListener("online", reload);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const filters: RecordFilters = { categories, severities, query };
    listRecords(filters)
      .then((records) => {
        if (!active) return;
        setState({ kind: "ready", records });
        onFiltersChange?.(filters, records);
      })
      .catch((err) => active && setState({ kind: "error", message: err instanceof UserFacingError ? err.message : "Erro inesperado." }));
    return () => {
      active = false;
    };
  }, [categories, severities, query, onFiltersChange, reloadKey]);

  const filtering = categories.length > 0 || severities.length > 0 || query !== "";

  function search(e: FormEvent) {
    e.preventDefault();
    setQuery(draftQuery.trim());
  }

  function clear() {
    setCategories([]);
    setSeverities([]);
    setDraftQuery("");
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={search} role="search" className="flex gap-2">
        <input
          type="search"
          aria-label="Buscar nos registros"
          placeholder="Buscar (ex.: dor de cabeça)"
          maxLength={100}
          value={draftQuery}
          onChange={(e) => setDraftQuery(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button type="submit" className="rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          Buscar
        </button>
      </form>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Filtrar por gravidade">
        {SEVERITIES.map((s) => (
          <Chip key={s} active={severities.includes(s)} onClick={() => setSeverities((v) => toggle(v, s))}>
            {SEVERITY_LABEL[s]}
          </Chip>
        ))}
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Filtrar por categoria">
        {CATEGORIES.map((c) => (
          <Chip key={c} active={categories.includes(c)} onClick={() => setCategories((v) => toggle(v, c))}>
            {CATEGORY_LABEL[c]}
          </Chip>
        ))}
      </div>
      {filtering ? (
        <button type="button" onClick={clear} className="self-start text-sm text-teal-700 dark:text-teal-400">
          Limpar filtros
        </button>
      ) : null}

      {state.kind === "loading" ? (
        <div className="py-8">
          <Spinner label="Carregando registros…" />
        </div>
      ) : state.kind === "error" ? (
        <p role="alert" className="py-8 text-sm text-red-700 dark:text-red-400">
          {typeof navigator !== "undefined" && !navigator.onLine
            ? "Sem internet: os registros aparecem quando a conexão voltar."
            : state.message}
        </p>
      ) : state.records.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          {filtering
            ? "Nenhum registro com esses filtros."
            : "Nenhum registro ainda. Toque em Gravar e conte como foi a consulta ou o que está sentindo."}
        </div>
      ) : (
        <Timeline records={state.records} />
      )}
    </div>
  );
}

function Timeline({ records }: { records: MedicalRecordSummary[] }) {
  const critical = records.filter((r) => r.severity === "critical").length;
  return (
    <>
      {critical > 0 ? (
        <p role="status" className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white">
          ⚠ {critical} {critical === 1 ? "registro com alerta" : "registros com alerta"}
        </p>
      ) : null}
      {groupByMonth(records).map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h2 className="sticky top-14 z-[5] -mx-4 bg-zinc-50/95 px-4 py-2 text-sm font-semibold text-zinc-600 first-letter:uppercase backdrop-blur dark:bg-zinc-950/95 dark:text-zinc-400">
            {group.label}
          </h2>
          <ol className="relative ml-2 flex flex-col gap-3 border-l-2 border-zinc-200 pl-5 dark:border-zinc-800">
            {group.items.map((r) => (
              <li key={r.id} className="relative">
                <span aria-hidden className={`absolute -left-[1.68rem] top-5 h-3 w-3 rounded-full ring-4 ${DOT[r.severity]}`} />
                <RecordCard record={r} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
