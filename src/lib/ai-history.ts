/**
 * "Perguntar à IA": perguntas favoritas e histórico de análises
 * (tabelas `ai_saved_questions` e `ai_analyses`, só do dono pelo RLS).
 */
import type { AnalysisScope } from "./analysis";
import { MAX_QUESTION_CHARS } from "./analysis";
import { getSupabase } from "./supabase";
import { isNetworkFailure, UserFacingError } from "./records";

export interface SavedQuestion {
  id: string;
  question: string;
  created_at: string;
}

export interface SavedAnalysis {
  id: string;
  question: string;
  answer: string;
  provider: string | null;
  scope_note: string | null;
  created_at: string;
}

export interface AiMemory {
  questions: SavedQuestion[];
  analyses: SavedAnalysis[];
}

/** Respostas guardadas que aparecem no histórico (as mais recentes). */
export const HISTORY_LIMIT = 30;
const MAX_ANSWER_CHARS = 8000;
const MAX_NOTE_CHARS = 300;

const fail = (what: string, error: { code?: string } | null) => {
  if (isNetworkFailure(error)) return new UserFacingError("Sem internet. Tente de novo quando a conexão voltar.");
  return new UserFacingError(`Não foi possível ${what}${error?.code ? ` (código ${error.code})` : ""}.`);
};

export async function loadAiMemory(scope: AnalysisScope): Promise<AiMemory> {
  const supabase = getSupabase();
  const [q, a] = await Promise.all([
    supabase.from("ai_saved_questions").select("id, question, created_at").eq("scope", scope).order("created_at").limit(50),
    supabase
      .from("ai_analyses")
      .select("id, question, answer, provider, scope_note, created_at")
      .eq("scope", scope)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
  ]);
  if (q.error || a.error) throw fail("carregar suas perguntas", q.error ?? a.error);
  return { questions: (q.data ?? []) as SavedQuestion[], analyses: (a.data ?? []) as SavedAnalysis[] };
}

export async function saveQuestion(scope: AnalysisScope, question: string): Promise<SavedQuestion> {
  const text = question.trim().slice(0, MAX_QUESTION_CHARS);
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ai_saved_questions")
    .insert({ scope, question: text })
    .select("id, question, created_at")
    .single();
  if (!error && data) return data as SavedQuestion;
  // Já estava salva (outro aparelho): devolve a que existe.
  if (error?.code === "23505") {
    const { data: existing } = await supabase
      .from("ai_saved_questions")
      .select("id, question, created_at")
      .eq("scope", scope)
      .eq("question", text)
      .maybeSingle();
    if (existing) return existing as SavedQuestion;
  }
  throw fail("salvar a pergunta", error);
}

export async function deleteSavedQuestion(id: string): Promise<void> {
  const { error } = await getSupabase().from("ai_saved_questions").delete().eq("id", id);
  if (error) throw fail("tirar a pergunta", error);
}

export async function saveAnalysis(
  scope: AnalysisScope,
  input: { question: string; answer: string; provider: string; scopeNote: string },
): Promise<SavedAnalysis> {
  const { data, error } = await getSupabase()
    .from("ai_analyses")
    .insert({
      scope,
      question: input.question.trim().slice(0, MAX_QUESTION_CHARS),
      answer: input.answer.slice(0, MAX_ANSWER_CHARS),
      provider: input.provider.slice(0, 40) || null,
      scope_note: input.scopeNote.slice(0, MAX_NOTE_CHARS) || null,
    })
    .select("id, question, answer, provider, scope_note, created_at")
    .single();
  if (error || !data) throw fail("guardar a resposta", error);
  return data as SavedAnalysis;
}

export async function deleteAnalysis(id: string): Promise<void> {
  const { error } = await getSupabase().from("ai_analyses").delete().eq("id", id);
  if (error) throw fail("apagar a resposta", error);
}
