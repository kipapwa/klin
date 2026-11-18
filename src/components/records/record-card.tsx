import Link from "next/link";
import { CATEGORY_LABEL, formatDateTime, SEVERITY_LABEL, STATUS_LABEL } from "@/lib/labels";
import type { MedicalRecordSummary, RecordSeverity } from "@/lib/types";

const CARD_BY_SEVERITY: Record<RecordSeverity, string> = {
  // Alerta: card inteiro em vermelho de alto contraste.
  critical: "bg-red-50 border-2 border-red-500 dark:bg-red-950 dark:border-red-500",
  attention: "bg-white border border-amber-400 dark:bg-zinc-900 dark:border-amber-500",
  routine: "bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800",
};

export function SeverityBadge({ severity }: { severity: RecordSeverity }) {
  if (severity === "routine") return null;
  const critical = severity === "critical";
  return (
    <span
      className={
        critical
          ? "rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white"
          : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100"
      }
    >
      {critical ? "⚠ " : ""}
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function RecordCard({ record }: { record: MedicalRecordSummary }) {
  const pending = record.status !== "ready";
  return (
    <Link
      href={`/registro/?id=${record.id}`}
      className={`block rounded-2xl p-4 shadow-sm transition active:scale-[0.99] ${CARD_BY_SEVERITY[record.severity]}`}
    >
      <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span>{formatDateTime(record.recorded_at)}</span>
        <span aria-hidden>·</span>
        <span>{CATEGORY_LABEL[record.category]}</span>
        <span className="ml-auto">
          <SeverityBadge severity={record.severity} />
        </span>
      </div>
      <h2
        className={`mt-1 font-semibold ${record.severity === "critical" ? "text-red-900 dark:text-red-100" : "text-zinc-900 dark:text-zinc-100"}`}
      >
        {record.title || "Registro sem título"}
      </h2>
      {record.chief_complaint ? (
        <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">{record.chief_complaint}</p>
      ) : null}
      {pending ? (
        <p className={`mt-2 text-xs font-medium ${record.status === "failed" ? "text-red-700 dark:text-red-400" : "text-teal-700 dark:text-teal-400"}`}>
          {STATUS_LABEL[record.status]}
        </p>
      ) : null}
    </Link>
  );
}
