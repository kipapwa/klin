import assert from "node:assert/strict";
import { test } from "node:test";
import { toDateTimeLocal, validateMedicationForm, type MedicationFormValues } from "./medication-form.ts";

const base: MedicationFormValues = {
  name: " Amoxicilina ",
  dosage: "500 mg",
  instructions: "",
  intervalHours: "8",
  durationDays: "7",
  startsAt: "2026-11-18T08:00",
  notificationsEnabled: true,
};

test("valores válidos são normalizados", () => {
  const r = validateMedicationForm(base);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.name, "Amoxicilina");
  assert.equal(r.value.instructions, null);
  assert.equal(r.value.interval_hours, 8);
  assert.equal(r.value.duration_days, 7);
  assert.equal(r.value.starts_at, new Date("2026-11-18T08:00").toISOString());
});

test("vírgula decimal, uso contínuo", () => {
  const r = validateMedicationForm({ ...base, intervalHours: "0,5", durationDays: " " });
  assert.ok(r.ok && r.value.interval_hours === 0.5 && r.value.duration_days === null);
});

test("erros por campo", () => {
  const r = validateMedicationForm({ ...base, name: "  ", intervalHours: "0", durationDays: "2.5", startsAt: "amanhã" });
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.deepEqual(Object.keys(r.errors).sort(), ["durationDays", "intervalHours", "name", "startsAt"]);
});

test("toDateTimeLocal ida e volta", () => {
  const d = new Date(2026, 10, 18, 9, 5);
  assert.equal(toDateTimeLocal(d), "2026-11-18T09:05");
  assert.equal(new Date(toDateTimeLocal(d)).getTime(), d.getTime());
});
