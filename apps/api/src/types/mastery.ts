/**
 * MASTERY V1.0 TYPE DEFINITIONS
 *
 * Diagnostic session/response types for the diagnostic flow.
 */

export type MasteryStatus = "not_started" | "weak" | "improving" | "proficient";

export interface DiagnosticSession {
  id: string;
  student_id: string;
  blueprint_version: string;
  question_ids: string[];
  current_index: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiagnosticResponse {
  id: string;
  session_id: string;
  question_canonical_id: string;
  question_index: number;
  is_correct: boolean;
  selected_choice: string | null;
  time_spent_ms: number | null;
  answered_at: string;
}

export interface DiagnosticBlueprint {
  total: number;
  sections: {
    section: string;
    count: number;
    domains: {
      domain: string;
      count: number;
    }[];
  }[];
}
