/** Agrupamento da linha do tempo (puro, testável no Node). */

export interface TimelineGroup<T> {
  key: string; // "2026-11"
  label: string; // "novembro de 2026"
  items: T[];
}

const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });

/** Agrupa por mês (no fuso do aparelho), mantendo a ordem recebida. */
export function groupByMonth<T extends { recorded_at: string }>(items: T[]): TimelineGroup<T>[] {
  const groups: TimelineGroup<T>[] = [];
  for (const item of items) {
    const d = new Date(item.recorded_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = { key, label: monthLabel.format(d), items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/** Liga/desliga um valor numa lista de filtros. */
export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
