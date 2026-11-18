import assert from "node:assert/strict";
import { test } from "node:test";
import { baseMime, extensionFor, pickRecorderMime } from "./audio.ts";

test("pickRecorderMime escolhe o primeiro formato suportado", () => {
  assert.equal(pickRecorderMime(() => true), "audio/webm;codecs=opus");
  // Safari/iPhone: só mp4
  assert.equal(pickRecorderMime((m) => m === "audio/mp4"), "audio/mp4");
  assert.equal(pickRecorderMime(() => false), "");
});

test("baseMime remove parâmetros e normaliza", () => {
  assert.equal(baseMime("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(baseMime("Audio/MP4"), "audio/mp4");
  assert.equal(baseMime("audio/x-m4a"), "audio/mp4");
  assert.equal(baseMime(""), "audio/webm");
});

test("extensionFor", () => {
  assert.equal(extensionFor("audio/webm;codecs=opus"), "webm");
  assert.equal(extensionFor("audio/mp4"), "m4a");
  assert.equal(extensionFor("audio/desconhecido"), "webm");
});
