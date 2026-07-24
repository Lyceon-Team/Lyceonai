/**
 * Schema-derived types for practice engine tables.
 *
 * @spec [genesis-schema.expected.sql; Coding Standards §17] | @implemented [2026-06-30]
 *
 * These types are the TS representation of the genesis schema columns for
 * practice_sessions, practice_session_items, and questions. Any reference to a
 * column not in the schema is a compile error. CI validates these types match
 * the actual schema via scripts/ci/practice-schema-types-gate.sh.
 */

// ---------------------------------------------------------------------------
// questions (genesis-schema.expected.sql)
// ---------------------------------------------------------------------------
export type QuestionsRow = {
  id: string; // TEXT NOT NULL, CHECK '^SAT(M|RW)[12][A-Z0-9]{6}$'
  section: string; // TEXT NOT NULL, CHECK 'M' | 'RW'
  source_type: number; // INTEGER NOT NULL, CHECK 1 | 2
  domain: string; // TEXT NOT NULL
  skill_codes: string[]; // TEXT[] NOT NULL
  difficulty: number; // INTEGER NOT NULL, CHECK 1..3
  stem: string; // TEXT NOT NULL
  passage: string | null; // TEXT nullable
  options: unknown; // JSONB NOT NULL
  correct_answer: string; // TEXT NOT NULL
  explanation: string; // TEXT NOT NULL
  option_metadata: unknown | null; // JSONB nullable
  assets: unknown | null; // JSONB nullable
  status: string; // TEXT NOT NULL DEFAULT 'draft'
  version: number; // INTEGER NOT NULL DEFAULT 1
  created_at: string; // TIMESTAMPTZ NOT NULL DEFAULT now()
  published_at: string | null; // TIMESTAMPTZ nullable
  retired_at: string | null; // TIMESTAMPTZ nullable
  source_lineage: unknown | null; // JSONB nullable
  generation_attribution: unknown | null; // JSONB nullable
  estimated_time_seconds: number | null; // INTEGER nullable
  premium_flag: boolean; // BOOLEAN DEFAULT false
  quality_score: number | null; // NUMERIC nullable
  issue_flags: string[] | null; // TEXT[] nullable
};

// ---------------------------------------------------------------------------
// practice_sessions (genesis-schema.expected.sql)
// ---------------------------------------------------------------------------
export type PracticeSessionRow = {
  id: string; // UUID PK
  user_id: string; // UUID NOT NULL
  mode: string; // TEXT NOT NULL
  filters: unknown; // JSONB NOT NULL DEFAULT '{}'
  target_count: number; // INTEGER NOT NULL
  platform: string; // TEXT NOT NULL
  client_instance_id: string; // TEXT NOT NULL
  status: string; // TEXT NOT NULL DEFAULT 'active'
  created_at: string; // TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at: string; // TIMESTAMPTZ NOT NULL DEFAULT now()
  last_activity_at: string; // TIMESTAMPTZ NOT NULL DEFAULT now()
  completed_at: string | null; // TIMESTAMPTZ nullable
  actor_id: string; // UUID NOT NULL
};

// ---------------------------------------------------------------------------
// practice_session_items (genesis-schema.expected.sql)
// ---------------------------------------------------------------------------
export type PracticeSessionItemRow = {
  id: string; // UUID PK
  session_id: string; // UUID NOT NULL FK
  user_id: string; // UUID NOT NULL
  ordinal: number; // INTEGER NOT NULL
  question_id: string; // TEXT NOT NULL (references questions.id)
  question_stem: string | null; // TEXT nullable
  question_passage: string | null; // TEXT nullable
  question_options: unknown | null; // JSONB nullable
  question_correct_answer: string | null; // TEXT nullable
  question_explanation: string | null; // TEXT nullable
  question_option_metadata: unknown | null; // JSONB nullable
  question_domain: string | null; // TEXT nullable
  question_skill: string | null; // TEXT nullable
  question_difficulty: number | null; // INTEGER nullable
  question_section: string | null; // TEXT nullable
  question_item_type: string | null; // TEXT NOT NULL DEFAULT 'mcq'
  question_correct_variants: string[] | null; // TEXT[] nullable
  question_assets: unknown | null; // JSONB nullable
  question_estimated_time_seconds: number | null; // INTEGER nullable
  status: string; // TEXT NOT NULL DEFAULT 'pending'
  selected_answer: string | null; // TEXT nullable
  is_correct: boolean | null; // BOOLEAN nullable
  outcome: string | null; // TEXT nullable
  time_spent_ms: number | null; // INTEGER nullable
  client_attempt_id: string | null; // TEXT nullable
  answered_at: string | null; // TIMESTAMPTZ nullable
  served_at: string | null; // TIMESTAMPTZ nullable
  occurred_at: string | null; // TIMESTAMPTZ nullable
  actor_id: string | null; // UUID nullable
  option_order: string[] | null; // TEXT[] nullable
  option_token_map: Record<string, string> | null; // JSONB nullable
  client_instance_id: string | null; // TEXT nullable
};
