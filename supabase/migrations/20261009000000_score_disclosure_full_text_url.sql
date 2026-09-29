-- ===========================================================================
-- SCORE DISCLOSURE: full_text_url points into the existing student terms (DATA ONLY)
-- ===========================================================================
-- @spec [Doc 04C §15.1-§15.2 as amended by SCL-179; Doc 04B §17.1] | @implemented [2026-09-27]
--
-- plain English: the one seeded `score_disclosure_versions` row (v1.0) carries
-- full_text_url = '/legal/score-disclosure', a slug no legal document has ever had
-- (20260930090000_exam_shell_server.sql D9). Owner ruling 2026-09-27 (SCL-179): the score
-- disclosure lives inside the existing terms, not a standalone page, and the link points at
-- '/legal/student-terms'. This sets that one column on that one row. Nothing else changes:
-- the summary stays 04B §17.1 verbatim (SCL-178), no version is superseded, no schema moves.
--
-- Guarded and idempotent: it only rewrites the exact old value, then asserts the row reads the
-- new one. A re-run updates 0 rows and passes; a row someone has since changed to anything
-- else is left alone and the assertion names it.
--
-- OWNER-RUN: `supabase db push --include-all`. Data only; genesis-fresh-apply covers it.
--
-- ROLLBACK (INV-06): transactional.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed —
--   UPDATE public.score_disclosure_versions SET full_text_url = '/legal/score-disclosure'
--    WHERE scoring_model_version = 'v1.0' AND full_text_url = '/legal/student-terms';
-- ===========================================================================

BEGIN;

UPDATE public.score_disclosure_versions
   SET full_text_url = '/legal/student-terms'
 WHERE scoring_model_version = 'v1.0'
   AND full_text_url = '/legal/score-disclosure';

DO $$
DECLARE
  v_url text;
BEGIN
  SELECT full_text_url INTO v_url
    FROM public.score_disclosure_versions
   WHERE scoring_model_version = 'v1.0';
  IF v_url IS DISTINCT FROM '/legal/student-terms' THEN
    RAISE EXCEPTION 'score_disclosure_versions v1.0 full_text_url is %, expected /legal/student-terms', v_url;
  END IF;
END $$;

COMMIT;
