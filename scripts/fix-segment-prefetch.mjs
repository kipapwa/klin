/**
 * Corrige o pré-carregamento de páginas no export estático (Next 16.4).
 *
 * O navegador pede os dados de cada página com PONTOS:
 *   /medicamentos/editar/__next.medicamentos.editar.__PAGE__.txt
 * mas o build grava com BARRAS:
 *   /medicamentos/editar/__next.medicamentos/editar/__PAGE__.txt
 * O pedido dá 404, o pré-carregamento falha e cada toque no menu espera a
 * internet. Este script cria a cópia com o nome que o navegador pede (o
 * conteúdo é o mesmo; os originais ficam intactos).
 *
 * Roda depois do `next build` (script "build" do package.json).
 */
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../out", import.meta.url));
if (!existsSync(out)) {
  console.error("fix-segment-prefetch: pasta out/ não encontrada (rode depois do next build).");
  process.exit(1);
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

let created = 0;
for (const file of files(out)) {
  if (!file.endsWith(".txt")) continue;
  const parts = relative(out, file).split(sep);
  // Primeira PASTA cujo nome começa com "__next." (o arquivo em si não conta).
  const i = parts.findIndex((p, idx) => idx < parts.length - 1 && p.startsWith("__next."));
  if (i < 0) continue;
  const routeDir = join(out, ...parts.slice(0, i));
  const flat = parts.slice(i).join(".").replace(/\.txt\.txt$/, ".txt");
  const target = join(routeDir, flat);
  if (!existsSync(target)) {
    copyFileSync(file, target);
    created++;
  }
}
console.log(`fix-segment-prefetch: ${created} arquivo(s) de pré-carregamento criado(s).`);
