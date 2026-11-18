import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, pdfSafe, reportFilename } from "./report.ts";
import type { MedicalRecord, Medication } from "./types.ts";

const record = (over: Partial<MedicalRecord> = {}): MedicalRecord => ({
  id: "r1",
  title: "Dor no peito",
  recorded_at: "2026-11-18T15:00:00Z",
  category: "symptom",
  severity: "critical",
  status: "ready",
  chief_complaint: "Dor em aperto",
  history: "",
  observations: null,
  plan: "Procurar PS",
  transcript: "não deve ir ao relatório",
  icd10_codes: [{ code: "R07.4", description: "Dor torácica" }],
  alert_signs: ["dor aos esforços"],
  follow_up_in_days: 7,
  follow_up_date: "2026-11-25",
  audio_path: null,
  audio_duration_s: null,
  ai_provider: "gemini",
  processed_at: null,
  ...over,
});

const med: Medication = {
  id: "m1", name: "Losartana", dosage: "50 mg", instructions: null, interval_hours: 24, duration_days: null,
  starts_at: "2026-11-18T11:00:00Z", ends_at: null, next_dose_at: "2026-11-19T11:00:00Z", source: "ai", is_active: true,
  notifications_enabled: false,
};

test("pdfSafe mantém acentos e troca o que a fonte padrão não tem", () => {
  assert.equal(pdfSafe("Conduta — “repouso” ✓ ação…"), 'Conduta - "repouso"  ação...');
  assert.equal(pdfSafe("çãéíõú"), "çãéíõú");
});

test("buildReport: medicamentos ativos, seções, alerta e sem transcrição", () => {
  const doc = buildReport({
    records: [record(), record({ id: "r2", severity: "routine", status: "draft", chief_complaint: null, plan: null, icd10_codes: [], alert_signs: [], follow_up_date: null, title: null })],
    medications: [med, { ...med, id: "m2", name: "Antigo", is_active: false }],
    email: "a@b.com",
    filtersDescription: "Alerta",
    generatedAt: new Date("2026-11-18T18:00:00Z"),
  });
  assert.equal(doc.sections[0].heading, "Medicamentos em uso");
  assert.deepEqual(doc.sections[0].blocks.map((b) => b.label), ["Losartana (50 mg)"]);
  assert.ok(doc.sections[1].alert);
  assert.deepEqual(doc.sections[1].blocks.map((b) => b.label), [
    "Gravidade", "Sinais de alerta", "Queixa principal", "Conduta", "CID-10 (sugestões)", "Retorno",
  ]);
  assert.match(doc.sections[2].heading, /Registro sem título/);
  assert.equal(doc.sections[2].blocks[0].text, "Nota ainda não processada pela IA.");
  assert.ok(doc.meta.some((m) => m.includes("2 registros (filtro: Alerta)")));
  assert.ok(doc.meta.some((m) => m.startsWith("ATENÇÃO: 1 registro com alerta")));
  assert.ok(!JSON.stringify(doc).includes("não deve ir ao relatório"), "transcrição bruta fica fora");
});

test("reportFilename não leva dado clínico", () => {
  assert.equal(reportFilename(new Date("2026-11-18T18:00:00Z")), "klin-relatorio-2026-11-18.pdf");
});
