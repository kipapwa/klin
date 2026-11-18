import assert from "node:assert/strict";
import { test } from "node:test";
import { publishableKey, secretKey } from "./supabase-keys.ts";

const env = (vars: Record<string, string>) => (name: string) => vars[name];

test("prefere as chaves novas (JSON), pela chave 'default'", () => {
  const get = env({
    SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_a","outra":"sb_publishable_b"}',
    SUPABASE_SECRET_KEYS: '{"default":"sb_secret_a"}',
    SUPABASE_ANON_KEY: "eyJ-legada",
    SUPABASE_SERVICE_ROLE_KEY: "eyJ-legada-sr",
  });
  assert.equal(publishableKey(get), "sb_publishable_a");
  assert.equal(secretKey(get), "sb_secret_a");
});

test("sem 'default', usa a primeira chave do dicionário", () => {
  assert.equal(secretKey(env({ SUPABASE_SECRET_KEYS: '{"klin":"sb_secret_k"}' })), "sb_secret_k");
});

test("cai nas legadas quando as novas faltam, estão vazias ou inválidas", () => {
  assert.equal(publishableKey(env({ SUPABASE_ANON_KEY: "eyJ-anon" })), "eyJ-anon");
  assert.equal(secretKey(env({ SUPABASE_SECRET_KEYS: "{}", SUPABASE_SERVICE_ROLE_KEY: "eyJ-sr" })), "eyJ-sr");
  assert.equal(secretKey(env({ SUPABASE_SECRET_KEYS: "não é json", SUPABASE_SERVICE_ROLE_KEY: "eyJ-sr" })), "eyJ-sr");
  assert.equal(secretKey(env({})), undefined);
});
