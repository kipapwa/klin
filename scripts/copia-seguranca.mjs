// Cópia de segurança dos dados do Klin, usada pelo agendamento semanal
// .github/workflows/copia-seguranca.yml. Lê cada tabela pela API do Supabase com a chave
// secreta (só existe nos segredos do GitHub) e grava um JSON por tabela em ./copia/.
// O workflow junta tudo num arquivo e o CRIPTOGRAFA com a senha BACKUP_SENHA antes de guardar:
// a cópia tem dados de saúde (LGPD) e os artefatos podem ser baixados por quem acessa o repositório.
//
// Uso: SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/copia-seguranca.mjs
import { mkdir, writeFile } from 'node:fs/promises';

const URL_SB = process.env.SUPABASE_URL;
const CHAVE = process.env.SUPABASE_SECRET_KEY;
if (!URL_SB || !CHAVE) {
  console.error('Faltam SUPABASE_URL e SUPABASE_SECRET_KEY.');
  process.exit(1);
}

// [tabela, coluna para ordenar (a chave primária)]. Todas as tabelas de "public" com dados que não
// se refazem sozinhos. Ficam de fora: push_subscriptions (o aparelho se inscreve de novo ao ativar as
// notificações) e ai_usage (só a contagem da cota diária de IA, que zera em 24 h).
// Os áudios do Storage também não entram (podem passar de 7 MB cada); a nota escrita pela IA entra.
const TABELAS = [
  ['profiles', 'id'],
  ['medical_records', 'id'],
  ['medications', 'id'],
  ['medication_logs', 'id'],
  ['ai_saved_questions', 'id'],
  ['ai_analyses', 'id'],
  ['bp_readings', 'id'],
];
const POR_VEZ = 1000;

async function ler(tabela, ordem) {
  const linhas = [];
  for (let de = 0; ; de += POR_VEZ) {
    const r = await fetch(`${URL_SB}/rest/v1/${tabela}?select=*&order=${ordem}.asc`, {
      headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, Range: `${de}-${de + POR_VEZ - 1}`, 'Range-Unit': 'items' },
    });
    // Tabela que ainda não existe (SQL novo não rodado): segue sem ela.
    if (r.status === 404 || r.status === 400) {
      const corpo = await r.text();
      if (/does not exist|Could not find/i.test(corpo)) return null;
      throw new Error(`${tabela}: HTTP ${r.status} ${corpo.slice(0, 200)}`);
    }
    if (r.status === 416) break; // pediu além do fim
    if (!r.ok) throw new Error(`${tabela}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const parte = await r.json();
    linhas.push(...parte);
    if (parte.length < POR_VEZ) break;
  }
  return linhas;
}

await mkdir('copia', { recursive: true });
const resumo = { feita_em: new Date().toISOString(), tabelas: {} };
for (const [tabela, ordem] of TABELAS) {
  const linhas = await ler(tabela, ordem);
  if (linhas === null) {
    console.log(`${tabela}: não existe (pulada)`);
    continue;
  }
  await writeFile(`copia/${tabela}.json`, JSON.stringify(linhas));
  resumo.tabelas[tabela] = linhas.length;
  console.log(`${tabela}: ${linhas.length} linha(s)`);
}
await writeFile('copia/resumo.json', JSON.stringify(resumo, null, 2));
// Só os números (sem dados pessoais) vão para o resumo da execução no GitHub.
if (process.env.GITHUB_STEP_SUMMARY) {
  const linhas = Object.entries(resumo.tabelas).map(([t, n]) => `| ${t} | ${n} |`).join('\n');
  await writeFile(process.env.GITHUB_STEP_SUMMARY, `### Cópia de segurança\n\n| Tabela | Linhas |\n|---|---|\n${linhas}\n`, { flag: 'a' });
}
