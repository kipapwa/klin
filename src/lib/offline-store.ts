/**
 * Gravações feitas sem internet, guardadas no IndexedDB DESTE aparelho até
 * serem enviadas. Apagadas ao enviar ou ao sair da conta.
 */

export interface Draft {
  /** Gerado no aparelho: vira medical_records.client_id (envio idempotente). */
  clientId: string;
  userId: string;
  blob: Blob;
  durationSeconds: number;
  recordedAt: string;
  attempts: number;
  lastError?: string;
}

const DB_NAME = "klin";
const STORE = "drafts";
export const DRAFTS_CHANGED = "klin:drafts-changed";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "clientId" });
      store.createIndex("userId", "userId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function changed() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DRAFTS_CHANGED));
}

export async function saveDraft(draft: Draft): Promise<void> {
  await run("readwrite", (s) => s.put(draft));
  changed();
}

export async function listDrafts(userId: string): Promise<Draft[]> {
  try {
    const all = await run("readonly", (s) => s.index("userId").getAll(userId) as IDBRequest<Draft[]>);
    return all.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  } catch {
    return [];
  }
}

export async function pendingDraftCount(userId: string): Promise<number> {
  return (await listDrafts(userId)).length;
}

export async function deleteDraft(clientId: string): Promise<void> {
  await run("readwrite", (s) => s.delete(clientId));
  changed();
}

export async function deleteDraftsOf(userId: string): Promise<void> {
  for (const d of await listDrafts(userId)) await deleteDraft(d.clientId);
}
