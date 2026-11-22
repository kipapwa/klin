# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Atue como um Engenheiro de Software Sênior e Arquiteto de Sistemas Full-Stack especializado em HealthTech e PWAs. Vamos construir um aplicativo web de *Registros Médicos (Medical Notes PWA)* neste repositório.

### Diretriz de Execução (Claude Code + Segurança)
- *Antes de escrever qualquer código de backend, autenticação ou banco de dados, aplique rigorosamente as regras da seção 4 (Segurança e Privacidade)*: blindagem de chaves de API (somente no servidor), prevenção contra vazamento de dados sensíveis (PHI/LGPD — nunca registrar conteúdo clínico em logs, mensagens de erro ou analytics), validação e sanitização de todos os inputs no servidor e configuração segura do Supabase (RLS em todas as tabelas; chave secreta/`service_role` só em Edge Function).
- *Observação sobre skills:* o app segue o modelo das skills do usuário (site estático no GitHub Pages + Supabase Edge Functions publicadas por GitHub Actions). A `ia-reserva-groq` foi aplicada na Fase 2. A `proteger-codigo` (repositório privado + site público minificado) é opcional e só deve ser usada se o usuário pedir.
- *Execução Incremental:* Não tente gerar todo o aplicativo em uma única resposta. Divida a implementação em fases claras, validando a estrutura e criando os arquivos passo a passo no workspace.

---

### Comandos
- `npm run dev` — servidor de desenvolvimento (`npx next dev --experimental-https` para testar Web Push).
- `npm run build` — export estático em `out/` (o que vai para o GitHub Pages). No Git Bash, ao testar com basePath, use `MSYS_NO_PATHCONV=1 NEXT_PUBLIC_BASE_PATH=/klin npm run build`: sem isso o Git Bash converte `/klin` num caminho do Windows.
- `npm run lint` — ESLint. `npm run typecheck` — `next typegen` + `tsc`. Rodar `tsc` direto, sem o typegen, dá erro falso em `LayoutProps`.
- `npm test` — testes unitários (`supabase/functions/_shared/*.test.ts` e `src/lib/*.test.ts`, `node:test` com o TypeScript nativo do Node 24). Um arquivo só: `node --test src/lib/ics.test.ts`. Nos módulos testados assim, os imports relativos levam a extensão `.ts` (`allowImportingTsExtensions` está ligado).
- `npm run test:e2e` — gera o site apontando para um **Supabase falso** (`e2e/mock-supabase.mjs`) e percorre login → gravação (microfone simulado) → IA → nota → painel no Chromium. As capturas ficam em `e2e/shots/`. Precisa de `npx playwright install chromium` uma vez. Ao criar uma tela ou chamada nova ao Supabase, acrescente a rota no mock e o passo em `e2e/flow.mjs`.
- `npm run test:db` — roda `supabase/schema.sql` num Postgres em memória (PGlite) com imitações de `auth`/`storage` e testa RLS, gatilhos e cota. Rode sempre que mexer no schema.
- `npm run check:functions` — checagem de tipos das Edge Functions com o Deno (via npx).
- Banco: aplicar `supabase/schema.sql` no SQL Editor do Supabase (idempotente), **antes** de publicar código que dependa da mudança.
- Publicação: push na `main` dispara `.github/workflows/deploy-site.yml` (Pages) e/ou `deploy-functions.yml` (Edge Functions + segredos).

### Notas de arquitetura
- *Hospedagem = GitHub Pages (estático):* `next.config.ts` usa `output: "export"`. Não existem Route Handlers, Server Actions, Proxy, `headers()`, cookies nem Cache Components. Todo código com segredo vai para `supabase/functions/` (Deno). O site fala direto com o Supabase usando a chave pública, protegido pelo RLS.
- *basePath:* o site pode ficar em `/<repo>/`. Caminhos absolutos no código passam por `withBase()` (`src/lib/base-path.ts`); o manifest já usa. O Service Worker resolve tudo relativo a `self.registration.scope`.
- *Next.js 16:* tem mudanças incompatíveis com versões anteriores. Antes de usar uma API do Next, consulte `node_modules/next/dist/docs/` (ver `AGENTS.md`).
- *Edge Functions:* a lógica fica em `supabase/functions/_shared/`, em TS puro sem APIs do Deno, para ser testada no Node. O `index.ts` de cada função é a casca Deno (`Deno.serve`, `npm:@supabase/supabase-js@<versão exata>`). `supabase/functions` fica fora do `tsconfig` do Next. O projeto usa o **sistema novo de chaves** do Supabase: nas funções, pegue as chaves com `publishableKey(env)`/`secretKey(env)` (`_shared/supabase-keys.ts`, que lê o JSON de `SUPABASE_PUBLISHABLE_KEYS`/`SUPABASE_SECRET_KEYS` e só depois as legadas). Nunca leia `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` direto.
- *IA (`processar-registro`):* `structureAudio` tenta o Gemini (`generateContent` com áudio inline até 14 MB e `responseJsonSchema`) e, em qualquer falha, o Groq (Whisper, depois Llama em `json_object`). Prompt e validação (`validateClinicalNote`) são os mesmos para as duas. A função usa o token do usuário (RLS), gasta 1 da cota (`ai_take_quota`), reserva o registro (`draft/failed → processing`), grava a nota e cria medicamentos `source='ai'` com `notifications_enabled=false` (o usuário confere antes). Os sem intervalo voltam em `medicationsNeedingReview`.
- *Service Worker:* JS puro em `public/sw.js`, registrado por `src/components/pwa/service-worker-register.tsx`. O contrato do payload de push está no topo do arquivo. "Marcar como tomado" registra a dose pela função `marcar-dose` com a assinatura do lembrete (ver Push); sem ela, abre `medicamentos/?tomar=<id>&horario=<iso>`. A privacidade do texto (discreto × detalhado) é decidida no servidor, não no SW.
- *Site (Fase 3):* tudo é Client Component sobre páginas estáticas. `SessionProvider` (no layout) acompanha a sessão do supabase-js (guardada no aparelho); `AppShell` envolve as telas logadas e redireciona para `/entrar/` sem sessão. O acesso a dados fica em `src/lib/records.ts`, que lança `UserFacingError` com mensagens prontas e sem dados clínicos. Rotas com id usam query string (`/registro/?id=`), porque o export estático não gera rotas dinâmicas. Login: e-mail + código OTP (`signInWithOtp`/`verifyOtp`), não link mágico (no iPhone, o link abre o Safari em vez do PWA).
- *Gravação:* `use-recorder.ts` (MediaRecorder, 32 kbit/s, máx. 30 min ≈ 7 MB, abaixo dos 14 MB do envio direto ao Gemini). Fluxo: upload para `audio/<user_id>/<client_id>.<ext>` → insert do registro em `draft` (se falhar, apaga o áudio) → `functions.invoke("processar-registro")`.
- *Medicamentos (Fase 4):* a agenda é a grade `starts_at + k × intervalo`. O banco guarda em `next_dose_at` a próxima dose ainda não registrada. O gatilho de inserção usa tolerância de 1 h (a dose de "começar agora" fica marcável) e `medication_logs` avança a grade. As regras de tela ficam em `src/lib/doses.ts` (puro, testado):
  - `dueSlot`: dá para marcar até 1 h antes; com doses perdidas, registra a mais recente;
  - `isPendingSlot`: valida o horário vindo da notificação;
  - `adherence`: doses previstas pela grade × tomadas.
  Registrar a mesma dose duas vezes vira `"already"` (unique `medication_id, scheduled_for`). A confirmação vinda do push chega em `/medicamentos/?tomar=<id>&horario=<iso>`.
- *Dado clínico nunca vai na URL:* o GitHub Pages recebe a query string nos pedidos de navegação do Next (aparece nos logs dele). Só ids opacos (uuid) e horários vão na URL. Para passar texto entre telas (ex.: remédio a cadastrar a partir do resumo da IA), use o sessionStorage (`storePrefill`/`peekPrefill`/`clearPrefill`).
- *Hora atual nas telas:* `useNow()` (`useSyncExternalStore`, tique de 30 s). Não chame `Date.now()` durante a renderização: a regra de pureza do eslint-plugin-react-hooks reclama. Interruptores usam `components/ui/switch.tsx` (`role="switch"`).
- *Push (Fase 5):*
  - Web Push implementado à mão com WebCrypto em `supabase/functions/_shared/webpush.ts` (VAPID ES256 + aes128gcm), sem a lib `web-push`. O teste confere byte a byte com o vetor da RFC 8291 e roda no Node e no Deno (`npm run test:deno`). Não troque por biblioteca sem manter esse teste.
  - Fluxo: o Supabase Cron (`supabase/cron.sql`, a cada minuto, segredo no Vault) chama `disparar-lembretes` (`--no-verify-jwt` + `x-cron-secret`). A função chama `claim_due_doses()`, que calcula a dose atual **pela grade**: dose ignorada não trava os próximos lembretes. `notified_for` evita repetir o mesmo horário, e doses com mais de 30 min não são notificadas.
  - O texto (discreto × detalhado) sai de `dosePayload` (`_shared/reminders.ts`), conforme `profiles.notification_privacy`.
  - **Marcar como tomado na notificação** (sem abrir o app): `disparar-lembretes` põe no payload uma assinatura HMAC da dose (`_shared/dose-token.ts`; chave derivada do `CRON_SECRET`; vale para aquele remédio + dono + horário, até 24 h). O `sw.js` manda para a função `marcar-dose` (`--no-verify-jwt`), que confere a assinatura e grava em `medication_logs` com `source='notification'`, e mostra "Dose registrada ✓". Sem assinatura ou com falha (sem internet, expirada), abre `medicamentos/?tomar=` como antes. As telas de remédios abertas recebem `klin:dose-marcada` (`useDoseMarked`). No E2E, o mock confere a assinatura com o mesmo código.
  - Inscrição do aparelho: `src/lib/push.ts` → RPC `register_push_subscription`. Sair da conta chama `forgetThisDevice()`.
  - E2E: o push é entregue ao `sw.js` real via CDP (`ServiceWorker.deliverPushMessage`). Isso exige o Chromium completo (`channel: "chromium"`), porque o headless shell não exibe notificações. A inscrição em si é simulada, pois não há FCM no teste.
- *Fase 6:*
  - **Linha do tempo:** a página `/` (`timeline-screen.tsx` + `record-list.tsx`) aplica no banco os filtros de categoria e gravidade e a busca `textSearch` no índice `search` (português). Os filtros ficam só no estado da tela.
  - **PDF:** conteúdo em `lib/report.ts` (puro, testado; `pdfSafe` limita o texto ao Latin-1 das fontes padrão) e desenho em `lib/report-pdf.ts` (jsPDF com `import()` dinâmico).
  - **Prévia dos relatórios:** nenhum relatório baixa direto. `components/reports/report-preview.tsx` (`ReportPreviewSheet`) mostra o mesmo `ReportDoc` do PDF na tela (`ReportPaper`, texto puro) com "Baixar PDF" fixo embaixo. `lib/export-report.ts` separa montar (`prepareRecordsReport`/`prepareMedicationReport`) de baixar (`downloadReport`). Rodapé fixo numa folha: `sticky -bottom-5 -mx-5 -mb-5 pb-5` (cobre a margem da folha).
  - **PDF dos remédios:** conteúdo em `lib/medication-report.ts` (puro, testado; fuso explícito). Para cada remédio, agenda, período, adesão e histórico dose a dose: as doses previstas pela grade (`slotAfter`) + os registros, com "Sem registro" para dose passada não marcada. Botão `components/medications/medication-report-button.tsx` (período de 7/30/90 dias) na lista (todos) e no detalhe (só aquele). Busca os registros com `listLogsSince`; o desenho reusa `report-pdf.ts`.
  - **Bloqueio:** `lib/pin.ts` (PBKDF2) + `lib/app-lock.ts` (estado via `useSyncExternalStore`; trava ao abrir e após 1 min em segundo plano). Recarga com o app visível não trava (aviso de 5 s no sessionStorage, gravado no `pagehide`; a ordem pagehide → oculto distingue recarga de fechar o app). Sem isso, o Next recarregava a página ao trocar de tela após uma publicação (versões diferentes no cache do SW) e pedia a digital de novo + `components/lock/lock-gate.tsx`, dentro do `AppShell`.
  - **Offline:** `lib/offline-store.ts` (IndexedDB) + `lib/sync.ts` (envio em ordem, uma execução por vez) + `components/offline/*`. `createRecordFromAudio` exige um `clientId` e é idempotente: áudio duplicado no Storage e `23505` no insert são tratados como "já enviado". Sem rede, lança `OfflineError`. O `public/sw.js` agora faz cache: cache-first para `/_next/static/` e `/icons/`, network-first para o resto do mesmo site. Ao mudar a estratégia, troque `CACHE_VERSION`.
  - **Sair da conta** (`AppShell.signOut`): desinscreve o push, apaga o PIN e os rascunhos (com aviso se houver pendentes).
  - **E2E:** `ctx.setOffline` testa o modo offline. O autenticador virtual da WebAuthn vem do CDP. O site de teste roda em `localhost`, porque a WebAuthn não aceita IP como domínio.
- *Horários:* use `components/ui/time-field.tsx` (`TimeField`), nunca `<input type="time">` nem `datetime-local`: o seletor do Android deixava o botão "Definir" fora da tela. Ele abre uma folha com horas e minutos (de 5 em 5, mais o minuto atual se for outro) e o "Confirmar" fixo embaixo. Para dia + hora, use `<input type="date">` + `TimeField`. Folha dentro de folha funciona: o `Sheet` só fecha com o próprio `close`.
- *Nenhuma caixa do sistema (regra do usuário):* nada de `window.confirm`, `alert`, `prompt` ou `beforeunload`; o lint reprova (`eslint.config.mjs`) e o E2E falha se aparecer uma. Confirmações usam `useConfirm()` (`components/ui/confirm.tsx`, promessa: `if (!(await confirm({...}))) return;`). Para "sair sem salvar", use `useLeaveGuard(mensagem)` (`lib/leave-guard.ts`); os links do menu, voltar e sininho usam `GuardedLink`, que pergunta na caixa do app. Exceções impossíveis de evitar: o pedido de permissão de notificação/microfone e a instalação do navegador.
- *Registro escrito (sem gravação):* aba "Escrever" em `/gravar/` (`components/recorder/writer.tsx`). O texto vai em `medical_records.transcript` com `audio_path` nulo. Com IA, `processar-registro` usa `structureText` (Gemini só texto → Groq direto no Llama); sem IA, entra pronto com `ai_provider = 'manual'`, com título, categoria e gravidade escolhidos.
- *Editar registro salvo:* o lápis no cabeçalho da nota abre `components/records/record-edit-sheet.tsx` (dia/horário, categoria, gravidade) → `updateRecordDetails` em `records.ts`. Dia e horário são do fuso do aparelho (`lib/record-edit.ts`, puro e testado; até 1 ano à frente). Ao salvar, a nota (`screen.update`) e o guardado da linha do tempo (`registros`) mudam na hora. Se a pessoa processar com IA de novo, a IA volta a escolher categoria e gravidade.
- *Ditado no registro escrito:* botão "Ditar" em `writer.tsx`, com `hooks/use-dictation.ts` (Web Speech API do navegador, `pt-BR`, religa sozinho após pausas; no Android `continuous=false` porque o modo contínuo repete frases). Os comandos falados ("vírgula", "ponto final", "nova linha"…) e as maiúsculas ficam em `lib/dictation.ts` (puro, testado). Sem suporte no navegador, o botão não aparece. O E2E usa um reconhecedor simulado (`window.__speech.say(texto, final)`).
- *Transição entre telas (skill deslizar-entre-telas):* `components/nav-transition.tsx`, no layout, anima abrir e voltar dos detalhes como no WhatsApp. Diferença em relação à skill (HTML puro): animam-se **duas cópias paradas** da tela (sai e entra) por cima, com a tela real (`#tela`) escondida por ~0,3 s. Animar a tela real faria o cabeçalho, o menu e o botão redondo (`fixed`) pularem. A profundidade de cada rota está em `depthOf` (abas = 0, detalhe = 1, edição = 2; mesma profundidade não anima). O voltar do celular é capturado pelo `NAV_POP_SCRIPT` no `<head>`, que roda antes do Next (que troca a tela no próprio popstate). Nos testes, use `#tela` para não pegar a cópia durante a animação. Respeita "reduzir movimento".
- *Sem zoom (skill sem-zoom):* viewport com `maximumScale: 1` e `userScalable: false` (layout), `touch-action: manipulation` e campos com no mínimo 16px (`globals.css`). A pinça no iPhone é barrada em `components/no-zoom.tsx`. Só no celular; no computador o zoom do navegador continua. Área que precisar de zoom leva a classe `pode-zoom`. Campo novo com letra menor que 16px faz o iPhone dar zoom, e o E2E reprova.
- *Telas instantâneas (regra do usuário):* toda tela que busca dados abre na hora com o guardado da última visita (`useScreen` em `src/hooks/use-screen.ts`, `src/lib/screen-cache.ts`). Siga a skill de projeto `tela-instantanea` (`.claude/skills/`) ao criar ou mudar qualquer tela, e acrescente a tela nova ao teste "telas instantâneas" do `e2e/flow.mjs`.
- *Visual:* a tela de Ajustes segue a skill `tela-menu` (estilo menu da Cozinha Doce; peças em `components/settings/menu-ui.tsx`). Os botões de voltar e o sininho usam `ICON_BUTTON` (quadrado arredondado). As folhas que sobem de baixo usam `components/ui/sheet.tsx` (`<dialog>`). O tema (`lib/theme.ts`) usa `data-theme` no `<html>`, e a variante `dark:` do Tailwind respeita essa escolha (`@custom-variant` em `globals.css`).
- *Pré-carregamento de páginas (Next 16.4, export estático):* o navegador pede `<rota>/__next.<rota>.__PAGE__.txt` (com pontos), mas o build grava `__next.<rota>/__PAGE__.txt` (com barras). Sem correção, cada toque no menu esperava a internet. O `npm run build` roda `scripts/fix-segment-prefetch.mjs`, que cria a cópia com o nome pedido sem alterar os originais. O E2E não aceita nenhum 404; se voltar a aparecer, confira esse script ao atualizar o Next.
- *Service Worker:* `/_next/static/` e ícones são cache-first. Páginas e dados de navegação usam stale-while-revalidate, guardados sem a query string: o app abre na hora com o guardado e a versão nova vale na abertura seguinte. Ao mudar a estratégia, suba `CACHE_VERSION`. Medido com rede e processador de celular simulados: abrir o app caiu de 1,25 s para 0,39 s; trocar de tela, de cerca de 1 s para cerca de 0,15 s.
- *CSP:* `<meta>` gerada por `src/lib/csp.ts`. Um novo domínio chamado pelo navegador precisa entrar nela; as chamadas às IAs saem da Edge Function e não entram.
- *Banco:* toda tabela tem `user_id default auth.uid()` + RLS. As relações usam FK composta `(id, user_id)`. Os gatilhos calculam `medications.ends_at`/`next_dose_at` e avançam `next_dose_at` ao inserir em `medication_logs`. As colunas `client_id` existem para a sincronização offline idempotente.
- Regras de segurança completas: `SECURITY.md`.

---

### 1. Stack Tecnológica e Infraestrutura
- *Frontend:* Next.js (App Router), TypeScript, Tailwind CSS (Mobile-First e configurado como PWA com manifest.json e Service Worker customizado).
- *Backend / BaaS:* Supabase (PostgreSQL, Auth, Supabase Storage privado para áudios e Edge Functions/Cron para disparos agendados se necessário).
- *Versionamento:* Git configurado com .gitignore estrito (garantindo que .env* nunca seja rastreado) e pronto para deploy contínuo via GitHub.
- *Hospedagem:* GitHub Pages (site estático, via GitHub Actions). Código com segredo roda em Supabase Edge Functions.
- *Inteligência Artificial (Resiliência e Fallback Server-Side):*
  - *Fluxo Primário:* API do *Google Gemini* (`gemini-3.8-flash` por padrão, configurável em `GEMINI_MODEL`; o `gemini-2.5-flash` da especificação original desliga em 01/12/2026) recebendo o áudio diretamente e retornando um JSON estruturado (Schema Enforcement).
  - *Fluxo de Fallback:* Caso a chamada ao Gemini falhe (timeout, erro 429/5xx ou indisponibilidade), acionar automaticamente a API do *Groq* (whisper-large-v3 para transcrição do áudio + `openai/gpt-oss-120b` em modo JSON para estruturação; o `llama-3.3-70b-versatile` da especificação original passou a ser plano Enterprise no Groq. Configurável em `GROQ_CHAT_MODEL`).

---

### 2. Funcionalidades Core e Inteligência Clínica
- *Gravação e Áudio Vinculado:* Gravador de áudio nativo no navegador (MediaRecorder API) com upload seguro para bucket privado no Supabase Storage e player integrado na visualização da nota.
- *Estruturação Clínica Automática:* A IA deve transformar o relato falado em nota médica estruturada (Queixa Principal, Histórico, Observações, Conduta) e sugerir códigos *CID-10* ou termos médicos padronizados.
- *Categorização e Alerta Visual de Gravidade:*
  - Classificar automaticamente em categorias (Exames, Sintomas, Receitas, Retornos, Procedimentos).
  - *Detecção de Urgência:* Se a IA detectar sinais de alerta ou condições graves, marcar o registro como critical e destacar o card/linha inteira em *vermelho* (bg-red-50 border-red-500 / alertas de alto contraste) no dashboard.
- *Extração de Medicamentos, Posologia e Notificações de Horário:*
  - Extrair estruturadamente os medicamentos citados (Nome, Dosagem, Frequência/Intervalo em horas, Duração em dias e Horário de Início) para alimentar a aba *"Medicamentos em Uso"*.
  - *Sistema de Notificações de Remédios (PWA Push + Local Alarms):*
    - Permitir ativar notificações push (Web Push API com VAPID keys + Service Worker) e/ou agendamento local para lembrar os horários exatos de cada dose (ex: de 8 em 8 horas).
    - Botão de ação rápida na notificação ou no app para *"Marcar como Tomado"*, registrando o histórico de adesão (medication_logs) e recalculando a próxima dose.
    - Opção de cadastrar ou editar horários de remédios manualmente além dos extraídos pela IA.
- *Linha do Tempo do Paciente:* Visualização cronológica da evolução clínica e histórico de atendimentos/sintomas com filtros por categoria e gravidade.

---

### 3. Usabilidade, Offline e Compartilhamento
- *Arquitetura Local-First (Modo Offline):* Permitir gravar áudios e salvar rascunhos localmente via IndexedDB quando estiver sem internet, sincronizando automaticamente com o Supabase assim que a conexão retornar.
- *Exportação e Lembretes:*
  - Botão para gerar e baixar um *Relatório Clínico em PDF* limpo e formatado.
  - Detecção automática de prazos de retorno na fala (ex: "voltar em 30 dias") com botão de um clique para adicionar lembrete/evento ao calendário (.ics ou integração direta).

---

### 4. Segurança e Privacidade
- *Zero Exposure de Chaves:* Todas as chamadas para Gemini, Groq e envio de Web Push (VAPID Private Key) devem ocorrer exclusivamente em *Supabase Edge Functions* (o site é estático). Nunca expor chaves no cliente.
- *Privacidade nas Notificações:* Por questões de sigilo médico, permitir configurar nas notificações push se o texto exibido na tela bloqueada mostra o nome do remédio ou uma mensagem discreta (ex: "Hora da sua medicação programada").
- *Row Level Security (RLS) Estrito:* Políticas no PostgreSQL e no Supabase Storage garantindo que cada usuário autenticado acesse, insira e delete exclusivamente seus próprios registros, medicações, logs de doses e arquivos de áudio (Signed URLs temporárias para reprodução).
- *Bloqueio de Tela Rápido:* Tela de proteção local por *PIN numérico* (com hash seguro) ou WebAuthn/Biometria ao abrir ou retomar o app no dispositivo móvel.

---

### Plano de Ação Imediato (Fase 1):
1. Verifique o diretório atual, inicialize o repositório git e, aplicando as regras da seção 4, defina o .gitignore, .env.example (incluindo variáveis para Gemini, Groq, Supabase e VAPID keys) e as regras de segurança do projeto.
2. Crie a estrutura inicial do projeto Next.js + TypeScript + Tailwind + PWA (com Service Worker preparado para Web Push).
3. Gere o arquivo supabase/schema.sql completo (tabelas medical_records, medications, medication_logs, push_subscriptions, enums, índices de busca e políticas de RLS para banco e storage).
4. Aguarde minha confirmação após a Fase 1 antes de prosseguir para a Fase 2 (Integração de IA Gemini -> Groq).