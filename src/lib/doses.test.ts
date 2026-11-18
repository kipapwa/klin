import assert from "node:assert/strict";
import { test } from "node:test";
import { adherence, doseState, dueSlot, isPendingSlot, type DoseSchedule } from "./doses.ts";

const H = 3_600_000;
const T0 = Date.parse("2026-11-18T08:00:00Z");
const iso = (t: number) => new Date(t).toISOString();

function med(over: Partial<DoseSchedule> = {}): DoseSchedule {
  return { starts_at: iso(T0), interval_hours: 8, ends_at: null, next_dose_at: iso(T0), is_active: true, ...over };
}

test("dueSlot: dose no horário, adiantada (até 1h) e ainda não devida", () => {
  assert.equal(dueSlot(med(), T0)?.toISOString(), iso(T0));
  assert.equal(dueSlot(med(), T0 - 30 * 60_000)?.toISOString(), iso(T0), "30 min antes pode");
  assert.equal(dueSlot(med(), T0 - 2 * H), null, "2h antes não");
});

test("dueSlot: várias doses perdidas => registra a mais recente", () => {
  // próxima pendente era 08:00; agora são 01:00 do dia seguinte (17h depois)
  assert.equal(dueSlot(med(), T0 + 17 * H)?.toISOString(), iso(T0 + 16 * H));
});

test("dueSlot: tratamento encerrado ou inativo", () => {
  assert.equal(dueSlot(med({ ends_at: iso(T0 + 10 * H) }), T0 + 17 * H), null, "16h passa do fim (10h)");
  assert.equal(dueSlot(med({ is_active: false }), T0), null);
  assert.equal(dueSlot(med({ next_dose_at: null }), T0), null);
});

test("isPendingSlot aceita só horários da grade ainda pendentes", () => {
  const m = med({ next_dose_at: iso(T0 + 8 * H) });
  assert.equal(isPendingSlot(m, iso(T0 + 8 * H)), true);
  assert.equal(isPendingSlot(m, iso(T0 + 16 * H)), true);
  assert.equal(isPendingSlot(m, iso(T0)), false, "já registrada");
  assert.equal(isPendingSlot(m, iso(T0 + 9 * H)), false, "fora da grade");
  assert.equal(isPendingSlot(m, "lixo"), false);
  assert.equal(isPendingSlot(med({ interval_hours: 0.5, next_dose_at: iso(T0) }), iso(T0 + 1.5 * H)), true, "intervalo fracionado");
});

test("doseState", () => {
  assert.equal(doseState(med(), T0 - 3 * H), "upcoming");
  assert.equal(doseState(med(), T0 + 10 * 60_000), "due");
  assert.equal(doseState(med(), T0 + 2 * H), "late");
  assert.equal(doseState(med({ is_active: false }), T0), "ended");
});

test("adherence conta doses previstas pela grade e tomadas no período", () => {
  // 1 dia de tratamento às 08, 16, 00 (3 doses até 00:30 do dia seguinte)
  const now = T0 + 16.5 * H;
  const logs = [
    { scheduled_for: iso(T0), status: "taken" as const },
    { scheduled_for: iso(T0 + 8 * H), status: "skipped" as const },
    { scheduled_for: iso(T0 + 16 * H), status: "taken" as const },
  ];
  assert.deepEqual(adherence(med(), logs, now), { expected: 3, taken: 2, percent: 67 });
  assert.deepEqual(adherence(med(), [], T0 - H), { expected: 0, taken: 0, percent: null }, "antes de começar");
});
