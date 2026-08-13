-- ---------------------------------------------------------------------------
-- Vertical B Slice 2: diagnostic baseline marker on projection snapshots.
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [Doc-05C §7.4 snapshots; Doc-01_V8 §20 entitlement_features]
-- @implemented 2026-08-12
--
-- plain English: adds a snapshot_kind discriminator to
-- student_section_projection_snapshots so the system can distinguish
-- throttle-driven periodic snapshots from the deliberate diagnostic_baseline
-- capture.  A partial unique index enforces that a student can have at most
-- ONE diagnostic_baseline per section — the baseline is immutable once written.
--
-- expected outcome: existing rows get snapshot_kind='periodic' (default).
-- The baseline capture in the practice-canonical answer handler writes
-- diagnostic_baseline rows with ON CONFLICT DO NOTHING — the once-only
-- index is the durability guard.
--
-- trade-offs: the column-level GRANT for `authenticated` is re-stated
-- (REVOKE + GRANT) to include snapshot_kind — the client display gate
-- needs the discriminator to serve baseline vs progression.
--
-- rollback:
--   DROP INDEX IF EXISTS public.idx_baseline_once_per_student_section;
--   ALTER TABLE public.student_section_projection_snapshots
--     DROP CONSTRAINT IF EXISTS snapshot_kind_valid;
--   ALTER TABLE public.student_section_projection_snapshots
--     DROP COLUMN IF EXISTS snapshot_kind;
--   REVOKE SELECT ON public.student_section_projection_snapshots FROM authenticated;
--   GRANT SELECT (
--       student_id, section,
--       projected_score_mid, projected_score_low, projected_score_high,
--       range_width, relevant_question_count, snapshot_at
--   ) ON public.student_section_projection_snapshots TO authenticated;
-- ---------------------------------------------------------------------------

-- 1. Add snapshot_kind column with default for existing/throttle rows.
ALTER TABLE public.student_section_projection_snapshots
  ADD COLUMN IF NOT EXISTS snapshot_kind text NOT NULL DEFAULT 'periodic';

ALTER TABLE public.student_section_projection_snapshots
  ADD CONSTRAINT snapshot_kind_valid
  CHECK (snapshot_kind IN ('periodic', 'diagnostic_baseline'));

-- 2. Partial unique index: one diagnostic_baseline per student per section, forever.
-- ON CONFLICT DO NOTHING in the capture path relies on this index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_baseline_once_per_student_section
  ON public.student_section_projection_snapshots (student_id, section)
  WHERE snapshot_kind = 'diagnostic_baseline';

-- 3. Amend column-level GRANT to include snapshot_kind (display gate needs it).
-- REVOKE first to ensure a clean re-grant (idempotent — no-ops if already revoked).
REVOKE SELECT ON public.student_section_projection_snapshots FROM authenticated;
GRANT SELECT (
    student_id, section,
    projected_score_mid, projected_score_low, projected_score_high,
    range_width, relevant_question_count, snapshot_at,
    snapshot_kind
) ON public.student_section_projection_snapshots TO authenticated;
