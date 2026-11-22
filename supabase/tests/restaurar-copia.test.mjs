/**
 * Restauração da cópia de segurança (supabase/restaurar-copia.sql) num Postgres em memória:
 * simulação, ids originais, vínculos de duas colunas, gatilhos desligados, sobrescrever e permissões.
 * Rodar: npm run test:db
 */
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { STUBS } from "./stubs.mjs";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const restaurarSql = readFileSync(new URL("../restaurar-copia.sql", import.meta.url), "utf8");
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const REC = "30000000-0000-0000-0000-000000000001";
const MED = "40000000-0000-0000-0000-000000000001";
const TABELAS = ["profiles", "medical_records", "medications", "medication_logs", "ai_saved_questions", "ai_analyses", "bp_readings"];

let db;
const q = async (sql) => (await db.query(sql)).rows;
const um = async (sql) => (await q(sql))[0];

async function as(role, uid, sql) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try {
    return await db.exec(sql);
  } finally {
    await db.exec("reset role;");
  }
}

/** Como a cópia: select * de cada tabela, em JSON (como a API devolve). */
async function copiar() {
  const c = {};
  for (const t of TABELAS) c[t] = (await um(`select coalesce(jsonb_agg(to_jsonb(x)), '[]') as j from public.${t} x`)).j;
  return c;
}

async function restaurar(t, linhas, modo = "faltando", simular = false) {
  await db.exec("set role service_role;");
  try {
    const { rows } = await db.query("select public.restaurar_copia($1, $2::jsonb, $3, $4) as r", [t, JSON.stringify(linhas), modo, simular]);
    return rows[0].r;
  } finally {
    await db.exec("reset role;");
  }
}

before(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  await db.exec(schema);
  await db.exec(restaurarSql);
  await db.exec(restaurarSql); // pode rodar de novo
  await db.exec(`insert into auth.users values ('${A}'), ('${B}');`);
  await as(
    "authenticated",
    A,
    `insert into public.medical_records (id, title, category, severity, chief_complaint, status)
       values ('${REC}', 'Consulta cardio', 'follow_up', 'attention', 'pressão alta', 'ready');
     insert into public.medications (id, record_id, name, interval_hours, starts_at)
       values ('${MED}', '${REC}', 'Losartana', 12, now() - interval '3 days');
     insert into public.medication_logs (medication_id, scheduled_for, status, taken_at)
       values ('${MED}', (select starts_at from public.medications where id = '${MED}'), 'taken', now());
     insert into public.bp_readings (systolic, diastolic, pulse) values (150, 95, 80), (128, 82, null);
     insert into public.ai_saved_questions (scope, question) values ('pressure', 'Como está minha pressão?');
     insert into public.ai_analyses (scope, question, answer) values ('pressure', 'Como está minha pressão?', 'Média 139/88.');`,
  );
  await as("authenticated", B, "insert into public.bp_readings (systolic, diastolic) values (118, 76)");
});

test("só a chave secreta restaura; anon e usuário logado não", async () => {
  await assert.rejects(as("anon", null, "select public.restaurar_copia('bp_readings', '[]'::jsonb)"));
  await assert.rejects(as("authenticated", A, "select public.restaurar_copia('bp_readings', '[]'::jsonb)"));
  await assert.rejects(restaurar("ai_usage", [{ id: 1 }]), /não pode ser restaurada/);
});

test("remédio apagado volta com o histórico de doses, ids originais e sem recalcular a agenda", async () => {
  const copia = await copiar();
  const antes = await um(`select next_dose_at, ends_at from public.medications where id = '${MED}'`);

  // Estragos: apaga o remédio (o histórico vai junto), apaga uma medição, muda outra e apaga o
  // registro (os remédios ficariam sem vínculo).
  await as(
    "authenticated",
    A,
    `delete from public.medications where id = '${MED}';
     delete from public.bp_readings where systolic = 150;
     update public.bp_readings set note = 'mudada' where systolic = 128;
     delete from public.medical_records where id = '${REC}';`,
  );
  assert.equal((await um("select count(*)::int n from public.medication_logs")).n, 0);

  // Simulação não grava nada.
  for (const t of TABELAS) await restaurar(t, copia[t], "faltando", true);
  assert.equal((await um("select count(*)::int n from public.medications")).n, 0, "simulação gravou");

  const r = {};
  for (const t of TABELAS) r[t] = await restaurar(t, copia[t]);
  assert.equal(r.medical_records.gravadas, 1);
  assert.equal(r.medications.gravadas, 1);
  assert.equal(r.medication_logs.gravadas, 1);
  assert.equal(r.bp_readings.gravadas, 1, "só a medição que sumiu");
  assert.equal(r.profiles.gravadas, 0);

  const med = await um(`select record_id, next_dose_at, ends_at from public.medications where id = '${MED}'`);
  assert.equal(med.record_id, REC, "vínculo com o registro (duas colunas) voltou");
  assert.deepEqual([med.next_dose_at, med.ends_at], [antes.next_dose_at, antes.ends_at], "agenda igual à da cópia");
  assert.equal((await um("select note from public.bp_readings where systolic = 128")).note, "mudada", "modo padrão não mexe no que existe");
  assert.equal((await um("select count(*)::int n from pg_trigger where not tgisinternal and tgenabled = 'D'")).n, 0, "gatilho ficou desligado");

  // Repetir não duplica.
  for (const t of TABELAS) assert.equal((await restaurar(t, copia[t])).gravadas, 0, `${t} duplicou`);

  // Sobrescrever volta o valor da cópia.
  await restaurar("bp_readings", copia.bp_readings, "sobrescrever");
  assert.equal((await um("select note from public.bp_readings where systolic = 128")).note, null);
});

test("conta excluída fica de fora; registro que sumiu deixa o remédio sem vínculo", async () => {
  const copia = await copiar();
  await db.exec(`delete from auth.users where id = '${B}'`);
  const r = await restaurar("bp_readings", copia.bp_readings);
  assert.equal(r.descartadas, 1, "medição da conta excluída");
  assert.equal(r.gravadas, 0);

  await as("authenticated", A, `delete from public.medications where id = '${MED}'; delete from public.medical_records where id = '${REC}';`);
  const m = await restaurar("medications", copia.medications);
  assert.equal(m.gravadas, 1);
  assert.equal(m.sem_vinculo, 1);
  assert.equal((await um(`select record_id from public.medications where id = '${MED}'`)).record_id, null);
});
