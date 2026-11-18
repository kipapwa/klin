import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// localStorage mínimo para o Node.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  get length() {
    return store.size;
  },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { forgetScreen, forgetUserScreens, prefetchScreens, readScreen, sameData, setScreenUser, writeScreen } = await import("./screen-cache.ts");

beforeEach(() => {
  store.clear();
  setScreenUser(null);
});

test("guardado separado por conta e nada sem conta", () => {
  writeScreen("remedios", ["sem conta"]);
  assert.equal(store.size, 0, "sem usuário não guarda");

  setScreenUser("ana");
  writeScreen("remedios", ["da Ana"]);
  setScreenUser("bia");
  assert.equal(readScreen("remedios"), undefined, "Bia não vê o guardado da Ana");
  writeScreen("remedios", ["da Bia"]);
  setScreenUser("ana");
  assert.deepEqual(readScreen("remedios"), ["da Ana"]);
});

test("sobrevive a reabrir o app (memória vazia, lê do armazenamento)", () => {
  setScreenUser("ana");
  writeScreen("perfil", { tz: "America/Sao_Paulo" });
  setScreenUser(null); // "fecha"
  setScreenUser("ana"); // "reabre": memória limpa
  assert.deepEqual(readScreen("perfil"), { tz: "America/Sao_Paulo" });
});

test("sair da conta apaga só as telas daquela conta", () => {
  setScreenUser("ana");
  writeScreen("a", 1);
  writeScreen("b", 2);
  setScreenUser("bia");
  writeScreen("a", 3);
  forgetUserScreens("ana");
  assert.deepEqual([...store.keys()], ["klin:tela:bia:a"]);
  setScreenUser("ana");
  assert.equal(readScreen("a"), undefined);
});

test("forgetScreen, limite de tamanho e sameData", () => {
  setScreenUser("ana");
  writeScreen("x", 1);
  forgetScreen("x");
  assert.equal(readScreen("x"), undefined);

  writeScreen("grande", "x".repeat(400_000));
  assert.equal(store.has("klin:tela:ana:grande"), false, "grande demais fica só na memória");
  assert.equal((readScreen("grande") as string).length, 400_000);

  assert.equal(sameData({ a: [1] }, { a: [1] }), true);
  assert.equal(sameData({ a: [1] }, { a: [2] }), false);
});

test("prefetchScreens busca só o que ainda não está guardado", async () => {
  setScreenUser("ana");
  writeScreen("perfil", "guardado");
  let calls = 0;
  await prefetchScreens({
    perfil: async () => {
      calls++;
      return "novo";
    },
    remedios: async () => {
      calls++;
      return ["r"];
    },
    falha: async () => {
      throw new Error("sem rede");
    },
  });
  assert.equal(calls, 1);
  assert.equal(readScreen("perfil"), "guardado");
  assert.deepEqual(readScreen("remedios"), ["r"]);
});
