import assert from "node:assert/strict";
import { test } from "node:test";
import { fromLocalInputs, toLocalInputs } from "./record-edit.ts";

const NOW = new Date(2026, 10, 19, 10, 0).getTime();

test("ida e volta entre ISO e os campos de dia/horário", () => {
  const iso = new Date(2026, 10, 18, 22, 2).toISOString();
  const inputs = toLocalInputs(iso);
  assert.deepEqual(inputs, { date: "2026-11-18", time: "22:02" });
  assert.deepEqual(fromLocalInputs(inputs.date, inputs.time, NOW), { iso });
});

test("data inexistente, vazia ou fora do limite é recusada", () => {
  assert.deepEqual(fromLocalInputs("2026-02-31", "10:00", NOW), { error: "Data inválida." });
  assert.deepEqual(fromLocalInputs("", "10:00", NOW), { error: "Escolha o dia." });
  assert.deepEqual(fromLocalInputs("2026-11-18", "", NOW), { error: "Escolha o horário." });
  assert.deepEqual(fromLocalInputs("1899-12-31", "10:00", NOW), { error: "Escolha uma data a partir de 1900." });
  assert.deepEqual(fromLocalInputs("2028-01-01", "10:00", NOW), { error: "A data pode ser no máximo 1 ano à frente." });
});

test("data passada e retorno no ano seguinte são aceitos", () => {
  assert.ok("iso" in fromLocalInputs("2020-03-05", "08:30", NOW));
  assert.ok("iso" in fromLocalInputs("2027-06-01", "14:00", NOW));
});
