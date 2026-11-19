import assert from "node:assert/strict";
import { test } from "node:test";
import { appendDictation, applyCommands, capitalizeSentences } from "./dictation.ts";

test("comandos falados viram pontuação", () => {
  assert.equal(applyCommands("dor de cabeça vírgula pior à noite ponto final"), "dor de cabeça, pior à noite.");
  assert.equal(applyCommands("está doendo ponto de interrogação"), "está doendo?");
  assert.equal(applyCommands("remédios dois pontos dipirona"), "remédios: dipirona");
  assert.equal(applyCommands("primeira linha nova linha segunda"), "primeira linha\nsegunda");
  assert.equal(applyCommands("dor virgula febre"), "dor, febre"); // reconhecedor às vezes escreve sem acento
});

test("'ponto' sozinho não vira pontuação (ex.: ponto de dor)", () => {
  assert.equal(applyCommands("dor no ponto de inserção"), "dor no ponto de inserção");
});

test("maiúscula no início e depois de ponto", () => {
  assert.equal(capitalizeSentences("febre. tomei dipirona", true), "Febre. Tomei dipirona");
  assert.equal(capitalizeSentences("e depois melhorou", false), "e depois melhorou");
});

test("emenda no texto existente com o espaço certo", () => {
  assert.equal(appendDictation("", "dor de cabeça há dois dias"), "Dor de cabeça há dois dias");
  assert.equal(appendDictation("Dor de cabeça", "vírgula pior à noite"), "Dor de cabeça, pior à noite");
  assert.equal(appendDictation("Dor de cabeça.", "tomei dipirona"), "Dor de cabeça. Tomei dipirona");
  assert.equal(appendDictation("Consulta hoje", "com a cardiologista"), "Consulta hoje com a cardiologista");
  assert.equal(appendDictation("Linha um\n", "linha dois"), "Linha um\nLinha dois");
  assert.equal(appendDictation("Texto", "   "), "Texto");
});
