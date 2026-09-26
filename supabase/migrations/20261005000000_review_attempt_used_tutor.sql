-- ============================================================================
-- W4-7 — review_error_attempts.used_tutor records whether LISA was used
-- ============================================================================
-- LYCEON-MIGRATION-REVIEWED — rollback written and confirmed, see the ROLLBACK
-- section at the foot of this file.
--
-- @spec [Doc-02B_V4 §16 "Tutor-Assisted Correctness for SM-2" ("The `used_tutor`
--        flag is recorded per review attempt for telemetry"), launch table
--        ("`used_tutor` flag captured | Yes"), CR-02B-16; closure plan W4-7;
--        owner ruling W4-6 (assisted attempts count normally)]
-- @implemented [2026-09-26]
--
-- plain English: the review attempt row has carried `used_tutor` since
--   20260610020000, and the writer has hard-coded it `false` since 20260921000000
--   ("ruling 9: LISA is out at launch"). LISA is now in review (W4-1/W4-4), so
--   the writer records the real value.
--
-- DEFINITION (closure plan W4-7): used_tutor is true when the student sent at
--   least one message to LISA on that review item's conversation before
--   submitting. Not "the panel was open": after W4-4 LISA is always open in
--   review, so that reading would flag every attempt and carry no signal. The
--   conversation is the one the W4-4 panel opens on first send
--   (`source_surface = 'review'`, `source_session_item_id` = the review item id,
--   which is also the attempt id). "Before submitting" is every message that
--   exists when this trigger runs: the item answers exactly once (the caller's
--   CAS UPDATE), inside this transaction.
--
-- TELEMETRY ONLY. Nothing reads the column: not canonical_mastery_events, not
--   the SM-2/graduation path, not scoring, selection, KPIs, guardian views or
--   UI. Owner ruling W4-6: an assisted attempt counts toward mastery exactly
--   like an unaided one. Gate G22 (scripts/ci/review-queue-gates.sql) fails if
--   any SQL function or view other than this writer references the column, and
--   tests/ci/used-tutor-no-reader.contract.test.ts does the same for app code.
--
-- IT CANNOT FAIL A SUBMIT. The lookup is its own function with its own
--   exception block: any error is reported as a WARNING carrying only the
--   SQLSTATE (no student id, no content) and the flag is recorded false. The
--   attempt, the queue move and the mastery event commit exactly as before.
--
-- PRACTICE IS NOT IN THIS MIGRATION. Doc 02B §16 defines the flag per REVIEW
--   attempt; practice has no LISA at launch and no conversation to look up. Every
--   practice attempt to date is therefore truthfully unassisted, so a column
--   added when LISA lands in practice (DEFAULT false) loses nothing — unlike
--   review, where each day of hard-coded `false` is unrecoverable.
--
-- Everything else in review_item_resolve() is byte-identical to 20260921000000.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.review_item_used_tutor(p_student_id uuid, p_item_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_used boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM public.tutor_conversations c
      JOIN public.tutor_messages m ON m.conversation_id = c.id
     WHERE c.student_id = p_student_id
       AND c.source_surface = 'review'
       AND c.source_session_item_id = p_item_id
       AND m.role = 'student'
       AND m.content_kind = 'message'
  ) INTO v_used;
  RETURN v_used;
EXCEPTION WHEN OTHERS THEN
  -- Analytics must never break a submission. Reported, not swallowed: the
  -- SQLSTATE is enough to find the cause, and nothing about the student is
  -- written to the log.
  RAISE WARNING 'review_item_used_tutor: lookup failed (SQLSTATE %), recording used_tutor = false', SQLSTATE;
  RETURN false;
END
$$;

COMMENT ON FUNCTION public.review_item_used_tutor(uuid, uuid) IS
  'W4-7 / Doc 02B §16: true when the student sent >=1 message to LISA on this review item''s conversation. Telemetry only — never read by mastery, scoring, selection or UI. Never raises: an error returns false with a WARNING.';

-- Called only from the SECURITY DEFINER trigger below; no client may call it.
REVOKE ALL ON FUNCTION public.review_item_used_tutor(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.review_item_resolve()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.student_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NEW.status = 'answered' THEN
    -- id = NEW.id so the attempt id EQUALS the item id. R3 passes that as the
    -- mastery event id (ruling 11), and canonical_mastery_events reads
    -- review_error_attempts.id as event_id.
    INSERT INTO public.review_error_attempts (
      id, session_item_id, student_id, question_id,
      selected_answer, is_correct, seconds_spent, client_attempt_id,
      used_tutor, section, domain, skill, difficulty, occurred_at, actor_id
    ) VALUES (
      NEW.id, NEW.id, NEW.student_id, NEW.question_id,
      NEW.selected_answer, NEW.is_correct,
      NEW.time_spent_ms / 1000, NEW.client_attempt_id,
      public.review_item_used_tutor(NEW.student_id, NEW.id),  -- W4-7: telemetry only
      NEW.question_section, NEW.question_domain, NEW.question_skill,
      NEW.question_difficulty, NEW.occurred_at, NEW.actor_id
    );

    IF NEW.is_correct THEN
      PERFORM public.review_queue_graduate(
        NEW.student_id, NEW.question_id, NEW.id, NEW.occurred_at);
    ELSE
      PERFORM public.review_queue_record(
        NEW.student_id, NEW.question_id, 'review',
        NEW.session_id, NEW.id, 'incorrect', NEW.occurred_at);
    END IF;

  ELSIF NEW.status = 'skipped' THEN
    -- No attempt row. Pre-build check 7: canonical_mastery_events' practice
    -- branch filters status='answered' (20260806000000_diagnostic_gate.sql:140),
    -- so practice skips carry no mastery. Review mirrors that; writing an
    -- attempt here would make review skips count where practice skips do not.
    PERFORM public.review_queue_record(
      NEW.student_id, NEW.question_id, 'review',
      NEW.session_id, NEW.id, 'skipped', NEW.occurred_at);
  END IF;

  RETURN NULL;
END
$$;

COMMIT;

-- ============================================================================
-- ROLLBACK (INV-06)
-- ============================================================================
--   BEGIN;
--   -- Restore the 20260921000000 writer: identical except the used_tutor value.
--   CREATE OR REPLACE FUNCTION public.review_item_resolve() ... (the body above,
--     with `public.review_item_used_tutor(NEW.student_id, NEW.id)` replaced by
--     `false,                      -- ruling 9: LISA is out at launch`);
--   DROP FUNCTION public.review_item_used_tutor(uuid, uuid);
--   COMMIT;
--
-- No data is lost either way: no column is added or dropped, and attempt rows
-- already written keep the used_tutor value they were written with. Nothing
-- reads the column, so a rollback changes no mastery, scoring or UI behaviour.
