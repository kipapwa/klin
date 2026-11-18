"use client";

import { useEffect, useRef, useState } from "react";
import { SearchIcon, SlidersIcon, XIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
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

const CATEGORY_ICON: Record<RecordCategory, string> = {
  symptom: "🤒",
  exam: "🧪",
  prescription: "💊",
  follow_up: "📅",
  procedure: "🩺",
};
const CATEGORIES = Object.keys(CATEGORY_ICON) as RecordCategory[];
const SEVERITIES: RecordSeverity[] = ["critical", "attention", "routine"];
const SEVERITY_DOT: Record<RecordSeverity, string> = {
  critical: "bg-red-600",
  attention: "bg-amber-500",
  routine: "bg-teal-600",
};
const SEVERITY_HINT: Record<RecordSeverity, string> = {
  critical: "Sinais de alerta",
  attention: "Acompanhar de perto",
  routine: "Sem sinais de alerta",
};

const TIMELINE_DOT: Record<RecordSeverity, string> = {
  critical: "bg-red-600 ring-red-200 dark:ring-red-900",
  attention: "bg-amber-500 ring-amber-100 dark:ring-amber-900",
  routine: "bg-teal-600 ring-teal-100 dark:ring-teal-900",
};

/**
 * Linha do tempo do paciente: busca enquanto digita, filtros numa folha
 * (gravidade e categoria) e registros agrupados por mês. Os filtros ficam só
 * na memória da tela — o termo buscado é dado de saúde e nunca vai à URL.
 */
export function RecordList({ onFiltersChange }: { onFiltersChange?: (f: RecordFilters, records: MedicalRecordSummary[]) => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [categories, setCategories] = useState<RecordCategory[]>([]);
  const [severities, setSeverities] = useState<RecordSeverity[]>([]);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  // Rascunho dos filtros dentro da folha (aplica ao tocar em "Mostrar").
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftCats, setDraftCats] = useState<RecordCategory[]>([]);
  const [draftSevs, setDraftSevs] = useState<RecordSeverity[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  // Busca enquanto digita (espera 350 ms parado).
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);

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

  const filterCount = categories.length + severities.length;
  const filtering = filterCount > 0 || query !== "";

  function openSheet() {
    setDraftCats(categories);
    setDraftSevs(severities);
    setSheetOpen(true);
  }

  function clearAll() {
    setCategories([]);
    setSeverities([]);
    setText("");
    setQuery("");
  }

  const pill =
    "inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 py-1 pl-3 pr-1.5 text-sm font-medium text-teal-900 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-100";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon size={20} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            ref={searchRef}
            type="search"
            enterKeyHint="search"
            aria-label="Buscar nos registros"
            placeholder="Buscar registros"
            maxLength={100}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setQuery(text.trim());
                searchRef.current?.blur();
              }
            }}
            className="h-12 w-full rounded-2xl border border-zinc-200 bg-white pl-11 pr-10 text-base shadow-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 dark:border-zinc-700 dark:bg-zinc-900 [&::-webkit-search-cancel-button]:hidden"
          />
          {text ? (
            <button
              type="button"
              aria-label="Limpar busca"
              onClick={() => {
                setText("");
                setQuery("");
              }}
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <XIcon size={18} />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={openSheet}
          aria-label={filterCount ? `Filtros (${filterCount} ativos)` : "Filtros"}
          className={`relative flex h-12 shrink-0 items-center gap-2 rounded-2xl border px-4 text-sm font-semibold shadow-sm ${filterCount ? "border-teal-600 bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-100" : "border-zinc-200 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"}`}
        >
          <SlidersIcon size={20} />
          Filtros
          {filterCount ? (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-teal-700 px-1 text-[11px] font-bold text-white">{filterCount}</span>
          ) : null}
        </button>
      </div>

      {filtering ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="Filtros ativos">
          {severities.map((s) => (
            <span key={s} className={pill}>
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${SEVERITY_DOT[s]}`} />
              {SEVERITY_LABEL[s]}
              <button type="button" aria-label={`Remover filtro ${SEVERITY_LABEL[s]}`} onClick={() => setSeverities((v) => v.filter((x) => x !== s))} className="grid h-6 w-6 place-items-center rounded-full hover:bg-teal-100 dark:hover:bg-teal-900">
                <XIcon size={14} />
              </button>
            </span>
          ))}
          {categories.map((c) => (
            <span key={c} className={pill}>
              <span aria-hidden>{CATEGORY_ICON[c]}</span>
              {CATEGORY_LABEL[c]}
              <button type="button" aria-label={`Remover filtro ${CATEGORY_LABEL[c]}`} onClick={() => setCategories((v) => v.filter((x) => x !== c))} className="grid h-6 w-6 place-items-center rounded-full hover:bg-teal-100 dark:hover:bg-teal-900">
                <XIcon size={14} />
              </button>
            </span>
          ))}
          <button type="button" onClick={clearAll} className="px-1 text-sm font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-400">
            Limpar tudo
          </button>
          {state.kind === "ready" ? (
            <span className="ml-auto text-xs text-zinc-500" role="status">
              {state.records.length} {state.records.length === 1 ? "registro" : "registros"}
            </span>
          ) : null}
        </div>
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
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-6 py-10 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-3xl" aria-hidden>
            {filtering ? "🔎" : "🎙️"}
          </span>
          <p className="font-semibold">{filtering ? "Nenhum registro encontrado" : "Nenhum registro ainda"}</p>
          <p className="max-w-xs text-sm text-zinc-600 dark:text-zinc-400">
            {filtering
              ? "Tente outra palavra ou remova algum filtro."
              : "Toque no microfone e conte como foi a consulta ou o que está sentindo."}
          </p>
          {filtering ? (
            <button type="button" onClick={clearAll} className="mt-2 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700">
              Limpar filtros
            </button>
          ) : null}
        </div>
      ) : (
        <Timeline records={state.records} />
      )}

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Filtrar registros">
        <div className="flex flex-col gap-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Gravidade</h3>
            <div className="grid gap-2" role="group" aria-label="Filtrar por gravidade">
              {SEVERITIES.map((s) => {
                const on = draftSevs.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDraftSevs((v) => toggle(v, s))}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left ${on ? "border-teal-600 bg-teal-50 dark:bg-teal-950" : "border-zinc-200 dark:border-zinc-700"}`}
                  >
                    <span aria-hidden className={`h-3.5 w-3.5 rounded-full ${SEVERITY_DOT[s]}`} />
                    <span className="flex-1">
                      <span className="block font-semibold">{SEVERITY_LABEL[s]}</span>
                      <span className="block text-xs text-zinc-500">{SEVERITY_HINT[s]}</span>
                    </span>
                    <span
                      aria-hidden
                      className={`grid h-6 w-6 place-items-center rounded-full border-2 text-xs ${on ? "border-teal-700 bg-teal-700 text-white" : "border-zinc-300 dark:border-zinc-600"}`}
                    >
                      {on ? "✓" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Categoria</h3>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Filtrar por categoria">
              {CATEGORIES.map((c) => {
                const on = draftCats.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDraftCats((v) => toggle(v, c))}
                    className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-sm font-semibold ${on ? "border-teal-600 bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-100" : "border-zinc-200 dark:border-zinc-700"}`}
                  >
                    <span aria-hidden className="text-lg">
                      {CATEGORY_ICON[c]}
                    </span>
                    {CATEGORY_LABEL[c]}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDraftCats([]);
                setDraftSevs([]);
              }}
              className="rounded-xl border border-zinc-300 px-4 py-3 font-medium dark:border-zinc-700"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => {
                setCategories(draftCats);
                setSeverities(draftSevs);
                setSheetOpen(false);
              }}
              className="flex-1 rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white hover:bg-teal-800"
            >
              Mostrar resultados
            </button>
          </div>
        </div>
      </Sheet>
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
          <h2 className="sticky top-16 z-[5] -mx-4 bg-zinc-50/95 px-4 py-2 text-sm font-semibold text-zinc-600 backdrop-blur first-letter:uppercase dark:bg-zinc-950/95 dark:text-zinc-400">
            {group.label}
          </h2>
          <ol className="relative ml-2 flex flex-col gap-3 border-l-2 border-zinc-200 pl-5 dark:border-zinc-800">
            {group.items.map((r) => (
              <li key={r.id} className="relative">
                <span aria-hidden className={`absolute -left-[1.68rem] top-5 h-3 w-3 rounded-full ring-4 ${TIMELINE_DOT[r.severity]}`} />
                <RecordCard record={r} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
