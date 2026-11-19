/** Conteúdo das notificações de dose (puro, testável no Node). */

export type NotificationPrivacy = "discreet" | "detailed";

export interface DueDose {
  medication_id: string;
  user_id: string;
  name: string;
  dosage: string | null;
  scheduled_for: string;
  privacy: NotificationPrivacy;
}

/** Formato lido pelo public/sw.js (ver o contrato no topo daquele arquivo). */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  dose?: {
    medicationId: string;
    scheduledFor: string;
    /** Marcar direto da notificação (ver dose-token.ts). Sem isto, o botão abre o app. */
    exp?: number;
    token?: string;
    markUrl?: string;
  };
}

/** Assinatura que autoriza marcar esta dose pelo Service Worker. */
export interface DoseMark {
  exp: number;
  token: string;
  markUrl: string;
}

export const DISCREET_BODY = "Hora da sua medicação programada.";

/**
 * Modo discreto (padrão): a tela bloqueada não revela o remédio.
 * O id do remédio vai no payload (cifrado ponta a ponta) só para o botão
 * "Marcar como tomado" saber qual dose é.
 */
export function dosePayload(dose: DueDose, mark?: DoseMark): PushPayload {
  const detailed = dose.privacy === "detailed";
  return {
    title: "Klin",
    body: detailed ? `Hora de tomar ${dose.name}${dose.dosage ? ` — ${dose.dosage}` : ""}.`.slice(0, 200) : DISCREET_BODY,
    url: "medicamentos/",
    tag: `dose-${dose.medication_id}`,
    dose: { medicationId: dose.medication_id, scheduledFor: new Date(dose.scheduled_for).toISOString(), ...(mark ?? {}) },
  };
}

export function testPayload(): PushPayload {
  return { title: "Klin", body: "Notificações ativadas neste aparelho ✓", url: "ajustes/", tag: "teste" };
}

/** Comparação em tempo constante (o segredo do agendador não vaza por tempo de resposta). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
