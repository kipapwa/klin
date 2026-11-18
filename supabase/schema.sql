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

-- Calcula fim do tratamento e primeira dose; recalcula se o horário mudar.
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
     or new.interval_hours is distinct from old.interval_hours then
    -- Próxima dose = primeira ocorrência da grade (starts_at + k * intervalo) a partir de agora.
    new.next_dose_at := new.starts_at + make_interval(secs =>
      greatest(0, ceil(extract(epoch from (now() - new.starts_at)) / (new.interval_hours * 3600)))
      * new.interval_hours * 3600);
  end if;

  if new.ends_at is not null and new.next_dose_at is not null and new.next_dose_at > new.ends_at then
    new.next_dose_at := null;
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
begin
  update public.medications m
     set next_dose_at = case
           when m.ends_at is not null
                and new.scheduled_for + make_interval(secs => m.interval_hours * 3600) > m.ends_at
             then null
           else new.scheduled_for + make_interval(secs => m.interval_hours * 3600)
         end,
         is_active = case
           when m.ends_at is not null
                and new.scheduled_for + make_interval(secs => m.interval_hours * 3600) > m.ends_at
             then false
           else m.is_active
         end
   where m.id = new.medication_id
     and m.user_id = new.user_id
     and (m.next_dose_at is null or m.next_dose_at <= new.scheduled_for);
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

-- ---------------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.medical_records     enable row level security;
alter table public.medications         enable row level security;
alter table public.medication_logs     enable row level security;
alter table public.push_subscriptions  enable row level security;

-- Nada para visitantes não autenticados.
revoke all on public.profiles, public.medical_records, public.medications,
              public.medication_logs, public.push_subscriptions from anon;

-- profiles: o próprio usuário lê e edita (criação é pelo trigger).
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

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
  foreach t in array array['medical_records', 'medications', 'medication_logs', 'push_subscriptions']
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
