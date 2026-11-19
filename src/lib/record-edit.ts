/**
 * Dia e horário de um registro nos campos <input type="date"> e <input type="time">
 * (no fuso do aparelho, o mesmo usado para mostrar a data). Puro, testável no Node.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO -> { date: "YYYY-MM-DD", time: "HH:MM" } no horário local. */
export function toLocalInputs(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Registros podem ser de até 1 ano à frente (ex.: retorno marcado). */
export const MAX_FUTURE_MS = 366 * 24 * 60 * 60 * 1000;
const MIN_YEAR = 1900;

/**
 * Campos -> ISO. Devolve a mensagem de erro quando o valor não serve.
 * `now` é passado de fora (nada de Date.now() na renderização).
 */
export function fromLocalInputs(date: string, time: string, now: number): { iso: string } | { error: string } {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm) return { error: "Escolha o dia." };
  if (!tm) return { error: "Escolha o horário." };
  const [y, mo, d, h, mi] = [dm[1], dm[2], dm[3], tm[1], tm[2]].map(Number);
  const local = new Date(y, mo - 1, d, h, mi);
  // Data inexistente (31/02) faz o Date "pular" para outro dia.
  if (local.getFullYear() !== y || local.getMonth() !== mo - 1 || local.getDate() !== d || h > 23 || mi > 59) {
    return { error: "Data inválida." };
  }
  if (y < MIN_YEAR) return { error: `Escolha uma data a partir de ${MIN_YEAR}.` };
  if (local.getTime() - now > MAX_FUTURE_MS) return { error: "A data pode ser no máximo 1 ano à frente." };
  return { iso: local.toISOString() };
}
