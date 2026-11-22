-- =====================================================================
-- Klin — schema do banco (Supabase / PostgreSQL 15+)
--
-- Como aplicar: Painel do Supabase > SQL Editor > colar e executar.
-- O script pode ser executado de novo sem erro (idempotente).
--
-- Princípios de segurança (ver SECURITY.md):
--   * RLS ativo em todas as tabelas; cada usuário só vê o que é seu.
--   * O papel `anon` não tem acesso a nada; `authenticated` só às próprias linhas.
--   * FKs compostas (id, user_id) impedem apontar para dados de outro usuário.
--   * Funções SECURITY DEFINER com search_path vazio.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Tipos (enums)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'record_category' and typnamespace = 'public'::regnamespace) then
    create type public.record_category as enum
      ('exam', 'symptom', 'prescription', 'follow_up', 'procedure');
  end if;

  if not exists (select 1 from pg_type where typname = 'record_severity' and typnamespace = 'public'::regnamespace) then
    -- critical => card/linha destacado em vermelho no dashboard
    create type public.record_severity as enum ('routine', 'attention', 'critical');
  end if;

  if not exists (select 1 from pg_type where typname = 'record_status' and typnamespace = 'public'::regnamespace) then
    -- draft: rascunho/offline; processing: na IA; ready: estruturado; failed: IA falhou
    create type public.record_status as enum ('draft', 'processing', 'ready', 'failed');
  end if;

  if not exists (select 1 from pg_type where typname = 'ai_provider' and typnamespace = 'public'::regnamespace) then
    create type public.ai_provider as enum ('gemini', 'groq', 'manual');
  end if;

  if not exists (select 1 from pg_type where typname = 'medication_source' and typnamespace = 'public'::regnamespace) then
    create type public.medication_source as enum ('ai', 'manual');
  end if;

  if not exists (select 1 from pg_type where typname = 'dose_status' and typnamespace = 'public'::regnamespace) then
    create type public.dose_status as enum ('taken', 'skipped', 'missed');
  end if;

  if not exists (select 1 from pg_type where typname = 'dose_log_source' and typnamespace = 'public'::regnamespace) then
    create type public.dose_log_source as enum ('app', 'notification', 'system');
  end if;

  if not exists (select 1 from pg_type where typname = 'notification_privacy' and typnamespace = 'public'::regnamespace) then
    -- discreet: "Hora da sua medicação programada"; detailed: mostra o nome do remédio
    create type public.notification_privacy as enum ('discreet', 'detailed');
  end if;
end
$$;

-- Categoria "Pressão" (medição de pressão arterial), acrescentada depois.
-- ADD VALUE fica fora do bloco acima: é idempotente e vale para bancos já criados.
alter type public.record_category add value if not exists 'blood_pressure';

-- ---------------------------------------------------------------------
-- 1. Funções utilitárias
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. profiles — preferências do usuário (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  display_name          text check (char_length(display_name) <= 120),
  timezone              text not null default 'America/Sao_Paulo'
                          check (char_length(timezone) <= 64),
  notification_privacy  public.notification_privacy not null default 'discreet',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Cria o perfil automaticamente quando um usuário se cadastra.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 3. medical_records — notas clínicas estruturadas
-- ---------------------------------------------------------------------
create table if not exists public.medical_records (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Id gerado no aparelho: torna idempotente a sincronização do modo offline.
  client_id         uuid,

  title             text check (char_length(title) <= 200),
  recorded_at       timestamptz not null default now(),
  category          public.record_category not null default 'symptom',
  severity          public.record_severity not null default 'routine',
  status            public.record_status not null default 'draft',

  -- Nota estruturada
  chief_complaint   text check (char_length(chief_complaint) <= 5000),   -- Queixa principal
  history           text check (char_length(history) <= 20000),          -- Histórico
  observations      text check (char_length(observations) <= 20000),     -- Observações
  plan              text check (char_length(plan) <= 20000),             -- Conduta
  transcript        text check (char_length(transcript) <= 100000),      -- Transcrição bruta

  -- [{ "code": "J06.9", "description": "..." }]
  icd10_codes       jsonb not null default '[]'::jsonb
                      check (jsonb_typeof(icd10_codes) = 'array' and jsonb_array_length(icd10_codes) <= 20),
  -- Sinais de alerta que justificaram severity = 'critical'
  alert_signs       text[] not null default '{}'
                      check (cardinality(alert_signs) <= 20),

  -- Retorno detectado na fala ("voltar em 30 dias")
  follow_up_in_days integer check (follow_up_in_days between 1 and 730),
  follow_up_date    date,

  -- Áudio no Storage (bucket "audio"); caminho sempre "<user_id>/<arquivo>"
  audio_path        text check (char_length(audio_path) <= 300),
  audio_mime_type   text check (char_length(audio_mime_type) <= 100),
  audio_duration_s  integer check (audio_duration_s between 0 and 7200),

  ai_provider       public.ai_provider,
  ai_model          text check (char_length(ai_model) <= 100),
  processed_at      timestamptz,

  -- Busca textual em português
  search            tsvector generated always as (
                      to_tsvector('portuguese'::regconfig,
                        coalesce(title, '') || ' ' ||
                        coalesce(chief_complaint, '') || ' ' ||
                        coalesce(history, '') || ' ' ||
                        coalesce(observations, '') || ' ' ||
                        coalesce(plan, ''))
                    ) stored,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint medical_records_id_user_key unique (id, user_id),
  constraint medical_records_client_id_key unique (user_id, client_id),
  constraint medical_records_audio_owner_chk
    check (audio_path is null or split_part(audio_path, '/', 1) = user_id::text)
);

drop trigger if exists medical_records_set_updated_at on public.medical_records;
create trigger medical_records_set_updated_at
  before update on public.medical_records
  for each row execute function public.set_updated_at();

create index if not exists medical_records_user_recorded_idx
  on public.medical_records (user_id, recorded_at desc);
create index if not exists medical_records_user_category_idx
  on public.medical_records (user_id, category, recorded_at desc);
create index if not exists medical_records_user_critical_idx
  on public.medical_records (user_id, recorded_at desc) where severity = 'critical';
create index if not exists medical_records_search_idx
  on public.medical_records using gin (search);

-- ---------------------------------------------------------------------
-- 4. medications — medicamentos em uso (extraídos pela IA ou manuais)
-- ---------------------------------------------------------------------
create table if not exists public.medications (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  record_id             uuid,
  client_id             uuid,

  name                  text not null check (char_length(name) between 1 and 200),
  dosage                text check (char_length(dosage) <= 200),            -- ex.: "500 mg", "1 comprimido"
  instructions          text check (char_length(instructions) <= 1000),     -- ex.: "após as refeições"
  interval_hours        numeric(5, 2) not null check (interval_hours > 0 and interval_hours <= 168),
  duration_days         integer check (duration_days between 1 and 3650),  -- null = uso contínuo
  starts_at             timestamptz not null,
  ends_at               timestamptz,                                         -- calculado por trigger
  next_dose_at          timestamptz,                                         -- calculado por trigger

  source                public.medication_source not null default 'manual',
  is_active             boolean not null default true,
  notifications_enabled boolean not null default true,
  last_notified_at      timestamptz,                                         -- evita push duplicado

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint medications_id_user_key unique (id, user_id),
  constraint medications_client_id_key unique (user_id, client_id),
  -- O registro de origem precisa ser do mesmo usuário.
  constraint medications_record_fk
    foreign key (record_id, user_id)
    references public.medical_records (id, user_id)
    on delete set null (record_id)
);

-- Dois jeitos de agendar:
--   'interval': grade starts_at + k × interval_hours (ex.: "de 8 em 8 horas", vindo da IA);
--   'times'   : horários fixos do dia em dose_times ("08:00", "20:00"), no fuso `timezone`,
--               a partir de starts_at (ex.: café, almoço e jantar).
alter table public.medications add column if not exists schedule_type text not null default 'interval';
alter table public.medications add column if not exists dose_times text[] not null default '{}';
alter table public.medications add column if not exists timezone text not null default 'America/Sao_Paulo';

create or replace function public.valid_dose_times(p_times text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(t ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'), true) from unnest(p_times) as t
$$;

alter table public.medications drop constraint if exists medications_schedule_chk;
alter table public.medications add constraint medications_schedule_chk check (
  char_length(timezone) between 1 and 64
  and cardinality(dose_times) <= 12
  and public.valid_dose_times(dose_times)
  and (
    (schedule_type = 'interval')
    or (schedule_type = 'times' and cardinality(dose_times) >= 1)
  )
);

-- Primeira dose depois de p_after (ou igual, se p_inclusive), respeitando início e fim.
create or replace function public.dose_slot_after(p_med public.medications, p_after timestamptz, p_inclusive boolean)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ref timestamptz := greatest(p_after, p_med.starts_at);
  v_day date;
  v_t text;
  v_slot timestamptz;
  v_best timestamptz;
  v_step double precision;
begin
  if p_med.schedule_type = 'times' then
    for v_day in
      select d::date from generate_series((v_ref at time zone p_med.timezone)::date - 1,
                                          (v_ref at time zone p_med.timezone)::date + 1, interval '1 day') as d
    loop
      foreach v_t in array p_med.dose_times loop
        v_slot := (v_day + v_t::time) at time zone p_med.timezone;
        if v_slot >= p_med.starts_at
           and (v_slot > p_after or (p_inclusive and v_slot = p_after))
           and (v_best is null or v_slot < v_best) then
          v_best := v_slot;
        end if;
      end loop;
    end loop;
  else
    v_step := p_med.interval_hours * 3600;
    v_best := p_med.starts_at + make_interval(secs =>
      greatest(0, ceil(extract(epoch from (p_after - p_med.starts_at)) / v_step)) * v_step);
    if not p_inclusive and v_best <= p_after then
      v_best := v_best + make_interval(secs => v_step);
    end if;
  end if;

  if v_best is null or (p_med.ends_at is not null and v_best > p_med.ends_at) then
    return null;
  end if;
  return v_best;
end;
$$;

-- Última dose da agenda até p_at (inclusive), ou null.
create or replace function public.dose_slot_at_or_before(p_med public.medications, p_at timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_day date;
  v_t text;
  v_slot timestamptz;
  v_best timestamptz;
  v_step double precision;
begin
  if p_at < p_med.starts_at then
    return null;
  end if;
  if p_med.schedule_type = 'times' then
    for v_day in
      select d::date from generate_series((p_at at time zone p_med.timezone)::date - 1,
                                          (p_at at time zone p_med.timezone)::date, interval '1 day') as d
    loop
      foreach v_t in array p_med.dose_times loop
        v_slot := (v_day + v_t::time) at time zone p_med.timezone;
        if v_slot >= p_med.starts_at and v_slot <= p_at and (v_best is null or v_slot > v_best) then
          v_best := v_slot;
        end if;
      end loop;
    end loop;
  else
    v_step := p_med.interval_hours * 3600;
    v_best := p_med.starts_at + make_interval(secs =>
      floor(extract(epoch from (p_at - p_med.starts_at)) / v_step) * v_step);
  end if;

  if v_best is null or (p_med.ends_at is not null and v_best > p_med.ends_at) then
    return null;
  end if;
  return v_best;
end;
$$;

-- Calcula fim do tratamento e primeira dose; recalcula se a agenda mudar.
create or replace function public.medications_compute_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.ends_at := case
    when new.duration_days is null then null
    else new.starts_at + make_interval(days => new.duration_days)
  end;

  if tg_op = 'INSERT'
     or new.starts_at is distinct from old.starts_at
     or new.interval_hours is distinct from old.interval_hours
     or new.schedule_type is distinct from old.schedule_type
     or new.dose_times is distinct from old.dose_times
     or new.timezone is distinct from old.timezone
     or new.duration_days is distinct from old.duration_days then
    -- Próxima dose = primeira da agenda que venceu há no máximo 1 hora. A
    -- tolerância deixa marcável a dose de "agora" (ou de 20 min atrás).
    new.next_dose_at := public.dose_slot_after(new, now() - interval '1 hour', true);
    new.notified_for := null;
  end if;

  return new;
end;
$$;

drop trigger if exists medications_compute_schedule on public.medications;
create trigger medications_compute_schedule
  before insert or update on public.medications
  for each row execute function public.medications_compute_schedule();

drop trigger if exists medications_set_updated_at on public.medications;
create trigger medications_set_updated_at
  before update on public.medications
  for each row execute function public.set_updated_at();

create index if not exists medications_user_active_idx
  on public.medications (user_id, is_active, next_dose_at);
create index if not exists medications_record_idx
  on public.medications (record_id) where record_id is not null;
-- Usado pelo disparador agendado de lembretes (roda com a chave secreta).
create index if not exists medications_due_idx
  on public.medications (next_dose_at)
  where is_active and notifications_enabled and next_dose_at is not null;

-- ---------------------------------------------------------------------
-- 5. medication_logs — histórico de adesão (cada dose)
-- ---------------------------------------------------------------------
create table if not exists public.medication_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  medication_id  uuid not null,
  scheduled_for  timestamptz not null,
  status         public.dose_status not null default 'taken',
  taken_at       timestamptz,
  source         public.dose_log_source not null default 'app',
  note           text check (char_length(note) <= 500),
  created_at     timestamptz not null default now(),

  constraint medication_logs_medication_fk
    foreign key (medication_id, user_id)
    references public.medications (id, user_id)
    on delete cascade,
  -- Uma marcação por dose (evita duplo clique / notificação + app).
  constraint medication_logs_dose_key unique (medication_id, scheduled_for),
  constraint medication_logs_taken_chk
    check ((status = 'taken') = (taken_at is not null))
);

create index if not exists medication_logs_user_scheduled_idx
  on public.medication_logs (user_id, scheduled_for desc);
create index if not exists medication_logs_medication_idx
  on public.medication_logs (medication_id, scheduled_for desc);

-- Ao registrar uma dose, avança a próxima dose na grade do tratamento.
create or replace function public.medication_logs_advance_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_med public.medications;
  v_next timestamptz;
begin
  select * into v_med from public.medications
   where id = new.medication_id and user_id = new.user_id;
  if not found or (v_med.next_dose_at is not null and v_med.next_dose_at > new.scheduled_for) then
    return new; -- dose antiga registrada depois: não volta a agenda
  end if;

  v_next := public.dose_slot_after(v_med, new.scheduled_for, false);
  update public.medications
     set next_dose_at = v_next,
         -- Sem próxima dose porque o tratamento acabou: encerra.
         is_active = case when v_next is null and v_med.ends_at is not null then false else is_active end
   where id = v_med.id;
  return new;
end;
$$;

drop trigger if exists medication_logs_advance_schedule on public.medication_logs;
create trigger medication_logs_advance_schedule
  after insert on public.medication_logs
  for each row execute function public.medication_logs_advance_schedule();

-- ---------------------------------------------------------------------
-- 6. push_subscriptions — inscrições Web Push por aparelho
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint      text not null check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  p256dh        text not null check (char_length(p256dh) <= 200),
  auth          text not null check (char_length(auth) <= 100),
  user_agent    text check (char_length(user_agent) <= 300),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,

  constraint push_subscriptions_endpoint_key unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

-- Inscreve ESTE aparelho para o usuário logado. Se o mesmo aparelho estava
-- inscrito para outra conta (troca de usuário), a inscrição antiga é removida:
-- assim ninguém recebe lembretes de outra pessoa. Só quem tem o endpoint (o
-- próprio aparelho) consegue fazer isso.
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> v_user;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_user, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (user_id, endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end;
$$;

revoke execute on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6c. Disparo de lembretes (chamado pela Edge Function disparar-lembretes,
-- com a chave secreta, a cada minuto pelo Supabase Cron).
-- ---------------------------------------------------------------------
alter table public.medications add column if not exists notified_for timestamptz;

-- "Reserva" as doses a notificar agora e devolve uma linha por dose.
-- A dose é calculada pela GRADE (starts_at + k × intervalo), não só por
-- next_dose_at: se o usuário ignorou a dose anterior, next_dose_at fica parado,
-- mas cada novo horário ainda recebe o próprio lembrete.
-- notified_for impede notificar o mesmo horário duas vezes; doses com mais de
-- 30 min (ex.: agendador fora do ar) não são notificadas atrasadas.
create or replace function public.claim_due_doses()
returns table (
  medication_id uuid,
  user_id uuid,
  name text,
  dosage text,
  scheduled_for timestamptz,
  privacy public.notification_privacy
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with locked as (
    select m.*
      from public.medications m
     where m.is_active
       and m.notifications_enabled
       and m.next_dose_at is not null
       and m.next_dose_at <= now() + interval '1 minute'
       for update skip locked
  ),
  due as (
    select l.id, l.next_dose_at, l.notified_for,
           public.dose_slot_at_or_before(l::public.medications, now() + interval '1 minute') as slot
      from locked l
  ),
  claimable as (
    select d.id, d.slot
      from due d
     where d.slot is not null
       and d.slot >= d.next_dose_at
       and d.slot > now() - interval '30 minutes'
       and (d.notified_for is null or d.notified_for < d.slot)
  )
  update public.medications m
     set notified_for = c.slot
    from claimable c
   where m.id = c.id
  returning m.id, m.user_id, m.name, m.dosage, c.slot,
            coalesce((select p.notification_privacy from public.profiles p where p.id = m.user_id),
                     'discreet'::public.notification_privacy);
end;
$$;

revoke execute on function public.claim_due_doses() from public, anon, authenticated;
grant execute on function public.claim_due_doses() to service_role;

-- ---------------------------------------------------------------------
-- 6b. ai_usage — cota diária de processamentos por IA (contra abuso/custo)
-- Sem políticas: o usuário não lê nem apaga linhas (não "zera" a cota).
-- Só a função ai_take_quota grava aqui.
-- ---------------------------------------------------------------------
create table if not exists public.ai_usage (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists ai_usage_user_created_idx
  on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- Gasta 1 da cota do usuário logado; devolve false se o limite de 24h acabou.
-- Chamá-la por conta própria só gasta a própria cota (nunca libera mais).
create or replace function public.ai_take_quota(p_limit integer default 30)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_used integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Serializa pedidos simultâneos do mesmo usuário.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select count(*) into v_used
    from public.ai_usage
   where user_id = v_user
     and created_at > now() - interval '24 hours';

  if v_used >= greatest(p_limit, 0) then
    return false;
  end if;

  insert into public.ai_usage (user_id) values (v_user);
  return true;
end;
$$;

revoke execute on function public.ai_take_quota(integer) from public, anon;
grant execute on function public.ai_take_quota(integer) to authenticated;

-- ---------------------------------------------------------------------
-- 6c. "Perguntar à IA": perguntas favoritas e histórico de análises
-- Do próprio usuário (RLS na seção 7). As respostas contêm dados de saúde:
-- mesma proteção dos registros. Nada aqui vai para logs.
-- ---------------------------------------------------------------------
create table if not exists public.ai_saved_questions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scope       text not null check (scope in ('records', 'medications')),
  question    text not null check (char_length(btrim(question)) between 3 and 500),
  created_at  timestamptz not null default now(),

  constraint ai_saved_questions_unique unique (user_id, scope, question)
);

create index if not exists ai_saved_questions_user_idx
  on public.ai_saved_questions (user_id, scope, created_at);

create table if not exists public.ai_analyses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scope       text not null check (scope in ('records', 'medications')),
  question    text not null check (char_length(btrim(question)) between 3 and 500),
  answer      text not null check (char_length(answer) between 1 and 8000),
  provider    text check (char_length(provider) <= 40),
  -- O que foi analisado (ex.: "12 registros · Categoria: Pressão"), sem os dados em si.
  scope_note  text check (char_length(scope_note) <= 300),
  created_at  timestamptz not null default now()
);

create index if not exists ai_analyses_user_idx
  on public.ai_analyses (user_id, scope, created_at desc);

-- Escopo "pressure" (aba Pressão). O check do create table acima ganha nome
-- automático (<tabela>_scope_check); recriado aqui para valer em bancos antigos.
alter table public.ai_saved_questions drop constraint if exists ai_saved_questions_scope_check;
alter table public.ai_saved_questions add constraint ai_saved_questions_scope_check
  check (scope in ('records', 'medications', 'pressure'));
alter table public.ai_analyses drop constraint if exists ai_analyses_scope_check;
alter table public.ai_analyses add constraint ai_analyses_scope_check
  check (scope in ('records', 'medications', 'pressure'));

-- ---------------------------------------------------------------------
-- 6d. bp_readings — medições de pressão arterial (aba Pressão)
-- Lançamento rápido: máxima/mínima (mmHg) e batimentos (bpm). Limites
-- largos, só para barrar erro de digitação.
-- ---------------------------------------------------------------------
create table if not exists public.bp_readings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  measured_at  timestamptz not null default now(),
  systolic     smallint not null check (systolic between 50 and 300),
  diastolic    smallint not null check (diastolic between 30 and 200),
  pulse        smallint check (pulse between 20 and 250),
  note         text check (char_length(note) <= 300),
  created_at   timestamptz not null default now(),

  constraint bp_readings_order check (systolic > diastolic),
  constraint bp_readings_when check (measured_at < now() + interval '1 day')
);

create index if not exists bp_readings_user_measured_idx
  on public.bp_readings (user_id, measured_at desc);

-- ---------------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.medical_records     enable row level security;
alter table public.medications         enable row level security;
alter table public.medication_logs     enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.ai_saved_questions  enable row level security;
alter table public.ai_analyses         enable row level security;
alter table public.bp_readings         enable row level security;

-- Nada para visitantes não autenticados.
revoke all on public.profiles, public.medical_records, public.medications,
              public.medication_logs, public.push_subscriptions,
              public.ai_saved_questions, public.ai_analyses, public.bp_readings from anon;

-- Permissões explícitas para usuários logados. Projetos novos do Supabase podem
-- não expor automaticamente as tabelas criadas por SQL; sem estes GRANTs o
-- banco responde "permission denied" (42501) mesmo com o RLS correto.
-- O RLS abaixo continua limitando cada usuário às próprias linhas.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete
  on public.medical_records, public.medications, public.medication_logs, public.push_subscriptions,
     public.ai_saved_questions, public.ai_analyses, public.bp_readings
  to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles, public.medical_records, public.medications,
             public.medication_logs, public.push_subscriptions, public.ai_usage,
             public.ai_saved_questions, public.ai_analyses, public.bp_readings
  to service_role;

-- profiles: o próprio usuário lê e edita (criação é pelo trigger).
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

-- Contas criadas antes do gatilho handle_new_user existir não têm perfil:
-- o app cria o próprio perfil (só com o próprio id).
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Demais tabelas: CRUD restrito a user_id = auth.uid().
do $$
declare
  t text;
begin
  foreach t in array array['medical_records', 'medications', 'medication_logs', 'push_subscriptions',
                         'ai_saved_questions', 'ai_analyses', 'bp_readings']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t || '_select_own', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t || '_insert_own', t);

    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_update_own', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      t || '_delete_own', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 8. Storage — bucket privado de áudios
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audio', 'audio', false,
  26214400, -- 25 MB
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Caminho obrigatório: "<user_id>/<arquivo>". Sem política de UPDATE:
-- áudios não são sobrescritos (cada gravação recebe um nome novo).
drop policy if exists audio_select_own on storage.objects;
create policy audio_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists audio_insert_own on storage.objects;
create policy audio_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists audio_delete_own on storage.objects;
create policy audio_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
