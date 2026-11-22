import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPressureReport, chartDomain, classify, inPeriod, parseReading, summarize, type BpReading } from "./blood-pressure.ts";

const AT = "2026-11-22T11:00:00.000Z";
const fields = (systolic: string, diastolic: string, pulse = "", note = "") => ({ systolic, diastolic, pulse, note });

test("classificação pela pior das duas (Diretriz Brasileira 2020)", () => {
  assert.equal(classify(115, 75).key, "optimal");
  assert.equal(classify(125, 78).key, "normal");
  assert.equal(classify(118, 86).key, "prehypertension");
  assert.equal(classify(135, 92).key, "stage1");
  assert.equal(classify(165, 85).key, "stage2");
  assert.equal(classify(150, 112).key, "stage3");
  assert.equal(classify(185, 95).tone, "critical");
  assert.equal(classify(85, 55).key, "low");
  assert.equal(classify(145, 58).key, "stage1", "alta vence baixa");
});

test("campos da tela: valida faixa, ordem, batimentos e cmHg", () => {
  assert.deepEqual(parseReading(fields("128", "82", "70", " manhã "), AT), {
    value: { systolic: 128, diastolic: 82, pulse: 70, note: "manhã", measuredAt: AT },
  });
  assert.deepEqual(parseReading(fields("120", "80"), AT), { value: { systolic: 120, diastolic: 80, pulse: null, note: null, measuredAt: AT } });
  assert.match((parseReading(fields("12", "8"), AT) as { error: string }).error, /120 e 80/);
  assert.match((parseReading(fields("80", "120"), AT) as { error: string }).error, /maior que a mínima/);
  assert.match((parseReading(fields("", "80"), AT) as { error: string }).error, /máxima/);
  assert.match((parseReading(fields("120", "8a"), AT) as { error: string }).error, /mínima/);
  assert.match((parseReading(fields("400", "80"), AT) as { error: string }).error, /entre 50 e 300/);
  assert.match((parseReading(fields("120", "80", "5"), AT) as { error: string }).error, /batimentos/i);
});

const r = (id: string, measured_at: string, systolic: number, diastolic: number, pulse: number | null = null): BpReading => ({
  id, measured_at, systolic, diastolic, pulse, note: null,
});
const NOW = Date.parse("2026-11-22T12:00:00.000Z");
const readings = [
  r("a", "2026-11-22T10:00:00.000Z", 150, 95, 80),
  r("b", "2026-11-20T10:00:00.000Z", 120, 80, 70),
  r("c", "2026-11-18T10:00:00.000Z", 130, 85),
  r("old", "2026-10-01T10:00:00.000Z", 190, 120),
];

test("período, médias, maior/menor e quantas acima de 140/90", () => {
  const week = inPeriod(readings, 7, NOW);
  assert.deepEqual(week.map((x) => x.id), ["a", "b", "c"]);
  const s = summarize(week)!;
  assert.equal(s.count, 3);
  assert.equal(s.avgSystolic, 133);
  assert.equal(s.avgDiastolic, 87);
  assert.equal(s.avgPulse, 75);
  assert.equal(s.highCount, 1);
  assert.equal(s.max.id, "a");
  assert.equal(s.min.id, "b");
  assert.equal(s.level.key, "prehypertension");
  assert.equal(summarize([]), null);
});

test("eixo do gráfico em múltiplos de 20, sempre com 90 e 140 visíveis", () => {
  assert.deepEqual(chartDomain([r("x", AT, 120, 80)]), [60, 160]);
  assert.deepEqual(chartDomain([r("x", AT, 210, 125), r("y", AT, 95, 55)]), [40, 220]);
});

test("relatório: resumo e medições do período, com classificação", () => {
  const doc = buildPressureReport({ readings, days: 7, email: "a@b.c", generatedAt: new Date(NOW), timeZone: "America/Sao_Paulo" });
  assert.equal(doc.title, "Relatório de pressão arterial");
  assert.ok(doc.meta[0].includes("últimos 7 dias"));
  const text = JSON.stringify(doc);
  assert.ok(text.includes("133/87 mmHg (Pré-hipertensão)"));
  assert.ok(text.includes("150/95 mmHg · 80 bpm · Alta (estágio 1)"));
  assert.ok(text.includes("22/11/2026, 07:00"), "fuso de São Paulo");
  assert.ok(!text.includes("190/120"), "fora do período");
  const empty = buildPressureReport({ readings: [], days: 30, email: null, generatedAt: new Date(NOW), timeZone: "UTC" });
  assert.equal(empty.sections[0].heading, "Sem medições no período");
});
