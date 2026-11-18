"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { listRecords, UserFacingError } from "@/lib/records";
import type { MedicalRecordSummary } from "@/lib/types";
import { RecordCard } from "./record-card";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; records: MedicalRecordSummary[] };

export function RecordList() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    listRecords()
      .then((records) => active && setState({ kind: "ready", records }))
      .catch((err) =>
        active &&
        setState({ kind: "error", message: err instanceof UserFacingError ? err.message : "Erro inesperado." }),
      );
    return () => {
      active = false;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="py-12">
        <Spinner label="Carregando registros…" />
      </div>
    );
  }
  if (state.kind === "error") {
    return <p role="alert" className="py-12 text-sm text-red-700 dark:text-red-400">{state.message}</p>;
  }
  if (state.records.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        Nenhum registro ainda. Toque em <strong>Gravar</strong> e conte como foi a consulta ou o que está sentindo.
      </div>
    );
  }

  const critical = state.records.filter((r) => r.severity === "critical").length;
  return (
    <div className="flex flex-col gap-3">
      {critical > 0 ? (
        <p role="status" className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white">
          ⚠ {critical} {critical === 1 ? "registro com alerta" : "registros com alerta"}
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {state.records.map((r) => (
          <li key={r.id}>
            <RecordCard record={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}
