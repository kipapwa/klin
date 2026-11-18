import assert from "node:assert/strict";
import { test } from "node:test";
import { adherence, doseState, dueSlot, isPendingSlot, slotAfter, slotAtOrBefore, type DoseSchedule } from "./doses.ts";

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

// --- Horários fixos ------------------------------------------------------
const SP = "America/Sao_Paulo"; // UTC-3, sem horário de verão
function fixed(times: string[], over: Partial<DoseSchedule> = {}): DoseSchedule {
  return {
    starts_at: "2026-11-18T03:00:00Z", // 00:00 em São Paulo
    interval_hours: 24,
    ends_at: null,
    next_dose_at: "2026-11-18T11:00:00Z", // 08:00 SP
    is_active: true,
    schedule_type: "times",
    dose_times: times,
    timezone: SP,
    ...over,
  };
}

test("horários fixos: próxima dose e dose atual no fuso", () => {
  const m = fixed(["08:00", "12:00", "19:30"]);
  assert.equal(new Date(slotAfter(m, Date.parse("2026-11-18T11:00:00Z"), false)!).toISOString(), "2026-11-18T15:00:00.000Z", "08:00 -> 12:00");
  assert.equal(new Date(slotAfter(m, Date.parse("2026-11-18T15:00:00Z"), false)!).toISOString(), "2026-11-18T22:30:00.000Z", "12:00 -> 19:30");
  assert.equal(new Date(slotAfter(m, Date.parse("2026-11-18T22:30:00Z"), false)!).toISOString(), "2026-11-19T11:00:00.000Z", "19:30 -> 08:00 do dia seguinte");
  assert.equal(new Date(slotAtOrBefore(m, Date.parse("2026-11-18T20:00:00Z"))!).toISOString(), "2026-11-18T15:00:00.000Z", "às 17:00 SP, a última foi 12:00");
  assert.equal(slotAtOrBefore(m, Date.parse("2026-11-18T02:00:00Z")), null, "antes do início");
});

test("horários fixos: hora da dose, dose perdida e notificação", () => {
  const m = fixed(["08:00", "20:00"]);
  // 08:30 SP: dose das 08:00 devida
  assert.equal(dueSlot(m, Date.parse("2026-11-18T11:30:00Z"))?.toISOString(), "2026-11-18T11:00:00.000Z");
  // 22:00 SP sem registrar a das 08:00: registra a das 20:00
  assert.equal(dueSlot(m, Date.parse("2026-11-19T01:00:00Z"))?.toISOString(), "2026-11-18T23:00:00.000Z");
  assert.equal(isPendingSlot(m, "2026-11-18T23:00:00.000Z"), true, "20:00 SP é horário da agenda");
  assert.equal(isPendingSlot(m, "2026-11-18T22:00:00.000Z"), false, "19:00 SP não é");
});

test("horários fixos respeitam horário de verão (Nova York)", () => {
  const m = fixed(["08:00"], { timezone: "America/New_York", starts_at: "2026-10-30T04:00:00Z", next_dose_at: null });
  // Antes e depois de 01/11/2026 (fim do horário de verão): 08:00 local = 12:00Z e depois 13:00Z
  assert.equal(new Date(slotAfter(m, Date.parse("2026-10-31T13:00:00Z"), false)!).toISOString(), "2026-11-01T13:00:00.000Z");
  assert.equal(new Date(slotAfter(m, Date.parse("2026-10-30T04:00:00Z"), true)!).toISOString(), "2026-10-30T12:00:00.000Z");
});

test("horários fixos: fim do tratamento e adesão", () => {
  const m = fixed(["08:00", "20:00"], { ends_at: "2026-11-20T03:00:00Z" }); // 2 dias
  assert.equal(slotAfter(m, Date.parse("2026-11-19T23:00:00Z"), false), null, "depois das 20:00 do 2º dia acabou");
  const logs = [
    { scheduled_for: "2026-11-18T11:00:00Z", status: "taken" as const },
    { scheduled_for: "2026-11-18T23:00:00Z", status: "taken" as const },
    { scheduled_for: "2026-11-19T11:00:00Z", status: "skipped" as const },
  ];
  assert.deepEqual(adherence(m, logs, Date.parse("2026-11-19T12:00:00Z")), { expected: 3, taken: 2, percent: 67 });
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
