# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Atue como um Engenheiro de Software Sênior e Arquiteto de Sistemas Full-Stack especializado em HealthTech e PWAs. Vamos construir um aplicativo web de *Registros Médicos (Medical Notes PWA)* neste repositório.

### Diretriz de Execução (Claude Code + Segurança)
- *Antes de escrever qualquer código de backend, autenticação ou banco de dados, aplique rigorosamente as regras da seção 4 (Segurança e Privacidade)*: blindagem de chaves de API (somente no servidor), prevenção contra vazamento de dados sensíveis (PHI/LGPD — nunca registrar conteúdo clínico em logs, mensagens de erro ou analytics), validação e sanitização de todos os inputs no servidor e configuração segura do Supabase (RLS em todas as tabelas; `service_role` só no servidor).
- *Observação sobre skills:* a skill `proteger-codigo` NÃO se aplica a este projeto — ela trata de esconder o código de sites estáticos no GitHub Pages, que não roda os Route Handlers do Next.js onde as chaves precisam ficar. A skill `ia-reserva-groq` cobre o fallback Gemini → Groq (Fase 2), mas foi escrita para HTML/JS puro + Edge Functions e deve ser adaptada para Next.js.
- *Execução Incremental:* Não tente gerar todo o aplicativo em uma única resposta. Divida a implementação em fases claras, validando a estrutura e criando os arquivos passo a passo no workspace.

---

### Comandos
- `npm run dev` — servidor de desenvolvimento (`npx next dev --experimental-https` para testar Web Push).
- `npm run build` / `npm start` — build e servidor de produção.
- `npm run lint` — ESLint.
- `npm run typecheck` — gera os tipos de rota do Next (`LayoutProps`, `PageProps`) e roda `tsc`. Rodar `tsc` direto, sem `next typegen`, dá erro falso.
- Banco: aplicar `supabase/schema.sql` no SQL Editor do Supabase (idempotente).

### Notas de arquitetura
- *Next.js 16:* tem mudanças incompatíveis com versões anteriores (ex.: `middleware` agora é `proxy.ts`; `cacheComponents` ligado). Antes de usar uma API do Next, consulte `node_modules/next/dist/docs/` (ver `AGENTS.md`).
- *Service Worker:* é JS puro em `public/sw.js` (escopo `/`), registrado por `src/components/pwa/service-worker-register.tsx`. O contrato do payload de push e da ação "Marcar como tomado" (`POST /api/doses/taken`, rota ainda a criar) está documentado no topo do arquivo. A privacidade do texto (discreto × detalhado) é decidida no servidor, não no SW.
- *Cabeçalhos de segurança/CSP:* `next.config.ts`. Um novo domínio externo chamado pelo navegador precisa entrar na CSP; as chamadas às IAs saem do servidor e não entram.
- *Banco:* toda tabela tem `user_id default auth.uid()` + RLS. As relações usam FK composta `(id, user_id)`. Os gatilhos calculam `medications.ends_at`/`next_dose_at` e avançam `next_dose_at` ao inserir em `medication_logs`. As colunas `client_id` existem para a sincronização offline idempotente.
- Regras de segurança completas: `SECURITY.md`.

---

### 1. Stack Tecnológica e Infraestrutura
- *Frontend:* Next.js (App Router), TypeScript, Tailwind CSS (Mobile-First e configurado como PWA com manifest.json e Service Worker customizado).
- *Backend / BaaS:* Supabase (PostgreSQL, Auth, Supabase Storage privado para áudios e Edge Functions/Cron para disparos agendados se necessário).
- *Versionamento:* Git configurado com .gitignore estrito (garantindo que .env* nunca seja rastreado) e pronto para deploy contínuo via GitHub.
- *Hospedagem:* a definir — precisa executar código de servidor do Next.js (ex.: Vercel). GitHub Pages não serve, pois é apenas estático.
- *Inteligência Artificial (Resiliência e Fallback Server-Side):*
  - *Fluxo Primário:* API do *Google Gemini* (gemini-2.5-flash) recebendo o áudio diretamente e retornando um JSON estruturado (Schema Enforcement).
  - *Fluxo de Fallback:* Caso a chamada ao Gemini falhe (timeout, erro 429/5xx ou indisponibilidade), acionar automaticamente a API do *Groq* (whisper-large-v3 para transcrição do áudio + llama-3.3-70b-versatile em modo JSON para estruturação).

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
- *Zero Exposure de Chaves:* Todas as chamadas para Gemini, Groq e envio de Web Push (VAPID Private Key) devem ocorrer exclusivamente em *Route Handlers / Server Actions / Edge Functions* no servidor. Nunca expor chaves no cliente.
- *Privacidade nas Notificações:* Por questões de sigilo médico, permitir configurar nas notificações push se o texto exibido na tela bloqueada mostra o nome do remédio ou uma mensagem discreta (ex: "Hora da sua medicação programada").
- *Row Level Security (RLS) Estrito:* Políticas no PostgreSQL e no Supabase Storage garantindo que cada usuário autenticado acesse, insira e delete exclusivamente seus próprios registros, medicações, logs de doses e arquivos de áudio (Signed URLs temporárias para reprodução).
- *Bloqueio de Tela Rápido:* Tela de proteção local por *PIN numérico* (com hash seguro) ou WebAuthn/Biometria ao abrir ou retomar o app no dispositivo móvel.

---

### Plano de Ação Imediato (Fase 1):
1. Verifique o diretório atual, inicialize o repositório git e, aplicando as regras da seção 4, defina o .gitignore, .env.example (incluindo variáveis para Gemini, Groq, Supabase e VAPID keys) e as regras de segurança do projeto.
2. Crie a estrutura inicial do projeto Next.js + TypeScript + Tailwind + PWA (com Service Worker preparado para Web Push).
3. Gere o arquivo supabase/schema.sql completo (tabelas medical_records, medications, medication_logs, push_subscriptions, enums, índices de busca e políticas de RLS para banco e storage).
4. Aguarde minha confirmação após a Fase 1 antes de prosseguir para a Fase 2 (Integração de IA Gemini -> Groq).