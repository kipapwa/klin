"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { downloadReport, type PreparedReport } from "@/lib/export-report";
import { UserFacingError } from "@/lib/records";
import type { ReportDoc } from "@/lib/report";

/**
 * Prévia do relatório na tela antes de baixar o PDF. Mostra o mesmo conteúdo
 * (ReportDoc) que vai para o PDF, como uma folha de papel, com o
 * "Baixar PDF" fixo embaixo.
 *
 * `load` monta o relatório; muda quando `loadKey` muda (ex.: outro período).
 * `controls` aparece acima da prévia (ex.: escolha do período).
 */
export function ReportPreviewSheet({
  open,
  onClose,
  title,
  load,
  loadKey,
  controls,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  load: () => Promise<PreparedReport>;
  loadKey: string;
  controls?: ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {/* Remonta a cada abertura e a cada troca de `loadKey`: busca o relatório de novo. */}
      {open ? <Preview key={loadKey} load={load} onDone={onClose} controls={controls} /> : null}
    </Sheet>
  );
}

function Preview({ load, onDone, controls }: { load: () => Promise<PreparedReport>; onDone: () => void; controls?: ReactNode }) {
  const [report, setReport] = useState<PreparedReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    load().then(
      (r) => alive && setReport(r),
      (err: unknown) => alive && setLoadError(err instanceof UserFacingError ? err.message : "Não foi possível montar o relatório."),
    );
    return () => {
      alive = false;
    };
    // `load` muda a cada renderização do pai; quem pede nova busca é o `key` (loadKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!report) return;
    setSaving(true);
    setSaveError(null);
    try {
      await downloadReport(report);
      onDone();
    } catch {
      setSaveError("Não foi possível gerar o PDF.");
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {controls}
      {loadError ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {loadError}
        </p>
      ) : report ? (
        <ReportPaper doc={report.doc} />
      ) : (
        <div className="py-10">
          <Spinner label="Montando o relatório…" />
        </div>
      )}

      <div className="sticky -bottom-5 -mx-5 -mb-5 flex flex-col gap-2 border-t border-zinc-100 bg-white px-5 pb-5 pt-3 dark:border-zinc-800 dark:bg-zinc-900">
        {saveError ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {saveError}
          </p>
        ) : null}
        <button
          type="button"
          onClick={save}
          disabled={!report || saving}
          className="rounded-2xl bg-teal-700 px-4 py-3.5 text-lg font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
        >
          {saving ? "Gerando PDF…" : "Baixar PDF"}
        </button>
      </div>
    </div>
  );
}

/** O relatório como uma folha de papel (texto puro: nada vira HTML). */
export function ReportPaper({ doc }: { doc: ReportDoc }) {
  return (
    <article aria-label="Prévia do relatório" className="rounded-xl border border-zinc-200 bg-white p-4 text-zinc-900 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100">
      <h3 className="text-lg font-bold text-teal-700 dark:text-teal-400">{doc.title}</h3>
      <div className="mt-1 flex flex-col text-xs text-zinc-500">
        {doc.meta.map((line, i) => (
          <p key={i} className={line.startsWith("ATENÇÃO") ? "font-semibold text-red-700 dark:text-red-400" : ""}>
            {line}
          </p>
        ))}
      </div>
      {doc.sections.map((section, i) => (
        <section key={i} className={`mt-4 border-t pt-3 ${section.alert ? "border-t-2 border-red-500" : "border-zinc-200 dark:border-zinc-700"}`}>
          <h4 className={`text-sm font-bold ${section.alert ? "text-red-800 dark:text-red-300" : ""}`}>{section.heading}</h4>
          {section.blocks.map((block, j) => (
            <div key={j} className="mt-2">
              {block.label ? <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{block.label}</p> : null}
              <p className="whitespace-pre-line break-words text-sm leading-relaxed">{block.text}</p>
            </div>
          ))}
        </section>
      ))}
      <p className="mt-4 border-t border-zinc-200 pt-2 text-[11px] text-zinc-500 dark:border-zinc-700">{doc.footer}</p>
    </article>
  );
}
