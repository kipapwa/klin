// Abrir a cópia de segurança (openssl enc + tar.gz) e dividir as linhas em partes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, createCipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { decifrar, lerTar, partes } from '../restaurar-copia.mjs';

// Mesmo formato de "openssl enc -aes-256-cbc -pbkdf2 -iter 250000 -salt".
function cifrar(buf, senha) {
  const sal = randomBytes(8);
  const k = pbkdf2Sync(senha, sal, 250000, 48, 'sha256');
  const c = createCipheriv('aes-256-cbc', k.subarray(0, 32), k.subarray(32, 48));
  return Buffer.concat([Buffer.from('Salted__'), sal, c.update(buf), c.final()]);
}

function tar(arquivos) {
  const blocos = [];
  for (const [nome, texto] of Object.entries(arquivos)) {
    const dados = Buffer.from(texto);
    const cab = Buffer.alloc(512);
    cab.write(nome, 0);
    cab.write(dados.length.toString(8).padStart(11, '0') + '\0', 124);
    cab.write('0', 156);
    blocos.push(cab, dados, Buffer.alloc((512 - (dados.length % 512)) % 512));
  }
  return Buffer.concat([...blocos, Buffer.alloc(1024)]);
}

test('abre a cópia criptografada e lê cada tabela', () => {
  const original = tar({ 'copia/mensagens.json': '[{"id":1,"texto":"olá, ação"}]', 'copia/resumo.json': '{}' });
  const aberto = lerTar(gunzipSync(decifrar(cifrar(gzipSync(original), 'senha-longa-123'), 'senha-longa-123')));
  assert.deepEqual(Object.keys(aberto), ['copia/mensagens.json', 'copia/resumo.json']);
  assert.deepEqual(JSON.parse(aberto['copia/mensagens.json']), [{ id: 1, texto: 'olá, ação' }]);
});

test('senha errada é avisada', () => {
  const enc = cifrar(Buffer.from('x'.repeat(100)), 'certa-123456');
  assert.throws(() => decifrar(enc, 'errada-123456'), /Senha errada/);
  assert.throws(() => decifrar(Buffer.from('não é cópia'), 'x'), /não é uma cópia/);
});

test('divide em partes de até 500 linhas', () => {
  const linhas = Array.from({ length: 1201 }, (_, i) => ({ id: i }));
  const p = partes(linhas);
  assert.deepEqual(p.map((x) => x.length), [500, 500, 201]);
  assert.deepEqual(p.flat(), linhas);
  assert.deepEqual(partes([]), []);
});

test('linhas grandes ficam em partes menores', () => {
  const grande = { texto: 'x'.repeat(900_000) };
  assert.deepEqual(partes([grande, grande, grande]).map((x) => x.length), [2, 1]);
});
