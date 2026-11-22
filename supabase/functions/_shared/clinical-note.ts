/**
 * Nota clínica estruturada: esquema, prompt e validação.
 *
 * O MESMO prompt e a MESMA validação valem para o Gemini e para o Groq,
 * para que o resto do sistema não saiba (nem precise saber) qual IA respondeu.
 *
 * Módulo puro (sem Deno, sem rede): roda nas Edge Functions e nos testes em Node.
 */

export const CATEGORIES = ["exam", "symptom", "blood_pressure", "prescription", "follow_up", "procedure"] as const;
export const SEVERITIES = ["routine", "attention", "critical"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Severity = (typeof SEVERITIES)[number];

export interface Icd10 {
  code: string;
  description: string;
}

export interface ExtractedMedication {
  name: string;
  dosage: string | null;
  interval_hours: number | null;
  duration_days: number | null;
  start_time: string | null; // "HH:MM" no fuso do usuário
  instructions: string | null;
}

export interface ClinicalNote {
  title: string;
  category: Category;
  severity: Severity;
  alert_signs: string[];
  chief_complaint: string;
  history: string;
  observations: string;
  plan: string;
  icd10: Icd10[];
  medications: ExtractedMedication[];
  follow_up_in_days: number | null;
  transcript: string;
}

// ---------------------------------------------------------------------
// JSON Schema (subconjunto aceito pelo `responseJsonSchema` do Gemini).
// Limites de tamanho NÃO são garantidos pela IA: a validação abaixo corta.
// ---------------------------------------------------------------------
const nullable = (type: string) => ({ type: [type, "null"] });

export const CLINICAL_NOTE_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Título curto do registro (até 80 caracteres)." },
    category: { type: "string", enum: [...CATEGORIES] },
    severity: { type: "string", enum: [...SEVERITIES] },
    alert_signs: { type: "array", items: { type: "string" }, maxItems: 10 },
    chief_complaint: { type: "string" },
    history: { type: "string" },
    observations: { type: "string" },
    plan: { type: "string" },
    icd10: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: { code: { type: "string" }, description: { type: "string" } },
        required: ["code", "description"],
      },
    },
    medications: {
      type: "array",
      maxItems: 15,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          dosage: nullable("string"),
          interval_hours: nullable("number"),
          duration_days: nullable("integer"),
          start_time: { ...nullable("string"), description: "Horário da primeira dose, formato HH:MM." },
          instructions: nullable("string"),
        },
        required: ["name", "dosage", "interval_hours", "duration_days", "start_time", "instructions"],
      },
    },
    follow_up_in_days: nullable("integer"),
    transcript: { type: "string" },
  },
  required: [
    "title", "category", "severity", "alert_signs", "chief_complaint", "history",
    "observations", "plan", "icd10", "medications", "follow_up_in_days", "transcript",
  ],
} as const;

// ---------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------
export const SYSTEM_PROMPT = `Você é um assistente de documentação clínica. Recebe o relato falado (em português do Brasil) de um paciente ou profissional de saúde sobre uma consulta, sintoma, exame, receita ou procedimento, e devolve uma nota médica estruturada em JSON.

Regras:
- Use apenas o que foi dito. Não invente dados, diagnósticos, doses nem datas. Campo sem informação: texto vazio "" (ou null onde permitido; lista vazia [] para listas).
- Escreva em português do Brasil, linguagem clínica clara e objetiva.
- chief_complaint: queixa principal. history: histórico/evolução. observations: achados, exames e observações. plan: conduta/orientações.
- category: uma de exam (exames), symptom (sintomas), blood_pressure (medição de pressão arterial), prescription (receitas), follow_up (retornos), procedure (procedimentos) — a que melhor representa o registro. Use blood_pressure quando o registro for principalmente uma medição de pressão (ex.: "12 por 8", "140 x 90", "pressão 13/9").
- Medição de pressão: escreva em observations os valores no formato "PA 120/80 mmHg" (e "pulso 72 bpm", horário, braço e posição, se ditos). "12 por 8" = 120/80 mmHg; "14 por 9" = 140/90 mmHg.
- severity: "critical" quando houver sinal de alerta ou condição potencialmente grave (ex.: pressão 180/120 mmHg ou mais, ou pressão alta com dor no peito, falta de ar, confusão ou fraqueza de um lado do corpo; dor torácica, falta de ar intensa, sinais de AVC, sangramento importante, febre alta persistente em criança, ideação suicida, reação alérgica grave); "attention" para algo que merece acompanhamento próximo; pressão a partir de 140/90 mmHg, ou abaixo de 90/60 mmHg com tontura ou desmaio, é no mínimo "attention"; senão "routine". Liste em alert_signs os sinais que justificaram "critical" ou "attention".
- icd10: até 5 sugestões de códigos CID-10 compatíveis com o relato (formato "A00" ou "A00.0"), com descrição em português. São sugestões, não diagnóstico.
- medications: cada medicamento citado com nome, dosagem (ex.: "500 mg", "1 comprimido"), interval_hours (ex.: "de 8 em 8 horas" = 8; "1 vez ao dia" = 24; "2 vezes ao dia" = 12), duration_days (ex.: "por 7 dias" = 7; uso contínuo ou não dito = null), start_time no formato HH:MM se um horário de início for dito (senão null) e instructions (ex.: "após as refeições").
- follow_up_in_days: prazo de retorno dito na fala, convertido em dias ("voltar em 30 dias" = 30; "em 2 semanas" = 14; "em 3 meses" = 90). Se não houver, null.
- title: resumo de até 80 caracteres.
- transcript: a transcrição fiel do que foi falado.`;

/** Instrução extra para o Groq (modo json_object não recebe o esquema). */
export const GROQ_JSON_INSTRUCTIONS = `Responda SOMENTE com um objeto JSON com exatamente estas chaves:
{"title": string, "category": "exam"|"symptom"|"blood_pressure"|"prescription"|"follow_up"|"procedure", "severity": "routine"|"attention"|"critical", "alert_signs": string[], "chief_complaint": string, "history": string, "observations": string, "plan": string, "icd10": [{"code": string, "description": string}], "medications": [{"name": string, "dosage": string|null, "interval_hours": number|null, "duration_days": integer|null, "start_time": "HH:MM"|null, "instructions": string|null}], "follow_up_in_days": integer|null, "transcript": string}`;

// ---------------------------------------------------------------------
// Leitura e validação
// ---------------------------------------------------------------------

/** Extrai o objeto JSON de uma resposta (tolera <think>, cercas ``` e texto extra). */
export function parseJsonObject(text: string): Record<string, unknown> {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  const out: unknown = JSON.parse(start >= 0 && end > start ? clean.slice(start, end + 1) : clean);
  if (!out || typeof out !== "object" || Array.isArray(out)) {
    throw new Error("resposta não é um objeto JSON");
  }
  return out as Record<string, unknown>;
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function strOrNull(value: unknown, max: number): string | null {
  const s = str(value, max);
  return s ? s : null;
}

/** Número dentro do intervalo, ou null. Atenção: Number(null) é 0, por isso o null é tratado antes. */
function numOrNull(value: unknown, min: number, max: number, integer: boolean): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const v = integer ? Math.round(n) : Math.round(n * 100) / 100;
  return v >= min && v <= max ? v : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

const ICD10_RE = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,2})?$/;
const TIME_RE = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;

function normalizeTime(value: unknown): string | null {
  const m = typeof value === "string" ? TIME_RE.exec(value.trim()) : null;
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/**
 * Valida e normaliza a saída de qualquer IA. Lança erro se a resposta não
 * tiver o mínimo (sem isso, a reserva é acionada).
 */
export function validateClinicalNote(raw: Record<string, unknown>, transcriptFallback = ""): ClinicalNote {
  const note: ClinicalNote = {
    title: str(raw.title, 200),
    category: oneOf(raw.category, CATEGORIES, "symptom"),
    severity: oneOf(raw.severity, SEVERITIES, "routine"),
    alert_signs: (Array.isArray(raw.alert_signs) ? raw.alert_signs : [])
      .map((s) => str(s, 200))
      .filter(Boolean)
      .slice(0, 20),
    chief_complaint: str(raw.chief_complaint, 5000),
    history: str(raw.history, 20000),
    observations: str(raw.observations, 20000),
    plan: str(raw.plan, 20000),
    icd10: [],
    medications: [],
    follow_up_in_days: numOrNull(raw.follow_up_in_days, 1, 730, true),
    transcript: str(raw.transcript, 100000) || transcriptFallback.slice(0, 100000),
  };

  const seen = new Set<string>();
  for (const item of Array.isArray(raw.icd10) ? raw.icd10 : []) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const code = str(rec.code, 10).toUpperCase().replace(/\s/g, "");
    if (!ICD10_RE.test(code) || seen.has(code)) continue;
    seen.add(code);
    note.icd10.push({ code, description: str(rec.description, 300) });
    if (note.icd10.length >= 20) break;
  }

  for (const item of Array.isArray(raw.medications) ? raw.medications : []) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = str(rec.name, 200);
    if (!name) continue;
    note.medications.push({
      name,
      dosage: strOrNull(rec.dosage, 200),
      interval_hours: numOrNull(rec.interval_hours, 0.25, 168, false),
      duration_days: numOrNull(rec.duration_days, 1, 3650, true),
      start_time: normalizeTime(rec.start_time),
      instructions: strOrNull(rec.instructions, 1000),
    });
    if (note.medications.length >= 30) break;
  }

  // Sinal de alerta sem gravidade não pode passar despercebido.
  if (note.alert_signs.length > 0 && note.severity === "routine") note.severity = "attention";

  const hasContent =
    note.title || note.chief_complaint || note.history || note.observations || note.plan;
  if (!hasContent) throw new Error("resposta sem conteúdo clínico");
  if (!note.title) note.title = (note.chief_complaint || "Registro").slice(0, 80);

  return note;
}
