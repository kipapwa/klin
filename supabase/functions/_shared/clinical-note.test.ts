import assert from "node:assert/strict";
import { test } from "node:test";
import { GROQ_JSON_INSTRUCTIONS, parseJsonObject, SYSTEM_PROMPT, validateClinicalNote } from "./clinical-note.ts";

test("parseJsonObject tolera <think> e cercas de código", () => {
  assert.deepEqual(parseJsonObject('<think>pensando {x}</think>```json\n{"title":"a"}\n```'), { title: "a" });
  assert.throws(() => parseJsonObject("[1,2]"));
  assert.throws(() => parseJsonObject("sem json"));
});

test("validateClinicalNote normaliza e corta valores", () => {
  const note = validateClinicalNote({
    title: "  Febre  ",
    category: "inexistente",
    severity: "grave",
    alert_signs: ["", "febre 40°C"],
    chief_complaint: "x".repeat(6000),
    icd10: [
      { code: "r50.9", description: "Febre" },
      { code: "R50.9", description: "duplicado" },
      { code: "invalido", description: "x" },
    ],
    medications: [
      { name: "Dipirona", dosage: "500 mg", interval_hours: "6", duration_days: null, start_time: "8:00", instructions: "" },
      { name: "Amoxicilina", interval_hours: null, duration_days: 0, start_time: "25:00" },
      { name: "", interval_hours: 8 },
    ],
    follow_up_in_days: null,
  });

  assert.equal(note.title, "Febre");
  assert.equal(note.category, "symptom");
  // severity inválida vira routine, mas há sinal de alerta => attention
  assert.equal(note.severity, "attention");
  assert.deepEqual(note.alert_signs, ["febre 40°C"]);
  assert.equal(note.chief_complaint.length, 5000);
  assert.deepEqual(note.icd10, [{ code: "R50.9", description: "Febre" }]);
  assert.equal(note.medications.length, 2);
  assert.deepEqual(note.medications[0], {
    name: "Dipirona", dosage: "500 mg", interval_hours: 6, duration_days: null, start_time: "08:00", instructions: null,
  });
  assert.equal(note.medications[1].interval_hours, null);
  assert.equal(note.medications[1].duration_days, null); // 0 está fora do intervalo
  assert.equal(note.medications[1].start_time, null);
  assert.equal(note.follow_up_in_days, null); // Number(null) seria 0
});

test("validateClinicalNote rejeita resposta sem conteúdo clínico", () => {
  assert.throws(() => validateClinicalNote({ title: "", category: "exam" }));
});

test("validateClinicalNote usa a queixa como título e a transcrição de reserva", () => {
  const note = validateClinicalNote({ chief_complaint: "Dor lombar" }, "texto do whisper");
  assert.equal(note.title, "Dor lombar");
  assert.equal(note.transcript, "texto do whisper");
});

test("categoria Pressão: aceita blood_pressure e o prompt explica os valores", () => {
  const note = validateClinicalNote({ title: "Pressão", category: "blood_pressure", observations: "PA 150/95 mmHg", severity: "attention" });
  assert.equal(note.category, "blood_pressure");
  assert.ok(SYSTEM_PROMPT.includes("blood_pressure (medição de pressão arterial)"));
  assert.ok(SYSTEM_PROMPT.includes('"12 por 8" = 120/80 mmHg'));
  assert.match(GROQ_JSON_INSTRUCTIONS, /"blood_pressure"/);
});
