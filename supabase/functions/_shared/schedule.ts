/**
 * Datas no fuso do usuário (ex.: "America/Sao_Paulo") sem bibliotecas.
 * Módulo puro: roda nas Edge Functions e nos testes em Node.
 */

/** Diferença (minutos) entre o horário local do fuso e o UTC naquele instante. */
function offsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60000);
}

/** Fuso válido ou o padrão do app. */
export function safeTimeZone(tz: string | null | undefined): string {
  try {
    if (tz) {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    }
  } catch {
    // fuso inválido: usa o padrão
  }
  return "America/Sao_Paulo";
}

/** Data local "YYYY-MM-DD" de um instante no fuso indicado. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Instante UTC correspondente a "YYYY-MM-DD" + "HH:MM" no fuso indicado. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Duas passadas resolvem a virada de horário de verão.
  let utc = guess - offsetMinutes(guess, timeZone) * 60000;
  utc = guess - offsetMinutes(utc, timeZone) * 60000;
  return new Date(utc);
}

/** Soma dias a uma data "YYYY-MM-DD". */
export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Início do tratamento: o próximo "HH:MM" local a partir de `from`
 * (hoje, se ainda não passou; senão amanhã). Sem horário: o próprio `from`.
 */
export function medicationStart(from: Date, startTime: string | null, timeZone: string): Date {
  if (!startTime) return from;
  const today = localDate(from, timeZone);
  const candidate = zonedToUtc(today, startTime, timeZone);
  return candidate.getTime() >= from.getTime() - 60_000
    ? candidate
    : zonedToUtc(addDays(today, 1), startTime, timeZone);
}
