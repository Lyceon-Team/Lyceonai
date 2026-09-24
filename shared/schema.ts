// @spec [Lyceon_Coding_Standards, §2] [Gap-Registry_V1.1, GAP-OP-05] | @implemented [2026-06-08]
// plain English: shared data-shape types for client + API surfaces — pure TypeScript
// types only, no ORM runtime. WS-1/D1 severed the Drizzle wiring: the `users` and
// `questions` pgTable objects (verified zero importers repo-wide) and the drizzle-orm
// imports were removed so the canonical schema source of truth is supabase/migrations,
// not a second ORM-defined schema. Edge case: all six importers consume only
// `import type` interfaces, so removal is type-safe and build-neutral.

import type { CanonicalSectionCode } from "./question-bank-contract";

export interface QuestionOption {
  key: "A" | "B" | "C" | "D";
  text: string;
}

export interface StudentQuestion {
  id: string;
  canonical_id: string | null;
  stem: string;
  // Canonical only. The former `| "MATH"` member let a single field hold two
  // vocabularies at once; Doc 04B V4.3 §11.2 names 'MATH' as a retired defect.
  section_code: CanonicalSectionCode | null;
  question_type: "multiple_choice" | "free_response";
  options: QuestionOption[];
  explanation: string | null;
  tags: string[];
  domain?: string | null;
  skill?: string | null;
  subskill?: string | null;
  skill_code?: string | null;
  difficulty?: number | null;
}

export interface ProgressStats {
  mathProgress: number;
  readingProgress: number;
  totalQuestions: number;
  correctAnswers?: number;
  recentStreak?: number;
  averageAccuracy?: number;
}
