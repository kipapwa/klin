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

// Pré-carregamento interno do Next no export estático: pede
// "<rota>/__next.<rota>.__PAGE__.txt", mas o build grava "__next.<rota>/__PAGE__.txt".
// A navegação funciona; o 404 é esperado (limitação do Next 16.4).
const KNOWN_404 = /\/__next\.[^/]+\.__PAGE__\.txt/;

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
page.on("dialog", (d) => d.accept()); // confirmações do app (ex.: "Sair da conta?")
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
  if ((await page.locator("input[type=time]").count()) !== 3) throw new Error("adicionar horário não criou o 3º campo");
  await page.click("[aria-label='Remover horário 00:00']"); // remove o que acabou de adicionar
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

  // --- Relatório PDF ---------------------------------------------------------
  const pdfDownload = page.waitForEvent("download");
  await page.click("text=Relatório PDF");
  const pdfFile = await pdfDownload;
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
  await page.locator("nav[aria-label='Notificações'] >> text=Com o nome").waitFor(fast);
  await page.waitForSelector("header button[aria-label^='Lembretes']", fast);
  await page.unroute("**/rest/v1/**");
  step(`telas instantâneas: 6 telas abriram com o banco atrasado 4 s (total ${Date.now() - t0} ms)`);

  await page.click("text=Sair");
  await page.waitForURL("**/entrar/");
  if (await page.evaluate(() => localStorage.getItem("klin:lock"))) throw new Error("PIN ficou no aparelho após sair");
  if (await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("klin:tela:")))) throw new Error("telas guardadas ficaram no aparelho após sair");
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
