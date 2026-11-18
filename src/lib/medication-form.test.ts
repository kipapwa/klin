import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeTimes, toDateTimeLocal, validateMedicationForm, type MedicationFormValues } from "./medication-form.ts";

const SP = "America/Sao_Paulo";
const base: MedicationFormValues = {
  name: " Amoxicilina ",
  dosage: "500 mg",
  instructions: "",
  mode: "times",
  times: ["20:00", "08:00"],
  startDate: "2026-11-18",
  intervalHours: "8",
  startsAt: "2026-11-18T08:00",
  durationDays: "7",
  notificationsEnabled: true,
};

test("horários fixos: ordena, começa à meia-noite local e guarda o fuso", () => {
  const r = validateMedicationForm(base, SP, Date.parse("2026-11-10T12:00:00Z")); // início no futuro
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.name, "Amoxicilina");
  assert.equal(r.value.schedule_type, "times");
  assert.deepEqual(r.value.dose_times, ["08:00", "20:00"]);
  assert.equal(r.value.starts_at, "2026-11-18T03:00:00.000Z");
  assert.equal(r.value.timezone, SP);
  assert.equal(r.value.duration_days, 7);
  assert.equal(r.value.instructions, null);
});

test("horários fixos com início hoje: começa agora (menos 1 h), não à meia-noite", () => {
  const now = Date.parse("2026-11-18T20:00:00Z"); // 17:00 em São Paulo
  const r = validateMedicationForm(base, SP, now);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.starts_at, "2026-11-18T19:00:00.000Z");
});

test("horários fixos: exige ao menos um horário e data", () => {
  const r = validateMedicationForm({ ...base, times: [], startDate: "" }, SP);
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.deepEqual(Object.keys(r.errors).sort(), ["startDate", "times"]);
});

test("a cada X horas: vírgula decimal e uso contínuo", () => {
  const r = validateMedicationForm({ ...base, mode: "interval", intervalHours: "0,5", durationDays: " " }, SP);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.schedule_type, "interval");
  assert.equal(r.value.interval_hours, 0.5);
  assert.equal(r.value.duration_days, null);
  assert.deepEqual(r.value.dose_times, []);
  assert.equal(r.value.starts_at, new Date("2026-11-18T08:00").toISOString());
});

test("erros por campo", () => {
  const r = validateMedicationForm({ ...base, mode: "interval", name: "  ", intervalHours: "0", durationDays: "2.5", startsAt: "amanhã" }, SP);
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.deepEqual(Object.keys(r.errors).sort(), ["durationDays", "intervalHours", "name", "startsAt"]);
});

test("normalizeTimes e toDateTimeLocal", () => {
  assert.deepEqual(normalizeTimes(["20:00", "08:00", "08:00", "99:00"]), ["08:00", "20:00"]);
  const d = new Date(2026, 10, 18, 9, 5);
  assert.equal(toDateTimeLocal(d), "2026-11-18T09:05");
});
