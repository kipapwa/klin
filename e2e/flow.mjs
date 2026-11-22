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
import { E2E_DOSE_SECRET, startStatic, startSupabase, state } from "./mock-supabase.mjs";
import { DOSE_TOKEN_TTL_MS, signDose } from "../supabase/functions/_shared/dose-token.ts";

const VAPID_TEST_KEY = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
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
    // Ponto P-256 válido (do exemplo da RFC 8291); só a pública vai ao site.
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: VAPID_TEST_KEY,
  },
});

// O Chromium sem interface não tem serviço de push (FCM): a inscrição é
// simulada na página. O Service Worker é o real (public/sw.js) e recebe um
// push de verdade pelo protocolo do DevTools mais abaixo.
const FAKE_PUSH = `
  const fakeSub = {
    endpoint: "https://push.exemplo/aparelho-e2e",
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "${VAPID_TEST_KEY}", auth: "BTBZMqHH6r4Tts7J_aSIgg" } }; },
    async unsubscribe() { sessionStorage.removeItem("fakeSub"); return true; },
  };
  // O headless informa "denied" mesmo com a permissão concedida no contexto.
  Object.defineProperty(Notification, "permission", { get: () => "granted" });
  Notification.requestPermission = async () => "granted";
  // Como no navegador real, a inscrição sobrevive a recarregar a página.
  PushManager.prototype.getSubscription = async function () { return sessionStorage.getItem("fakeSub") ? fakeSub : null; };
  PushManager.prototype.subscribe = async function (opts) {
    window.__subscribeKeyLength = new Uint8Array(opts.applicationServerKey).length;
    sessionStorage.setItem("fakeSub", "1");
    return fakeSub;
  };
`;

// Nenhum 404 é aceito. O do pré-carregamento do Next ("__next.<rota>.__PAGE__.txt")
// é resolvido no build por scripts/fix-segment-prefetch.mjs; se voltar, as telas
// passam a esperar a internet a cada toque.
const KNOWN_404 = /$^/;

await startSupabase(54321);
await startStatic(outDir, 3210);
const browser = await chromium.launch({ channel: "chromium", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const ctx = await browser.newContext({
  timezoneId: "America/Sao_Paulo",
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  permissions: ["microphone", "notifications"],
});
await ctx.addInitScript(FAKE_PUSH);
// O Chromium de teste não tem serviço de voz: reconhecedor simulado, comandado pelo teste.
await ctx.addInitScript(() => {
  class FakeRecognition {
    constructor() {
      window.__speech = this;
    }
    start() {}
    stop() {
      setTimeout(() => this.onend?.(), 0);
    }
    abort() {
      this.stop();
    }
    say(text, isFinal) {
      const result = { 0: { transcript: text }, isFinal, length: 1 };
      this.onresult?.({ resultIndex: 0, results: [result] });
    }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
});
const page = await ctx.newPage();
const problems = [];
const unexpected404 = [];
let allowed500 = 0;
page.on("response", (r) => {
  if (r.status() === 404 && !KNOWN_404.test(r.url())) unexpected404.push(r.url());
});
page.on("console", (m) => {
  const text = m.text();
  // 404 é conferido pela URL acima (o console não diz qual recurso falhou).
  if (/Failed to load resource: .* 404/.test(text)) return;
  // Esperado no trecho do modo offline.
  if (/ERR_INTERNET_DISCONNECTED/.test(text)) return;
  // Falha simulada de propósito (perfil em Ajustes), uma vez.
  if (allowed500 > 0 && /status of 500/.test(text)) {
    allowed500--;
    return;
  }
  if (m.type() === "error" || /Content Security Policy/i.test(text)) problems.push(text);
});
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
// Regra do usuário: nenhuma caixa do sistema. Se aparecer uma, o teste reprova.
page.on("dialog", (d) => {
  problems.push(`caixa do sistema (${d.type()}): ${d.message()}`);
  void d.dismiss();
});
/** Responde a caixa de confirmação do próprio app. */
async function answerConfirm(button) {
  const box = page.locator("dialog[role=alertdialog][open]");
  await box.waitFor();
  await box.locator(`button:has-text("${button}")`).click();
  await box.waitFor({ state: "detached" }).catch(() => {});
}
const step = (s) => console.log("OK  " + s);
const BASE = "http://localhost:3210"; // WebAuthn não aceita IP como domínio

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
  await page.click("[role=radio]:has-text('A cada X horas')");
  await page.click("button:has-text('12 em 12 h')");
  await page.screenshot({ path: `${shots}/6-form.png`, fullPage: true });
  await page.click("text=Salvar remédio");
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
  await page.click("nav >> text=Remédios");
  await page.waitForURL("**/medicamentos/");
  const losartanaCard = page.locator("li", { hasText: "Losartana" });
  await losartanaCard.locator("text=Hora da dose").waitFor();
  await page.screenshot({ path: `${shots}/7-medicamentos.png`, fullPage: true });
  // Sininho do topo: número de doses agora e "Tomei" sem sair da tela.
  const bell = page.locator("header button[aria-label^='Lembretes']");
  await page.waitForSelector("header button[aria-label*='dose(s) agora']"); // número carrega depois
  await bell.click();
  const bellSheet = page.locator("dialog[aria-label='Lembretes']");
  await bellSheet.locator("li", { hasText: "Losartana" }).locator("text=Tomei").click();
  await bellSheet.locator("li", { hasText: "Losartana" }).waitFor({ state: "detached" });
  await page.screenshot({ path: `${shots}/16-sininho.png` });
  await bellSheet.locator("[aria-label='Fechar']").click();
  // A lista atrás atualiza sozinha (evento de dose registrada).
  await losartanaCard.locator("text=Próxima dose").waitFor();
  const losartana = state.meds.find((m) => m.name === "Losartana");
  if (state.logs.filter((l) => l.medication_id === losartana.id && l.status === "taken").length !== 1) throw new Error("dose não registrada");
  step("sininho: dose de agora marcada como tomada e lista atualizada");

  // Vindo da notificação (ação "Marcar como tomado" do Service Worker).
  const pending = omeprazol.next_dose_at;
  const fromPush = `${BASE}/medicamentos/?tomar=${omeprazol.id}&horario=${encodeURIComponent(pending)}`;
  await page.goto(fromPush);
  await page.waitForSelector("text=Confirmar a dose de Omeprazol");
  await page.screenshot({ path: `${shots}/8-confirmar-push.png` });
  await page.click("[role=dialog][aria-label='Confirmar dose'] >> button:has-text('Tomei')");
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

  // --- Remédio com horários do dia ------------------------------------------
  await page.click("nav >> text=Remédios");
  await page.click("[aria-label='Adicionar remédio']");
  await page.waitForSelector("text=Novo remédio");
  await page.fill("#name", "Vitamina D");
  await page.click("button:has-text('2x ao dia')");
  await page.click("text=Adicionar horário");
  if ((await page.locator("[aria-haspopup=dialog][aria-label^='Horário ']").count()) !== 3) throw new Error("adicionar horário não criou o 3º campo");
  // Seletor de horas do app (o do Android deixava o "Definir" fora da tela).
  await page.click("[aria-label='Horário 3: 00:00']");
  const picker = page.locator("dialog[aria-label='Horário 3']");
  await picker.waitFor();
  await picker.locator("[role=radio][aria-label='21 h']").click();
  await picker.locator("[role=radio][aria-label='30 min']").click();
  await page.screenshot({ path: `${shots}/23-seletor-horas.png` });
  const confirmBox = await picker.locator("button:has-text('Confirmar')").boundingBox();
  const viewport = page.viewportSize();
  if (!confirmBox || confirmBox.y + confirmBox.height > viewport.height) throw new Error("botão Confirmar fora da tela: " + JSON.stringify(confirmBox));
  await picker.locator("button:has-text('Confirmar')").click();
  await picker.waitFor({ state: "hidden" });
  await page.waitForSelector("[aria-label='Horário 3: 21:30']");
  step("seletor de horas do app: escolhe hora e minuto com o Confirmar sempre visível");
  await page.click("[aria-label='Remover horário 21:30']"); // remove o que acabou de adicionar
  await page.screenshot({ path: `${shots}/14-form-horarios.png`, fullPage: true });
  await page.click("text=Salvar remédio");
  await page.waitForSelector("text=Todos os dias às 08:00 e 20:00");
  const vit = state.meds.find((x) => x.name === "Vitamina D");
  if (vit.schedule_type !== "times" || vit.dose_times.join() !== "08:00,20:00" || vit.timezone !== "America/Sao_Paulo") {
    throw new Error("agenda de horários errada: " + JSON.stringify(vit));
  }
  const vitLocal = new Date(vit.next_dose_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  if (!["08:00", "20:00"].includes(vitLocal)) throw new Error("próxima dose fora dos horários: " + vitLocal);
  await page.locator("main >> text=Ative as notificações neste aparelho").waitFor();
  step(`remédio com horários do dia (próxima dose às ${vitLocal}) e aviso para ativar notificações`);
  await page.click("nav >> text=Remédios");
  await page.waitForSelector("li:has-text('Vitamina D') >> text=Todos os dias às 08:00 e 20:00");
  await page.screenshot({ path: `${shots}/15-remedios.png`, fullPage: true });

  // --- Linha do tempo: filtros e busca -------------------------------------
  await page.click("nav >> text=Registros");
  await page.waitForSelector("text=novembro de 2026");
  await page.click("button[aria-label='Filtros']");
  const filterSheet = page.locator("dialog[aria-label='Filtrar registros']");
  await filterSheet.locator("[aria-label='Filtrar por categoria'] >> text=Exames").click();
  await filterSheet.locator("text=Mostrar resultados").click();
  await page.waitForSelector("text=Nenhum registro encontrado");
  if (!state.calls.some((c) => c.includes("category=in.%28exam%29"))) throw new Error("filtro não foi enviado ao banco");
  await page.waitForSelector("button[aria-label='Filtros (1 ativos)']");
  await page.screenshot({ path: `${shots}/17-filtro-ativo.png` });
  await page.click("[aria-label='Remover filtro Exames']");
  // Busca enquanto digita, sem botão.
  await page.fill("[aria-label='Buscar nos registros']", "peito");
  await page.waitForSelector("a[href*='/registro/'] >> text=Dor no peito ao subir escadas");
  if (page.url().includes("peito")) throw new Error("termo de busca vazou para a URL");
  await page.fill("[aria-label='Buscar nos registros']", "joelho");
  await page.waitForSelector("text=Nenhum registro encontrado");
  await page.click("[aria-label='Limpar busca']");
  await page.waitForSelector("a[href*='/registro/']");
  await page.screenshot({ path: `${shots}/11-linha-do-tempo.png`, fullPage: true });
  step("linha do tempo: filtros por categoria e busca no texto");

  // --- Transição entre telas (skill deslizar-entre-telas) -------------------
  await page.evaluate(() => {
    window.__dbg = [];
    new MutationObserver((ms) => {
      for (const m of ms) {
        for (const n of m.addedNodes) if (n.classList?.contains("tela-transicao")) window.__dbg.push(["+", n.className, location.pathname, performance.now() | 0]);
        for (const n of m.removedNodes) if (n.classList?.contains("tela-transicao")) window.__dbg.push(["-", performance.now() | 0]);
      }
    }).observe(document.body, { childList: true });
    document.addEventListener("click", (e) => window.__dbg.push(["clique", e.target.closest?.("a")?.getAttribute("href") ?? e.target.tagName, location.pathname, performance.now() | 0]), true);
    window.addEventListener("popstate", () => window.__dbg.push(["popstate", location.pathname, performance.now() | 0]), true);
  });
  const transition = async (dir, action) => {
    const seen = page.waitForSelector(`.tela-transicao.${dir}`, { state: "attached", timeout: 2000 });
    await action();
    try {
      await seen;
    } catch (err) {
      throw err;
    }
    const info = await page.evaluate(() => {
      const stage = document.querySelector(".tela-transicao");
      return {
        copies: stage?.querySelectorAll(".tela-copia").length ?? 0,
        idsInCopies: stage?.querySelectorAll("[id]").length ?? -1,
        realHidden: document.getElementById("tela")?.style.visibility === "hidden",
      };
    });
    if (info.copies !== 2 || info.idsInCopies !== 0 || !info.realHidden) throw new Error(`transição ${dir} errada: ${JSON.stringify(info)}`);
    await page.waitForSelector(".tela-transicao", { state: "detached", timeout: 1500 });
    if ((await page.evaluate(() => document.getElementById("tela")?.style.visibility)) === "hidden") throw new Error("tela ficou escondida");
  };
  await transition("frente", () => page.click("a[href*='/registro/'] >> text=Dor no peito ao subir escadas"));
  await page.waitForSelector("text=Queixa principal");
  await transition("volta", () => page.click("[aria-label='Voltar']"));
  await page.waitForSelector("text=Linha do tempo");
  await transition("frente", () => page.click("a[href*='/registro/'] >> text=Dor no peito ao subir escadas"));
  await transition("volta", () => page.goBack()); // voltar do celular
  await page.waitForSelector("text=Linha do tempo");
  // Troca de aba não anima.
  await page.click("nav >> text=Remédios");
  await page.waitForSelector("h1:has-text('Seus remédios')");
  if (await page.locator(".tela-transicao").count()) throw new Error("troca de aba não deveria animar");
  // "Reduzir movimento": nada anima.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.click("li:has-text('Omeprazol') >> h2");
  await page.waitForSelector("h1:has-text('Omeprazol')");
  if (await page.locator(".tela-transicao").count()) throw new Error("com reduzir movimento não deveria animar");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.click("nav >> text=Registros");
  await page.waitForSelector("text=Linha do tempo");
  step("transição entre telas: abre e volta (botão e voltar do celular), abas e reduzir movimento sem animação");

  // --- Sem zoom (skill sem-zoom) ------------------------------------------------
  const zoom = await page.evaluate(() => {
    const fake = (type, fingers) => {
      const e = new Event(type, { cancelable: true, bubbles: true });
      if (fingers) Object.defineProperty(e, "touches", { value: { length: fingers } });
      document.body.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const inputs = [...document.querySelectorAll("input:not([type=radio]):not([type=checkbox]), textarea, select")];
    return {
      viewport: document.querySelector("meta[name=viewport]")?.getAttribute("content"),
      touchAction: getComputedStyle(document.documentElement).touchAction,
      smallestInput: Math.min(...inputs.map((el) => parseFloat(getComputedStyle(el).fontSize))),
      pinchBlocked: fake("touchmove", 2),
      oneFingerFree: !fake("touchmove", 1),
      gestureBlocked: fake("gesturestart"),
    };
  });
  if (
    !/maximum-scale=1/.test(zoom.viewport) || !/user-scalable=no/.test(zoom.viewport) ||
    zoom.touchAction !== "manipulation" || zoom.smallestInput < 16 ||
    !zoom.pinchBlocked || !zoom.oneFingerFree || !zoom.gestureBlocked
  ) {
    throw new Error("sem zoom incompleto: " + JSON.stringify(zoom));
  }
  for (const path of ["/gravar/", "/medicamentos/editar/", "/ajustes/"]) {
    await page.goto(BASE + path);
    if (path === "/gravar/") await page.click("[role=tab]:has-text('Escrever')");
    await page.waitForTimeout(300);
    const smallest = await page.evaluate(() =>
      Math.min(...[...document.querySelectorAll("input:not([type=radio]):not([type=checkbox]), textarea")].map((el) => parseFloat(getComputedStyle(el).fontSize))),
    );
    if (smallest < 16) throw new Error(`campo com letra menor que 16px em ${path}: ${smallest}px (o iPhone daria zoom)`);
  }
  await page.evaluate(() => localStorage.setItem("klin:novo-registro", "voice")); // o app lembra a aba; volta a "Falar"
  await page.goto(BASE + "/");
  await page.waitForSelector("text=Linha do tempo");
  step("sem zoom: viewport, toque duplo, pinça barrada (1 dedo livre) e campos com 16px+");

  // --- Relatório PDF ---------------------------------------------------------
  // Prévia na tela antes de baixar: mesmo conteúdo do PDF.
  await page.click("#tela button:has-text('Relatório PDF')");
  const recSheet = page.locator("dialog[aria-label='Relatório dos registros']");
  const paper = recSheet.locator("article[aria-label='Prévia do relatório']");
  await paper.waitFor();
  for (const expected of ["Relatório clínico", "Dor no peito ao subir escadas", "R07.4"]) {
    if (!(await paper.textContent()).includes(expected)) throw new Error(`prévia sem "${expected}"`);
  }
  await page.screenshot({ path: `${shots}/25-previa-relatorio.png` });
  const pdfDownload = page.waitForEvent("download");
  await recSheet.locator("button:has-text('Baixar PDF')").click();
  const pdfFile = await pdfDownload;
  await recSheet.waitFor({ state: "hidden" });

  // Perguntar à IA sobre os registros da lista (mesmo conteúdo do relatório).
  await page.click("#tela button:has-text('Perguntar à IA sobre seus registros')");
  const askSheet = page.locator("dialog[aria-label='Perguntar à IA']");
  await askSheet.locator("text=A IA vai analisar").waitFor();
  await askSheet.locator("[aria-label='Sugestões'] >> text=Resuma meus registros").click();
  if ((await askSheet.locator("#ai-question").inputValue()) !== "Resuma meus registros") throw new Error("sugestão não preencheu o campo");
  await askSheet.locator("button:has-text('Analisar')").click();
  await askSheet.locator("[aria-label='Resposta da IA'] >> text=Você registrou as doses em dia").waitFor();
  const askRec = state.analyses.at(-1);
  if (askRec.scope !== "records" || askRec.question !== "Resuma meus registros" || !askRec.context.includes("Dor no peito ao subir escadas")) {
    throw new Error("análise de registros enviou dados errados: " + JSON.stringify({ ...askRec, context: askRec.context.slice(0, 200) }));
  }
  await askSheet.locator("text=Guardada no histórico").waitFor();
  const savedAnalysis = (state.aiAnalyses ?? []).at(-1);
  if (savedAnalysis?.scope !== "records" || !savedAnalysis.answer.includes("Você registrou as doses em dia") || !savedAnalysis.scope_note) {
    throw new Error("resposta não foi guardada no histórico: " + JSON.stringify(savedAnalysis));
  }
  await page.screenshot({ path: `${shots}/26-perguntar-ia.png` });
  await askSheet.locator("button:has-text('Salvar pergunta')").click();
  await askSheet.locator("button[aria-pressed='true']:has-text('Pergunta salva')").waitFor();
  if ((state.aiQuestions ?? []).at(-1)?.question !== "Resuma meus registros") throw new Error("pergunta não foi salva");
  await askSheet.locator("button:has-text('Fechar')").click();
  await askSheet.waitFor({ state: "hidden" });
  step("perguntar à IA sobre os registros: sugestão, resposta, conteúdo enviado e resposta guardada");

  // Reabrindo: a pergunta salva vira atalho e a resposta está no histórico.
  await page.click("#tela button:has-text('Perguntar à IA sobre seus registros')");
  const mine = askSheet.locator("[aria-label='Minhas perguntas']");
  await mine.locator("text=Resuma meus registros").click();
  if ((await askSheet.locator("#ai-question").inputValue()) !== "Resuma meus registros") throw new Error("atalho salvo não preencheu o campo");
  if (await askSheet.locator("[aria-label='Sugestões'] >> text=Resuma meus registros").count()) throw new Error("pergunta salva repetida nas sugestões");
  await askSheet.locator("#ai-question").fill("Quais sintomas se repetem no meu caso?");
  await askSheet.locator("button:has-text('Salvar pergunta')").click();
  await mine.locator("text=Quais sintomas se repetem no meu caso?").waitFor();
  await askSheet.locator("button:has-text('Histórico (1)')").click();
  const historyList = askSheet.locator("[aria-label='Histórico de respostas']");
  await historyList.locator("summary:has-text('Resuma meus registros')").click();
  await historyList.locator("text=Você registrou as doses em dia").waitFor();
  await page.screenshot({ path: `${shots}/26b-historico-ia.png` });
  await historyList.locator("button:has-text('Apagar')").click();
  await answerConfirm("Apagar");
  await askSheet.locator("text=Nenhuma resposta guardada ainda").waitFor();
  if ((state.aiAnalyses ?? []).length !== 0) throw new Error("resposta não foi apagada");
  await askSheet.locator("button:has-text('Voltar')").click();
  await askSheet.locator("[aria-label='Tirar das minhas perguntas: Resuma meus registros']").click();
  await askSheet.locator("[aria-label='Sugestões'] >> text=Resuma meus registros").waitFor();
  if ((state.aiQuestions ?? []).some((q) => q.question === "Resuma meus registros")) throw new Error("pergunta não saiu dos favoritos");
  await askSheet.locator("[aria-label='Fechar']").click();
  await askSheet.waitFor({ state: "hidden" });
  step("perguntas salvas e histórico de respostas: salvar, reusar, reler, apagar");
  const pdfText = (await import("node:fs")).readFileSync(await pdfFile.path(), "latin1");
  if (!pdfText.startsWith("%PDF") || !/klin-relatorio-\d{4}-\d{2}-\d{2}\.pdf/.test(pdfFile.suggestedFilename())) {
    throw new Error("PDF inválido: " + pdfFile.suggestedFilename());
  }
  for (const expected of ["Dor no peito ao subir escadas", "Losartana", "R07.4", "Medicamentos em uso"]) {
    if (!pdfText.includes(expected)) throw new Error(`PDF sem "${expected}"`);
  }
  if (pdfText.includes("Estou com dor no peito")) throw new Error("a transcrição bruta não deveria ir ao PDF");
  (await import("node:fs")).copyFileSync(await pdfFile.path(), `${shots}/relatorio.pdf`);
  step(`relatório PDF gerado no aparelho (${pdfFile.suggestedFilename()})`);

  // --- Modo offline ------------------------------------------------------------
  await ctx.setOffline(true);
  await page.click("a[href$='/gravar/']");
  await page.waitForSelector("[aria-label='Começar a gravar']");
  await page.waitForSelector("text=Sem internet. Você pode gravar");
  await page.click("[aria-label='Começar a gravar']");
  await page.waitForSelector("[role=timer]");
  await page.waitForTimeout(1500);
  await page.click("[aria-label='Parar gravação']");
  await page.click("text=Enviar para a IA");
  await page.waitForSelector("text=Gravação salva no aparelho");
  const recordsBefore = state.records.length;
  await page.click("text=Voltar à linha do tempo");
  await page.waitForSelector("text=1 gravação aguardando envio");
  await page.screenshot({ path: `${shots}/12-offline.png`, fullPage: true });
  if (state.records.length !== recordsBefore) throw new Error("não deveria ter enviado sem internet");
  step("sem internet: gravação guardada no aparelho");

  await ctx.setOffline(false);
  await page.waitForSelector("text=gravação aguardando envio", { state: "detached", timeout: 15_000 });
  const synced = state.records.at(-1);
  if (state.records.length !== recordsBefore + 1 || !synced.client_id || !synced.recorded_at || synced.status !== "ready") {
    throw new Error("sincronização errada: " + JSON.stringify(synced));
  }
  if (Date.now() - Date.parse(synced.recorded_at) < 1000) throw new Error("recorded_at deveria ser a hora da gravação, não a do envio");
  step("conexão voltou: enviada sozinha (horário original) e processada pela IA");

  // --- Registro escrito à mão --------------------------------------------------
  await page.click("[aria-label='Novo registro']");
  await page.waitForURL("**/gravar/");
  await page.click("[role=tab]:has-text('Escrever')");

  // Ditado: o texto aparece enquanto fala (reconhecedor simulado pelo teste).
  await page.click("button:has-text('Ditar')");
  await page.waitForSelector("text=Ouvindo… fale normalmente");
  await page.evaluate(() => window.__speech.say("dor de cabeça há dois", false));
  await page.waitForSelector("text=dor de cabeça há dois…");
  await page.evaluate(() => window.__speech.say("dor de cabeça há dois dias vírgula pior à noite ponto final", true));
  await page.evaluate(() => window.__speech.say("tomei dipirona", true));
  await page.waitForFunction(() => document.querySelector("#record-text")?.value === "Dor de cabeça há dois dias, pior à noite. Tomei dipirona");
  if (!(await page.$eval("#record-text", (el) => el.readOnly))) throw new Error("campo deveria ficar só leitura enquanto dita");
  await page.screenshot({ path: `${shots}/21-ditado.png`, fullPage: true });
  await page.click("button:has-text('Parar')");
  await page.waitForSelector("button:has-text('Ditar')");
  if (await page.$eval("#record-text", (el) => el.readOnly)) throw new Error("campo deveria voltar a aceitar digitação");
  step("ditado: texto aparece enquanto fala, com pontuação falada e maiúsculas");

  await page.fill("#record-text", "Dor de cabeça há dois dias, melhora com repouso.");
  // Sair com texto não salvo: pergunta na caixa do app; "Ficar" mantém o texto.
  await page.click("nav >> text=Registros");
  await page.locator("dialog[role=alertdialog][open] >> text=Sair desta tela?").waitFor();
  await page.waitForTimeout(300); // depois da animação de entrada
  await page.screenshot({ path: `${shots}/18-confirmar-sair.png` });
  await answerConfirm("Ficar");
  if ((await page.inputValue("#record-text")) !== "Dor de cabeça há dois dias, melhora com repouso.") throw new Error("texto perdido");
  if (!page.url().endsWith("/gravar/")) throw new Error("saiu da tela mesmo escolhendo Ficar");
  await page.screenshot({ path: `${shots}/19-escrever.png`, fullPage: true });
  await page.click("button:has-text('Organizar com IA')");
  await page.waitForSelector("text=Nota criada");
  const escrito = state.records.find((r) => r.transcript === "Dor de cabeça há dois dias, melhora com repouso.");
  if (!escrito || escrito.audio_path || !state.calls.includes("IA texto")) throw new Error("registro escrito não foi para a IA: " + JSON.stringify(escrito));
  await page.click("text=Abrir nota");
  await page.waitForSelector("h1:has-text('Dor de cabeça leve')");
  await page.waitForSelector("text=Texto original");
  step("registro escrito: a IA organizou o texto (sem gravação)");

  // Sem IA: salva como está, com título, categoria e gravidade escolhidos.
  await page.click("nav >> text=Registros");
  await page.click("[aria-label='Novo registro']");
  await page.waitForURL("**/gravar/");
  await page.waitForSelector("#record-text"); // lembrou a última escolha (Escrever)
  await page.fill("#record-text", "Fiz exame de sangue em jejum. Resultado sai em 5 dias.");
  await page.click("[role=switch][aria-label='Organizar com IA']");
  await page.fill("#record-title", "Exame de sangue");
  await page.click("[role=radio]:has-text('Exames')");
  await page.click("[role=radio]:has-text('Atenção')");
  await page.click("button:has-text('Salvar registro')");
  await page.waitForSelector("h1:has-text('Exame de sangue')");
  const manual = state.records.find((r) => r.title === "Exame de sangue");
  if (manual.category !== "exam" || manual.severity !== "attention" || manual.status !== "ready" || manual.ai_provider !== "manual") {
    throw new Error("registro manual errado: " + JSON.stringify(manual));
  }
  step("registro escrito sem IA: salvo com título, categoria e gravidade escolhidos");

  // Editar dia/horário, categoria e gravidade de um registro salvo.
  await page.click("#tela [aria-label='Editar dia, categoria e gravidade']");
  const editSheet = page.locator("dialog[aria-label='Editar registro']");
  await editSheet.waitFor();
  await editSheet.locator("#edit-date").fill("2026-11-10");
  await editSheet.locator("#edit-time").click();
  const timeSheet = page.locator("dialog[aria-label='Horário do registro']");
  await timeSheet.locator("[role=radio][aria-label='07 h']").click();
  await timeSheet.locator("[role=radio][aria-label='45 min']").click();
  await timeSheet.locator("button:has-text('Confirmar')").click();
  await timeSheet.waitFor({ state: "hidden" });
  await editSheet.locator("[aria-label='Horário do registro: 07:45']").waitFor();
  await editSheet.locator("[role=radio]:has-text('Pressão')").click();
  await editSheet.locator("[role=radio]:has-text('Alerta')").click();
  await page.screenshot({ path: `${shots}/22-editar-registro.png` });
  await editSheet.locator("button:has-text('Salvar')").click();
  await editSheet.waitFor({ state: "hidden" });
  await page.waitForSelector("#tela header >> text=10/11/2026, 07:45");
  await page.waitForSelector("#tela header >> text=Pressão");
  if (manual.category !== "blood_pressure" || manual.severity !== "critical" || new Date(manual.recorded_at).getTime() !== new Date(2026, 10, 10, 7, 45).getTime()) {
    throw new Error("edição não chegou ao banco: " + JSON.stringify(manual));
  }
  if (!(await page.$("#tela header.border-red-500"))) throw new Error("registro grave deveria ficar em vermelho");
  // Linha do tempo já mostra a mudança na hora (guardado atualizado).
  await page.click("nav >> text=Registros");
  await page.waitForSelector("#tela a[href*='/registro/'] >> text=Exame de sangue");
  step("editar registro salvo: dia/horário, categoria e gravidade (nota e linha do tempo)");
  // volta a "Falar" para os próximos testes
  await page.evaluate(() => localStorage.setItem("klin:novo-registro", "voice"));

  // --- Ajustes: notificações e privacidade --------------------------------
  // Perfil já guardado (pré-carregado pela linha do tempo): Ajustes abriria na hora.
  // Para testar a falha, apaga o guardado e abre a tela do zero.
  const perfilGuardado = await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("klin:tela:") && k.endsWith(":perfil")));
  if (!perfilGuardado) throw new Error("perfil não foi pré-carregado pela linha do tempo");
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.endsWith(":perfil")).forEach((k) => localStorage.removeItem(k)));
  state.failProfileOnce = true; // bug corrigido: antes ficava carregando para sempre
  allowed500 = 1;
  await page.goto(BASE + "/ajustes/");
  await page.waitForSelector("text=Tentar de novo");
  await page.locator("text=Tentar de novo").first().click();
  // Menu de Ajustes: valores atuais à direita das linhas.
  await page.locator("nav[aria-label='Notificações'] >> text=Discreta").waitFor();
  await page.locator("nav[aria-label='Notificações'] >> text=São Paulo").waitFor();
  step("Ajustes: falha ao carregar o perfil mostra o erro e \"Tentar de novo\" recupera");
  await page.click("[role=switch][aria-label='Notificações neste aparelho']");
  await page.waitForSelector("text=Notificações ativadas ✓");
  await page.waitForSelector("text=Ativadas: aviso na hora de cada dose.");
  if (state.subs.length !== 1 || state.subs[0].endpoint !== "https://push.exemplo/aparelho-e2e" || !state.subs[0].p256dh) {
    throw new Error("inscrição não registrada: " + JSON.stringify(state.subs));
  }
  if ((await page.evaluate(() => window.__subscribeKeyLength)) !== 65) throw new Error("chave VAPID pública mal convertida");
  step("ativar notificações registra a inscrição do aparelho");

  await page.click("text=Enviar notificação de teste");
  await page.waitForSelector("text=Notificação de teste enviada.");
  await page.click("text=Tela bloqueada");
  await page.locator("dialog[aria-label='O que aparece na tela bloqueada'] >> text=Mostrar o nome do remédio").click();
  await page.waitForSelector("text=Preferência salva.");
  if (state.profile.notification_privacy !== "detailed") throw new Error("privacidade não salva");
  await page.screenshot({ path: `${shots}/10-ajustes.png`, fullPage: true });
  step("notificação de teste e privacidade na tela bloqueada");

  // Push de verdade entregue ao Service Worker real (CDP), no formato do disparar-lembretes.
  const cdp = await ctx.newCDPSession(page);
  const registrationId = await new Promise((resolve) => {
    cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
      const r = registrations.find((x) => x.scopeURL === `${BASE}/` && !x.isDeleted);
      if (r) resolve(r.registrationId);
    });
    cdp.send("ServiceWorker.enable");
  });
  await cdp.send("ServiceWorker.deliverPushMessage", {
    origin: BASE,
    registrationId,
    data: JSON.stringify({
      title: "Klin",
      body: "Hora da sua medicação programada.",
      url: "medicamentos/",
      tag: `dose-${omeprazol.id}`,
      dose: { medicationId: omeprazol.id, scheduledFor: new Date().toISOString() },
    }),
  });
  let n = null;
  for (let i = 0; i < 40 && !n; i++) {
    n = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      const list = await reg.getNotifications();
      return list.length
        ? { title: list[0].title, body: list[0].body, tag: list[0].tag, actions: list[0].actions.map((a) => a.action), data: list[0].data, icon: list[0].icon, badge: list[0].badge }
        : null;
    });
    if (!n) await page.waitForTimeout(250);
  }
  if (!n) throw new Error("o Service Worker não exibiu a notificação");
  if (n.body !== "Hora da sua medicação programada." || !n.actions.includes("mark-taken") || n.data.dose.medicationId !== omeprazol.id || n.data.url !== "medicamentos/") {
    throw new Error("notificação exibida errada: " + JSON.stringify(n));
  }
  if (!n.icon.endsWith("/icons/transparent-192.png") || !n.badge.endsWith("/icons/badge-96.png")) {
    throw new Error("ícones da notificação errados: " + JSON.stringify({ icon: n.icon, badge: n.badge }));
  }
  step("Service Worker exibe o push com o botão \"Marcar como tomado\" (só o ícone pequeno do Klin)");

  // "Marcar como tomado" na notificação registra a dose SEM abrir o app (assinatura da dose).
  const markDose = async (scheduledFor, { exp = Date.parse(scheduledFor) + DOSE_TOKEN_TTL_MS, tamper = false } = {}) => {
    let token = await signDose(E2E_DOSE_SECRET, { medicationId: omeprazol.id, userId: state.profile.id, scheduledFor, exp });
    if (tamper) token = (token[0] === "A" ? "B" : "A") + token.slice(1);
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin: BASE,
      registrationId,
      data: JSON.stringify({
        title: "Klin",
        body: "Hora da sua medicação programada.",
        url: "medicamentos/",
        tag: `dose-${omeprazol.id}`,
        dose: { medicationId: omeprazol.id, scheduledFor, exp, token, markUrl: "http://127.0.0.1:54321/functions/v1/marcar-dose" },
      }),
    });
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(BASE));
    if (!sw) throw new Error("Service Worker não encontrado");
    await sw.evaluate(async (tag) => {
      for (let i = 0; i < 40; i++) {
        const [n] = await self.registration.getNotifications({ tag });
        if (n?.data?.dose?.token) {
          self.dispatchEvent(new NotificationEvent("notificationclick", { notification: n, action: "mark-taken" }));
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("notificação com assinatura não exibida");
    }, `dose-${omeprazol.id}`);
  };
  const confirmation = async () => {
    for (let i = 0; i < 40; i++) {
      const body = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).find((x) => x.tag.startsWith("tomada-"))?.body ?? null);
      if (body) return body;
      await page.waitForTimeout(100);
    }
    return null;
  };
  const doseAt = new Date(Math.floor(Date.now() / 60000) * 60000 - 5 * 60000).toISOString();
  const pagesBefore = ctx.pages().length;
  await markDose(doseAt);
  const ok1 = await confirmation();
  if (ok1 !== "Dose registrada ✓") throw new Error("sem confirmação da dose: " + ok1);
  const viaPush = state.logs.find((l) => l.medication_id === omeprazol.id && Date.parse(l.scheduled_for) === Date.parse(doseAt));
  if (viaPush?.source !== "notification" || viaPush.status !== "taken") throw new Error("dose não registrada pela notificação: " + JSON.stringify(viaPush));
  if (ctx.pages().length !== pagesBefore) throw new Error("não deveria abrir o app");
  await page.evaluate(async () => {
    for (const n of await (await navigator.serviceWorker.ready).getNotifications()) n.close();
  });
  await markDose(doseAt); // mesmo horário de novo: não duplica
  if ((await confirmation()) !== "Essa dose já estava registrada ✓") throw new Error("segunda marcação deveria avisar que já estava registrada");
  if (state.logs.filter((l) => l.medication_id === omeprazol.id && Date.parse(l.scheduled_for) === Date.parse(doseAt)).length !== 1) throw new Error("dose duplicada");
  step("\"Marcar como tomado\" na notificação registra a dose sem abrir o app (e não duplica)");

  // Assinatura adulterada: a função recusa e o app abre para marcar lá (reserva de antes).
  const before = state.logs.length;
  const opened = ctx.waitForEvent("page", { timeout: 5000 }).catch(() => null);
  await markDose(new Date(Date.parse(doseAt) - 60 * 60000).toISOString(), { tamper: true });
  const fallbackPage = await opened;
  const navigated = fallbackPage ?? page;
  await navigated.waitForURL((u) => u.pathname.endsWith("/medicamentos/") && u.searchParams.has("tomar"), { timeout: 5000 });
  if (state.logs.length !== before) throw new Error("assinatura adulterada registrou dose");
  if (fallbackPage) await fallbackPage.close();
  else await page.goto(`${BASE}/ajustes/`);
  step("assinatura inválida é recusada e o app abre para marcar (reserva)");

  // Relatório dos remédios em PDF: agenda, adesão e histórico (com a dose marcada pela notificação).
  await page.goto(`${BASE}/medicamentos/`);
  // Botão no topo, ao lado do título (antes ficava escondido no fim da lista).
  const topReport = page.locator("#tela button:has-text('Relatório PDF')");
  const topBox = await topReport.boundingBox();
  if (!topBox || topBox.y > 300) throw new Error("botão do relatório deveria ficar no topo: " + JSON.stringify(topBox));
  await topReport.click();
  const medSheet = page.locator("dialog[aria-label='Relatório dos remédios']");
  await medSheet.locator("article[aria-label='Prévia do relatório'] >> text=últimos 30 dias").waitFor();
  await medSheet.locator("[role=radio]:has-text('7 dias')").click();
  // Trocar o período refaz a prévia.
  const medPaper = medSheet.locator("article[aria-label='Prévia do relatório']");
  await medPaper.locator("text=últimos 7 dias").waitFor();
  for (const expected of ["Omeprazol", "Histórico de doses", "pela notificação"]) {
    if (!(await medPaper.textContent()).includes(expected)) throw new Error(`prévia de remédios sem "${expected}"`);
  }
  await page.screenshot({ path: `${shots}/24-relatorio-remedios.png` });
  const medPdfDownload = page.waitForEvent("download");
  await medSheet.locator("button:has-text('Baixar PDF')").click();
  const medPdf = await medPdfDownload;
  await medSheet.waitFor({ state: "hidden" });
  const medPdfText = (await import("node:fs")).readFileSync(await medPdf.path(), "latin1");
  if (!medPdfText.startsWith("%PDF") || !/^klin-remedios-\d{4}-\d{2}-\d{2}\.pdf$/.test(medPdf.suggestedFilename())) {
    throw new Error("PDF de remédios inválido: " + medPdf.suggestedFilename());
  }
  for (const expected of ["Relatório de remédios", "Omeprazol", "Vitamina D", "Adesão no período", "Histórico de doses", "pela notificação", "últimos 7 dias"]) {
    if (!medPdfText.includes(expected)) throw new Error(`PDF de remédios sem "${expected}"`);
  }
  if (!state.calls.includes("GET medication_logs relatorio")) throw new Error("relatório não buscou o histórico");
  step("relatório dos remédios em PDF: período, adesão e histórico dose a dose");

  // Perguntar à IA sobre os remédios, com período e pergunta escrita.
  await page.click("#tela button:has-text('Perguntar à IA sobre seus remédios')");
  const askMed = page.locator("dialog[aria-label='Perguntar à IA']");
  await askMed.locator("[aria-label='Período da análise'] >> text=7 dias").click();
  await askMed.locator("#ai-question").fill("Como está minha adesão ao omeprazol?");
  await askMed.locator("button:has-text('Analisar')").click();
  await askMed.locator("[aria-label='Resposta da IA']").waitFor();
  const askM = state.analyses.at(-1);
  if (askM.scope !== "medications" || !askM.context.includes("Omeprazol") || !askM.context.includes("últimos 7 dias") || !askM.context.includes("Histórico de doses")) {
    throw new Error("análise de remédios enviou dados errados: " + askM.context.slice(0, 300));
  }
  await askMed.locator("button:has-text('Perguntar outra coisa')").click();
  if ((await askMed.locator("#ai-question").inputValue()) !== "") throw new Error("nova pergunta deveria começar vazia");
  await askMed.locator("[aria-label='Fechar']").click();
  step("perguntar à IA sobre os remédios: período, pergunta escrita e histórico enviado");
  await page.goto(`${BASE}/ajustes/`); // o bloqueio, a seguir, começa nos Ajustes

  // --- Bloqueio por PIN e biometria ------------------------------------------
  // Autenticador virtual de plataforma (digital/rosto) pelo DevTools.
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });
  await page.reload();
  await page.waitForSelector("text=Bloqueio por PIN");
  await page.click("text=Bloqueio por PIN");
  await page.fill("#new-pin", "1234");
  await page.fill("#confirm-pin", "1234");
  await page.click("text=Salvar PIN");
  await page.waitForSelector("text=Evite sequências");
  await page.fill("#new-pin", "2580");
  await page.fill("#confirm-pin", "2580");
  await page.click("text=Salvar PIN");
  await page.waitForSelector("text=Bloquear agora");
  const stored = await page.evaluate(() => localStorage.getItem("klin:lock"));
  if (!stored || stored.includes("2580")) throw new Error("PIN guardado em texto puro: " + stored);
  await page.click("[role=switch][aria-label='Desbloquear com digital ou rosto']");
  await page.waitForSelector("text=Biometria ativada.");
  step("PIN criado (só o hash fica no aparelho) e biometria registrada");

  // Ao travar, a biometria é pedida sozinha: com a "digital" aceita, destrava sem toque.
  await page.click("text=Bloquear agora");
  await page.waitForSelector("text=Bloquear agora");
  if (!(await page.locator("nav").count())) throw new Error("a biometria automática não destravou");
  step("ao travar, pede a digital/rosto sozinho e destrava");

  // "Digital" recusada: o pedido automático falha e a tela fica bloqueada.
  const setVerified = (ok) => cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: ok });
  await setVerified(false);
  await page.click("text=Bloquear agora");
  await page.waitForSelector("text=App bloqueado");
  await page.waitForTimeout(500);
  if (await page.locator("nav").count()) throw new Error("conteúdo visível com o app bloqueado");
  await page.fill("#unlock-pin", "1111");
  await page.click("text=Desbloquear com PIN");
  await page.waitForSelector("text=PIN incorreto. 9 tentativas restantes");
  await page.screenshot({ path: `${shots}/13-bloqueio.png` });
  await setVerified(true);
  await page.click("text=Desbloquear com digital / rosto");
  await page.waitForSelector("text=Bloquear agora");
  step("biometria recusada: fica bloqueado; PIN errado recusado; botão de digital destrava");

  await setVerified(false);
  // Recarga com o app na tela (o Next faz isso ao trocar de tela após publicar): não trava.
  await page.reload();
  await page.waitForSelector("text=Bloquear agora");
  if (await page.locator("text=App bloqueado").count()) throw new Error("recarga com o app aberto travou o app");
  step("recarga da página com o app na tela não pede a digital de novo");

  // Fechar o app (fica oculto antes de sair) e abrir de novo: trava.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.reload();
  await page.waitForSelector("text=App bloqueado");
  await page.fill("#unlock-pin", "2580");
  await page.click("text=Desbloquear com PIN");
  await page.waitForSelector("text=Bloquear agora");
  step("ao reabrir o app fica bloqueado; PIN certo desbloqueia");

  // --- Telas instantâneas: com o banco lento (4 s), toda tela abre em até 1 s ---
  await page.route("**/rest/v1/**", async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue().catch(() => {});
  });
  const fast = { timeout: 1000 };
  const t0 = Date.now();
  await page.click("nav >> text=Registros");
  await page.waitForSelector("a[href*='/registro/'] >> text=Dor no peito ao subir escadas", fast);
  await page.click("a[href*='/registro/'] >> text=Dor no peito ao subir escadas");
  await page.waitForSelector("text=Queixa principal", fast);
  await page.click("nav >> text=Remédios");
  await page.waitForSelector("li:has-text('Vitamina D') >> text=Todos os dias às 08:00 e 20:00", fast);
  await page.click("li:has-text('Vitamina D') >> h2");
  await page.waitForSelector("h1:has-text('Vitamina D')", fast);
  await page.click("text=Editar horários");
  await page.waitForFunction(() => document.querySelector("#name")?.value === "Vitamina D", null, fast);
  await page.click("nav >> text=Ajustes");
  await page.locator("#tela nav[aria-label='Notificações'] >> text=Com o nome").waitFor(fast);
  await page.waitForSelector("header button[aria-label^='Lembretes']", fast);
  await page.unroute("**/rest/v1/**");
  step(`telas instantâneas: 6 telas abriram com o banco atrasado 4 s (total ${Date.now() - t0} ms)`);

  await page.click("text=Sair da conta");
  await page.locator("dialog[role=alertdialog][open] >> text=Sair da conta?").waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/20-confirmar-sair-conta.png` });
  await answerConfirm("Sair");
  await page.waitForURL("**/entrar/");
  if (await page.evaluate(() => localStorage.getItem("klin:lock"))) throw new Error("PIN ficou no aparelho após sair");
  const leftover = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("klin:tela:")));
  if (leftover.length) throw new Error("telas guardadas ficaram no aparelho após sair: " + leftover.join(", "));
  if (state.subs.length !== 0 || !state.calls.includes("DELETE push_subscriptions")) throw new Error("sair não removeu a inscrição do aparelho");
  step("sair remove a inscrição deste aparelho");
  await page.goto(BASE + "/");
  await page.waitForURL("**/entrar/");

} catch (err) {
  console.log("FALHOU:", err.message);
  await page.screenshot({ path: `${shots}/erro.png`, fullPage: true });
  problems.push("teste: " + err.message);
}
problems.push(...unexpected404.map((u) => `404 inesperado: ${u}`));
console.log("problemas:", problems.length ? problems : "nenhum");
await browser.close();
process.exit(problems.length ? 1 : 0);
