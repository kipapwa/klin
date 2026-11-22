/** Tipos das tabelas usadas pelo site (espelham supabase/schema.sql). */

export type RecordCategory = "exam" | "symptom" | "blood_pressure" | "prescription" | "follow_up" | "procedure";
export type RecordSeverity = "routine" | "attention" | "critical";
export type RecordStatus = "draft" | "processing" | "ready" | "failed";

export interface Icd10 {
  code: string;
  description: string;
}

export interface MedicalRecordSummary {
  id: string;
  title: string | null;
  recorded_at: string;
  category: RecordCategory;
  severity: RecordSeverity;
  status: RecordStatus;
  chief_complaint: string | null;
}

export interface MedicalRecord extends MedicalRecordSummary {
  history: string | null;
  observations: string | null;
  plan: string | null;
  transcript: string | null;
  icd10_codes: Icd10[];
  alert_signs: string[];
  follow_up_in_days: number | null;
  follow_up_date: string | null;
  audio_path: string | null;
  audio_duration_s: number | null;
  ai_provider: "gemini" | "groq" | "manual" | null;
  processed_at: string | null;
}

export interface MedicationLog {
  id: string;
  scheduled_for: string;
  status: "taken" | "skipped" | "missed";
  taken_at: string | null;
  source: "app" | "notification" | "system";
}

export interface Medication {
  id: string;
  record_id?: string | null;
  name: string;
  dosage: string | null;
  instructions: string | null;
  interval_hours: number;
  schedule_type?: "interval" | "times";
  dose_times?: string[];
  timezone?: string;
  duration_days: number | null;
  starts_at: string;
  ends_at: string | null;
  next_dose_at: string | null;
  source: "ai" | "manual";
  is_active: boolean;
  notifications_enabled: boolean;
}

/** Remédio citado sem intervalo: a IA não criou, o usuário completa. */
export interface MedicationNeedingReview {
  name: string;
  dosage: string | null;
  interval_hours: number | null;
  duration_days: number | null;
  start_time: string | null;
  instructions: string | null;
}

export interface ProcessResult {
  recordId: string;
  provider: "gemini" | "groq";
  severity: RecordSeverity;
  medicationsCreated: number;
  medicationsNeedingReview: MedicationNeedingReview[];
}
