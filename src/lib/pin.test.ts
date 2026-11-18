import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPin, lockoutDelay, pinProblem, verifyPin } from "./pin.ts";

test("pinProblem", () => {
  assert.equal(pinProblem("2580"), null);
  assert.equal(pinProblem("739154"), null);
  assert.match(pinProblem("123")!, /4 a 8/);
  assert.match(pinProblem("12a4")!, /4 a 8/);
  assert.match(pinProblem("0000")!, /repetidos/);
  assert.match(pinProblem("1234")!, /sequências/);
  assert.match(pinProblem("9876")!, /sequências/);
});

test("hash não contém o PIN e só o PIN certo confere", async () => {
  const stored = await hashPin("2580", 1000);
  assert.ok(!JSON.stringify(stored).includes("2580"));
  assert.equal(await verifyPin("2580", stored), true);
  assert.equal(await verifyPin("2581", stored), false);
  const other = await hashPin("2580", 1000);
  assert.notEqual(other.hash, stored.hash, "sal aleatório: hashes diferentes para o mesmo PIN");
});

test("lockoutDelay cresce a partir do 5º erro, com teto", () => {
  assert.equal(lockoutDelay(4), 0);
  assert.equal(lockoutDelay(5), 30_000);
  assert.equal(lockoutDelay(6), 60_000);
  assert.equal(lockoutDelay(20), 15 * 60_000);
});
