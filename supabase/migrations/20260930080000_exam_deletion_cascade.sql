-- ============================================================================
-- E6b — exam tables in the account-deletion cascade (both modes)
-- ============================================================================
-- @spec [Doc-05E, §1 (anonymize = user-facing default, hard_delete = internal),
--        §3 Rule 4 (linkage lives only on profiles.actor_id), §5 / §5.1
--        (activity retained identity-decoupled; identity link + fingerprints
--        removed), §6 INV-05E-03 / -05 / -06 / -07 / -08, §8 steps 2-4]
--       [Doc-05D, §10 (deletion layers; §10.5 re-run on a gone profile is a
--        no-op)]
--       [Doc-04A_V2.2, §5.3 (test_sessions); Doc-04B_V4.3, §9.1 (score_runs),
--        §9.4 (insert-once)]
--       [SCL-143; supersedes the CASCADE disposition of SCL-124 / SCL-129]
-- @implemented [2026-09-24]
--
-- plain English: until now test_sessions.student_id and score_runs.student_id
--   were ON DELETE CASCADE, so an account deletion removed every exam session,
--   its answers and its score in BOTH modes, and the cascade's result JSON
--   reported none of it. Anonymize mode therefore lost the exam record Doc 05E
--   §5 says it keeps. This migration makes the exam tables behave like practice
--   and review:
--     * both tables carry actor_id (the student's one grouping id), stamped by
--       the two writers, backfilled, sealed NOT NULL, no DEFAULT;
--     * both student_id columns become nullable and ON DELETE SET NULL, so the
--       profile delete severs the identity and the rows stay under actor_id;
--     * the cascade's INV-05E-07 sentinel covers both tables; anonymize reports
--       how many sessions and score runs it retained; hard_delete deletes the
--       sessions, their four children, their scores and ledger rows, and their
--       outbox rows, explicitly, and reports each count;
--     * the insert-once trigger admits exactly one UPDATE — the SET NULL above —
--       and no longer lets an anonymised score row be deleted.
--
-- DECISION LOG (owner rulings 2026-09-24 on the E6b pushback; PR decision log)
--  D1 FK delete action = SET NULL on both identity columns (RULED). Production's
--     practice/review identity FKs are SET NULL and the anonymize branch only
--     blanks fingerprints; severance is the FK's job. Keeping CASCADE and adding
--     an explicit UPDATE before the profile delete was rejected: it needs a
--     caller- or setting-based trigger exemption while the profile still exists.
--  D2 The insert-once trigger (Doc 04B §9.4) admits ONE UPDATE (RULED): old
--     student_id NOT NULL, new NULL, every other column equal (to_jsonb minus
--     student_id), the referenced profile row gone. Only the FK's own SET NULL
--     action produces that state. Every other UPDATE still raises the §9.4
--     message. The brief assumed hard delete would be refused and need a bypass;
--     it is the reverse — hard delete already passes (the session is gone first)
--     and anonymize was the blocked path.
--  D3 DELETE carve-out gains `OLD.student_id IS NOT NULL` (RULED). Without it a
--     NULL student_id makes `NOT EXISTS (profiles WHERE id = NULL)` true and
--     every anonymised score row deletable.
--  D4 actor_id writers (RULED): exam_create_session reads profiles.actor_id and
--     raises EXAM_SESSION_NO_ACTOR_ID without one (the apply_mastery_event
--     pattern); score_test_session_from_outbox copies test_sessions.actor_id
--     onto the run. The scoring change is two column references — the formula,
--     the section scorer and the constants are untouched; the parity gate
--     proves scaled values bit-exact (PR evidence). lyceon_scoring_owner gains
--     SELECT on test_sessions.actor_id only.
--     A score event still pending when its student is anonymised is scored
--     normally: the run lands with student_id NULL and the session's actor_id.
--  D5 hard_delete deletes the four runtime children by name, children before
--     parents (answers before submissions: last_submission_id is NO ACTION),
--     then test_sessions. score_runs and score_run_event_ledger cannot be
--     deleted by name (insert-once) and leave through their CASCADE FKs with
--     the session, which the trigger admits; they are counted first.
--  D6 exam_runtime_outbox (RULED): hard_delete deletes it after the sessions
--     (identity-free queue state, the legal_acceptance_outbox L1-13 precedent);
--     anonymize retains it (no identity; score_runs references it NO ACTION).
--  D7 No fingerprint to remove: test_sessions has no client/device column
--     (Doc 04A deliberately omits client_instance_id); the children and the
--     ledger carry no identity. Checked against the live column lists.
--  D8 Anonymize counts test_sessions / score_runs BEFORE the profile delete
--     (RULED): severance by FK action is invisible to GET DIAGNOSTICS, and an
--     uncounted retention is how the original gap stayed unseen.
--  D9 Backfill of score_runs.actor_id: the insert-once trigger refuses any
--     UPDATE, so the one backfill statement runs with ONLY
--     trg_prevent_score_runs_update disabled, inside this transaction, and the
--     migration asserts it is enabled again before continuing. Production holds
--     0 score_runs rows (read 2026-09-24), so there it updates nothing.
--  D10 authenticated already has table-level SELECT on test_sessions (own rows
--     by RLS), so a student can read their own actor_id there — the same
--     exposure practice_sessions and profiles already have.
--
-- OWNER-RUN: applied through the tracked pipeline (`supabase db push
--   --include-all`: this sorts before 20261001000000, already on `exam`).
--   Genesis-extending; genesis-fresh-apply covers it. NOT APPLIED TO PROD BY
--   THIS CHANGE.
--
-- ROLLBACK (INV-06): transactional. Inverse, in order:
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed —
--   re-apply the previous definitions of execute_account_deletion_cascade
--     (20260917130000), exam_create_session (20260930070000),
--     score_test_session_from_outbox and prevent_score_runs_mutation
--     (20260930040000);
--   REVOKE SELECT (actor_id) ON public.test_sessions FROM lyceon_scoring_owner;
--   ALTER TABLE ... DROP CONSTRAINT <t>_student_id_fkey, ADD CONSTRAINT
--     <t>_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id)
--     ON DELETE CASCADE  (for test_sessions and score_runs);
--   ALTER TABLE ... ALTER COLUMN student_id SET NOT NULL (fails if any row was
--     anonymised in between — by design: those rows have no student to restore);
--   ALTER TABLE ... DROP COLUMN actor_id  (both tables).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. actor_id substrate (Doc 05E §8 step 1): nullable, no DEFAULT, no FK
-- ---------------------------------------------------------------------------
ALTER TABLE public.test_sessions ADD COLUMN actor_id uuid;
ALTER TABLE public.score_runs    ADD COLUMN actor_id uuid;

COMMENT ON COLUMN public.test_sessions.actor_id IS
  'Doc 05E: the student''s synthetic grouping id (profiles.actor_id), stamped by exam_create_session. Survives anonymisation; student_id does not.';
COMMENT ON COLUMN public.score_runs.actor_id IS
  'Doc 05E: copied from test_sessions.actor_id by score_test_session_from_outbox. Survives anonymisation; student_id does not.';

-- ---------------------------------------------------------------------------
-- 2. Backfill (Doc 05E §8 step 3) — one id per student (INV-05E-06)
-- ---------------------------------------------------------------------------
UPDATE public.test_sessions t
   SET actor_id = p.actor_id
  FROM public.profiles p
 WHERE t.student_id = p.id AND t.actor_id IS NULL;

-- D9: the insert-once trigger refuses every UPDATE; only this statement runs
-- without it, and only the UPDATE trigger is lifted.
ALTER TABLE public.score_runs DISABLE TRIGGER trg_prevent_score_runs_update;
UPDATE public.score_runs r
   SET actor_id = t.actor_id
  FROM public.test_sessions t
 WHERE r.test_session_id = t.id AND r.actor_id IS NULL;
ALTER TABLE public.score_runs ENABLE TRIGGER trg_prevent_score_runs_update;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.score_runs'::regclass
         AND tgname IN ('trg_prevent_score_runs_update', 'trg_prevent_score_runs_delete')
         AND tgenabled = 'O') <> 2 THEN
    RAISE EXCEPTION 'E6b: the score_runs insert-once triggers are not both enabled after the backfill';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Seal (INV-05E-07 fail-closed, as PR-5c): no ungrouped row may be sealed
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_sessions bigint;
  v_runs     bigint;
BEGIN
  SELECT count(*) INTO v_sessions FROM public.test_sessions WHERE actor_id IS NULL;
  SELECT count(*) INTO v_runs     FROM public.score_runs    WHERE actor_id IS NULL;
  IF v_sessions > 0 OR v_runs > 0 THEN
    RAISE EXCEPTION 'E6b BACKFILL SENTINEL: % test_sessions and % score_runs row(s) still have actor_id NULL — cannot seal NOT NULL',
      v_sessions, v_runs;
  END IF;
END $$;

ALTER TABLE public.test_sessions ALTER COLUMN actor_id SET NOT NULL;
ALTER TABLE public.score_runs    ALTER COLUMN actor_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Identity columns: nullable, severed by the FK at profile delete (D1)
-- ---------------------------------------------------------------------------
ALTER TABLE public.test_sessions ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE public.score_runs    ALTER COLUMN student_id DROP NOT NULL;

ALTER TABLE public.test_sessions
  DROP CONSTRAINT test_sessions_student_id_fkey,
  ADD CONSTRAINT test_sessions_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.score_runs
  DROP CONSTRAINT score_runs_student_id_fkey,
  ADD CONSTRAINT score_runs_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 5. Insert-once trigger: admit the SET NULL, close the NULL delete hole (D2, D3)
-- @spec [Doc-04B_V4.3, §9.4 Layer 2; Doc-05E §5.1] | @implemented [2026-09-24]
-- plain English: DELETE passes only when the row's session is gone, or its
--   (non-NULL) student's profile is gone; UPDATE passes only as the profile
--   deletion's SET NULL on student_id; everything else raises the §9.4 message.
--   Owner, SECURITY DEFINER and both triggers are unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_score_runs_mutation() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- D6 (E4), narrowed by E6b: a DELETE passes only as the FK cascade of a
  -- session deletion, or of a profile deletion for a row that still names a
  -- student. OLD.student_id IS NOT NULL closes the hole the nullable column
  -- opened: `id = NULL` matches no profile, so without it every anonymised
  -- score row would read as "profile gone" and be deletable.
  IF TG_OP = 'DELETE'
     AND (NOT EXISTS (SELECT 1 FROM test_sessions WHERE id = OLD.test_session_id)
          OR (OLD.student_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.student_id))) THEN
    RETURN OLD;
  END IF;
  -- E6b: the ONE admitted UPDATE is score_runs.student_id ON DELETE SET NULL
  -- firing as the student's profile is deleted: student_id goes from a value to
  -- NULL, no other column changes, and the referenced profile no longer exists.
  -- No caller can build that state while the profile exists, and once it is gone
  -- the FK action has already nulled the column — so no role, setting or
  -- statement other than the FK action itself reaches this branch.
  IF TG_OP = 'UPDATE'
     AND OLD.student_id IS NOT NULL
     AND NEW.student_id IS NULL
     AND (to_jsonb(NEW) - 'student_id') = (to_jsonb(OLD) - 'student_id')
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.student_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'score_runs is insert-once. UPDATE and DELETE are forbidden. Use score_runs_admin_recompute for post-launch calibration audit.';
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Writers stamp actor_id (Doc 05E §8 step 2; D4)
-- ---------------------------------------------------------------------------
GRANT SELECT (actor_id) ON TABLE public.test_sessions TO lyceon_scoring_owner;

-- §12.1 orchestrator, as E4 wrote it, plus actor_id read from the session and
-- written on the run. No other line differs (E4's file is the diff base).
CREATE OR REPLACE FUNCTION public.score_test_session_from_outbox(
  p_outbox_event_id uuid
) RETURNS uuid
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_started_at      timestamptz := clock_timestamp();
  v_event_type      text;
  v_test_session_id uuid;
  v_test_form_id    uuid;
  v_student_id      uuid;
  v_actor_id        uuid;   -- E6b: the session's grouping id, copied onto the run
  v_score_table_ver text;
  v_existing_run_id uuid;
  v_score_run_id    uuid;

  v_rw_present   boolean := false;
  v_math_present boolean := false;
  v_rw_row       record;
  v_math_row     record;
  v_total        int;
  v_partial_display int;
BEGIN
  -- IDEMPOTENCY CHECK (§5.17 — once, at the entrypoint)
  SELECT score_run_id INTO v_existing_run_id
  FROM score_run_event_ledger
  WHERE outbox_event_id = p_outbox_event_id;

  IF FOUND THEN
    RAISE LOG '%', jsonb_build_object(
      'event', 'scoring.session.scored',
      'score_run_id', v_existing_run_id,
      'source_outbox_event_id', p_outbox_event_id,
      'idempotent_return', true,
      'computation_ms', round(extract(epoch FROM clock_timestamp() - v_started_at) * 1000));
    RETURN v_existing_run_id;
  END IF;

  -- READ THE OUTBOX EVENT (04A wrote this; we consume it)
  SELECT event_type, aggregate_id
  INTO v_event_type, v_test_session_id
  FROM exam_runtime_outbox
  WHERE id = p_outbox_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outbox event not found: %', p_outbox_event_id;
  END IF;

  IF v_event_type NOT IN ('test_session_completed', 'test_session_partial_scored_abandoned') THEN
    RAISE EXCEPTION 'Outbox event type not handled by scoring: %', v_event_type;
  END IF;

  -- Read session metadata (D10: a missing session raises, §21.1)
  SELECT student_id, actor_id, test_form_id
  INTO v_student_id, v_actor_id, v_test_form_id
  FROM test_sessions
  WHERE id = v_test_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test session not found for outbox event %: session_id=%',
      p_outbox_event_id, v_test_session_id;
  END IF;

  SELECT score_table_version
  INTO v_score_table_ver
  FROM test_forms
  WHERE id = v_test_form_id;

  -- VERSION-VALIDATION GATE (§12.1, §19.6). Active and superseded score;
  -- candidate, missing or partially attested versions never do.
  PERFORM 1
  FROM scoring_model_versions
  WHERE version = v_score_table_ver
    AND status IN ('active', 'superseded')
    AND published_at IS NOT NULL
    AND constants_sha256 IS NOT NULL
    AND validation_packet_sha256 IS NOT NULL
    AND validation_packet_url IS NOT NULL;   -- D10: §19.6 lists the URL too

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Scoring blocked: scoring_model_version % is missing, candidate, or '
      'incompletely attested. score_runs MUST NOT be inserted for an '
      'unattested version. (Doc 04B V4.3 §12.1 + §19.6.)',
      v_score_table_ver
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM scoring_constants
    WHERE scoring_model_version = v_score_table_ver
  ) THEN
    RAISE EXCEPTION
      'Scoring blocked: no scoring_constants rows for version %',
      v_score_table_ver
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- DETERMINE WHICH SECTIONS ARE SCOREABLE
  SELECT EXISTS (
    SELECT 1 FROM test_session_sections
    WHERE test_session_id = v_test_session_id
      AND section = 'RW'
      AND state = 'submitted'
  ) INTO v_rw_present;

  SELECT EXISTS (
    SELECT 1 FROM test_session_sections
    WHERE test_session_id = v_test_session_id
      AND section = 'M'
      AND state = 'submitted'
  ) INTO v_math_present;

  IF NOT v_rw_present AND NOT v_math_present THEN
    RAISE EXCEPTION 'No scoreable sections found for session %', v_test_session_id;
  END IF;

  -- COMPUTE PRESENT SECTIONS
  -- An absent section's record is still ASSIGNED, to a typed all-NULL row of
  -- compute_section_scaled_score's shape. PL/pgSQL fixes the INSERT below's plan
  -- on its first execution in a session; if that execution sees an unassigned
  -- `record` it raises "record … is not assigned yet" even inside a CASE branch
  -- that is not taken. Without this, the first partial (one-section) session a
  -- fresh connection scores fails. Found by the scoring-parity gate in CI
  -- (collation ordered a partial session first). The CASE guards stay; the NULL
  -- row only makes the structure determinate.
  IF v_rw_present THEN
    SELECT * INTO v_rw_row
    FROM compute_section_scaled_score(v_test_session_id, 'rw');
  ELSE
    SELECT NULL::int AS scaled, NULL::int AS module1_correct, NULL::int AS module2_correct,
           NULL::text AS module2_path, NULL::int AS m2_easy_wrong, NULL::int AS m2_medium_wrong,
           NULL::int AS m2_hard_wrong, NULL::numeric AS ceiling, NULL::numeric AS deduction,
           NULL::numeric AS raw_floor, NULL::numeric AS path_floor,
           NULL::numeric AS effective_floor, NULL::numeric AS s_raw
      INTO v_rw_row;
  END IF;

  IF v_math_present THEN
    SELECT * INTO v_math_row
    FROM compute_section_scaled_score(v_test_session_id, 'math');
  ELSE
    SELECT NULL::int AS scaled, NULL::int AS module1_correct, NULL::int AS module2_correct,
           NULL::text AS module2_path, NULL::int AS m2_easy_wrong, NULL::int AS m2_medium_wrong,
           NULL::int AS m2_hard_wrong, NULL::numeric AS ceiling, NULL::numeric AS deduction,
           NULL::numeric AS raw_floor, NULL::numeric AS path_floor,
           NULL::numeric AS effective_floor, NULL::numeric AS s_raw
      INTO v_math_row;
  END IF;

  -- TOTAL_SCALED / PARTIAL_DISPLAY_SCALED (§9.1, §15.2)
  IF v_rw_present AND v_math_present THEN
    v_total := v_rw_row.scaled + v_math_row.scaled;
    v_partial_display := NULL;
  ELSIF v_rw_present THEN
    v_total := NULL;
    v_partial_display := v_rw_row.scaled;
  ELSE
    v_total := NULL;
    v_partial_display := v_math_row.scaled;
  END IF;

  -- INSERT score_runs ROW (with ALL intermediate values)
  INSERT INTO score_runs (
    test_session_id, student_id, actor_id, test_form_id, scoring_model_version,
    source_outbox_event_id, source_event_type,
    rw_scored, rw_module1_correct, rw_module2_correct, rw_module2_path,
    rw_m2_easy_wrong, rw_m2_medium_wrong, rw_m2_hard_wrong,
    rw_ceiling, rw_deduction, rw_raw_floor, rw_path_floor, rw_effective_floor,
    rw_s_raw, rw_scaled,
    math_scored, math_module1_correct, math_module2_correct, math_module2_path,
    math_m2_easy_wrong, math_m2_medium_wrong, math_m2_hard_wrong,
    math_ceiling, math_deduction, math_raw_floor, math_path_floor, math_effective_floor,
    math_s_raw, math_scaled,
    total_scaled, partial_display_scaled, constants_snapshot
  ) VALUES (
    v_test_session_id, v_student_id, v_actor_id, v_test_form_id, v_score_table_ver,
    p_outbox_event_id, v_event_type,
    v_rw_present,
    CASE WHEN v_rw_present THEN v_rw_row.module1_correct END,
    CASE WHEN v_rw_present THEN v_rw_row.module2_correct END,
    CASE WHEN v_rw_present THEN v_rw_row.module2_path END,
    CASE WHEN v_rw_present THEN v_rw_row.m2_easy_wrong END,
    CASE WHEN v_rw_present THEN v_rw_row.m2_medium_wrong END,
    CASE WHEN v_rw_present THEN v_rw_row.m2_hard_wrong END,
    CASE WHEN v_rw_present THEN v_rw_row.ceiling END,
    CASE WHEN v_rw_present THEN v_rw_row.deduction END,
    CASE WHEN v_rw_present THEN v_rw_row.raw_floor END,
    CASE WHEN v_rw_present THEN v_rw_row.path_floor END,
    CASE WHEN v_rw_present THEN v_rw_row.effective_floor END,
    CASE WHEN v_rw_present THEN v_rw_row.s_raw END,
    CASE WHEN v_rw_present THEN v_rw_row.scaled END,
    v_math_present,
    CASE WHEN v_math_present THEN v_math_row.module1_correct END,
    CASE WHEN v_math_present THEN v_math_row.module2_correct END,
    CASE WHEN v_math_present THEN v_math_row.module2_path END,
    CASE WHEN v_math_present THEN v_math_row.m2_easy_wrong END,
    CASE WHEN v_math_present THEN v_math_row.m2_medium_wrong END,
    CASE WHEN v_math_present THEN v_math_row.m2_hard_wrong END,
    CASE WHEN v_math_present THEN v_math_row.ceiling END,
    CASE WHEN v_math_present THEN v_math_row.deduction END,
    CASE WHEN v_math_present THEN v_math_row.raw_floor END,
    CASE WHEN v_math_present THEN v_math_row.path_floor END,
    CASE WHEN v_math_present THEN v_math_row.effective_floor END,
    CASE WHEN v_math_present THEN v_math_row.s_raw END,
    CASE WHEN v_math_present THEN v_math_row.scaled END,
    v_total, v_partial_display,
    scoring_constants_snapshot_jsonb(v_score_table_ver)
  ) RETURNING id INTO v_score_run_id;

  -- WRITE THE LEDGER ENTRY (idempotency anchor)
  INSERT INTO score_run_event_ledger (outbox_event_id, score_run_id, test_session_id)
  VALUES (p_outbox_event_id, v_score_run_id, v_test_session_id);

  -- E9 SEAM (no-op today; §16.1: no mastery emission from 04B)
  PERFORM emit_score_run_side_effects(v_score_run_id);

  -- §20.1 structured log — UUIDs and scaled values only (§20.4)
  RAISE LOG '%', jsonb_build_object(
    'event', 'scoring.session.scored',
    'score_run_id', v_score_run_id,
    'test_session_id', v_test_session_id,
    'student_id', v_student_id,
    'test_form_id', v_test_form_id,
    'scoring_model_version', v_score_table_ver,
    'source_outbox_event_id', p_outbox_event_id,
    'source_event_type', v_event_type,
    'rw_scored', v_rw_present,
    'math_scored', v_math_present,
    'rw_scaled', CASE WHEN v_rw_present THEN v_rw_row.scaled END,
    'math_scaled', CASE WHEN v_math_present THEN v_math_row.scaled END,
    'total_scaled', v_total,
    'computation_ms', round(extract(epoch FROM clock_timestamp() - v_started_at) * 1000),
    'idempotent_return', false);

  RETURN v_score_run_id;
END;
$$;

-- E6's session create, plus the actor_id stamp. No other line differs.
CREATE OR REPLACE FUNCTION public.exam_create_session(p_student_id uuid, p_test_form_id uuid, p_mode text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_now      timestamptz := clock_timestamp();
  v_form     test_forms%ROWTYPE;
  v_existing test_sessions%ROWTYPE;
  v_adv      jsonb;
  v_ids      jsonb := '[]'::jsonb;
  v_attempt  int;
  v_id       uuid;
  v_actor_id uuid;
BEGIN
  SELECT * INTO v_form FROM test_forms WHERE id = p_test_form_id;
  IF NOT FOUND OR v_form.status <> 'published' THEN
    RETURN jsonb_build_object('status', 409, 'error', jsonb_build_object(
      'code', 'form_not_published', 'message', 'The form is not published.'), 'outbox_ids', v_ids);
  END IF;
  IF NOT v_form.is_selectable THEN
    RETURN jsonb_build_object('status', 409, 'error', jsonb_build_object(
      'code', 'form_not_available', 'message', 'The form is not available for new sessions.'), 'outbox_ids', v_ids);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('test_session_create:' || p_student_id::text));

  SELECT * INTO v_existing FROM test_sessions
   WHERE student_id = p_student_id AND state IN ('created', 'active', 'section_break');
  IF FOUND THEN
    v_adv := exam_advance_session(v_existing.id, v_now);
    v_ids := v_adv->'outbox_ids';
    SELECT * INTO v_existing FROM test_sessions WHERE id = v_existing.id;
    IF v_existing.state IN ('created', 'active', 'section_break') THEN
      IF v_existing.test_form_id = p_test_form_id THEN
        RETURN jsonb_build_object('status', 200,
          'body', exam_session_body(v_existing.id, v_now), 'outbox_ids', v_ids);
      END IF;
      RETURN jsonb_build_object('status', 409, 'error', jsonb_build_object(
          'code', 'existing_active_session',
          'message', 'Another full-length session is in progress.',
          'session_id', v_existing.id), 'outbox_ids', v_ids);
    END IF;
  END IF;

  SELECT count(*)::int + 1 INTO v_attempt FROM test_sessions
   WHERE student_id = p_student_id AND test_form_id = p_test_form_id
     AND state IN ('completed', 'abandoned_final', 'partial_scored_abandoned');

  -- E6b (Doc 05E §8 step 2, INV-05E-06): stamp the student's one grouping id.
  -- Fail closed without it (INV-05E-07), as apply_mastery_event does.
  SELECT actor_id INTO v_actor_id FROM profiles WHERE id = p_student_id;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'EXAM_SESSION_NO_ACTOR_ID: no actor_id for student %', p_student_id;
  END IF;

  INSERT INTO test_sessions (student_id, actor_id, test_form_id, state, mode, grace_expires_at,
                             attempt_number_for_form, is_first_seen_form_attempt)
  VALUES (p_student_id, v_actor_id, p_test_form_id, 'created', p_mode,
          v_now + exam_runtime_setting('test_level_grace_window'),
          v_attempt, v_attempt = 1)
  RETURNING id INTO v_id;

  INSERT INTO test_session_sections (test_session_id, section, state)
  VALUES (v_id, 'RW', 'not_started'), (v_id, 'M', 'not_started');

  RETURN jsonb_build_object('status', 201, 'body', exam_session_body(v_id, v_now), 'outbox_ids', v_ids);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. The cascade (production's definition, 20260917130000, byte-identical
--    except the E6b blocks: the declaration, the hard_delete exam layer, the
--    two sentinel rows, the anonymize exam counts, one comment line).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_account_deletion_cascade(
  p_profile_id    uuid,
  p_privacy_mode  text DEFAULT 'hard_delete'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result    jsonb := '{}'::jsonb;
  v_count     bigint;
  v_actor_id  uuid;
  v_exam_sessions uuid[];   -- E6b: the profile's test_sessions, collected before hard_delete removes them
BEGIN
  -- ========================================================================
  -- PRIVACY MODE GUARD
  -- ========================================================================
  IF p_privacy_mode NOT IN ('hard_delete', 'anonymize') THEN
    RAISE EXCEPTION 'unknown p_privacy_mode: %. Valid: hard_delete, anonymize', p_privacy_mode;
  END IF;

  -- ========================================================================
  -- IDEMPOTENCY: profile already gone → clean no-op (§10.5)
  -- ========================================================================
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RETURN jsonb_build_object('status', 'no_op', 'reason', 'profile does not exist (already cascaded)');
  END IF;

  -- ========================================================================
  -- STATUS GUARD: require a completed deletion request
  -- ========================================================================
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_requests
     WHERE profile_id = p_profile_id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'no completed deletion request for profile %. '
      'The cron driver must mark the request completed (after deidentify_user) before calling cascade.',
      p_profile_id;
  END IF;

  -- ========================================================================
  -- CAPTURE actor_id (anonymize mode: needed for sentinel + ledger;
  -- must be read BEFORE profile deletion destroys the mapping — §3 Rule 4)
  -- ========================================================================
  IF p_privacy_mode = 'anonymize' THEN
    SELECT actor_id INTO v_actor_id FROM public.profiles WHERE id = p_profile_id;
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION '05E-5d: profiles.actor_id IS NULL for profile % — cannot anonymize without grouping identifier (INV-05E-06)',
        p_profile_id;
    END IF;
  END IF;

  -- ========================================================================
  -- PRE-CLEAR: RESTRICT + NO ACTION FKs that block profile deletion
  -- ========================================================================

  -- PS-1. entitlements (profile_id → profiles ON DELETE RESTRICT)
  DELETE FROM public.entitlements WHERE profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('entitlements', v_count);

  -- PS-2 .. PS-4: the pre-clears that touch rows belonging to OTHER identities
  -- (a student's consent request when a guardian deletes; another person's deletion
  -- request that named this profile as actor; the guardian_links rows on either side).
  --
  -- ANONYMIZE MODE (the user-facing path): these MUST already have run in their own
  -- transaction — public.preclear_account_deletion_links, T1.5 of the executor. A row
  -- of a LIVE identity written in THIS transaction would share its xmin with the
  -- anonymized_actors row written below, which is a deterministic join from actor_id
  -- to that live person and, through profiles.guardian_email, to the deleted one
  -- (evidence invariant rule 3, SCL-088; plan v4 §1). So this mode does not clear:
  -- it verifies, and fails closed (INV-05E-05: explicit, gated, nothing implicit).
  --
  -- HARD_DELETE MODE (service_role-only internal tool, Doc 05E §1): self-clears, as
  -- before. Nothing pseudonymous is retained by that mode, so the join has nothing
  -- to reach.
  IF p_privacy_mode = 'anonymize' THEN
    IF EXISTS (SELECT 1 FROM public.guardian_links
                WHERE accepted_by_profile_id = p_profile_id
                   OR revoked_by_profile_id  = p_profile_id
                   OR student_profile_id     = p_profile_id
                   OR guardian_profile_id    = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.guardian_consent_requests
                   WHERE guardian_profile_id = p_profile_id
                      OR student_profile_id  = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.account_deletion_requests
                   WHERE actor_profile_id = p_profile_id AND profile_id <> p_profile_id)
    THEN
      RAISE EXCEPTION 'PRECLEAR_REQUIRED: profile % still has guardian_links / guardian_consent_requests / actor_profile_id references — run public.preclear_account_deletion_links(profile) in its own transaction first (evidence invariant rule 3)',
        p_profile_id;
    END IF;
  ELSE
    -- PS-2. guardian_links — nullable NO ACTION refs first, then RESTRICT
    UPDATE public.guardian_links SET accepted_by_profile_id = NULL
     WHERE accepted_by_profile_id = p_profile_id;
    UPDATE public.guardian_links SET revoked_by_profile_id = NULL
     WHERE revoked_by_profile_id = p_profile_id;
    DELETE FROM public.guardian_links WHERE student_profile_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('guardian_links_as_student', v_count);
    DELETE FROM public.guardian_links WHERE guardian_profile_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('guardian_links_as_guardian', v_count);

    -- PS-3. guardian_consent_requests — nullable NO ACTION ref first, then RESTRICT
    UPDATE public.guardian_consent_requests SET guardian_profile_id = NULL
     WHERE guardian_profile_id = p_profile_id;
    DELETE FROM public.guardian_consent_requests WHERE student_profile_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('guardian_consent_requests', v_count);

    -- PS-4. account_deletion_requests — actor_profile_id edge case
    UPDATE public.account_deletion_requests
       SET actor_profile_id = profile_id
     WHERE actor_profile_id = p_profile_id AND profile_id <> p_profile_id;
  END IF;

  -- PS-5. account_deletion_requests — delete THIS profile's request rows
  DELETE FROM public.account_deletion_requests WHERE profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('account_deletion_requests', v_count);

  -- ========================================================================
  -- LAYER 1: DELETE derived state (SHARED — both modes; INV-05E-09 proven safe)
  -- ========================================================================
  -- All derived state: mastery, KPI, projections, scheduling. Recomputable from
  -- retained activity if ever needed (§5). No FK to profiles (convention only).
  -- Zero triggers on any L1 table. Zero FKs from L1 to L2.

  -- L1-01. student_section_projection_snapshots (05C)
  DELETE FROM public.student_section_projection_snapshots WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_section_projection_snapshots', v_count);

  -- L1-02. student_section_projections (05C)
  DELETE FROM public.student_section_projections WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_section_projections', v_count);

  -- L1-03. student_projection_refresh_state (05C)
  DELETE FROM public.student_projection_refresh_state WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_projection_refresh_state', v_count);

  -- L1-04. projection_refresh_outbox (05C)
  DELETE FROM public.projection_refresh_outbox WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('projection_refresh_outbox', v_count);

  -- L1-05. student_section_kpi (05B)
  DELETE FROM public.student_section_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_section_kpi', v_count);

  -- L1-06. student_domain_kpi (05B)
  DELETE FROM public.student_domain_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_domain_kpi', v_count);

  -- L1-07. student_skill_kpi (05B)
  DELETE FROM public.student_skill_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_skill_kpi', v_count);

  -- L1-08. student_overall_kpi (05B)
  DELETE FROM public.student_overall_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_overall_kpi', v_count);

  -- L1-09. student_domain_mastery (05B)
  DELETE FROM public.student_domain_mastery WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_domain_mastery', v_count);

  -- L1-10. student_skill_mastery (05A)
  DELETE FROM public.student_skill_mastery WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_skill_mastery', v_count);


  -- L1-12. student_kpi_rollups_current (SCL-004: was missing from L1 in both modes)
  DELETE FROM public.student_kpi_rollups_current WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_kpi_rollups_current', v_count);

  -- L1-13. legal_acceptance_outbox (2026-09-16 evidence audit, plan v4 Phase 1). The
  -- outbox has NO profiles FK (20260619000300 dropped it so consent intent survives a
  -- late profile insert), sat in no cascade list, and is invisible to the FK-driven
  -- preflight above — so its rows, keyed by the auth uuid (= profile id), survived a
  -- deletion in signup order. Classified here as identity-keyed queue state: DELETED in
  -- both modes. The consent EVIDENCE lives in deletion_consent_evidence, copied from
  -- legal_acceptances by mark_deletion_log_executing before this transaction; an
  -- undrained outbox row at T+7 is intent that never became an acceptance and is not
  -- evidence of one.
  DELETE FROM public.legal_acceptance_outbox WHERE user_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('legal_acceptance_outbox', v_count);

  -- ========================================================================
  -- MODE BRANCH: hard_delete vs anonymize diverge at L2
  -- ========================================================================

  IF p_privacy_mode = 'hard_delete' THEN
    -- ====================================================================
    -- LAYER 2 (hard_delete): Hard-delete event/audit sources
    -- ====================================================================
    -- Children-before-parent FK-safe order. All event + session + audit rows removed.

    -- L2-01. practice_session_items (child of practice_sessions via ON DELETE CASCADE)
    DELETE FROM public.practice_session_items WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_session_items', v_count);

    -- L2-02. practice_sessions
    DELETE FROM public.practice_sessions WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_sessions', v_count);

    -- L2-03. review_error_attempts (child of review_session_items via ON DELETE CASCADE)
    DELETE FROM public.review_error_attempts WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_error_attempts', v_count);

    -- L2-04. review_session_items (child of review_sessions via ON DELETE CASCADE)
    DELETE FROM public.review_session_items WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_session_items', v_count);

    -- L2-05. review_sessions
    DELETE FROM public.review_sessions WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_sessions', v_count);

    -- L2-06. mastery_event_audit_log (no FK; student_id by convention)
    DELETE FROM public.mastery_event_audit_log WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_event_audit_log', v_count);

    -- L2-07. mastery_domain_refresh_audit_log (no FK; student_id by convention)
    DELETE FROM public.mastery_domain_refresh_audit_log WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_domain_refresh_audit_log', v_count);

    -- ====================================================================
    -- LAYER 2 (hard_delete): exam runtime (Doc 04A §5, Doc 04B §9; E6b, SCL-143)
    -- ====================================================================
    -- test_sessions.student_id and score_runs.student_id are ON DELETE SET NULL
    -- (E6b), as practice and review are: the profile delete below would SEVER
    -- these rows, not remove them. hard_delete removes them here, explicitly.
    -- The sessions are collected first — the outbox carries only aggregate_id
    -- (no FK, no identity) and is reachable only through them.
    SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_exam_sessions
      FROM public.test_sessions WHERE student_id = p_profile_id;

    -- L2-08 .. L2-11. The four runtime children, children before parents.
    -- Answers before submissions: test_session_answers.last_submission_id
    -- references test_answer_submissions (NO ACTION).
    DELETE FROM public.test_session_answers WHERE test_session_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_session_answers', v_count);

    DELETE FROM public.test_answer_submissions WHERE test_session_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_answer_submissions', v_count);

    DELETE FROM public.test_session_items WHERE test_session_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_session_items', v_count);

    DELETE FROM public.test_session_sections WHERE test_session_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_session_sections', v_count);

    -- L2-12 / L2-13. score_run_event_ledger and score_runs. Neither is deleted by
    -- name: score_runs is insert-once (Doc 04B §9.4) and its trigger refuses a
    -- DELETE while the parent session exists. Both leave with the session through
    -- test_session_id / score_run_id ON DELETE CASCADE, which the trigger admits
    -- (the parent is gone). Counted first, because that removal is invisible to
    -- GET DIAGNOSTICS.
    SELECT count(*) INTO v_count
      FROM public.score_run_event_ledger l
      JOIN public.score_runs r ON r.id = l.score_run_id
     WHERE r.test_session_id = ANY (v_exam_sessions);
    v_result := v_result || jsonb_build_object('score_run_event_ledger', v_count);

    SELECT count(*) INTO v_count FROM public.score_runs WHERE test_session_id = ANY (v_exam_sessions);
    v_result := v_result || jsonb_build_object('score_runs', v_count);

    -- L2-14. test_sessions (takes its score_runs and their ledger rows with it)
    DELETE FROM public.test_sessions WHERE id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_sessions', v_count);

    -- L2-15. exam_runtime_outbox — identity-free queue state, deleted in
    -- hard_delete like legal_acceptance_outbox (L1-13). After the sessions:
    -- score_runs and the ledger reference it (NO ACTION) and are gone now.
    DELETE FROM public.exam_runtime_outbox WHERE aggregate_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('exam_runtime_outbox', v_count);

  ELSIF p_privacy_mode = 'anonymize' THEN
    -- ====================================================================
    -- FAIL-CLOSED SENTINEL (INV-05E-07): before severing identity, verify
    -- every retained row for this user has its grouping identifier.
    -- ====================================================================
    -- Defense-in-depth: actor_id is DB-enforced NOT NULL (PR-5c seal), so
    -- this cannot fire under normal operation. But INV-05E-07 requires
    -- explicit verification before the identity ↔ actor_id linkage is
    -- destroyed. Runs BEFORE SET NULL so identity col is still queryable.
    DECLARE
      v_sentinel_tbl text;
      v_sentinel_col text;
      v_sentinel_cnt bigint;
    BEGIN
      FOR v_sentinel_tbl, v_sentinel_col IN VALUES
        ('practice_sessions',                'user_id'),
        ('practice_session_items',           'user_id'),
        ('review_sessions',                  'student_id'),
        ('review_session_items',             'student_id'),
        ('review_error_attempts',            'student_id'),
        ('mastery_event_audit_log',          'student_id'),
        ('mastery_domain_refresh_audit_log', 'student_id'),
        ('test_sessions',                    'student_id'),   -- E6b (SCL-143)
        ('score_runs',                       'student_id')    -- E6b (SCL-143)
      LOOP
        EXECUTE format(
          'SELECT count(*) FROM public.%I WHERE %I = $1 AND actor_id IS NULL',
          v_sentinel_tbl, v_sentinel_col
        ) INTO v_sentinel_cnt USING p_profile_id;
        IF v_sentinel_cnt > 0 THEN
          RAISE EXCEPTION '05E-5d SENTINEL (INV-05E-07): % row(s) in public.% have identity present but actor_id IS NULL — refusing to sever identity from ungrouped row',
            v_sentinel_cnt, v_sentinel_tbl;
        END IF;
      END LOOP;
    END;

    -- ====================================================================
    -- LAYER 2 (anonymize): Sever identity + remove fingerprints on
    -- activity tables — rows RETAINED for world-model training (§5)
    -- ====================================================================
    -- §5.1: "Removed: the identity link and any client/device/session
    --   fingerprint that could enable re-identification."
    -- §5.1: "Retained: the learning interaction — item answered, response
    --   chosen, correctness, difficulty/domain/skill/section, ordering,
    --   timing, and shared question-bank content."
    -- actor_id (NOT NULL, PR-5c) is the surviving synthetic grouping id.
    -- Children before parents (convention match with hard-delete ordering).
    --
    -- Partial unique indexes (uq_practice_items_idem, uq_review_attempts_idem)
    -- are on (identity, client_attempt_id) WHERE client_attempt_id IS NOT NULL.
    -- Setting client_attempt_id = NULL removes rows from the partial index;
    -- no uniqueness violation. Live write path unaffected (non-anonymized
    -- users retain non-NULL identity and client_attempt_id).

    -- L2-01. practice_session_items (identity + fingerprint)
    UPDATE public.practice_session_items
       SET client_attempt_id = NULL
     WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_session_items', v_count);

    -- L2-02. practice_sessions (identity + fingerprint)
    UPDATE public.practice_sessions
       SET client_instance_id = NULL
     WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_sessions', v_count);

    -- L2-03. review_error_attempts (identity + fingerprint)
    UPDATE public.review_error_attempts
       SET client_attempt_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_error_attempts', v_count);

    -- L2-05. review_sessions (identity + fingerprint)
    UPDATE public.review_sessions
       SET client_instance_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_sessions', v_count);

    -- ====================================================================
    -- LAYER 3 (anonymize): Sever identity on audit tables
    -- ====================================================================
    -- §5: "Audit layer: one-way anonymized per Doc 05D §10, idempotency
    --   guarantees untouched."
    -- mastery_event_audit_log_dedup_uq is UNIQUE on (event_source_kind,
    -- event_id) — does NOT include student_id. SET NULL is safe; the
    -- idempotency anchor (INV-05A-10) is preserved.
    -- No FK to profiles (denormalized, convention only).

    -- L3-01. mastery_event_audit_log
    UPDATE public.mastery_event_audit_log
       SET student_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_event_audit_log', v_count);

    -- L3-02. mastery_domain_refresh_audit_log
    UPDATE public.mastery_domain_refresh_audit_log
       SET student_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_domain_refresh_audit_log', v_count);

    -- ====================================================================
    -- LAYER 2 (anonymize): exam runtime (Doc 04A §5, Doc 04B §9; E6b, SCL-143)
    -- ====================================================================
    -- RETAINED under actor_id. The identity link is severed by
    -- test_sessions.student_id and score_runs.student_id ON DELETE SET NULL when
    -- the profile row goes below — the same mechanism as practice and review.
    -- score_runs is insert-once; its trigger admits exactly that FK action (the
    -- student_id -> NULL change with every other column equal, the profile gone).
    -- Nothing else to remove: test_sessions has no client/device fingerprint
    -- (Doc 04A omits client_instance_id); the four children and the ledger carry
    -- no identity; the outbox carries none either and score_runs references it,
    -- so it stays. Counted HERE, before the profile delete, because a severance
    -- done by an FK action is invisible to GET DIAGNOSTICS.
    SELECT count(*) INTO v_count FROM public.test_sessions WHERE student_id = p_profile_id;
    v_result := v_result || jsonb_build_object('test_sessions', v_count);

    SELECT count(*) INTO v_count FROM public.score_runs WHERE student_id = p_profile_id;
    v_result := v_result || jsonb_build_object('score_runs', v_count);

    -- ====================================================================
    -- ANONYMIZED_ACTORS LEDGER — Doc 05E §3 Rule 4 / INV-05E-01 / INV-05E-02
    -- (build-derived ledger; no spec anchor — SCL-088. The earlier citation of section 3.1 ("Industry precedent")
    -- was wrong.)
    -- ====================================================================
    -- Records that this actor_id is anonymized, BEFORE the profile deletion below
    -- destroys the one linkage surface. actor_id ONLY: no timestamp (SCL-088 — a
    -- deletion time on the pseudonymous side joins a dated evidence record at this
    -- volume), and public.rewrite_anonymized_actors() strips insertion order after
    -- every executor pass so xmin/ctid carry no sequence either.
    INSERT INTO public.anonymized_actors (actor_id)
    VALUES (v_actor_id)
    ON CONFLICT (actor_id) DO NOTHING;
    v_result := v_result || jsonb_build_object('anonymized_actors', 1);

  END IF;

  -- ========================================================================
  -- PROFILE + AUTH DELETE (shared — both modes destroy the profile row)
  -- ========================================================================
  -- §3 Rule 4: "Linkage destroyed at anonymization." The profile row
  -- contains profiles.actor_id — the ONLY surface linking identity to the
  -- synthetic identifier. Deleting the row makes the link irreversible.
  -- auto-CASCADE FKs fire: rate_limit_ledger, abuse_score_incidents,
  -- abuse_scores, notification_events, notification_messages, legal_acceptances.
  -- profiles.guardian_profile_id SET NULL self-FK fires for other profiles.
  -- test_sessions.student_id and score_runs.student_id SET NULL fire here in
  -- anonymize mode (E6b); in hard_delete no exam row is left for them to reach.
  -- Operator-FK edges (36 config/history) are ON DELETE SET NULL — Postgres severs
  -- the attribution as the profile row goes; no enumeration here.
  -- In anonymize mode, L2/L3 identity columns are already NULL — no FK
  -- from those tables blocks this DELETE (FKs are NO ACTION, nullable).

  DELETE FROM public.profiles WHERE id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('profiles', v_count);

  DELETE FROM auth.users WHERE id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('auth_users', v_count);

  RETURN jsonb_build_object(
    'status', 'completed',
    'profile_id', p_profile_id,
    'privacy_mode', p_privacy_mode,
    'rows_affected', v_result
  );
END;
$$;

COMMIT;
