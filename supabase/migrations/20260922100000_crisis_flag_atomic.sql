-- ===========================================================================
-- D1 — flagging a conversation for crisis review becomes ONE transaction
-- ===========================================================================
-- @spec [Doc-03_V3 §21.2 step 5, §21.3; CR-03C-V3-01 §3.4; SCL-025;
--        WS-L8 Item 4b (schema-drift tolerance); owner ruling 2026-09-22 D1]
--        | @implemented [2026-09-22]
--
-- plain English: `flagConversationForReview` did two writes in sequence — set
-- `crisis_flagged` on the conversation, then insert the review case. Between
-- them there is a state the system must never be in: a conversation MARKED as
-- a crisis with NOTHING in the review queue. The turn fails and the student
-- sees an error, which is correct, but the flag stays set. Nothing sweeps for
-- a flagged conversation without a case, so that row sits there flagged and
-- unreviewed until a human happens to look. The 48h SLA never starts, because
-- the SLA lives on a case that was never created.
--
-- This function does both writes. A PL/pgSQL function invoked as a single
-- statement is one transaction, so an unhandled error anywhere below rolls the
-- UPDATE back with the INSERT. There is no torn state to sweep for.
--
-- WHAT IT DELIBERATELY STILL DOES. Two outcomes are success-equivalent and are
-- handled INSIDE the function, exactly as the TypeScript did:
--
--   * unique_violation on `idx_crisis_review_cases_conversation_active` means
--     an active case already exists for this conversation — a second crisis
--     signal during one sustained event. The case IS persisted; the existing
--     one is returned and the caller proceeds. This is Doc 03 §21.3's reading,
--     not a new tolerance.
--   * check_violation on `source` means production's CHECK constraint predates
--     the newer source values (WS-L8 Item 4b). The insert retries once with the
--     coarser value the old schema accepts. The case still persists; only its
--     precision degrades.
--
-- Each is caught in its own subtransaction, so the retry undoes only the failed
-- INSERT — never the flag. Anything else propagates and the whole call rolls
-- back, which is B1.1d's blocking-write ruling, unchanged.
--
-- A MISSING CONVERSATION NOW FAILS. The TypeScript issued
-- `UPDATE ... WHERE id = $1` and checked only `error`. PostgREST reports no
-- error when a filtered UPDATE matches zero rows, so flagging a conversation
-- id that does not exist returned success, and the case INSERT then failed on
-- the FK — leaving the caller with a confusing FK error for what is really a
-- bad conversation id. The row count is checked here.
--
-- WHERE THE TWO CONSTANTS LIVE NOW. `SLA_HOURS = 48` and the source-fallback
-- map were TypeScript constants. They are SQL functions below, defined once,
-- because the writes that use them are SQL now. `tests/ci/crisis-flag-atomic.pg.ci.test.ts`
-- holds `crisis_review_sla_hours()` to Doc 03 §21.3's published 48.
--
-- trade-offs:
--  - Returns `jsonb` rather than a composite or RETURNS TABLE. OUT parameters
--    named `sla_deadline` and `case_id` collide with the columns of the same
--    name inside the duplicate-lookup SELECT, and PostgreSQL resolves that as
--    an ambiguous column reference at runtime rather than at creation. jsonb
--    has no such trap, and the caller parses it with Zod at the boundary like
--    every other external payload.
--  - The retry INSERT is not itself wrapped: if the coarser source ALSO
--    collides, the error propagates and everything rolls back. That is the
--    safe direction — no flag without a case — and the case is vanishingly
--    unlikely, because the two paths differ only in a text value.
--  - SECURITY DEFINER, revoked from PUBLIC, granted to service_role only,
--    matching every other privileged function in this schema. The crisis path
--    runs as service_role; no student or guardian may reach it.
--
-- edge cases:
--  - `p_category` defaults are NOT set here. The caller always passes one;
--    a NULL would hit the column's NOT NULL rather than being silently
--    defaulted to 'crisis' by two different layers.
--  - The function does NOT notify. Cloud Tasks cannot participate in a
--    database transaction, and a notification sent for a case that then rolls
--    back is worse than one sent a moment late. The caller notifies after the
--    RPC returns, which is Doc 03 §21.2's step 5 ordering.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- Apply order: after 20260917000002_crisis_review_cases_category.sql. No DDL on
-- any table; this adds three functions and grants.
-- ===========================================================================

BEGIN;

-- ── 1. The SLA window — one definition, in SQL, and only here ──────────────

CREATE OR REPLACE FUNCTION public.crisis_review_sla_hours()
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT 48;
$$;

COMMENT ON FUNCTION public.crisis_review_sla_hours() IS
  'Doc 03 §21.3: the crisis review SLA window in hours. 48 at launch; the §21.3 target after 30 days is 24. THE single definition — flag_conversation_for_crisis_review() reads it.';

-- ── 2. Schema-drift fallback for `source` (WS-L8 Item 4b) ──────────────────
-- The coarser value the pre-20260819 CHECK constraint accepts, or NULL when
-- there is no fallback and the violation is therefore real.

CREATE OR REPLACE FUNCTION public.crisis_source_fallback(p_source text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_source
           WHEN 'classifier_degraded_no_floor' THEN 'classifier_degraded'
           WHEN 'infrastructure_failure'       THEN 'classifier_degraded'
           ELSE NULL
         END;
$$;

COMMENT ON FUNCTION public.crisis_source_fallback(text) IS
  'WS-L8 Item 4b: source values added after the original CHECK constraint, mapped to the coarser value the old constraint accepts. NULL means no fallback — the CHECK violation is real and must propagate.';

-- ── 3. The two writes, as one ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.flag_conversation_for_crisis_review(
  p_conversation_id  uuid,
  p_student_id       uuid,
  p_source           text,
  p_signature_id     uuid,
  p_model_confidence numeric,
  p_category         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deadline  timestamptz := now()
                 + make_interval(hours => public.crisis_review_sla_hours());
  v_source    text        := p_source;
  v_fallback  text;
  v_case_id   uuid;
  v_found_at  timestamptz;
  v_rows      integer;
BEGIN
  UPDATE public.tutor_conversations
     SET crisis_flagged = true
   WHERE id = p_conversation_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION
      'crisis flag target conversation % does not exist', p_conversation_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  BEGIN
    INSERT INTO public.crisis_review_cases
      (conversation_id, student_id, source, category,
       signature_id, model_confidence, sla_deadline)
    VALUES
      (p_conversation_id, p_student_id, v_source, p_category,
       p_signature_id, p_model_confidence, v_deadline)
    RETURNING id INTO v_case_id;

    RETURN jsonb_build_object(
      'case_id',          v_case_id,
      'sla_deadline',     v_deadline,
      'already_existed',  false,
      'persisted_source', v_source
    );

  EXCEPTION
    WHEN unique_violation THEN
      -- An active case already exists. Return it; the flag stands.
      SELECT c.id, c.sla_deadline
        INTO v_case_id, v_found_at
        FROM public.crisis_review_cases c
       WHERE c.conversation_id = p_conversation_id
         AND c.status IN ('open', 'in_review')
       LIMIT 1;

      IF v_case_id IS NULL THEN
        -- A unique violation with nothing to find is not a state this
        -- function understands. Propagate and roll the flag back with it.
        RAISE;
      END IF;

      RETURN jsonb_build_object(
        'case_id',          v_case_id,
        'sla_deadline',     v_found_at,
        'already_existed',  true,
        'persisted_source', NULL
      );

    WHEN check_violation THEN
      v_fallback := public.crisis_source_fallback(p_source);
      IF v_fallback IS NULL THEN
        RAISE;   -- a real CHECK violation, not a schema-version mismatch
      END IF;
      v_source := v_fallback;
  END;

  -- Only reached via the check_violation fallback above. Unwrapped on
  -- purpose: if this fails too, everything rolls back, flag included.
  INSERT INTO public.crisis_review_cases
    (conversation_id, student_id, source, category,
     signature_id, model_confidence, sla_deadline)
  VALUES
    (p_conversation_id, p_student_id, v_source, p_category,
     p_signature_id, p_model_confidence, v_deadline)
  RETURNING id INTO v_case_id;

  RETURN jsonb_build_object(
    'case_id',          v_case_id,
    'sla_deadline',     v_deadline,
    'already_existed',  false,
    'persisted_source', v_source
  );
END;
$$;

COMMENT ON FUNCTION public.flag_conversation_for_crisis_review(uuid, uuid, text, uuid, numeric, text) IS
  'Doc 03 §21.2/§21.3, owner ruling D1 2026-09-22: sets tutor_conversations.crisis_flagged AND creates the review case in ONE transaction, so a flagged conversation with no case in the queue is not a reachable state. Returns {case_id, sla_deadline, already_existed, persisted_source}. Does NOT notify — Cloud Tasks cannot join the transaction; the caller notifies after this returns.';

-- ── 4. Grants — service_role only, like every other privileged function ────

REVOKE ALL ON FUNCTION public.crisis_review_sla_hours()              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crisis_source_fallback(text)           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flag_conversation_for_crisis_review(uuid, uuid, text, uuid, numeric, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.crisis_review_sla_hours()           TO service_role;
GRANT EXECUTE ON FUNCTION public.crisis_source_fallback(text)        TO service_role;
GRANT EXECUTE ON FUNCTION public.flag_conversation_for_crisis_review(uuid, uuid, text, uuid, numeric, text) TO service_role;

COMMIT;
