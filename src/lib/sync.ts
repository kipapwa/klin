import { deleteDraft, listDrafts, saveDraft } from "./offline-store";
import { createRecordFromAudio, OfflineError, processRecord, UserFacingError } from "./records";

let running: Promise<number> | null = null;

/**
 * Envia as gravações guardadas no aparelho (em ordem de gravação) e pede a
 * nota à IA. Uma execução por vez. Devolve quantas foram enviadas.
 * A IA roda em segundo plano: se falhar, a nota fica "Aguardando IA" e pode
 * ser reprocessada pela tela do registro.
 */
export function syncDrafts(userId: string): Promise<number> {
  running ??= (async () => {
    let sent = 0;
    try {
      for (const draft of await listDrafts(userId)) {
        try {
          const recordId = await createRecordFromAudio(draft.blob, draft.durationSeconds, {
            clientId: draft.clientId,
            recordedAt: draft.recordedAt,
          });
          await deleteDraft(draft.clientId);
          sent++;
          processRecord(recordId).catch(() => {});
        } catch (err) {
          if (err instanceof OfflineError) break; // sem rede: tenta de novo quando voltar
          await saveDraft({
            ...draft,
            attempts: draft.attempts + 1,
            lastError: err instanceof UserFacingError ? err.message : "Erro inesperado.",
          });
        }
      }
    } finally {
      running = null;
    }
    return sent;
  })();
  return running;
}
