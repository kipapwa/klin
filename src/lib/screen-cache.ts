/**
 * Telas instantâneas (skill tela-instantanea): cada tela desenha na hora com
 * o que ficou guardado da última vez e só troca se o banco trouxer algo
 * diferente.
 *
 * Guardado: memória + localStorage DESTE aparelho, separado por conta
 * ("klin:tela:<usuário>:<nome>") e apagado ao sair da conta. Contém dados
 * clínicos do próprio usuário — mesma proteção da sessão de login, que já
 * fica neste armazenamento e dá acesso a tudo. As permissões continuam no
 * banco (RLS): o guardado nunca libera nada.
 */

const PREFIX = "klin:tela:";
/** Acima disto (em caracteres) fica só na memória, para não lotar o armazenamento. */
const MAX_PERSIST = 300_000;

let userId: string | null = null;
const memory = new Map<string, unknown>();

/** Chamado pelo SessionProvider quando a sessão muda. */
export function setScreenUser(id: string | null) {
  if (id !== userId) memory.clear();
  userId = id;
}

const keyOf = (name: string) => (userId ? `${PREFIX}${userId}:${name}` : null);

export function readScreen<T>(name: string): T | undefined {
  const key = keyOf(name);
  if (!key) return undefined;
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as T;
    memory.set(key, value);
    return value;
  } catch {
    return undefined;
  }
}

export function writeScreen<T>(name: string, value: T) {
  const key = keyOf(name);
  if (!key) return;
  memory.set(key, value);
  try {
    const raw = JSON.stringify(value);
    if (raw.length <= MAX_PERSIST) localStorage.setItem(key, raw);
    else localStorage.removeItem(key);
  } catch {
    // armazenamento cheio ou bloqueado: fica só na memória
  }
}

export function forgetScreen(name: string) {
  const key = keyOf(name);
  if (!key) return;
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // nada a apagar
  }
}

/** Ao sair da conta: apaga tudo o que foi guardado deste usuário. */
export function forgetUserScreens(id: string | null = userId) {
  memory.clear();
  if (!id) return;
  try {
    const mine = `${PREFIX}${id}:`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(mine)) localStorage.removeItem(k);
    }
  } catch {
    // sem armazenamento
  }
}

/** Mesmo conteúdo? (evita redesenhar à toa quando o banco devolve o mesmo) */
export function sameData(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Busca em segundo plano as telas mais usadas que ainda não estão guardadas
 * (roda ao abrir a linha do tempo), para a primeira visita também abrir na hora.
 */
export async function prefetchScreens(loaders: Record<string, () => Promise<unknown>>) {
  await Promise.all(
    Object.entries(loaders).map(async ([name, load]) => {
      if (readScreen(name) !== undefined) return;
      try {
        writeScreen(name, await load());
      } catch {
        // sem rede ou erro: a tela busca sozinha quando for aberta
      }
    }),
  );
}
