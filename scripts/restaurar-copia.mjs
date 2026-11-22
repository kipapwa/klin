// Devolve ao banco os dados de uma cópia de segurança semanal (.github/workflows/copia-seguranca.yml).
// Antes, rode uma vez supabase/restaurar-copia.sql no SQL Editor do Supabase.
//
// Uso (na pasta do projeto):
//   node scripts/restaurar-copia.mjs <copia>  [opções]
//   <copia>: o .zip baixado do GitHub (Actions › Cópia de segurança › Artifacts), o copia.tar.gz.enc,
//            o copia.tar.gz ou a pasta "copia" já aberta.
// Opções:
//   --tabelas bp_readings,medications   só essas tabelas (padrão: todas)
//   --registro <id>             só esse registro médico (e os remédios criados a partir dele)
//   --remedio <id>              só esse remédio e o histórico de doses dele
//   --sobrescrever              as linhas que já existem voltam a ficar iguais às da cópia
//                               (padrão: só recria o que sumiu, sem mexer no que existe)
//   --sim                       não pergunta antes de gravar
// Pede a senha da cópia (BACKUP_SENHA) e a chave secreta do Supabase (Project Settings › API Keys ›
// Secret key), ou lê as duas das variáveis de ambiente BACKUP_SENHA e SUPABASE_SECRET_KEY.
// Antes de gravar, mostra quanto existe na cópia e quanto falta no banco, e pede para digitar RESTAURAR.
//
// O que a cópia não tem: contas de login (registro ligado de forma obrigatória a uma conta que não
// existe mais fica de fora), arquivos do Storage e as tabelas deixadas de fora em copia-seguranca.mjs.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { pbkdf2Sync, createDecipheriv } from 'node:crypto';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

// Ordem de gravação: primeiro o que as outras tabelas usam (pais antes dos filhos).
export const TABELAS = [
  'profiles',
  'medical_records',
  'medications',
  'medication_logs',
  'ai_saved_questions',
  'ai_analyses',
  'bp_readings',
];

// Restaurar um único item com os filhos dele. Apagar um remédio apaga junto o histórico de doses;
// apagar um registro deixa os remédios dele sem vínculo (use --sobrescrever para religar).
const UNS_REGISTROS = [
  { opcao: '--registro', tabela: 'medical_records', filhos: { medications: 'record_id' } },
  { opcao: '--remedio', tabela: 'medications', filhos: { medication_logs: 'medication_id' } },
];
const POR_VEZ = 500;
const BYTES_POR_VEZ = 2_000_000;

// ---------------------------------------------------------------------------------------------
// Abrir a cópia (sem dependências: zip, openssl enc, gzip e tar feitos à mão)
// ---------------------------------------------------------------------------------------------

// .zip do GitHub: devolve { nome: Buffer } de cada arquivo.
export function abrirZip(buf) {
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error('Arquivo .zip inválido.');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const arquivos = {};
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Arquivo .zip inválido.');
    const metodo = buf.readUInt16LE(p + 10);
    const tamanho = buf.readUInt32LE(p + 20);
    const nomeLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const comentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + nomeLen);
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dados = buf.subarray(ini, ini + tamanho);
    if (metodo === 0) arquivos[nome] = Buffer.from(dados);
    else if (metodo === 8) arquivos[nome] = inflateRawSync(dados);
    else throw new Error(`${nome}: compressão ${metodo} não suportada.`);
    p += 46 + nomeLen + extraLen + comentLen;
  }
  return arquivos;
}

// Mesmo formato de "openssl enc -aes-256-cbc -pbkdf2 -iter 250000 -salt".
export function decifrar(buf, senha) {
  if (buf.toString('latin1', 0, 8) !== 'Salted__') throw new Error('Este arquivo não é uma cópia criptografada.');
  const sal = buf.subarray(8, 16);
  const chave = pbkdf2Sync(senha, sal, 250000, 48, 'sha256');
  const d = createDecipheriv('aes-256-cbc', chave.subarray(0, 32), chave.subarray(32, 48));
  try {
    return Buffer.concat([d.update(buf.subarray(16)), d.final()]);
  } catch {
    throw new Error('Senha errada (ou arquivo danificado).');
  }
}

// .tar: devolve { nome: Buffer } dos arquivos comuns.
export function lerTar(buf) {
  const arquivos = {};
  let p = 0;
  while (p + 512 <= buf.length) {
    const cab = buf.subarray(p, p + 512);
    if (cab.every((b) => b === 0)) break;
    const campo = (de, ate) => cab.toString('utf8', de, ate).replace(/\0.*$/s, '');
    const tamanho = parseInt(campo(124, 136).trim() || '0', 8);
    const tipo = campo(156, 157);
    const prefixo = campo(345, 500);
    const nome = (prefixo ? prefixo + '/' : '') + campo(0, 100);
    if (tipo === '0' || tipo === '') arquivos[nome] = Buffer.from(buf.subarray(p + 512, p + 512 + tamanho));
    p += 512 + Math.ceil(tamanho / 512) * 512;
  }
  return arquivos;
}

// Devolve { tabela: linhas[] } a partir de .zip, .enc, .tar.gz ou pasta.
export async function lerCopia(caminho, pedirSenha) {
  const info = await stat(caminho);
  let arquivos = {};
  if (info.isDirectory()) {
    for (const nome of await readdir(caminho)) {
      if (nome.endsWith('.json')) arquivos[nome] = await readFile(join(caminho, nome));
    }
  } else {
    let buf = await readFile(caminho);
    if (buf.readUInt32LE(0) === 0x04034b50) {
      const dentro = abrirZip(buf);
      const enc = Object.keys(dentro).find((n) => n.endsWith('.enc'));
      if (!enc) throw new Error('O .zip não tem o arquivo copia.tar.gz.enc.');
      buf = dentro[enc];
    }
    if (buf.toString('latin1', 0, 8) === 'Salted__') buf = decifrar(buf, await pedirSenha());
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
    arquivos = lerTar(buf);
  }
  const tabelas = {};
  let resumo = null;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const t = basename(nome, '.json');
    if (t === 'resumo') resumo = JSON.parse(conteudo.toString('utf8'));
    else if (TABELAS.includes(t)) tabelas[t] = JSON.parse(conteudo.toString('utf8'));
  }
  if (!Object.keys(tabelas).length) throw new Error('Nenhuma tabela encontrada na cópia.');
  return { tabelas, resumo };
}

// Divide as linhas em partes que cabem num pedido.
export function partes(linhas) {
  const saida = [];
  let atual = [];
  let bytes = 0;
  for (const l of linhas) {
    const tam = JSON.stringify(l).length;
    if (atual.length && (atual.length >= POR_VEZ || bytes + tam > BYTES_POR_VEZ)) {
      saida.push(atual);
      atual = [];
      bytes = 0;
    }
    atual.push(l);
    bytes += tam;
  }
  if (atual.length) saida.push(atual);
  return saida;
}

// ---------------------------------------------------------------------------------------------
// Conversa com o usuário e com o Supabase
// ---------------------------------------------------------------------------------------------

function perguntar(texto, oculto = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) {
      rl._writeToOutput = (s) => { if (s.includes(texto) || s.includes('\n')) rl.output.write(s.includes(texto) ? s : '\n'); };
    }
    rl.question(texto, (r) => { rl.close(); resolve(r.trim()); });
  });
}

async function restaurar(url, chave, tabela, linhas, modo, simular) {
  const r = await fetch(`${url}/rest/v1/rpc/restaurar_copia`, {
    method: 'POST',
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_tabela: tabela, p_linhas: linhas, p_modo: modo, p_simular: simular }),
  });
  const corpo = await r.text();
  if (r.ok) return JSON.parse(corpo);
  let erro = corpo;
  try { const j = JSON.parse(corpo); erro = j.message || corpo; if (j.code === 'PGRST202') erro = 'FALTA_FUNCAO'; } catch { /* texto */ }
  if (r.status === 401 || r.status === 403) erro = 'Chave secreta recusada pelo Supabase (confira se é a Secret key, sb_secret_...).';
  throw new Error(erro);
}

async function somar(url, chave, tabela, linhas, modo, simular) {
  const total = { recebidas: 0, descartadas: 0, sem_vinculo: 0, novas: 0, gravadas: 0 };
  for (const parte of partes(linhas)) {
    const r = await restaurar(url, chave, tabela, parte, modo, simular);
    for (const k of Object.keys(total)) total[k] += r[k] || 0;
  }
  return total;
}

function tabelaTexto(cab, linhas) {
  const larg = cab.map((c, i) => Math.max(c.length, ...linhas.map((l) => String(l[i]).length)));
  const fmt = (l) => l.map((v, i) => (i ? String(v).padStart(larg[i]) : String(v).padEnd(larg[i]))).join('  ');
  return [fmt(cab), larg.map((n) => '-'.repeat(n)).join('  '), ...linhas.map(fmt)].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const opcao = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const flag = (nome) => { const i = args.indexOf(nome); if (i >= 0) args.splice(i, 1); return i >= 0; };
  const soTabelas = opcao('--tabelas');
  let UM_REGISTRO = null;
  let umId = null;
  for (const u of UNS_REGISTROS) {
    const id = opcao(u.opcao);
    if (id && umId) throw new Error('Use só uma opção de item único por vez.');
    if (id) { UM_REGISTRO = u; umId = id; }
  }
  const modo = flag('--sobrescrever') ? 'sobrescrever' : 'faltando';
  const semPerguntar = flag('--sim');
  const caminho = args[0];
  if (!caminho) {
    console.log(`Uso: node scripts/restaurar-copia.mjs <copia.zip | copia.tar.gz.enc | pasta copia> [--tabelas a,b] [--registro <id> | --remedio <id>] [--sobrescrever] [--sim]`);
    process.exit(1);
  }

  const url = (process.env.SUPABASE_URL || 'https://oxkjzvhrhmfazaoupnsa.supabase.co').replace(/\/$/, '');
  const { tabelas, resumo } = await lerCopia(caminho, async () => process.env.BACKUP_SENHA || perguntar('Senha da cópia (BACKUP_SENHA): ', true));
  console.log(`\nCópia feita em: ${resumo?.feita_em ? new Date(resumo.feita_em).toLocaleString('pt-BR') : '(sem data)'}`);

  let escolhidas = TABELAS.filter((t) => tabelas[t]);
  if (soTabelas) {
    const pedidas = soTabelas.split(',').map((s) => s.trim()).filter(Boolean);
    const desconhecidas = pedidas.filter((t) => !TABELAS.includes(t));
    if (desconhecidas.length) throw new Error(`Tabela desconhecida: ${desconhecidas.join(', ')}. Use: ${TABELAS.join(', ')}`);
    escolhidas = escolhidas.filter((t) => pedidas.includes(t));
  }
  if (umId) {
    const { tabela, filhos } = UM_REGISTRO;
    escolhidas = [tabela, ...Object.keys(filhos)].filter((t) => tabelas[t]);
    tabelas[tabela] = (tabelas[tabela] || []).filter((l) => l.id === umId);
    for (const [filho, coluna] of Object.entries(filhos)) tabelas[filho] = (tabelas[filho] || []).filter((l) => l[coluna] === umId);
    if (!tabelas[tabela].length) throw new Error(`O registro ${umId} não está em ${tabela} nesta cópia.`);
  }
  if (!escolhidas.length) throw new Error('Nenhuma das tabelas pedidas está na cópia.');

  const chave = process.env.SUPABASE_SECRET_KEY || await perguntar('Chave secreta do Supabase (sb_secret_...): ', true);
  if (!chave) throw new Error('Sem a chave secreta não dá para gravar.');

  // 1) Simulação: quanto falta em cada tabela.
  console.log(`\nBanco: ${url}`);
  console.log(modo === 'faltando'
    ? 'Modo: só recriar o que sumiu (nada que existe é alterado).'
    : 'Modo: SOBRESCREVER (o que existe volta a ficar igual à cópia).');
  const previa = [];
  for (const t of escolhidas) {
    const r = await somar(url, chave, t, tabelas[t], modo, true);
    previa.push([t, r.recebidas, r.recebidas - r.novas - r.descartadas, r.novas, r.descartadas]);
  }
  console.log('\n' + tabelaTexto(['tabela', 'na cópia', 'já existem', 'faltam', 'sem conta'], previa));
  console.log('\n"sem conta": ligadas a uma conta de login que não existe mais; ficam de fora.');
  if (modo === 'faltando' && previa.every((l) => l[3] === 0)) {
    console.log('\nNão falta nada no banco. Para voltar valores alterados, use --sobrescrever.');
    return;
  }

  if (!semPerguntar) {
    const r = await perguntar('\nPara gravar, digite RESTAURAR: ');
    if (r !== 'RESTAURAR') { console.log('Nada foi gravado.'); return; }
  }

  // 2) Gravação, tabela por tabela.
  const fim = [];
  for (const t of escolhidas) {
    process.stdout.write(`${t}… `);
    const r = await somar(url, chave, t, tabelas[t], modo, false);
    console.log(`${r.gravadas} gravada(s)`);
    fim.push([t, r.gravadas, r.recebidas - r.gravadas - r.descartadas, r.descartadas, r.sem_vinculo]);
  }
  console.log('\n' + tabelaTexto(['tabela', 'gravadas', 'não mexidas', 'de fora', 'ligação vazia'], fim));
  console.log('\n"não mexidas": já existiam ou bateriam com outra (valor que não pode repetir).');
  console.log('"de fora": ligadas a uma conta ou registro que não existe mais.');
  console.log('"ligação vazia": gravadas, mas a conta ou registro ligado (opcional) não existe mais.');
  console.log('\nArquivos do Storage e contas de login não fazem parte da cópia.');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => {
    if (e.message === 'FALTA_FUNCAO') {
      console.error('\nO banco ainda não tem a função de restaurar. Rode supabase/restaurar-copia.sql no SQL Editor do Supabase e tente de novo.');
    } else {
      console.error(`\nErro: ${e.message}`);
      console.error('O que já foi gravado antes do erro continua gravado; rodar de novo não duplica nada.');
    }
    process.exit(1);
  });
}
