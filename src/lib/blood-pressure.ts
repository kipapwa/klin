/**
 * Pressão arterial: validação, classificação, resumo do período e relatório.
 * Puro (testável no Node). Dados em `bp_readings` (lib/pressure.ts).
 *
 * Classificação da Diretriz Brasileira de Hipertensão Arterial (SBC, 2020),
 * para medida no consultório: vale a pior das duas (máxima ou mínima).
 */
import type { ReportBlock, ReportDoc, ReportSection } from "./report.ts";

export interface BpReading {
  id: string;
  measured_at: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  note: string | null;
}

export interface BpInput {
  systolic: number;
  diastolic: number;
  pulse: number | null;
  note: string | null;
  measuredAt: string;
}

export const BP_LIMITS = {
  systolic: [50, 300],
  diastolic: [30, 200],
  pulse: [20, 250],
} as const;
export const MAX_NOTE_CHARS = 300;
export const PRESSURE_PERIODS = [7, 30, 90] as const;

/** Tom = cor + ícone na tela (sempre com o texto junto). */
export type BpTone = "good" | "warning" | "serious" | "critical";

export interface BpLevel {
  key: "low" | "optimal" | "normal" | "prehypertension" | "stage1" | "stage2" | "stage3";
  label: string;
  tone: BpTone;
}

const LEVELS: Record<BpLevel["key"], BpLevel> = {
  low: { key: "low", label: "Baixa", tone: "warning" },
  optimal: { key: "optimal", label: "Ótima", tone: "good" },
  normal: { key: "normal", label: "Normal", tone: "good" },
  prehypertension: { key: "prehypertension", label: "Pré-hipertensão", tone: "warning" },
  stage1: { key: "stage1", label: "Alta (estágio 1)", tone: "serious" },
  stage2: { key: "stage2", label: "Alta (estágio 2)", tone: "serious" },
  stage3: { key: "stage3", label: "Muito alta (estágio 3)", tone: "critical" },
};

const ORDER: BpLevel["key"][] = ["optimal", "normal", "prehypertension", "stage1", "stage2", "stage3"];

function bySystolic(s: number): BpLevel["key"] {
  if (s >= 180) return "stage3";
  if (s >= 160) return "stage2";
  if (s >= 140) return "stage1";
  if (s >= 130) return "prehypertension";
  if (s >= 120) return "normal";
  return "optimal";
}

function byDiastolic(d: number): BpLevel["key"] {
  if (d >= 110) return "stage3";
  if (d >= 100) return "stage2";
  if (d >= 90) return "stage1";
  if (d >= 85) return "prehypertension";
  if (d >= 80) return "normal";
  return "optimal";
}

export function classify(systolic: number, diastolic: number): BpLevel {
  const worst = Math.max(ORDER.indexOf(bySystolic(systolic)), ORDER.indexOf(byDiastolic(diastolic)));
  // Baixa só quando nada está alto (ex.: 85/55).
  if (worst <= 1 && (systolic < 90 || diastolic < 60)) return LEVELS.low;
  return LEVELS[ORDER[worst]];
}

/** Acima do limite de hipertensão (140/90). */
export const isHigh = (r: Pick<BpReading, "systolic" | "diastolic">) => r.systolic >= 140 || r.diastolic >= 90;

/** Só números inteiros de até 3 dígitos. */
function parseNumber(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  return Number(t);
}

/** Campos da tela → medição validada (ou a mensagem para a pessoa). */
export function parseReading(
  fields: { systolic: string; diastolic: string; pulse: string; note: string },
  measuredAt: string,
): { value: BpInput } | { error: string } {
  const s = parseNumber(fields.systolic);
  const d = parseNumber(fields.diastolic);
  if (s === null) return { error: "Escreva a pressão máxima (ex.: 120)." };
  if (d === null) return { error: "Escreva a pressão mínima (ex.: 80)." };
  if (s < 30 && d < 20) {
    return { error: `Use mmHg: ${s} por ${d} se escreve ${s * 10} e ${d * 10}.` };
  }
  if (s < BP_LIMITS.systolic[0] || s > BP_LIMITS.systolic[1]) return { error: "A máxima deve ficar entre 50 e 300." };
  if (d < BP_LIMITS.diastolic[0] || d > BP_LIMITS.diastolic[1]) return { error: "A mínima deve ficar entre 30 e 200." };
  if (s <= d) return { error: "A máxima precisa ser maior que a mínima. Confira se não ficaram trocadas." };
  let pulse: number | null = null;
  if (fields.pulse.trim()) {
    pulse = parseNumber(fields.pulse);
    if (pulse === null || pulse < BP_LIMITS.pulse[0] || pulse > BP_LIMITS.pulse[1]) {
      return { error: "Os batimentos devem ficar entre 20 e 250 (ou deixe em branco)." };
    }
  }
  const note = fields.note.trim().slice(0, MAX_NOTE_CHARS) || null;
  return { value: { systolic: s, diastolic: d, pulse, note, measuredAt } };
}

/** Medições do período (desde `now - days`), da mais recente para a mais antiga. */
export function inPeriod(readings: BpReading[], days: number, now: number): BpReading[] {
  const since = now - days * 86_400_000;
  return readings
    .filter((r) => Date.parse(r.measured_at) >= since)
    .sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at));
}

export interface BpSummary {
  count: number;
  avgSystolic: number;
  avgDiastolic: number;
  avgPulse: number | null;
  highCount: number;
  max: BpReading;
  min: BpReading;
  level: BpLevel;
}

export function summarize(readings: BpReading[]): BpSummary | null {
  if (readings.length === 0) return null;
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const pulses = readings.map((r) => r.pulse).filter((p): p is number => p !== null);
  const avgSystolic = avg(readings.map((r) => r.systolic));
  const avgDiastolic = avg(readings.map((r) => r.diastolic));
  const byLoad = [...readings].sort((a, b) => b.systolic - a.systolic || b.diastolic - a.diastolic);
  return {
    count: readings.length,
    avgSystolic,
    avgDiastolic,
    avgPulse: pulses.length ? avg(pulses) : null,
    highCount: readings.filter(isHigh).length,
    max: byLoad[0],
    min: byLoad[byLoad.length - 1],
    level: classify(avgSystolic, avgDiastolic),
  };
}

/** Faixa do eixo vertical (múltiplos de 20), sempre mostrando as linhas de 140 e 90. */
export function chartDomain(readings: BpReading[]): [number, number] {
  const lows = readings.map((r) => r.diastolic);
  const highs = readings.map((r) => r.systolic);
  const lo = Math.min(80, ...lows) - 10;
  const hi = Math.max(150, ...highs) + 10;
  return [Math.max(0, Math.floor(lo / 20) * 20), Math.ceil(hi / 20) * 20];
}

export const bpText = (r: Pick<BpReading, "systolic" | "diastolic">) => `${r.systolic}/${r.diastolic}`;

function formatter(timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Relatório (o mesmo conteúdo da prévia, do PDF e do que vai para a IA). */
export function buildPressureReport(input: {
  readings: BpReading[];
  days: number;
  email: string | null;
  generatedAt: Date;
  timeZone: string;
}): ReportDoc {
  const fmt = formatter(input.timeZone);
  const day = new Intl.DateTimeFormat("pt-BR", { timeZone: input.timeZone, day: "2-digit", month: "2-digit", year: "numeric" });
  const now = input.generatedAt.getTime();
  const list = inPeriod(input.readings, input.days, now);
  const summary = summarize(list);
  const since = new Date(now - input.days * 86_400_000);

  const sections: ReportSection[] = [];
  if (summary) {
    const blocks: ReportBlock[] = [
      { label: "Medições", text: String(summary.count) },
      { label: "Média", text: `${summary.avgSystolic}/${summary.avgDiastolic} mmHg (${summary.level.label})` },
      ...(summary.avgPulse !== null ? [{ label: "Batimentos (média)", text: `${summary.avgPulse} bpm` }] : []),
      { label: "Maior", text: `${bpText(summary.max)} mmHg em ${fmt.format(new Date(summary.max.measured_at))}` },
      { label: "Menor", text: `${bpText(summary.min)} mmHg em ${fmt.format(new Date(summary.min.measured_at))}` },
      { label: "Acima de 140/90", text: `${summary.highCount} de ${summary.count}` },
    ];
    sections.push({ heading: "Resumo do período", blocks });
    sections.push({
      heading: "Medições (mais recente primeiro)",
      blocks: list.map((r) => {
        const level = classify(r.systolic, r.diastolic);
        const parts = [`${bpText(r)} mmHg`, r.pulse !== null ? `${r.pulse} bpm` : null, level.label, r.note].filter(Boolean);
        return { label: fmt.format(new Date(r.measured_at)), text: parts.join(" · ") };
      }),
    });
  } else {
    sections.push({ heading: "Sem medições no período", blocks: [{ text: "Nenhuma medição de pressão registrada nesses dias." }] });
  }

  return {
    title: "Relatório de pressão arterial",
    meta: [
      `Período: ${day.format(since)} a ${day.format(input.generatedAt)} (últimos ${input.days} dias)`,
      ...(input.email ? [`Conta: ${input.email}`] : []),
      `Gerado em ${fmt.format(input.generatedAt)}`,
      "Classificação: Diretriz Brasileira de Hipertensão Arterial 2020 (medida no consultório).",
    ],
    sections,
    footer: "Klin · medições anotadas pelo próprio paciente. Não substitui avaliação médica.",
  };
}

export function pressureReportFilename(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `klin-pressao-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.pdf`;
}
