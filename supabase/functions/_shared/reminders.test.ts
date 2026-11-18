import assert from "node:assert/strict";
import { test } from "node:test";
import { DISCREET_BODY, dosePayload, timingSafeEqual, type DueDose } from "./reminders.ts";

const dose: DueDose = {
  medication_id: "7b7c88d4-bf8a-488c-a0fe-8b9315aa36d9",
  user_id: "u",
  name: "Losartana",
  dosage: "50 mg",
  scheduled_for: "2026-11-18 20:00:00+00",
  privacy: "discreet",
};

test("modo discreto não revela o remédio", () => {
  const p = dosePayload(dose);
  assert.equal(p.body, DISCREET_BODY);
  assert.ok(!JSON.stringify({ title: p.title, body: p.body }).includes("Losartana"));
  assert.deepEqual(p.dose, { medicationId: dose.medication_id, scheduledFor: "2026-11-18T20:00:00.000Z" });
  assert.equal(p.url, "medicamentos/");
  assert.equal(p.tag, `dose-${dose.medication_id}`);
});

test("modo detalhado mostra nome e dosagem", () => {
  assert.equal(dosePayload({ ...dose, privacy: "detailed" }).body, "Hora de tomar Losartana — 50 mg.");
  assert.equal(dosePayload({ ...dose, privacy: "detailed", dosage: null }).body, "Hora de tomar Losartana.");
});

test("timingSafeEqual", () => {
  assert.equal(timingSafeEqual("segredo-123", "segredo-123"), true);
  assert.equal(timingSafeEqual("segredo-123", "segredo-124"), false);
  assert.equal(timingSafeEqual("segredo", "segredo-123"), false);
  assert.equal(timingSafeEqual("", ""), true);
});
