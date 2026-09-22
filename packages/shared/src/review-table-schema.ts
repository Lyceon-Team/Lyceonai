/**
 * Schema-derived types for review engine tables.
 *
 * @spec [genesis-schema.expected.sql; Coding Standards §17; brief R3 §2.1] | @implemented [2026-09-21]
 *
 * plain English: the TS representation of the genesis columns for review_sessions,
 * review_session_items and review_schedule. Naming a column that does not exist is a
 * compile error here, and `scripts/ci/practice-schema-types-gate.sh` proves these stay
 * in step with the schema. expected outcome: the review vertical cannot repeat the
 * failure that killed the last one — code written against columns that were never
 * applied. trade-offs: the types are hand-maintained, which is why the gate exists.
 *
 * Read alongside `practice-schema.ts`: these tables are practice's, column for column,
 * with three deliberate differences (R2, 20260921000000_review_queue_runtime.sql):
 *   1. the owner column is `student_id`, not `user_id` (ruled plan §2 row 8 — renaming
 *      it would break the deletion and anonymization functions);
 *   2. items carry `queue_entry_id`, the link back to the queue row being worked off;
 *   3. items carry `created_at`, which practice_session_items does not have.
 *
 * `student_id` is NULLABLE on both session and item. That is not slack: account
 * anonymization nulls it (20260917000000:753) while keeping the rows, so a non-null
 * type here would be a lie about the post-anonymization state.
 */

// ---------------------------------------------------------------------------
// review_sessions (genesis-schema.expected.sql)
// ---------------------------------------------------------------------------
export type ReviewSessionRow = {
  id: string; // UUID PK
  student_id: string | null; // UUID nullable (anonymization SET NULL)
  status: string; // TEXT NOT NULL DEFAULT 'created'
  client_instance_id: string | null; // TEXT nullable
  created_at: string; // TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at: string; // TIMESTAMPTZ NOT NULL DEFAULT now()
  actor_id: string; // UUID NOT NULL
  mode: string; // TEXT NOT NULL, CHECK 'queue' | 'session' | 'filter'
  filters: unknown; // JSONB NOT NULL DEFAULT '{}'
  target_count: number; // INTEGER NOT NULL, CHECK > 0
  platform: string; // TEXT NOT NULL, CHECK 'web' | 'mobile'
  last_activity_at: string; // TIMESTAMPTZ NOT NULL DEFAULT now()
  completed_at: string | null; // TIMESTAMPTZ nullable
  abandoned_at: string | null; // TIMESTAMPTZ nullable
};

// ---------------------------------------------------------------------------
// review_session_items (genesis-schema.expected.sql)
// ---------------------------------------------------------------------------
//
// NOTE the nullability difference that matters at prefill: question_stem,
// question_options, question_correct_answer, question_explanation, question_domain,
// question_skill, question_difficulty and question_section are all NOT NULL here,
// where the practice_session_items equivalents are nullable. A pool row that cannot
// supply all eight cannot be snapshotted into review at all — see the prefill guard
// in server/routes/review-canonical.ts.
export type ReviewSessionItemRow = {
  id: string; // UUID PK
  session_id: string; // UUID NOT NULL FK
  student_id: string | null; // UUID nullable (anonymization SET NULL)
  ordinal: number; // INTEGER NOT NULL
  question_id: string; // TEXT NOT NULL (references questions.id)
  question_stem: string; // TEXT NOT NULL
  question_passage: string | null; // TEXT nullable
  question_options: unknown; // JSONB NOT NULL
  question_correct_answer: string; // TEXT NOT NULL
  question_explanation: string; // TEXT NOT NULL
  question_option_metadata: unknown | null; // JSONB nullable
  question_domain: string; // TEXT NOT NULL
  question_skill: string; // TEXT NOT NULL
  question_difficulty: number; // SMALLINT NOT NULL
  question_section: string; // TEXT NOT NULL
  status: string; // TEXT NOT NULL DEFAULT 'pending'
  served_at: string | null; // TIMESTAMPTZ nullable
  answered_at: string | null; // TIMESTAMPTZ nullable
  created_at: string; // TIMESTAMPTZ NOT NULL DEFAULT now()
  actor_id: string; // UUID NOT NULL
  selected_answer: string | null; // TEXT nullable
  is_correct: boolean | null; // BOOLEAN nullable
  outcome: string | null; // TEXT nullable
  time_spent_ms: number | null; // INTEGER nullable
  client_attempt_id: string | null; // TEXT nullable
  occurred_at: string | null; // TIMESTAMPTZ nullable
  option_order: string[] | null; // TEXT[] nullable
  option_token_map: Record<string, string> | null; // JSONB nullable
  client_instance_id: string | null; // TEXT nullable
  question_item_type: string; // TEXT NOT NULL DEFAULT 'mcq'
  question_correct_variants: string[] | null; // TEXT[] nullable
  question_assets: unknown | null; // JSONB nullable
  question_estimated_time_seconds: number | null; // INTEGER nullable
  queue_entry_id: string | null; // UUID nullable FK -> review_schedule(id) ON DELETE SET NULL
};

// ---------------------------------------------------------------------------
// review_schedule (genesis-schema.expected.sql) — the mistake queue.
// R3 NEVER writes this table. Both writers are database triggers
// (20260921000000_review_queue_runtime.sql); the API only reads it.
// ---------------------------------------------------------------------------
export type ReviewScheduleRow = {
  id: string; // UUID PK
  student_id: string; // UUID NOT NULL
  question_id: string; // TEXT NOT NULL
  queued_at: string; // TIMESTAMPTZ NOT NULL
  status: string; // TEXT NOT NULL DEFAULT 'active', CHECK active|graduated|superseded
  created_at: string; // TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at: string; // TIMESTAMPTZ NOT NULL DEFAULT now()
  source_engine: string; // TEXT NOT NULL, CHECK practice|review|full_length
  source_session_id: string; // UUID NOT NULL
  source_item_id: string; // UUID NOT NULL
  source_outcome: string; // TEXT NOT NULL, CHECK incorrect|skipped
  closed_at: string | null; // TIMESTAMPTZ nullable
  closed_by_item_id: string | null; // UUID nullable
};
