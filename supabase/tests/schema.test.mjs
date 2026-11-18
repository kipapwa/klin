/**
 * Testa supabase/schema.sql num Postgres em memória (PGlite), com imitações
 * mínimas dos schemas `auth` e `storage` e dos papéis do Supabase.
 * Rodar: npm run test:db
 */
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

const STUBS = `
create role anon nologin; create role authenticated nologin;
create schema auth; create schema storage;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, storage, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable
  as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant all on storage.objects to authenticated;
-- Como o Supabase: papéis da API recebem acesso a tudo que for criado em public.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

let db;

/** Executa SQL como o usuário `uid` (papel authenticated). */
async function as(uid, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role;");
  }
}

before(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  await db.exec(schema);
  await db.exec(schema); // idempotente
  await db.exec(`insert into auth.users values ('${A}'), ('${B}');`);
});

test("perfil criado pelo gatilho de cadastro", async () => {
  const { rows } = await db.query("select count(*)::int as c from public.profiles");
  assert.equal(rows[0].c, 2);
});

test("registros: isolamento entre usuários e busca", async () => {
  const { rows } = await as(A, `insert into public.medical_records (title, chief_complaint, severity, audio_path)
    values ('Dor de cabeça', 'cefaleia intensa há 3 dias', 'critical', '${A}/a.webm') returning id`);
  const recA = rows[0].id;

  assert.equal((await as(B, "select * from public.medical_records")).rows.length, 0, "B não vê");
  assert.equal((await as(B, "update public.medical_records set title = 'x' returning id")).rows.length, 0, "B não altera");
  await assert.rejects(as(B, `insert into public.medical_records (user_id, title) values ('${A}', 'x')`), "B não insere por A");
  await assert.rejects(as(A, `insert into public.medical_records (title, audio_path) values ('x', '${B}/b.webm')`), "áudio na pasta do dono");
  await assert.rejects(
    as(B, `insert into public.medications (record_id, name, interval_hours, starts_at) values ('${recA}', 'X', 8, now())`),
    "FK composta impede vincular a registro alheio",
  );
  const found = await as(A, "select id from public.medical_records where search @@ plainto_tsquery('portuguese', 'cefaleia')");
  assert.equal(found.rows.length, 1);
});

test("medicamentos: agenda de doses", async () => {
  const rec = (await as(A, "insert into public.medical_records (title) values ('Receita') returning id")).rows[0].id;
  const m = (await as(A, `insert into public.medications (record_id, name, interval_hours, duration_days, starts_at)
    values ('${rec}', 'Dipirona', 8, 2, now() - interval '1 hour') returning id, next_dose_at, starts_at`)).rows[0];
  assert.equal((m.next_dose_at - m.starts_at) / 3.6e6, 8, "próxima dose = início + 8h");

  const at = new Date(m.next_dose_at).toISOString();
  await as(A, `insert into public.medication_logs (medication_id, scheduled_for, taken_at) values ('${m.id}', '${at}', now())`);
  const m2 = (await as(A, `select next_dose_at from public.medications where id = '${m.id}'`)).rows[0];
  assert.equal((m2.next_dose_at - m.next_dose_at) / 3.6e6, 8, "marcar tomado avança 8h");

  await assert.rejects(
    as(A, `insert into public.medication_logs (medication_id, scheduled_for, taken_at) values ('${m.id}', '${at}', now())`),
    "dose não é marcada duas vezes",
  );
  await assert.rejects(
    as(B, `insert into public.medication_logs (medication_id, scheduled_for, taken_at) values ('${m.id}', now(), now())`),
    "B não registra dose em remédio de A",
  );

  await as(A, `delete from public.medical_records where id = '${rec}'`);
  const kept = (await as(A, `select record_id from public.medications where id = '${m.id}'`)).rows[0];
  assert.equal(kept.record_id, null, "apagar o registro mantém o remédio");
});

test("storage: bucket privado e pasta por usuário", async () => {
  assert.equal((await db.query("select public from storage.buckets where id = 'audio'")).rows[0].public, false);
  assert.equal((await as(A, `insert into storage.objects (bucket_id, name) values ('audio', '${A}/x.webm') returning id`)).rows.length, 1);
  await assert.rejects(as(A, `insert into storage.objects (bucket_id, name) values ('audio', '${B}/x.webm')`));
  assert.equal((await as(B, "select * from storage.objects")).rows.length, 0);
});

test("anon não acessa tabelas nem a cota", async () => {
  await db.exec("set role anon;");
  try {
    await assert.rejects(db.query("select * from public.medical_records"));
    await assert.rejects(db.query("select public.ai_take_quota(10)"));
  } finally {
    await db.exec("reset role;");
  }
});

test("cota de IA: limite de 24h e tabela inacessível ao usuário", async () => {
  const take = async (uid) => (await as(uid, "select public.ai_take_quota(2) as ok")).rows[0].ok;
  assert.deepEqual([await take(A), await take(A), await take(A)], [true, true, false]);
  assert.equal(await take(B), true, "cota é por usuário");

  await assert.rejects(as(A, "select * from public.ai_usage"), "não lê a cota");
  await assert.rejects(as(A, "delete from public.ai_usage"), "não zera a cota");
  assert.equal(await take(A), false, "continua bloqueado após tentativas de apagar");
});

test("reserva do registro para processamento (filtro usado pela Edge Function)", async () => {
  const id = (await as(A, `insert into public.medical_records (title, audio_path) values ('x', '${A}/r.webm') returning id`)).rows[0].id;
  const claim = `update public.medical_records set status = 'processing'
    where id = '${id}' and audio_path is not null
      and (status in ('draft', 'failed') or (status = 'processing' and updated_at < now() - interval '5 minutes'))
    returning id`;
  assert.equal((await as(A, claim)).rows.length, 1, "primeira reserva");
  assert.equal((await as(A, claim)).rows.length, 0, "segunda reserva simultânea é recusada");
  assert.equal((await as(B, claim)).rows.length, 0, "B não reserva registro de A");
});
