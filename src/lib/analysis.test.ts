import assert from "node:assert/strict";
import { test } from "node:test";
import { reportToText, SUGGESTIONS } from "./analysis.ts";
import type { ReportDoc } from "./report.ts";

const doc: ReportDoc = {
  title: "Relatório de remédios",
  meta: ["Período: 15/11/2026 a 22/11/2026 (últimos 7 dias)"],
  sections: [
    { heading: "Losartana (50 mg) · Em uso", blocks: [{ label: "Adesão no período", text: "6 de 7 doses tomadas (86%)" }, { text: "Sem detalhes." }] },
    { heading: "Dor no peito", alert: true, blocks: [{ label: "Queixa principal", text: "Aperto no peito" }] },
  ],
  footer: "Klin",
};

test("relatório vira texto com títulos, rótulos e alerta marcado", () => {
  assert.equal(
    reportToText(doc),
    [
      "Relatório de remédios",
      "Período: 15/11/2026 a 22/11/2026 (últimos 7 dias)",
      "",
      "== Losartana (50 mg) · Em uso",
      "Adesão no período: 6 de 7 doses tomadas (86%)",
      "Sem detalhes.",
      "",
      "== Dor no peito [ALERTA]",
      "Queixa principal: Aperto no peito",
    ].join("\n"),
  );
});

test("texto grande é cortado no limite, com aviso", () => {
  const text = reportToText(doc, 120);
  assert.ok(text.length <= 120);
  assert.ok(text.endsWith("os itens mais antigos não foram enviados]"));
});

test("sugestões prontas para as duas telas", () => {
  assert.ok(SUGGESTIONS.records.length >= 3 && SUGGESTIONS.medications.length >= 3);
});
