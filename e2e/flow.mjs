/**
 * Teste ponta a ponta do fluxo principal, num Chromium com microfone simulado
 * e um Supabase FALSO (e2e/mock-supabase.mjs) — não toca em nenhum projeto real.
 *
 *   npx playwright install chromium   (uma vez)
 *   npm run test:e2e
 *
 * Gera o site apontando para o mock, sobe tudo localmente e salva capturas
 * de tela em e2e/shots/ (ignorado pelo git).
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startStatic, startSupabase, state } from "./mock-supabase.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = fileURLToPath(new URL("../out", import.meta.url));
const shots = fileURLToPath(new URL("./shots", import.meta.url));
mkdirSync(shots, { recursive: true });

execSync("npm run build", {
  cwd: root,
  stdio: "ignore",
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "chave-de-teste",
    NEXT_PUBLIC_BASE_PATH: "",
  },
});

// Pré-carregamento interno do Next no export estático: pede
// "<rota>/__next.<rota>.__PAGE__.txt", mas o build grava "__next.<rota>/__PAGE__.txt".
// A navegação funciona; o 404 é esperado (limitação do Next 16.4).
const KNOWN_404 = /\/__next\.[^/]+\.__PAGE__\.txt/;

await startSupabase(54321);
await startStatic(outDir, 3210);
const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ["microphone"] });
const page = await ctx.newPage();
const problems = [];
const unexpected404 = [];
page.on("response", (r) => {
  if (r.status() === 404 && !KNOWN_404.test(r.url())) unexpected404.push(r.url());
});
page.on("console", (m) => {
  const text = m.text();
  // 404 é conferido pela URL acima (o console não diz qual recurso falhou).
  if (/Failed to load resource: .* 404/.test(text)) return;
  if (m.type() === "error" || /Content Security Policy/i.test(text)) problems.push(text);
});
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
const step = (s) => console.log("OK  " + s);
const BASE = "http://127.0.0.1:3210";

try {
  await page.goto(BASE + "/");
  await page.waitForURL("**/entrar/");
  step("sem sessão redireciona para /entrar/");
  await page.screenshot({ path: `${shots}/1-login.png` });

  await page.fill("#email", "teste@exemplo.com");
  await page.click("text=Receber código");
  await page.fill("#code", "000000");
  await page.click("button:has-text('Entrar')");
  await page.waitForSelector("text=Código inválido ou expirado.");
  step("código errado mostra erro");
  // Erro esperado do teste (403 do mock) não conta como problema.
  problems.length = 0;

  await page.fill("#code", "123456");
  await page.click("button:has-text('Entrar')");
  await page.waitForSelector("text=Nenhum registro ainda");
  step("login com código e painel vazio");

  await page.click("a[href$='/gravar/']");
  await page.waitForURL("**/gravar/");
  await page.click("[aria-label='Começar a gravar']");
  await page.waitForSelector("[role=timer]");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${shots}/2-gravando.png` });
  await page.click("[aria-label='Parar gravação']");
  await page.waitForSelector("text=Enviar para a IA");
  step("gravação com microfone simulado");

  await page.click("text=Enviar para a IA");
  await page.waitForSelector("text=Nota criada", { timeout: 15000 });
  step("upload + IA (função) + resumo");
  const [key, file] = Object.entries(state.uploads)[0];
  console.log(`    upload: ${key} (${file.size} bytes, ${file.type})`);
  if (!key.startsWith("11111111-1111-4111-8111-111111111111/")) throw new Error("áudio fora da pasta do usuário");
  const rec = state.records[0];
  console.log(`    registro: status=${rec.status} mime=${rec.audio_mime_type} duração=${rec.audio_duration_s}s client_id=${Boolean(rec.client_id)}`);
  await page.waitForSelector("text=Omeprazol");
  await page.screenshot({ path: `${shots}/3-resultado.png`, fullPage: true });

  // Remédio citado sem intervalo: "Cadastrar" abre o formulário pré-preenchido
  // (via sessionStorage — o nome do remédio não pode ir para a URL).
  await page.click("li:has-text('Omeprazol') >> text=Cadastrar");
  await page.waitForURL("**/medicamentos/editar/");
  if (page.url().includes("Omeprazol")) throw new Error("nome do remédio vazou para a URL");
  if ((await page.inputValue("#name")) !== "Omeprazol" || (await page.inputValue("#dosage")) !== "20 mg") {
    throw new Error("formulário não veio pré-preenchido");
  }
  await page.click("button:has-text('12 em 12h')");
  await page.screenshot({ path: `${shots}/6-form.png`, fullPage: true });
  await page.click("text=Cadastrar medicamento");
  await page.waitForURL("**/medicamentos/detalhe/?id=*");
  await page.waitForSelector("h1:has-text('Omeprazol')");
  const omeprazol = state.meds.find((m) => m.name === "Omeprazol");
  if (omeprazol.record_id !== rec.id || omeprazol.interval_hours !== 12 || omeprazol.source !== "manual") {
    throw new Error("cadastro manual com dados errados: " + JSON.stringify(omeprazol));
  }
  step("remédio sem intervalo cadastrado a partir do resumo da IA");

  await page.click("nav >> text=Registros");
  await page.click("a[href*='/registro/']");
  await page.waitForURL("**/registro/?id=*");
  await page.waitForSelector("text=R07.4");
  await page.click("text=Ouvir gravação");
  await page.waitForSelector("audio[src*='token=t']");
  step("nota completa + áudio por Signed URL");

  const download = page.waitForEvent("download");
  await page.click("text=Adicionar ao calendário");
  console.log("    .ics:", (await download).suggestedFilename());
  step("retorno no calendário (.ics)");
  await page.screenshot({ path: `${shots}/4-nota.png`, fullPage: true });

  await page.click("[aria-label='Voltar']");
  await page.waitForSelector("text=registro com alerta");
  const cls = await page.locator("a[href*='/registro/']").first().getAttribute("class");
  if (!/bg-red-50/.test(cls) || !/border-red-500/.test(cls)) throw new Error("card crítico sem destaque vermelho: " + cls);
  step("card crítico em vermelho no painel");
  await page.screenshot({ path: `${shots}/5-painel.png` });

  // --- Medicamentos em uso -------------------------------------------------
  await page.click("nav >> text=Medicamentos");
  await page.waitForURL("**/medicamentos/");
  const losartanaCard = page.locator("li", { hasText: "Losartana" });
  await losartanaCard.locator("text=Hora da dose").waitFor();
  await page.screenshot({ path: `${shots}/7-medicamentos.png`, fullPage: true });
  await losartanaCard.locator("text=Marcar como tomado").click();
  await page.waitForSelector("text=Dose de Losartana registrada ✓");
  await losartanaCard.locator("text=Próxima dose").waitFor();
  const losartana = state.meds.find((m) => m.name === "Losartana");
  if (state.logs.filter((l) => l.medication_id === losartana.id && l.status === "taken").length !== 1) throw new Error("dose não registrada");
  step("marcar como tomado avança para a próxima dose");

  // Vindo da notificação (ação "Marcar como tomado" do Service Worker).
  const pending = omeprazol.next_dose_at;
  const fromPush = `${BASE}/medicamentos/?tomar=${omeprazol.id}&horario=${encodeURIComponent(pending)}`;
  await page.goto(fromPush);
  await page.waitForSelector("text=Confirmar a dose de Omeprazol");
  await page.screenshot({ path: `${shots}/8-confirmar-push.png` });
  await page.click("button:has-text('Tomei')");
  await page.waitForSelector("text=Dose de Omeprazol registrada ✓");
  const pushLog = state.logs.find((l) => l.medication_id === omeprazol.id);
  if (pushLog?.source !== "notification" || Date.parse(pushLog.scheduled_for) !== Date.parse(pending)) {
    throw new Error("dose da notificação registrada errada: " + JSON.stringify(pushLog));
  }
  await page.goto(fromPush);
  await page.waitForSelector("text=Essa dose já foi registrada.");
  step("confirmação pela notificação, sem registrar duas vezes");

  await page.click("text=OK");
  await page.click("li:has-text('Omeprazol') >> h2");
  await page.waitForURL("**/medicamentos/detalhe/?id=*");
  await page.waitForSelector("text=Tomada");
  await page.click("[role=switch]");
  await page.waitForSelector("[role=switch][aria-checked=false]:not([disabled])");
  if (!state.calls.includes("PATCH medications notifications_enabled")) throw new Error("lembrete não foi alterado");
  await page.screenshot({ path: `${shots}/9-detalhe.png`, fullPage: true });
  step("detalhe: histórico, adesão e lembretes");

  await page.click("text=Sair");
  await page.waitForURL("**/entrar/");
  step("sair");
} catch (err) {
  console.log("FALHOU:", err.message);
  await page.screenshot({ path: `${shots}/erro.png`, fullPage: true });
  problems.push("teste: " + err.message);
}
problems.push(...unexpected404.map((u) => `404 inesperado: ${u}`));
console.log("problemas:", problems.length ? problems : "nenhum");
await browser.close();
process.exit(problems.length ? 1 : 0);
