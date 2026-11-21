import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMedicationReport, doseHistory, medicationReportFilename, type ReportLog } from "./medication-report.ts";
import type { Medication } from "./types.ts";

const TZ = "America/Sao_Paulo";
// 21/11/2026 12:00 em São Paulo (15:00 UTC)
const NOW = new Date("2026-11-21T15:00:00Z");

const losartana: Medication = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Losartana",
  dosage: "50 mg",
  instructions: "em jejum",
  interval_hours: 24,
  schedule_type: "times",
  dose_times: ["08:00"],
  timezone: TZ,
  duration_days: null,
  starts_at: "2026-11-18T10:00:00Z", // 18/11 07:00
  ends_at: null,
  next_dose_at: "2026-11-22T11:00:00Z",
  source: "manual",
  is_active: true,
  notifications_enabled: true,
};

const log = (day: string, status: ReportLog["status"], source: ReportLog["source"] = "app"): ReportLog => ({
  id: crypto.randomUUID(),
  medication_id: losartana.id,
  scheduled_for: `2026-11-${day}T11:00:00.000Z`,
  status,
  taken_at: status === "taken" ? `2026-11-${day}T11:05:00.000Z` : null,
  source,
});

test("histórico: doses previstas com tomada, pulada e sem registro (mais recente primeiro)", () => {
  const logs = [log("18", "taken"), log("19", "skipped"), log("21", "taken", "notification")];
  const h = doseHistory(losartana, logs, NOW.getTime() - 7 * 86_400_000, NOW.getTime());
  assert.deepEqual(
    h.map((x) => [new Date(x.at).toISOString().slice(0, 10), x.status]),
    [
      ["2026-11-21", "taken"],
      ["2026-11-20", "none"],
      ["2026-11-19", "skipped"],
      ["2026-11-18", "taken"],
    ],
  );
});

test("relatório: adesão, histórico legível e sem remédio fora do período", () => {
  const antigo: Medication = { ...losartana, id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Amoxicilina", starts_at: "2026-09-01T10:00:00Z", ends_at: "2026-09-08T10:00:00Z", is_active: false, next_dose_at: null };
  const doc = buildMedicationReport({
    medications: [antigo, losartana],
    logs: [log("18", "taken"), log("19", "skipped"), log("21", "taken", "notification")],
    days: 7,
    email: "pessoa@exemplo.com",
    generatedAt: NOW,
    timeZone: TZ,
  });
  assert.equal(doc.title, "Relatório de remédios");
  assert.equal(doc.meta[0], "Período: 14/11/2026 a 21/11/2026 (últimos 7 dias)");
  assert.equal(doc.sections.length, 1, "Amoxicilina terminou antes do período");
  const s = doc.sections[0];
  assert.equal(s.heading, "Losartana (50 mg) · Em uso");
  const block = (label: string) => s.blocks.find((b) => b.label === label)?.text;
  assert.equal(block("Quando tomar"), "Todos os dias às 08:00");
  assert.equal(block("Instruções"), "em jejum");
  assert.equal(block("Adesão no período"), "2 de 4 doses tomadas (50%)");
  assert.equal(
    block("Histórico de doses"),
    [
      "21/11/2026, 08:00 - Tomada em 21/11/2026, 08:05 (pela notificação)",
      "20/11/2026, 08:00 - Sem registro",
      "19/11/2026, 08:00 - Pulada",
      "18/11/2026, 08:00 - Tomada em 18/11/2026, 08:05",
    ].join("\n"),
  );
  assert.equal(medicationReportFilename(NOW), "klin-remedios-2026-11-21.pdf");
});

test("remédio em uso que começa daqui a pouco entra no relatório (sem doses ainda)", () => {
  const novo: Medication = { ...losartana, id: "cccccccc-0000-4000-8000-000000000003", name: "Vitamina D", starts_at: "2026-11-21T15:05:00Z", next_dose_at: "2026-11-22T11:00:00Z" };
  const doc = buildMedicationReport({ medications: [novo], logs: [], days: 7, email: null, generatedAt: NOW, timeZone: TZ });
  assert.equal(doc.sections[0].heading, "Vitamina D (50 mg) · Em uso");
  assert.equal(doc.sections[0].blocks.find((b) => b.label === "Adesão no período")?.text, "Nenhuma dose prevista no período.");
});

test("sem remédios no período: relatório explica em vez de vir vazio", () => {
  const doc = buildMedicationReport({ medications: [], logs: [], days: 30, email: null, generatedAt: NOW, timeZone: TZ });
  assert.equal(doc.sections[0].heading, "Nenhum remédio no período");
});
