-- ============================================================================
-- E6 — Full-length exam runtime: per-session item options + runtime functions
-- ============================================================================
-- @spec [Doc-04A_V2.2, §4 (#1 server time, #2 one active session, #3 routing
--        lock, #5 idempotent answers, #6 module answers lock, #12 outbox,
--        #13 missing rows are blanks, #16 partial-scoring eligibility),
--        §7.2-§7.3 (lifecycle, session create), §8.2-§8.5 (timer helper,
--        heartbeat, expiration, module start), §9.1-§9.4 (routing, break),
--        §10.1 (serving), §11.2 (answer submission), §12 (module submit),
--        §13.1-§13.3 (completion + outbox), §14.3-§14.4 (abandonment),
--        §15.1 (state read), §16.1-§16.2 (preconditions, error codes), §18]
--       [Doc-04B_V4.3, §10 is_answer_correct (the only definition of correct),
--        §12 score_test_session_from_outbox]
--       [E6 owner rulings 2026-09-24 — see the PR decision log and SCL-131..136]
-- @implemented [2026-09-24]
--
-- plain English: every state transition of the exam runtime lives in this
--   file as one SQL function per API operation, so each operation is one
--   transaction and every timeout / routing / finalisation rule exists once.
--   The TypeScript handlers (server/routes/exam-runtime-routes.ts) call these
--   through supabase-js .rpc() and do nothing but auth, entitlement, Zod,
--   option-token resolution and serialisation.
--
-- expected outcome:
--   * test_session_items persists the option shuffle per served item
--     (practice's option_order / option_token_map, owner ruling "same as
--     practice and review").
--   * exam_* RPCs return {status, body | error, outbox_ids}. Expected failures
--     are RETURNED, never raised, so a timeout transition performed on the
--     way to a 409 still commits (04A §8.4 "After the transaction commits,
--     the inbound request continues").
--   * Module 1 is graded ONCE, at Module 1 submit or timeout, by
--     is_answer_correct in SQL (04A §9.1). No answer is graded on submit.
--   * A past-grace session is finalised INLINE at every touch
--     (exam_advance_session), and by exam_abandonment_sweep() on a schedule
--     (pg_cron, bound outside migrations — scripts/ops/exam-abandonment-sweep-cron.sql).
--   * exam_score_outbox_event() scores an outbox event and marks it
--     published; the API calls it right after the completing transaction
--     commits, the sweep re-drives anything left pending.
--
-- OWNER RULINGS APPLIED (SCL numbers in brackets)
--   R1 [SCL-132] Module 2 is addressed as '2' by the client; the server maps it
--      to the locked '2A'/'2B'. Tables keep the physical module id.
--   R2 [SCL-133] Option shuffle = practice's: opaque tokens, the map persisted
--      on a per-session item row; the handler resolves token -> canonical
--      letter BEFORE exam_submit_answer, which stores the canonical letter.
--   R3 [SCL-134] Break: skippable in both modes; bounded in strict — at
--      RW-submit + break_duration_ms the server starts Math Module 1 AT THAT
--      INSTANT; unbounded (up to grace) in lenient.
--   R4 [SCL-135] Inline finalisation of a past-grace session at every touch
--      (not only at create).
--   R5 [SCL-136] Scoring inline after commit; outbox payload carries no
--      student_id (aggregate_id is the session).
--   R6 Scheduler = pg_cron (platform-managed; bound by owner-run SQL because
--      genesis excludes platform extensions). A build decision, not a spec
--      amendment: 04A §14.3 names a cadence, not a scheduler.
--
-- trade-offs / edge cases:
--   * All runtime RPCs lock the session row FOR UPDATE first, so every
--     operation on one session is serialised (answer submits included).
--     A student has at most one active session, so this is per-student
--     serialisation of an interactive flow: no contention in practice.
--   * Module start resets active_paused_ms to 0: §8.2 adds the accumulator to
--     the ACTIVE module's expiry; carried over, Module 1's pauses would extend
--     Module 2 in lenient mode.
--   * Timeout timestamps are clock_timestamp() at processing, as §8.4 says,
--     except the strict break auto-start, which starts Math Module 1 at the
--     break's end (R3) so a student who stays away loses that time.
--   * Grace window (24 h) and heartbeat pause threshold (15 s) are the 04A
--     defaults, held in exam_runtime_setting(); the pre-baseline runtime
--     config table was dropped in E1 and no replacement is specified yet.
--
-- OWNER-RUN: tracked pipeline (`supabase db push`). Sorts BEFORE
--   20261001000000_security_definer_revoke_public, so a production that has
--   already applied that file needs `supabase db push --include-all`.
--
-- ROLLBACK (INV-06): transactional. Purely additive.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed —
--   DROP FUNCTION public.exam_abandonment_sweep(int);
--   DROP FUNCTION public.exam_score_outbox_event(uuid);
--   DROP FUNCTION public.exam_heartbeat(uuid, uuid, text);
--   DROP FUNCTION public.exam_submit_module(uuid, uuid, text, text);
--   DROP FUNCTION public.exam_submit_answer(uuid, uuid, text, text, int, text, text, text, int, text);
--   DROP FUNCTION public.exam_answer_option_map(uuid, uuid, text, text, int);
--   DROP FUNCTION public.exam_record_item_options(uuid, uuid, text, text, jsonb);
--   DROP FUNCTION public.exam_module_items(uuid, uuid, text, text);
--   DROP FUNCTION public.exam_start_module(uuid, uuid, text, text);
--   DROP FUNCTION public.exam_session_state(uuid, uuid);
--   DROP FUNCTION public.exam_create_session(uuid, uuid, text);
--   DROP FUNCTION public.exam_touch_session(uuid, uuid, timestamptz);
--   DROP FUNCTION public.exam_advance_session(uuid, timestamptz);
--   DROP FUNCTION public.exam_finalize_session(uuid, timestamptz);
--   DROP FUNCTION public.exam_submit_module2_internal(uuid, text, text, timestamptz);
--   DROP FUNCTION public.exam_submit_module1_internal(uuid, text, text, timestamptz);
--   DROP FUNCTION public.exam_start_module_internal(uuid, text, text, timestamptz);
--   DROP FUNCTION public.exam_grade_module1(uuid, text);
--   DROP FUNCTION public.exam_fold_heartbeat(uuid, text, timestamptz);
--   DROP FUNCTION public.exam_section_state_json(uuid, text, timestamptz);
--   DROP FUNCTION public.exam_session_body(uuid, timestamptz);
--   DROP FUNCTION public.exam_outbox_payload(uuid, text);
--   DROP FUNCTION public.exam_remaining_ms(uuid, text, timestamptz);
--   DROP FUNCTION public.exam_physical_module(uuid, text, text);
--   DROP FUNCTION public.exam_module_duration_ms(uuid, text, text);
--   DROP FUNCTION public.exam_ms(interval);
--   DROP FUNCTION public.exam_runtime_setting(text);
--   DROP TABLE public.test_session_items;
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- test_session_items — the served item and its persisted option shuffle
-- @spec [Doc-04A_V2.2, §4 #9 (resume: same questions, same order); E6 R2;
--        Doc-02B_V4 §16 (practice's option_order/option_token_map)]
-- @implemented [2026-09-24]
-- plain English: one row per item the server has served in a session. For an
--   mcq, option_order is the canonical keys in served order and
--   option_token_map maps each opaque token the client sees to its canonical
--   key; both NULL for a grid-in. Written once by exam_record_item_options
--   (INSERT ... ON CONFLICT DO NOTHING) and never updated: service_role has
--   no UPDATE grant, so a re-serve reads the same shuffle back.
-- edge cases: rows go with the session (ON DELETE CASCADE) — account deletion
--   removes sessions (SCL-124), so this cannot block it.
-- ---------------------------------------------------------------------------
CREATE TABLE public.test_session_items (
  test_session_id   uuid NOT NULL REFERENCES public.test_sessions(id) ON DELETE CASCADE,
  section           text NOT NULL CHECK (section IN ('RW', 'M')),
  module            text NOT NULL CHECK (module IN ('1', '2A', '2B')),
  ordinal           int  NOT NULL,
  question_id       text NOT NULL REFERENCES public.questions(id),
  option_order      text[] NULL,
  option_token_map  jsonb  NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (test_session_id, section, module, ordinal),
  CONSTRAINT test_session_items_option_pair CHECK (
    (option_order IS NULL) = (option_token_map IS NULL)
  ),
  CONSTRAINT test_session_items_option_map_is_object CHECK (
    option_token_map IS NULL OR jsonb_typeof(option_token_map) = 'object'
  )
);

ALTER TABLE public.test_session_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.test_session_items FROM PUBLIC, anon, authenticated, service_role;
-- Insert-once by privilege (no UPDATE, no DELETE): the shuffle a student saw
-- cannot be rewritten under them.
GRANT SELECT, INSERT ON TABLE public.test_session_items TO service_role;

-- Own-row policy, as on the other session children. No column is granted to
-- authenticated: the row's only payload is the token map, which practice also
-- withholds from direct reads (20260610020000 column grants).
CREATE POLICY test_session_items_select_self ON public.test_session_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_sessions s
                  WHERE s.id = test_session_items.test_session_id
                    AND s.student_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Small pure helpers
-- ---------------------------------------------------------------------------

-- @spec [Doc-04A_V2.2, §7.3 step 8 (24 h default), §8.3 (15 s default)]
-- plain English: the two runtime defaults 04A names, in one place.
CREATE FUNCTION public.exam_runtime_setting(p_key text)
RETURNS interval LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_key
           WHEN 'test_level_grace_window'   THEN interval '24 hours'
           WHEN 'heartbeat_pause_threshold' THEN interval '15 seconds'
         END
$$;

-- plain English: an interval as whole milliseconds (floor).
CREATE FUNCTION public.exam_ms(p interval)
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT floor(extract(epoch FROM p) * 1000)::bigint
$$;

-- @spec [Doc-04A_V2.2, §8.5 "Module duration values come from the form row"]
CREATE FUNCTION public.exam_module_duration_ms(p_form_id uuid, p_section text, p_module text)
RETURNS int LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN p_section = 'RW' AND p_module = '1' THEN f.rw_module1_ms
           WHEN p_section = 'RW'                   THEN f.rw_module2_ms
           WHEN p_module = '1'                     THEN f.m_module1_ms
           ELSE f.m_module2_ms
         END
    FROM test_forms f WHERE f.id = p_form_id
$$;

-- @spec [E6 R1] plain English: the client's '1' / '2' to the stored module id.
--   '2' resolves to '2' || module2_path, or NULL while Module 1 is unrouted.
CREATE FUNCTION public.exam_physical_module(p_session_id uuid, p_section text, p_module text)
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_module
           WHEN '1' THEN '1'
           WHEN '2' THEN (SELECT '2' || s.module2_path FROM test_session_sections s
                           WHERE s.test_session_id = p_session_id AND s.section = p_section)
         END
$$;

-- ---------------------------------------------------------------------------
-- §8.2 — the canonical timer helper (the only place the formula appears)
-- @spec [Doc-04A_V2.2, §8.2, §8.6 mode-read point (2)]
-- plain English: remaining_ms for a section's ACTIVE module, NULL when no
--   module is active. effective_expires_at = module_expires_at +
--   active_paused_ms + currently_paused_ms; currently_paused_ms is the gap
--   since last_active_at when it exceeds the pause threshold. Strict: both
--   terms are 0.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_remaining_ms(p_session_id uuid, p_section text, p_now timestamptz)
RETURNS bigint LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_mode    text;
  v_sec     test_session_sections%ROWTYPE;
  v_expires timestamptz;
  v_paused  bigint := 0;
BEGIN
  SELECT mode INTO v_mode FROM test_sessions WHERE id = p_session_id;
  SELECT * INTO v_sec FROM test_session_sections
   WHERE test_session_id = p_session_id AND section = p_section;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_sec.state = 'module1_active' THEN
    v_expires := v_sec.module1_expires_at;
  ELSIF v_sec.state = 'module2_active' THEN
    v_expires := v_sec.module2_expires_at;
  ELSE
    RETURN NULL;
  END IF;

  IF v_mode = 'lenient' THEN
    v_paused := v_sec.active_paused_ms;
    IF v_sec.last_active_at IS NOT NULL
       AND p_now - v_sec.last_active_at > exam_runtime_setting('heartbeat_pause_threshold') THEN
      v_paused := v_paused + exam_ms(p_now - v_sec.last_active_at);
    END IF;
  END IF;

  RETURN greatest(0::bigint, exam_ms(v_expires + v_paused * interval '1 millisecond' - p_now));
END;
$$;

-- ---------------------------------------------------------------------------
-- §8.3 — heartbeat fold (the spec's statement, verbatim in effect)
-- @spec [Doc-04A_V2.2, §8.3, §8.6 mode-read point (1), §15.1 step 4]
-- plain English: folds a detected pause into active_paused_ms (lenient only)
--   and stamps last_active_at, for the section's ACTIVE module only.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_fold_heartbeat(p_session_id uuid, p_section text, p_now timestamptz)
RETURNS void LANGUAGE sql SET search_path = public, pg_temp AS $$
  UPDATE test_session_sections sec
     SET active_paused_ms = sec.active_paused_ms + CASE
           WHEN s.mode = 'lenient'
            AND sec.last_active_at IS NOT NULL
            AND p_now - sec.last_active_at > exam_runtime_setting('heartbeat_pause_threshold')
           THEN exam_ms(p_now - sec.last_active_at)
           ELSE 0
         END,
         last_active_at = p_now
    FROM test_sessions s
   WHERE s.id = sec.test_session_id
     AND sec.test_session_id = p_session_id
     AND sec.section = p_section
     AND sec.state IN ('module1_active', 'module2_active')
$$;

-- ---------------------------------------------------------------------------
-- §9.1 step 1 — Module 1 raw score (the only correctness math 04A performs)
-- @spec [Doc-04A_V2.2, §9.1, §4 #13; Doc-04B_V4.3 §10, §14.4]
-- plain English: correct Module 1 answers, judged by is_answer_correct (the
--   one SQL definition of correct), counting only answers that sit on the
--   form's own Module 1 (ordinal AND question_id). Missing rows count wrong.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_grade_module1(p_session_id uuid, p_section text)
RETURNS int LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT count(*)::int
    FROM test_session_answers a
    JOIN test_sessions s ON s.id = a.test_session_id
    JOIN test_form_items fi
      ON fi.test_form_id = s.test_form_id
     AND fi.section = a.section AND fi.module = a.module
     AND fi.ordinal = a.ordinal AND fi.question_id = a.question_id
   WHERE a.test_session_id = p_session_id
     AND a.section = p_section
     AND a.module = '1'
     AND is_answer_correct(a.answer, a.question_id)
$$;

-- ---------------------------------------------------------------------------
-- §8.5 — module start (internal)
-- @spec [Doc-04A_V2.2, §8.5 step 3, §7.2 created->active / section_break->active]
-- plain English: puts a section's module 1 or 2 into its active state with
--   p_started_at as the start instant and expiry = start + form duration;
--   the session becomes active on this section.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_start_module_internal(
  p_session_id uuid, p_section text, p_module text, p_started_at timestamptz)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_form uuid;
  v_dur  int;
BEGIN
  SELECT test_form_id INTO v_form FROM test_sessions WHERE id = p_session_id;
  v_dur := exam_module_duration_ms(v_form, p_section, p_module);

  IF p_module = '1' THEN
    UPDATE test_session_sections
       SET state = 'module1_active',
           module1_started_at = p_started_at,
           module1_expires_at = p_started_at + v_dur * interval '1 millisecond',
           active_paused_ms = 0,
           last_active_at = p_started_at
     WHERE test_session_id = p_session_id AND section = p_section AND state = 'not_started';
  ELSE
    UPDATE test_session_sections
       SET state = 'module2_active',
           module2_started_at = p_started_at,
           module2_expires_at = p_started_at + v_dur * interval '1 millisecond',
           active_paused_ms = 0,
           last_active_at = p_started_at
     WHERE test_session_id = p_session_id AND section = p_section AND state = 'module1_submitted';
  END IF;

  UPDATE test_sessions
     SET state = 'active',
         active_section = p_section,
         started_at = COALESCE(started_at, p_started_at)
   WHERE id = p_session_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- §9.1 — Module 1 submit / timeout (internal): grade once, route, lock
-- @spec [Doc-04A_V2.2, §9.1 steps 1-4, §8.4 Module 1 timeout path, §4 #3]
-- plain English: module2_path = 'B' when the Module 1 raw score reaches the
--   form's threshold, else 'A'; written once (trg_module2_path_immutability
--   refuses any later change).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_submit_module1_internal(
  p_session_id uuid, p_section text, p_by text, p_now timestamptz)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_raw       int;
  v_threshold int;
BEGIN
  v_raw := exam_grade_module1(p_session_id, p_section);
  SELECT CASE WHEN p_section = 'RW' THEN f.routing_threshold_rw ELSE f.routing_threshold_m END
    INTO v_threshold
    FROM test_sessions s JOIN test_forms f ON f.id = s.test_form_id
   WHERE s.id = p_session_id;

  UPDATE test_session_sections
     SET state = 'module1_submitted',
         module2_path = CASE WHEN v_raw >= v_threshold THEN 'B' ELSE 'A' END,
         module1_submitted_at = p_now,
         module1_submitted_by = p_by
   WHERE test_session_id = p_session_id AND section = p_section AND state = 'module1_active';
END;
$$;

-- ---------------------------------------------------------------------------
-- §13.2 / §14.4 — outbox payload (E6 R5: no student_id)
-- @spec [Doc-04A_V2.2, §13.2, §14.4, §4 #16; SCL-136]
-- plain English: the §13.2 / §14.4 payload minus student_id. The consumer
--   (score_test_session_from_outbox) reads only aggregate_id; this payload is
--   a notification, never a transport of identity.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_outbox_payload(p_session_id uuid, p_event_type text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
           'test_session_id', s.id,
           'test_form_id', s.test_form_id,
           'score_table_version', f.score_table_version,
           'mode', s.mode,
           'is_first_seen_form_attempt', s.is_first_seen_form_attempt,
           'attempt_number_for_form', s.attempt_number_for_form)
      || CASE WHEN p_event_type = 'test_session_completed'
              THEN jsonb_build_object('completed_at', s.completed_at)
              ELSE jsonb_build_object('abandoned_at', s.abandoned_at) END
      || jsonb_build_object('sections', (
           SELECT jsonb_agg(
                    CASE WHEN p_event_type = 'test_session_completed'
                         THEN jsonb_build_object('section', sec.section, 'module2_path', sec.module2_path)
                         ELSE jsonb_build_object('section', sec.section,
                                                 'section_state', sec.state,
                                                 'module2_path', sec.module2_path,
                                                 'scoreable', sec.state = 'submitted') END
                    ORDER BY CASE sec.section WHEN 'RW' THEN 1 ELSE 2 END)
             FROM test_session_sections sec WHERE sec.test_session_id = s.id))
    FROM test_sessions s JOIN test_forms f ON f.id = s.test_form_id
   WHERE s.id = p_session_id
$$;

-- ---------------------------------------------------------------------------
-- §12 step 4 / §8.4 Module 2 timeout / §13.1 — Module 2 submit (internal)
-- @spec [Doc-04A_V2.2, §12 step 4, §8.4, §13.1-§13.3, §7.2 active->section_break]
-- plain English: the section becomes submitted. Second section submitted ->
--   the session completes and the completion outbox row is written in the
--   same transaction (returned). Otherwise RW is done -> section_break.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_submit_module2_internal(
  p_session_id uuid, p_section text, p_by text, p_now timestamptz)
RETURNS uuid LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_outbox uuid;
BEGIN
  UPDATE test_session_sections
     SET state = 'submitted',
         module2_submitted_at = p_now,
         module2_submitted_by = p_by
   WHERE test_session_id = p_session_id AND section = p_section AND state = 'module2_active';

  IF (SELECT count(*) FROM test_session_sections
       WHERE test_session_id = p_session_id AND state = 'submitted') = 2 THEN
    UPDATE test_sessions
       SET state = 'completed', completed_at = p_now, active_section = NULL
     WHERE id = p_session_id;
    INSERT INTO exam_runtime_outbox (event_type, aggregate_id, payload)
    VALUES ('test_session_completed', p_session_id,
            exam_outbox_payload(p_session_id, 'test_session_completed'))
    RETURNING id INTO v_outbox;
  ELSE
    UPDATE test_sessions
       SET state = 'section_break', active_section = NULL
     WHERE id = p_session_id;
  END IF;
  RETURN v_outbox;
END;
$$;

-- ---------------------------------------------------------------------------
-- §14.3 steps 2-5 — finalise one past-grace session (sweep AND inline)
-- @spec [Doc-04A_V2.2, §14.3, §14.4, §4 #16, §7.3 step 5; E6 R4 / SCL-135]
-- plain English: time out any active module (Module 1 -> routed; Module 2 ->
--   submitted, which may complete the session), then classify: any section
--   submitted -> partial_scored_abandoned + partial outbox row; none ->
--   abandoned_final. Returns the outbox id written, if any. Caller holds the
--   session row lock.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_finalize_session(p_session_id uuid, p_now timestamptz)
RETURNS uuid LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_sec    record;
  v_outbox uuid;
  v_state  text;
BEGIN
  FOR v_sec IN
    SELECT section, state FROM test_session_sections
     WHERE test_session_id = p_session_id AND state IN ('module1_active', 'module2_active')
     ORDER BY CASE section WHEN 'RW' THEN 1 ELSE 2 END
  LOOP
    IF v_sec.state = 'module1_active' THEN
      PERFORM exam_submit_module1_internal(p_session_id, v_sec.section, 'timeout', p_now);
    ELSE
      v_outbox := exam_submit_module2_internal(p_session_id, v_sec.section, 'timeout', p_now);
    END IF;
  END LOOP;

  SELECT state INTO v_state FROM test_sessions WHERE id = p_session_id;
  IF v_state = 'completed' THEN
    RETURN v_outbox;           -- the last Module 2 timeout completed the exam
  END IF;

  IF EXISTS (SELECT 1 FROM test_session_sections
              WHERE test_session_id = p_session_id AND state = 'submitted') THEN
    UPDATE test_sessions
       SET state = 'partial_scored_abandoned', abandoned_at = p_now, active_section = NULL
     WHERE id = p_session_id;
    INSERT INTO exam_runtime_outbox (event_type, aggregate_id, payload)
    VALUES ('test_session_partial_scored_abandoned', p_session_id,
            exam_outbox_payload(p_session_id, 'test_session_partial_scored_abandoned'))
    RETURNING id INTO v_outbox;
  ELSE
    UPDATE test_sessions
       SET state = 'abandoned_final', abandoned_at = p_now, active_section = NULL
     WHERE id = p_session_id;
    v_outbox := NULL;
  END IF;
  RETURN v_outbox;
END;
$$;

-- ---------------------------------------------------------------------------
-- The touch: bring a session up to server time before any request reads it
-- @spec [Doc-04A_V2.2, §8.4 (inbound-eager timeout paths), §4 #7, §9.4;
--        E6 R3 / SCL-134 (strict break), R4 / SCL-135 (inline finalise)]
-- plain English: locks the session row and applies, in order:
--   1. past grace -> finalise (terminal state + outbox row if scoreable);
--   2. strict + section_break past RW-submit + break_duration_ms -> start
--      Math Module 1 at the break's end;
--   3. any active module whose §8.2 remaining_ms is 0 -> its §8.4 timeout
--      path (Module 1 routes; Module 2 submits, possibly completing).
--   Returns {finalized, outbox_ids}. A terminal session is left untouched.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_advance_session(p_session_id uuid, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_s        test_sessions%ROWTYPE;
  v_outbox   uuid;
  v_ids      uuid[] := ARRAY[]::uuid[];
  v_break_at timestamptz;
  v_sec      record;
BEGIN
  SELECT * INTO v_s FROM test_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.state IN ('completed', 'abandoned_final', 'partial_scored_abandoned') THEN
    RETURN jsonb_build_object('finalized', false, 'outbox_ids', to_jsonb(v_ids));
  END IF;

  -- 1. past grace
  IF p_now > v_s.grace_expires_at THEN
    v_outbox := exam_finalize_session(p_session_id, p_now);
    IF v_outbox IS NOT NULL THEN v_ids := v_ids || v_outbox; END IF;
    RETURN jsonb_build_object('finalized', true, 'outbox_ids', to_jsonb(v_ids));
  END IF;

  -- 2. strict break is bounded (lenient: unbounded, up to grace)
  IF v_s.state = 'section_break' AND v_s.mode = 'strict' THEN
    SELECT sec.module2_submitted_at + f.break_duration_ms * interval '1 millisecond'
      INTO v_break_at
      FROM test_session_sections sec JOIN test_forms f ON f.id = v_s.test_form_id
     WHERE sec.test_session_id = p_session_id AND sec.section = 'RW';
    IF v_break_at IS NOT NULL AND p_now >= v_break_at THEN
      PERFORM exam_start_module_internal(p_session_id, 'M', '1', v_break_at);
    END IF;
  END IF;

  -- 3. expired active modules
  FOR v_sec IN
    SELECT section, state FROM test_session_sections
     WHERE test_session_id = p_session_id AND state IN ('module1_active', 'module2_active')
     ORDER BY CASE section WHEN 'RW' THEN 1 ELSE 2 END
  LOOP
    IF exam_remaining_ms(p_session_id, v_sec.section, p_now) <= 0 THEN
      IF v_sec.state = 'module1_active' THEN
        PERFORM exam_submit_module1_internal(p_session_id, v_sec.section, 'timeout', p_now);
      ELSE
        v_outbox := exam_submit_module2_internal(p_session_id, v_sec.section, 'timeout', p_now);
        IF v_outbox IS NOT NULL THEN v_ids := v_ids || v_outbox; END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('finalized', false, 'outbox_ids', to_jsonb(v_ids));
END;
$$;

-- ---------------------------------------------------------------------------
-- §16.1 — standard preconditions for session-bound endpoints (steps 3-5)
-- @spec [Doc-04A_V2.2, §16.1, §16.2; E6 R4]
-- plain English: 404 session_not_found, 403 forbidden (not the owner), then
--   the touch, then the terminal check. A session finalised by THIS touch
--   reports 409 session_grace_expired (why the request failed); one that was
--   already terminal reports 409 session_terminal. Steps 1-2 (auth,
--   entitlement) run in the handler before this.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_touch_session(p_student_id uuid, p_session_id uuid, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid;
  v_adv   jsonb;
  v_state text;
BEGIN
  SELECT student_id INTO v_owner FROM test_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 404, 'code', 'session_not_found', 'outbox_ids', '[]'::jsonb);
  END IF;
  IF v_owner IS DISTINCT FROM p_student_id THEN
    RETURN jsonb_build_object('status', 403, 'code', 'forbidden', 'outbox_ids', '[]'::jsonb);
  END IF;

  v_adv := exam_advance_session(p_session_id, p_now);
  SELECT state INTO v_state FROM test_sessions WHERE id = p_session_id;

  IF v_state IN ('completed', 'abandoned_final', 'partial_scored_abandoned') THEN
    RETURN jsonb_build_object(
      'status', 409,
      'code', CASE WHEN (v_adv->>'finalized')::boolean THEN 'session_grace_expired' ELSE 'session_terminal' END,
      'state', v_state,
      'outbox_ids', v_adv->'outbox_ids');
  END IF;
  RETURN jsonb_build_object('status', 200, 'state', v_state, 'outbox_ids', v_adv->'outbox_ids');
END;
$$;

-- ---------------------------------------------------------------------------
-- Response fragments
-- ---------------------------------------------------------------------------

-- @spec [Doc-04A_V2.2, §11.2 response section_state, §9.3 (no path)]
CREATE FUNCTION public.exam_section_state_json(p_session_id uuid, p_section text, p_now timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
           'section', sec.section,
           'state', sec.state,
           'remaining_ms', exam_remaining_ms(p_session_id, sec.section, p_now))
    FROM test_session_sections sec
   WHERE sec.test_session_id = p_session_id AND sec.section = p_section
$$;

-- @spec [Doc-04A_V2.2, §7.3 response, §15.1 response, §9.3 (module2_path_locked
--        only); E6 R3 (break_remaining_ms, additive)]
-- plain English: the session read model. break_remaining_ms is set only in
--   section_break: time left in the suggested break (strict: until Math
--   Module 1 starts on its own; lenient: advisory, floored at 0).
CREATE FUNCTION public.exam_session_body(p_session_id uuid, p_now timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
           'session_id', s.id,
           'test_form_id', s.test_form_id,
           'state', s.state,
           'mode', s.mode,
           'active_section', s.active_section,
           'grace_expires_at', s.grace_expires_at,
           'attempt_number_for_form', s.attempt_number_for_form,
           'is_first_seen_form_attempt', s.is_first_seen_form_attempt,
           'break_remaining_ms', CASE WHEN s.state = 'section_break' THEN (
               SELECT greatest(0::bigint, exam_ms(rw.module2_submitted_at
                        + f.break_duration_ms * interval '1 millisecond' - p_now))
                 FROM test_session_sections rw
                WHERE rw.test_session_id = s.id AND rw.section = 'RW') END,
           'sections', (
             SELECT jsonb_agg(jsonb_build_object(
                      'section', sec.section,
                      'state', sec.state,
                      'remaining_ms', exam_remaining_ms(s.id, sec.section, p_now),
                      'module2_path_locked', sec.module2_path IS NOT NULL)
                    ORDER BY CASE sec.section WHEN 'RW' THEN 1 ELSE 2 END)
               FROM test_session_sections sec WHERE sec.test_session_id = s.id))
    FROM test_sessions s JOIN test_forms f ON f.id = s.test_form_id
   WHERE s.id = p_session_id
$$;

-- ---------------------------------------------------------------------------
-- POST /api/tests/sessions
-- @spec [Doc-04A_V2.2, §7.3 steps 3-12, §4 #2, §16.2; E6 R4]
-- plain English: validates the form (published + selectable), serialises
--   creates per student with the §7.3 advisory lock, touches any existing
--   non-terminal session (finalising it inline if past grace), then either
--   returns the existing session (same form, 200), refuses (different form,
--   409 existing_active_session) or inserts the new session and its two
--   sections (201).
-- edge cases: a form id that does not exist answers 409 form_not_published
--   (04A has no form_not_found code; the id cannot be published).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_create_session(p_student_id uuid, p_test_form_id uuid, p_mode text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_now      timestamptz := clock_timestamp();
  v_form     test_forms%ROWTYPE;
  v_existing test_sessions%ROWTYPE;
  v_adv      jsonb;
  v_ids      jsonb := '[]'::jsonb;
  v_attempt  int;
  v_id       uuid;
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

  INSERT INTO test_sessions (student_id, test_form_id, state, mode, grace_expires_at,
                             attempt_number_for_form, is_first_seen_form_attempt)
  VALUES (p_student_id, p_test_form_id, 'created', p_mode,
          v_now + exam_runtime_setting('test_level_grace_window'),
          v_attempt, v_attempt = 1)
  RETURNING id INTO v_id;

  INSERT INTO test_session_sections (test_session_id, section, state)
  VALUES (v_id, 'RW', 'not_started'), (v_id, 'M', 'not_started');

  RETURN jsonb_build_object('status', 201, 'body', exam_session_body(v_id, v_now), 'outbox_ids', v_ids);
END;
$$;

-- ---------------------------------------------------------------------------
-- GET /api/tests/sessions/:session_id/state
-- @spec [Doc-04A_V2.2, §15.1; E6 R4]
-- plain English: touch (finalising a past-grace session inline), fold the
--   active section's heartbeat (§15.1 step 4), return the read model. A
--   terminal session answers 200 with its terminal state: §15.1's response
--   enumerates 'completed', and a finalised session must be readable so the
--   client learns the outcome.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_session_state(p_student_id uuid, p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_now   timestamptz := clock_timestamp();
  v_touch jsonb;
  v_active text;
BEGIN
  v_touch := exam_touch_session(p_student_id, p_session_id, v_now);
  IF (v_touch->>'status')::int IN (403, 404) THEN
    RETURN jsonb_build_object('status', (v_touch->>'status')::int, 'error', jsonb_build_object(
      'code', v_touch->>'code', 'message', 'Session not available.'), 'outbox_ids', v_touch->'outbox_ids');
  END IF;

  SELECT active_section INTO v_active FROM test_sessions WHERE id = p_session_id;
  IF v_active IS NOT NULL THEN
    PERFORM exam_fold_heartbeat(p_session_id, v_active, v_now);
  END IF;

  RETURN jsonb_build_object('status', 200, 'body', exam_session_body(p_session_id, v_now),
                            'outbox_ids', v_touch->'outbox_ids');
END;
$$;

-- ---------------------------------------------------------------------------
-- POST /api/tests/sessions/:id/sections/:section/modules/:module/start
-- @spec [Doc-04A_V2.2, §8.5 steps 1-3, §7.2; E6 R1]
-- plain English: starts RW Module 1 from 'created', Math Module 1 from
--   'section_break', or Module 2 of a routed section. Re-starting the module
--   that is already active is an idempotent 200 (a retried click must not
--   fail). A module already done -> 409 module_submitted; any other order ->
--   409 module_not_startable.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_start_module(p_student_id uuid, p_session_id uuid,
                                         p_section text, p_module text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_now   timestamptz := clock_timestamp();
  v_touch jsonb;
  v_state text;
  v_sec   text;
  v_ok    boolean := false;
BEGIN
  v_touch := exam_touch_session(p_student_id, p_session_id, v_now);
  IF (v_touch->>'status')::int <> 200 THEN
    RETURN jsonb_build_object('status', (v_touch->>'status')::int, 'error', jsonb_build_object(
      'code', v_touch->>'code', 'message', 'Session not available.'), 'outbox_ids', v_touch->'outbox_ids');
  END IF;
  v_state := v_touch->>'state';
  SELECT state INTO v_sec FROM test_session_sections
   WHERE test_session_id = p_session_id AND section = p_section;

  IF p_module = '1' THEN
    IF v_sec = 'module1_active' THEN
      v_ok := true;                                           -- idempotent re-start
    ELSIF v_sec = 'not_started'
          AND ((p_section = 'RW' AND v_state = 'created')
            OR (p_section = 'M'  AND v_state = 'section_break')) THEN
      PERFORM exam_start_module_internal(p_session_id, p_section, '1', v_now);
      v_ok := true;
    ELSIF v_sec IN ('module1_submitted', 'module2_active', 'submitted') THEN
      RETURN jsonb_build_object('status', 409, 'error', jsonb_build_object(
        'code', 'module_submitted', 'message', 'This module has already been submitted.',
        'section_state', exam_section_state_json(p_session_id, p_section, v_now)),
        'outbox_ids', v_touch->'outbox_ids');
    END IF;
  ELSE
    IF v_sec = 'module2_active' THEN
      v_ok := true;
    ELSIF v_sec = 'module1_submitted' THEN
      PERFORM exam_start_module_internal(p_session_id, p_section, '2', v_now);
      v_ok := true;
    ELSIF v_sec = 'submitted' THEN
      RETURN jsonb_build_object('status', 409, 'error', jsonb_build_object(
        'code', 'module_submitted', 'message', 'This module has already been submitted.',
        'section_state', exam_section_state_json(p_session_id, p_section, v_now)),
        'outbox_ids', v_touch->'outbox_ids');
    END IF;
  END IF;

  IF NOT v_ok THEN
    RETURN jsonb_build_object('status', 409, 'error', jsonb_build_object(
      'code', 'module_not_startable', 'message', 'This module cannot be started yet.'),
      'outbox_ids', v_touch->'outbox_ids');
  END IF;

  RETURN jsonb_build_object('status', 200, 'body', jsonb_build_object(
    'section_state', exam_section_state_json(p_session_id, p_section, v_now)),
    'outbox_ids', v_touch->'outbox_ids');
END;
$$;

-- ---------------------------------------------------------------------------
-- GET /api/tests/sessions/:id/sections/:section/modules/:module/items
-- @spec [Doc-04A_V2.2, §10.1 steps 1-7, §10.2 (server-side half); E6 R1, R2]
-- plain English: for the ACTIVE module only, returns each form item's
--   render fields (stem, passage, options with canonical keys, assets,
--   item_type), its stored shuffle (NULL until the handler records one) and
--   the student's stored canonical answer, plus section_state. Never reads
--   correct_answer, correct_variants, explanation, domain, skill_codes or
--   difficulty: the answer-bearing columns do not leave the database here.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_module_items(p_student_id uuid, p_session_id uuid,
                                         p_section text, p_module text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_now   timestamptz := clock_timestamp();
  v_touch jsonb;
  v_sec   text;
  v_phys  text;
BEGIN
  v_touch := exam_touch_session(p_student_id, p_session_id, v_now);
  IF (v_touch->>'status')::int <> 200 THEN
    RETURN jsonb_build_object('status', (v_touch->>'status')::int, 'error', jsonb_build_object(
      'code', v_touch->>'code', 'message', 'Session not available.'), 'outbox_ids', v_touch->'outbox_ids');
  END IF;

  SELECT state INTO v_sec FROM test_session_sections
   WHERE test_session_id = p_session_id AND section = p_section;
  IF NOT ((p_module = '1' AND v_sec = 'module1_active') OR (p_module = '2' AND v_sec = 'module2_active')) THEN
    RETURN jsonb_build_object('status', 409, 'error', jsonb_build_object(
      'code', CASE
                WHEN p_module = '1' AND v_sec IN ('module1_submitted', 'module2_active', 'submitted') THEN 'module_submitted'
                WHEN p_module = '2' AND v_sec = 'submitted' THEN 'module_submitted'
                ELSE 'module_not_started' END,
      'message', 'This module is not active.',
      'section_state', exam_section_state_json(p_session_id, p_section, v_now)),
      'outbox_ids', v_touch->'outbox_ids');
  END IF;

  v_phys := exam_physical_module(p_session_id, p_section, p_module);

  RETURN jsonb_build_object('status', 200, 'body', jsonb_build_object(
    'section_state', exam_section_state_json(p_session_id, p_section, v_now),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'ordinal', fi.ordinal,
               'question_id', fi.question_id,
               'item_type', q.item_type,
               'stem', q.stem,
               'passage', q.passage,
               'options', q.options,
               'assets', q.assets,
               'served', si.test_session_id IS NOT NULL,
               'option_order', to_jsonb(si.option_order),
               'option_token_map', si.option_token_map,
               'has_answer', a.test_session_id IS NOT NULL,
               'current_answer', a.answer)
             ORDER BY fi.ordinal)
        FROM test_sessions s
        JOIN test_form_items fi
          ON fi.test_form_id = s.test_form_id AND fi.section = p_section AND fi.module = v_phys
        JOIN questions q ON q.id = fi.question_id
        LEFT JOIN test_session_items si
          ON si.test_session_id = s.id AND si.section = fi.section
         AND si.module = fi.module AND si.ordinal = fi.ordinal
        LEFT JOIN test_session_answers a
          ON a.test_session_id = s.id AND a.section = fi.section
         AND a.module = fi.module AND a.ordinal = fi.ordinal
       WHERE s.id = p_session_id), '[]'::jsonb)),
    'outbox_ids', v_touch->'outbox_ids');
END;
$$;

-- ---------------------------------------------------------------------------
-- Records the shuffle the handler minted for items served without one.
-- @spec [E6 R2; Doc-02B_V4 §16 (practice hydrateSessionItemOptionTokens, idempotent)]
-- plain English: p_rows = [{ordinal, question_id, option_order, option_token_map}]
--   for the ACTIVE module. Each row must be an item of that module;
--   ON CONFLICT DO NOTHING keeps the first shuffle written (two tabs racing
--   both read the winner back). Returns the stored rows for the module.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_record_item_options(p_student_id uuid, p_session_id uuid,
                                                p_section text, p_module text, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_now   timestamptz := clock_timestamp();
  v_touch jsonb;
  v_sec   text;
  v_phys  text;
BEGIN
  v_touch := exam_touch_session(p_student_id, p_session_id, v_now);
  IF (v_touch->>'status')::int <> 200 THEN
    RETURN jsonb_build_object('status', (v_touch->>'status')::int, 'error', jsonb_build_object(
      'code', v_touch->>'code', 'message', 'Session not available.'), 'outbox_ids', v_touch->'outbox_ids');
  END IF;
  SELECT state INTO v_sec FROM test_session_sections
   WHERE test_session_id = p_session_id AND section = p_section;
  IF NOT ((p_module = '1' AND v_sec = 'module1_active') OR (p_module = '2' AND v_sec = 'module2_active')) THEN
    RETURN jsonb_build_object('status', 409, 'error', jsonb_build_object(
      'code', 'module_submitted', 'message', 'This module is not active.'), 'outbox_ids', v_touch->'outbox_ids');
  END IF;
  v_phys := exam_physical_module(p_session_id, p_section, p_module);

  INSERT INTO test_session_items (test_session_id, section, module, ordinal, question_id,
                                  option_order, option_token_map)
  SELECT p_session_id, p_section, v_phys, fi.ordinal, fi.question_id,
         CASE WHEN r.option_order IS NULL OR jsonb_typeof(r.option_order) = 'null' THEN NULL
              ELSE ARRAY(SELECT jsonb_array_elements_text(r.option_order)) END,
         CASE WHEN jsonb_typeof(r.option_token_map) = 'object' THEN r.option_token_map END
    FROM jsonb_to_recordset(p_rows) AS r(ordinal int, question_id text,
                                         option_order jsonb, option_token_map jsonb)
    JOIN test_sessions s ON s.id = p_session_id
    JOIN test_form_items fi
      ON fi.test_form_id = s.test_form_id AND fi.section = p_section AND fi.module = v_phys
     AND fi.ordinal = r.ordinal AND fi.question_id = r.question_id
  ON CONFLICT (test_session_id, section, module, ordinal) DO NOTHING;

  RETURN jsonb_build_object('status', 200, 'body', jsonb_build_object('items', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'ordinal', si.ordinal, 'question_id', si.question_id,
             'option_order', to_jsonb(si.option_order), 'option_token_map', si.option_token_map)
           ORDER BY si.ordinal)
      FROM test_session_items si
     WHERE si.test_session_id = p_session_id AND si.section = p_section AND si.module = v_phys),
    '[]'::jsonb)), 'outbox_ids', v_touch->'outbox_ids');
END;
$$;

-- ---------------------------------------------------------------------------
-- The stored shuffle for one item, for token resolution BEFORE submit.
-- @spec [E6 R2; Doc-02B_V4 §16]
-- plain English: ownership only, deliberately no state check and no touch:
--   an idempotent replay must reach exam_submit_answer's replay path whatever
--   the module's state. Returns the item's type and token map (the student's
--   own), or nulls when the (section, module, ordinal) is not an item.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_answer_option_map(p_student_id uuid, p_session_id uuid,
                                              p_section text, p_module text, p_ordinal int)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid;
  v_phys  text;
  v_row   record;
BEGIN
  SELECT student_id INTO v_owner FROM test_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 404, 'error', jsonb_build_object('code', 'session_not_found', 'message', 'Session not available.'));
  END IF;
  IF v_owner IS DISTINCT FROM p_student_id THEN
    RETURN jsonb_build_object('status', 403, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Session not available.'));
  END IF;
  v_phys := exam_physical_module(p_session_id, p_section, p_module);

  SELECT fi.question_id, q.item_type, si.option_token_map
    INTO v_row
    FROM test_sessions s
    JOIN test_form_items fi
      ON fi.test_form_id = s.test_form_id AND fi.section = p_section
     AND fi.module = v_phys AND fi.ordinal = p_ordinal
    JOIN questions q ON q.id = fi.question_id
    LEFT JOIN test_session_items si
      ON si.test_session_id = s.id AND si.section = fi.section
     AND si.module = fi.module AND si.ordinal = fi.ordinal
   WHERE s.id = p_session_id;

  RETURN jsonb_build_object('status', 200, 'body', jsonb_build_object(
    'question_id', v_row.question_id,
    'item_type', v_row.item_type,
    'option_token_map', v_row.option_token_map));
END;
$$;

-- ---------------------------------------------------------------------------
-- POST /api/tests/answer
-- @spec [Doc-04A_V2.2, §11.2 steps 1-8, §11.3, §4 #5 #6 #13, §16.1; E6 R1, R2]
-- plain English: preconditions -> idempotent replay (same key returns the
--   stored response verbatim, flags a body mismatch for audit, writes
--   nothing) -> the module must be the active one -> the (ordinal,
--   question_id) must be that module's item -> ledger insert + canonical
--   upsert in this transaction. p_answer is the CANONICAL value the handler
--   resolved (mcq letter / grid-in string / NULL = explicit omit);
--   p_display_answer is what the client sent, echoed in the response.
-- edge cases: the touch runs the §8.4 timeout first, so an answer arriving
--   after expiry sees a submitted module and gets 409 module_submitted, by
--   server time. Nothing is graded here.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_submit_answer(
  p_student_id uuid, p_session_id uuid, p_section text, p_module text, p_ordinal int,
  p_question_id text, p_answer text, p_display_answer text, p_client_latency_ms int,
  p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_now      timestamptz := clock_timestamp();
  v_touch    jsonb;
  v_prior    test_answer_submissions%ROWTYPE;
  v_sec      text;
  v_phys     text;
  v_response jsonb;
  v_sub_id   uuid;
  v_mismatch text[] := ARRAY[]::text[];
BEGIN
  v_touch := exam_touch_session(p_student_id, p_session_id, v_now);
  IF (v_touch->>'status')::int <> 200 THEN
    RETURN jsonb_build_object('status', (v_touch->>'status')::int, 'error', jsonb_build_object(
      'code', v_touch->>'code', 'message', 'Session not available.'), 'outbox_ids', v_touch->'outbox_ids');
  END IF;

  -- §11.2 step 2: replay
  SELECT * INTO v_prior FROM test_answer_submissions
   WHERE test_session_id = p_session_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_prior.section IS DISTINCT FROM p_section THEN v_mismatch := v_mismatch || 'section'::text; END IF;
    IF left(v_prior.module, 1) IS DISTINCT FROM p_module THEN v_mismatch := v_mismatch || 'module'::text; END IF;
    IF v_prior.question_id IS DISTINCT FROM p_question_id THEN v_mismatch := v_mismatch || 'question_id'::text; END IF;
    IF v_prior.ordinal IS DISTINCT FROM p_ordinal THEN v_mismatch := v_mismatch || 'ordinal'::text; END IF;
    IF v_prior.answer IS DISTINCT FROM p_answer THEN v_mismatch := v_mismatch || 'answer'::text; END IF;
    RETURN jsonb_build_object('status', 200,
      'body', v_prior.response_json || jsonb_build_object('idempotent_replay', true),
      'body_mismatch_fields', to_jsonb(v_mismatch),
      'outbox_ids', v_touch->'outbox_ids');
  END IF;

  -- §11.2 step 3: the module must be the active one
  SELECT state INTO v_sec FROM test_session_sections
   WHERE test_session_id = p_session_id AND section = p_section;
  IF (v_touch->>'state') <> 'active'
     OR NOT ((p_module = '1' AND v_sec = 'module1_active') OR (p_module = '2' AND v_sec = 'module2_active')) THEN
    RETURN jsonb_build_object('status', 409, 'error', jsonb_build_object(
      'code', CASE
                WHEN p_module = '1' AND v_sec IN ('module1_submitted', 'module2_active', 'submitted') THEN 'module_submitted'
                WHEN p_module = '2' AND v_sec = 'submitted' THEN 'module_submitted'
                ELSE 'module_not_started' END,
      'message', 'This module is not accepting answers.',
      'section_state', exam_section_state_json(p_session_id, p_section, v_now)),
      'outbox_ids', v_touch->'outbox_ids');
  END IF;
  v_phys := exam_physical_module(p_session_id, p_section, p_module);

  -- §11.2 step 4: the position must be this module's item
  IF NOT EXISTS (
    SELECT 1 FROM test_sessions s
      JOIN test_form_items fi ON fi.test_form_id = s.test_form_id
     WHERE s.id = p_session_id AND fi.section = p_section AND fi.module = v_phys
       AND fi.ordinal = p_ordinal AND fi.question_id = p_question_id) THEN
    RETURN jsonb_build_object('status', 400, 'error', jsonb_build_object(
      'code', 'invalid_question_for_form',
      'message', 'The question does not belong to this position of the active module.'),
      'outbox_ids', v_touch->'outbox_ids');
  END IF;

  -- §11.2 steps 6-8
  v_response := jsonb_build_object(
    'response_schema_version', 'tests-answer-v1',
    'stored', jsonb_build_object('question_id', p_question_id, 'ordinal', p_ordinal,
                                 'answer', p_display_answer, 'submitted_at', v_now),
    'section_state', exam_section_state_json(p_session_id, p_section, v_now),
    'idempotent_replay', false);

  INSERT INTO test_answer_submissions (test_session_id, idempotency_key, section, module, ordinal,
                                       question_id, answer, client_latency_ms, response_json,
                                       response_schema_version, was_canonical_update)
  VALUES (p_session_id, p_idempotency_key, p_section, v_phys, p_ordinal,
          p_question_id, p_answer, p_client_latency_ms, v_response, 'tests-answer-v1', true)
  RETURNING id INTO v_sub_id;

  INSERT INTO test_session_answers (test_session_id, section, module, ordinal, question_id,
                                    answer, client_latency_ms, last_submission_id, updated_at)
  VALUES (p_session_id, p_section, v_phys, p_ordinal, p_question_id,
          p_answer, p_client_latency_ms, v_sub_id, v_now)
  ON CONFLICT (test_session_id, section, module, ordinal) DO UPDATE
     SET question_id = EXCLUDED.question_id,
         answer = EXCLUDED.answer,
         client_latency_ms = EXCLUDED.client_latency_ms,
         last_submission_id = EXCLUDED.last_submission_id,
         updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object('status', 200, 'body', v_response, 'outbox_ids', v_touch->'outbox_ids');
END;
$$;

-- ---------------------------------------------------------------------------
-- POST /api/tests/sessions/:id/sections/:section/modules/:module/submit
-- @spec [Doc-04A_V2.2, §12 steps 1-5, §9.1, §13.1, §4 #3 #6; E6 R1]
-- plain English: Module 1 -> grade once + route + lock (path never
--   returned); Module 2 -> section submitted, completing the session (and
--   writing the outbox row) when it is the second. Already submitted -> 409
--   module_submitted with the section state.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_submit_module(p_student_id uuid, p_session_id uuid,
                                          p_section text, p_module text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_now    timestamptz := clock_timestamp();
  v_touch  jsonb;
  v_sec    text;
  v_outbox uuid;
  v_ids    jsonb;
BEGIN
  v_touch := exam_touch_session(p_student_id, p_session_id, v_now);
  IF (v_touch->>'status')::int <> 200 THEN
    RETURN jsonb_build_object('status', (v_touch->>'status')::int, 'error', jsonb_build_object(
      'code', v_touch->>'code', 'message', 'Session not available.'), 'outbox_ids', v_touch->'outbox_ids');
  END IF;
  v_ids := v_touch->'outbox_ids';

  SELECT state INTO v_sec FROM test_session_sections
   WHERE test_session_id = p_session_id AND section = p_section;

  IF p_module = '1' AND v_sec = 'module1_active' THEN
    PERFORM exam_submit_module1_internal(p_session_id, p_section, 'student', v_now);
  ELSIF p_module = '2' AND v_sec = 'module2_active' THEN
    v_outbox := exam_submit_module2_internal(p_session_id, p_section, 'student', v_now);
    IF v_outbox IS NOT NULL THEN v_ids := v_ids || to_jsonb(v_outbox); END IF;
  ELSE
    RETURN jsonb_build_object('status', 409, 'error', jsonb_build_object(
      'code', CASE
                WHEN p_module = '1' AND v_sec IN ('module1_submitted', 'module2_active', 'submitted') THEN 'module_submitted'
                WHEN p_module = '2' AND v_sec = 'submitted' THEN 'module_submitted'
                ELSE 'module_not_started' END,
      'message', 'This module is not active.',
      'section_state', exam_section_state_json(p_session_id, p_section, v_now)),
      'outbox_ids', v_ids);
  END IF;

  RETURN jsonb_build_object('status', 200, 'body', jsonb_build_object(
    'section_state', exam_section_state_json(p_session_id, p_section, v_now),
    'session_state', (SELECT state FROM test_sessions WHERE id = p_session_id)),
    'outbox_ids', v_ids);
END;
$$;

-- ---------------------------------------------------------------------------
-- POST /api/tests/sessions/:id/sections/:section/heartbeat
-- @spec [Doc-04A_V2.2, §8.3]
-- plain English: folds the pause (lenient) and stamps activity on the
--   section's active module; a section with no active module is a no-op 200.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_heartbeat(p_student_id uuid, p_session_id uuid, p_section text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_now   timestamptz := clock_timestamp();
  v_touch jsonb;
BEGIN
  v_touch := exam_touch_session(p_student_id, p_session_id, v_now);
  IF (v_touch->>'status')::int <> 200 THEN
    RETURN jsonb_build_object('status', (v_touch->>'status')::int, 'error', jsonb_build_object(
      'code', v_touch->>'code', 'message', 'Session not available.'), 'outbox_ids', v_touch->'outbox_ids');
  END IF;
  PERFORM exam_fold_heartbeat(p_session_id, p_section, v_now);
  RETURN jsonb_build_object('status', 200, 'body', jsonb_build_object(
    'section_state', exam_section_state_json(p_session_id, p_section, v_now)),
    'outbox_ids', v_touch->'outbox_ids');
END;
$$;

-- ---------------------------------------------------------------------------
-- Scoring hand-off: score one outbox event, mark it published
-- @spec [Doc-04A_V2.2, §13.3, §5.7 status semantics; Doc-04B_V4.3 §12;
--        E6 R5 / SCL-136]
-- plain English: calls score_test_session_from_outbox (idempotent through
--   its event ledger) and marks the row published. A failure is recorded on
--   the row (attempts, failure_reason; 'failed' after 5 attempts, the §5.7
--   dead letter) and returned, never swallowed; the row stays pending for
--   the sweep to retry. A row another caller already published is left as is.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_score_outbox_event(p_outbox_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_run   uuid;
  v_state text;
  v_msg   text;
BEGIN
  BEGIN
    v_run := score_test_session_from_outbox(p_outbox_event_id);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    UPDATE exam_runtime_outbox
       SET attempts = attempts + 1,
           last_attempt_at = clock_timestamp(),
           failure_reason = left(v_state || ': ' || v_msg, 500),
           status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END
     WHERE id = p_outbox_event_id AND status = 'pending';
    RETURN jsonb_build_object('ok', false, 'sqlstate', v_state);
  END;

  UPDATE exam_runtime_outbox
     SET status = 'published', published_at = clock_timestamp(),
         attempts = attempts + 1, last_attempt_at = clock_timestamp(), failure_reason = NULL
   WHERE id = p_outbox_event_id AND status = 'pending';
  RETURN jsonb_build_object('ok', true, 'score_run_id', v_run);
END;
$$;

-- ---------------------------------------------------------------------------
-- §14.3 — the abandonment sweep + outbox re-drive (the backstop)
-- @spec [Doc-04A_V2.2, §14.3, §18 (per-session atomicity); E6 R5 / SCL-136, R6]
-- plain English: finalises up to p_limit past-grace sessions (FOR UPDATE SKIP
--   LOCKED, each in its own subtransaction so one failure rolls back only
--   that session), then scores up to p_limit pending outbox rows. Returns
--   counts. Scheduled by pg_cron every 5 minutes (owner-run binding).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_abandonment_sweep(p_limit int DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_row       record;
  v_finalized int := 0;
  v_failed    int := 0;
  v_scored    int := 0;
  v_unscored  int := 0;
  v_res       jsonb;
  v_state     text;
BEGIN
  FOR v_row IN
    SELECT id FROM test_sessions
     WHERE state IN ('created', 'active', 'section_break')
       AND clock_timestamp() > grace_expires_at
     ORDER BY grace_expires_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM exam_advance_session(v_row.id, clock_timestamp());
      v_finalized := v_finalized + 1;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      RAISE WARNING 'exam_abandonment_sweep: session % not finalised (sqlstate %)', v_row.id, v_state;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  FOR v_row IN
    SELECT id FROM exam_runtime_outbox
     WHERE status = 'pending'
     ORDER BY created_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    v_res := exam_score_outbox_event(v_row.id);
    IF (v_res->>'ok')::boolean THEN v_scored := v_scored + 1; ELSE v_unscored := v_unscored + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('finalized', v_finalized, 'finalize_failed', v_failed,
                            'scored', v_scored, 'score_failed', v_unscored);
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: every function above is server-only.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.exam_runtime_setting(text)',
    'public.exam_ms(interval)',
    'public.exam_module_duration_ms(uuid, text, text)',
    'public.exam_physical_module(uuid, text, text)',
    'public.exam_remaining_ms(uuid, text, timestamptz)',
    'public.exam_fold_heartbeat(uuid, text, timestamptz)',
    'public.exam_grade_module1(uuid, text)',
    'public.exam_start_module_internal(uuid, text, text, timestamptz)',
    'public.exam_submit_module1_internal(uuid, text, text, timestamptz)',
    'public.exam_outbox_payload(uuid, text)',
    'public.exam_submit_module2_internal(uuid, text, text, timestamptz)',
    'public.exam_finalize_session(uuid, timestamptz)',
    'public.exam_advance_session(uuid, timestamptz)',
    'public.exam_touch_session(uuid, uuid, timestamptz)',
    'public.exam_section_state_json(uuid, text, timestamptz)',
    'public.exam_session_body(uuid, timestamptz)',
    'public.exam_create_session(uuid, uuid, text)',
    'public.exam_session_state(uuid, uuid)',
    'public.exam_start_module(uuid, uuid, text, text)',
    'public.exam_module_items(uuid, uuid, text, text)',
    'public.exam_record_item_options(uuid, uuid, text, text, jsonb)',
    'public.exam_answer_option_map(uuid, uuid, text, text, int)',
    'public.exam_submit_answer(uuid, uuid, text, text, int, text, text, text, int, text)',
    'public.exam_submit_module(uuid, uuid, text, text)',
    'public.exam_heartbeat(uuid, uuid, text)',
    'public.exam_score_outbox_event(uuid)',
    'public.exam_abandonment_sweep(int)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$$;

COMMIT;
