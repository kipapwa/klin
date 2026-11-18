import assert from "node:assert/strict";
import { test } from "node:test";
import { groupByMonth, toggle } from "./timeline.ts";

test("groupByMonth agrupa consecutivos por mês e mantém a ordem", () => {
  const items = [
    { id: 1, recorded_at: "2026-11-18T15:00:00" },
    { id: 2, recorded_at: "2026-11-02T09:00:00" },
    { id: 3, recorded_at: "2026-10-30T09:00:00" },
  ];
  const groups = groupByMonth(items);
  assert.deepEqual(groups.map((g) => [g.key, g.items.map((i) => i.id)]), [
    ["2026-11", [1, 2]],
    ["2026-10", [3]],
  ]);
  assert.equal(groups[0].label, "novembro de 2026");
});

test("toggle", () => {
  assert.deepEqual(toggle(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggle(["a", "b"], "a"), ["b"]);
});
