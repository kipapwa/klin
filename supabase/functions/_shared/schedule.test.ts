import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, localDate, medicationStart, safeTimeZone, zonedToUtc } from "./schedule.ts";

test("zonedToUtc em São Paulo (UTC-3)", () => {
  assert.equal(zonedToUtc("2026-11-18", "08:00", "America/Sao_Paulo").toISOString(), "2026-11-18T11:00:00.000Z");
});

test("zonedToUtc respeita horário de verão (Nova York)", () => {
  assert.equal(zonedToUtc("2026-07-01", "08:00", "America/New_York").toISOString(), "2026-07-01T12:00:00.000Z");
  assert.equal(zonedToUtc("2026-12-01", "08:00", "America/New_York").toISOString(), "2026-12-01T13:00:00.000Z");
});

test("localDate usa o fuso, não o UTC", () => {
  // 01:30 UTC do dia 19 ainda é dia 18 em São Paulo
  assert.equal(localDate(new Date("2026-11-19T01:30:00Z"), "America/Sao_Paulo"), "2026-11-18");
});

test("addDays atravessa mês e ano", () => {
  assert.equal(addDays("2026-12-20", 30), "2027-01-19");
});

test("medicationStart: hoje se o horário ainda não passou, senão amanhã", () => {
  const from = new Date("2026-11-18T13:00:00Z"); // 10:00 em São Paulo
  assert.equal(medicationStart(from, "14:00", "America/Sao_Paulo").toISOString(), "2026-11-18T17:00:00.000Z");
  assert.equal(medicationStart(from, "08:00", "America/Sao_Paulo").toISOString(), "2026-11-19T11:00:00.000Z");
  assert.equal(medicationStart(from, null, "America/Sao_Paulo"), from);
});

test("safeTimeZone cai no padrão com fuso inválido", () => {
  assert.equal(safeTimeZone("Marte/Base"), "America/Sao_Paulo");
  assert.equal(safeTimeZone(null), "America/Sao_Paulo");
  assert.equal(safeTimeZone("Europe/Lisbon"), "Europe/Lisbon");
});
