/**
 * MASTERY V1.0 TYPE DEFINITIONS
 * 
 * Sprint 3: TypeScript types for mastery system
 */

import { MasteryEventType } from '../services/mastery-constants';

/**
 * Mastery status labels (derived, not stored)
 */
export type MasteryStatus = 'not_started' | 'weak' | 'improving' | 'proficient';

/**
 * Diagnostic session state
 */
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

/**
 * Diagnostic response (per-question answer in a session)
 */
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

/**
 * Diagnostic blueprint (deterministic question selection plan)
 */
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

/**
 * Mastery update parameters (extended from AttemptInput)
 */
export interface MasteryUpdateParams {
  userId: string;
  questionCanonicalId: string;
  sessionId?: string | null;
  isCorrect: boolean;
  selectedChoice?: string | null;
  timeSpentMs?: number | null;
  eventType: MasteryEventType;
  questionWeight?: number;
  metadata: {
    exam: string | null;
    section: string | null;
    domain: string | null;
    skill: string | null;
    subskill: string | null;
    difficulty_bucket: string | null;
    structure_cluster_id: string | null;
  };
}
