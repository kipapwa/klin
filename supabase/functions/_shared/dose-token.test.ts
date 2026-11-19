import assert from "node:assert/strict";
import { test } from "node:test";
import { DOSE_TOKEN_TTL_MS, parseMarkRequest, signDose, verifyDose, type DoseClaims } from "./dose-token.ts";

const SECRET = "segredo-do-cron-de-teste";
const claims: DoseClaims = {
  medicationId: "11111111-2222-4333-8444-555555555555",
  userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  scheduledFor: "2026-11-19T11:00:00.000Z",
  exp: Date.parse("2026-11-19T11:00:00.000Z") + DOSE_TOKEN_TTL_MS,
};

test("assinatura confere só com o mesmo segredo e a mesma dose", async () => {
  const token = await signDose(SECRET, claims);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await verifyDose(SECRET, claims, token), true);
  assert.equal(await verifyDose("outro-segredo", claims, token), false);
  assert.equal(await verifyDose(SECRET, { ...claims, scheduledFor: "2026-11-19T19:00:00.000Z" }, token), false);
  assert.equal(await verifyDose(SECRET, { ...claims, userId: "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee" }, token), false);
  assert.equal(await verifyDose(SECRET, { ...claims, medicationId: "21111111-2222-4333-8444-555555555555" }, token), false);
  assert.equal(await verifyDose(SECRET, { ...claims, exp: claims.exp + 1 }, token), false); // não dá para esticar o prazo
  assert.equal(await verifyDose(SECRET, claims, token.slice(0, -1) + (token.endsWith("A") ? "B" : "A")), false);
});

test("o mesmo horário escrito de outro jeito gera a mesma assinatura", async () => {
  const token = await signDose(SECRET, claims);
  assert.equal(await verifyDose(SECRET, { ...claims, scheduledFor: "2026-11-19T08:00:00-03:00" }, token), true);
});

test("corpo do pedido: aceita só o formato esperado", () => {
  const ok = { medicationId: claims.medicationId, scheduledFor: claims.scheduledFor, exp: claims.exp, token: "a".repeat(43) };
  assert.deepEqual(parseMarkRequest(ok), ok);
  assert.equal(parseMarkRequest({ ...ok, medicationId: "x" }), null);
  assert.equal(parseMarkRequest({ ...ok, scheduledFor: "ontem" }), null);
  assert.equal(parseMarkRequest({ ...ok, exp: "1" }), null);
  assert.equal(parseMarkRequest({ ...ok, token: "curto" }), null);
  assert.equal(parseMarkRequest(null), null);
});
