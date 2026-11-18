import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFollowUpIcs } from "./ics.ts";

const now = new Date("2026-11-18T15:04:05.678Z");

test("evento de dia inteiro com alarme na véspera e título discreto", () => {
  const ics = buildFollowUpIcs({ uid: "abc", date: "2026-12-31", now });
  const lines = ics.split("\r\n");
  assert.ok(ics.endsWith("\r\n"));
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20261231"));
  assert.ok(lines.includes("DTEND;VALUE=DATE:20270101"));
  assert.ok(lines.includes("DTSTAMP:20261118T150405Z"));
  assert.ok(lines.includes("SUMMARY:Retorno médico"));
  assert.ok(lines.includes("TRIGGER:-P1D"));
  assert.ok(lines.includes("UID:abc@klin"));
});

test("escapa caracteres especiais e dobra linhas longas", () => {
  const ics = buildFollowUpIcs({ uid: "x", date: "2026-01-05", description: "a,b;c\nd " + "x".repeat(120), now });
  assert.match(ics, /DESCRIPTION:a\\,b\\;c\\nd /);
  assert.ok(ics.split("\r\n").every((l) => l.length <= 75));
});

test("data inválida é recusada", () => {
  assert.throws(() => buildFollowUpIcs({ uid: "x", date: "31/12/2026" }));
});
