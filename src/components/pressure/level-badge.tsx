import type { BpLevel, BpTone } from "@/lib/blood-pressure";

/** Cor de estado sempre com ícone + texto (nunca só a cor). */
const TONE: Record<BpTone, { icon: string; className: string }> = {
  good: { icon: "✓", className: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  warning: { icon: "!", className: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  serious: { icon: "▲", className: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200" },
  critical: { icon: "⚠", className: "bg-red-600 text-white" },
};

export function LevelBadge({ level, className = "" }: { level: BpLevel; className?: string }) {
  const t = TONE[level.tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${t.className} ${className}`}>
      <span aria-hidden>{t.icon}</span>
      {level.label}
    </span>
  );
}
