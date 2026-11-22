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
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
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
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema public to service_role;
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

  // Conta antiga sem perfil: o app cria o próprio (e só o próprio).
  await db.query(`delete from public.profiles where id = '${A}'`);
  await as(A, `insert into public.profiles (id, timezone) values ('${A}', 'America/Sao_Paulo')`);
  await assert.rejects(as(A, `insert into public.profiles (id) values ('${B}') on conflict do nothing`), "não cria perfil de outro");
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
  const now = (await as(A, `insert into public.medications (name, interval_hours, starts_at)
    values ('Agora', 8, now()) returning next_dose_at, starts_at`)).rows[0];
  assert.equal(now.next_dose_at.getTime(), now.starts_at.getTime(), "começando agora: a 1ª dose é a de agora");

  const recent = (await as(A, `insert into public.medications (name, interval_hours, starts_at)
    values ('Recente', 8, now() - interval '40 minutes') returning next_dose_at, starts_at`)).rows[0];
  assert.equal(recent.next_dose_at.getTime(), recent.starts_at.getTime(), "dose de 40 min atrás ainda é a próxima");

  const m = (await as(A, `insert into public.medications (record_id, name, interval_hours, duration_days, starts_at)
    values ('${rec}', 'Dipirona', 8, 2, now() - interval '3 hours') returning id, next_dose_at, starts_at`)).rows[0];
  assert.equal((m.next_dose_at - m.starts_at) / 3.6e6, 8, "dose de 3h atrás já passou: próxima = início + 8h");

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

test("horários fixos: próxima dose no fuso do usuário, avanço e validação", async () => {
  // Agenda às 08:00 e 20:00 de São Paulo, começando há 2 dias.
  const ins = (times, extra = "") =>
    as(A, `insert into public.medications (name, interval_hours, schedule_type, dose_times, timezone, starts_at${extra ? ", duration_days" : ""})
      values ('Fixos', 24, 'times', '${times}', 'America/Sao_Paulo', now() - interval '2 days'${extra ? ", " + extra : ""})
      returning id, next_dose_at`);
  const m = (await ins("{08:00,20:00}")).rows[0];

  const expected = (await db.query(`
    select min(s) as s from (
      select ((d::date + t::time) at time zone 'America/Sao_Paulo') as s
        from generate_series(current_date - 2, current_date + 2, interval '1 day') d,
             unnest(array['08:00','20:00']) t
    ) x where s >= now() - interval '1 hour'`)).rows[0].s;
  assert.equal(m.next_dose_at.getTime(), expected.getTime(), "próxima = 1º horário fixo que venceu há no máximo 1 h");
  const local = (await db.query(`select to_char($1::timestamptz at time zone 'America/Sao_Paulo', 'HH24:MI') as hm`, [m.next_dose_at])).rows[0].hm;
  assert.ok(["08:00", "20:00"].includes(local), `cai num dos horários (foi ${local})`);

  await as(A, `insert into public.medication_logs (medication_id, scheduled_for, taken_at) values ('${m.id}', '${m.next_dose_at.toISOString()}', now())`);
  const next = (await as(A, `select next_dose_at from public.medications where id = '${m.id}'`)).rows[0].next_dose_at;
  assert.equal((next - m.next_dose_at) / 3.6e6, 12, "08:00 -> 20:00 (ou 20:00 -> 08:00): 12 h depois");

  // 3 horários desiguais: café, almoço, jantar.
  const desigual = (await ins("{07:00,12:00,19:30}")).rows[0];
  assert.ok(desigual.next_dose_at, "agenda desigual aceita");

  await assert.rejects(ins("{}"), "horários fixos exige ao menos um horário");
  await assert.rejects(ins("{25:00}"), "horário inválido");
  await assert.rejects(ins("{8h}"), "formato HH:MM");

  // Tratamento de 1 dia que começou há 2 dias: já acabou, sem próxima dose.
  const acabou = (await ins("{08:00}", "1")).rows[0];
  assert.equal(acabou.next_dose_at, null);
});

test("categoria Pressão (blood_pressure) aceita; categoria inexistente recusada", async () => {
  const { rows } = await as(A, `insert into public.medical_records (title, category, observations)
    values ('Pressão de manhã', 'blood_pressure', 'PA 130/85 mmHg, pulso 72 bpm') returning category`);
  assert.equal(rows[0].category, "blood_pressure");
  await assert.rejects(as(A, "insert into public.medical_records (title, category) values ('x', 'pressao')"), "enum recusa valor desconhecido");
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

test("inscrição push: troca de conta no mesmo aparelho remove a inscrição antiga", async () => {
  const reg = (uid, ep) => as(uid, `select public.register_push_subscription('${ep}', 'chave', 'segredo', 'Teste/1.0')`);
  await reg(A, "https://push.exemplo/aparelho-1");
  await reg(A, "https://push.exemplo/aparelho-1"); // repetir não duplica
  assert.equal((await as(A, "select * from public.push_subscriptions")).rows.length, 1);

  await reg(B, "https://push.exemplo/aparelho-1"); // B entrou no mesmo aparelho
  assert.equal((await as(A, "select * from public.push_subscriptions")).rows.length, 0, "A não recebe mais neste aparelho");
  assert.equal((await as(B, "select * from public.push_subscriptions")).rows.length, 1);
  await assert.rejects(reg(A, "http://inseguro"), "endpoint precisa ser https");
});

test("disparo de lembretes: uma notificação por horário, inclusive após dose ignorada", async () => {
  const claim = async () => {
    await db.exec("set role service_role;");
    try {
      return (await db.query("select * from public.claim_due_doses() order by name")).rows;
    } finally {
      await db.exec("reset role;");
    }
  };
  await db.exec("update public.medications set notifications_enabled = false");
  await as(A, "update public.profiles set notification_privacy = 'detailed' where id = auth.uid()");
  const ins = (uid, name, startsAgo, extra = "") =>
    as(uid, `insert into public.medications (name, dosage, interval_hours, starts_at${extra ? ", " + extra.split("=")[0] : ""})
      values ('${name}', '1 cp', 8, now() - interval '${startsAgo}'${extra ? ", " + extra.split("=")[1] : ""}) returning id`);

  const agora = (await ins(A, "Agora", "1 minute")).rows[0].id;
  // Começou há 8h05: a dose das 0h (8h05 atrás) foi ignorada; a das 8h (5 min atrás) é a atual.
  const ignorada = (await ins(A, "Ignorada", "8 hours 5 minutes")).rows[0].id;
  // Simula a 1ª dose nunca registrada: next_dose_at parado no início.
  await db.query(`update public.medications set next_dose_at = starts_at where id = '${ignorada}'`);
  await ins(B, "Desligado", "1 minute", "notifications_enabled=false");
  await ins(B, "Futuro", "-3 hours");

  const first = await claim();
  assert.deepEqual(first.map((r) => r.name), ["Agora", "Ignorada"]);
  assert.equal(first[0].privacy, "detailed");
  const slots = await db.query(`select id, starts_at, notified_for from public.medications where id in ('${agora}', '${ignorada}') order by name`);
  assert.equal(slots.rows[0].notified_for.getTime(), slots.rows[0].starts_at.getTime(), "dose de agora");
  assert.equal(slots.rows[1].notified_for - slots.rows[1].starts_at, 8 * 3.6e6, "dose atual da grade (início + 8h)");

  assert.deepEqual(await claim(), [], "mesmo horário não é notificado de novo");

  // Horário fixo que é agora (no fuso de São Paulo): notificado nesse horário exato.
  const hm = (await db.query("select to_char(now() at time zone 'America/Sao_Paulo', 'HH24:MI') as hm")).rows[0].hm;
  await as(A, `insert into public.medications (name, interval_hours, schedule_type, dose_times, timezone, starts_at)
    values ('Fixo agora', 24, 'times', '{${hm}}', 'America/Sao_Paulo', now() - interval '3 days')`);
  const fixed = await claim();
  assert.deepEqual(fixed.map((r) => r.name), ["Fixo agora"]);
  const slotLocal = (await db.query(`select to_char($1::timestamptz at time zone 'America/Sao_Paulo', 'HH24:MI') as hm`, [fixed[0].scheduled_for])).rows[0].hm;
  assert.equal(slotLocal, hm, "dose do horário fixo de hoje");

  await assert.rejects(as(A, "select * from public.claim_due_doses()"), "usuário comum não chama o disparo");
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

test("Perguntar à IA: perguntas favoritas e histórico só do dono", async () => {
  await as(A, "insert into public.ai_saved_questions (scope, question) values ('records', 'Como está minha pressão?')");
  await assert.rejects(
    as(A, "insert into public.ai_saved_questions (scope, question) values ('records', 'Como está minha pressão?')"),
    "mesma pergunta não duplica",
  );
  await assert.rejects(as(A, "insert into public.ai_saved_questions (scope, question) values ('outro', 'Pergunta')"), "escopo inválido");
  await assert.rejects(as(A, "insert into public.ai_saved_questions (scope, question) values ('records', '  a ')"), "pergunta curta demais");

  const { rows } = await as(A, `insert into public.ai_analyses (scope, question, answer, provider, scope_note)
    values ('medications', 'Como está minha adesão?', 'Você tomou 6 de 7 doses.', 'gemini', 'Últimos 7 dias') returning id`);
  await assert.rejects(
    as(A, `insert into public.ai_analyses (scope, question, answer) values ('records', 'Pergunta', '${"x".repeat(8001)}')`),
    "resposta grande demais",
  );

  assert.equal((await as(B, "select * from public.ai_saved_questions")).rows.length, 0, "B não vê as perguntas de A");
  assert.equal((await as(B, "select * from public.ai_analyses")).rows.length, 0, "B não vê o histórico de A");
  assert.equal((await as(B, `delete from public.ai_analyses where id = '${rows[0].id}' returning id`)).rows.length, 0, "B não apaga");
  await assert.rejects(as(B, `insert into public.ai_analyses (user_id, scope, question, answer) values ('${A}', 'records', 'Pergunta', 'x')`));
  assert.equal((await as(A, `delete from public.ai_analyses where id = '${rows[0].id}' returning id`)).rows.length, 1, "dono apaga");

  await db.exec("set role anon;");
  try {
    await assert.rejects(db.query("select * from public.ai_analyses"));
  } finally {
    await db.exec("reset role;");
  }
});
