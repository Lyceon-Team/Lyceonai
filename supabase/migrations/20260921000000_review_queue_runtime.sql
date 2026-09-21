-- ============================================================================
-- R2 — Review Vertical: the queue, the session mirror, and the only DB logic
-- ============================================================================
-- @spec [Ruled plan 2026-09-21 §2 (every difference from practice) and §3
--        rulings 2,3,4,5,7,8,12,13,14,19,21]
--       [Doc-02B_V4 §16 review engine — amended by §5 of the ruled plan:
--        skips DO enter review, oldest-first, one row per miss or skip]
--       [Doc-05F_V1.0 §9.3 — the calendar's due-by-date input reads queued_at]
-- @implemented [2026-09-21]
--
-- plain English: review is practice with a different pool. This migration makes
--   that true at the database layer. review_schedule stops being an unfed SM-2
--   table and becomes the mistake queue: one row per miss or skip, at most one
--   open per (student, question). review_sessions and review_session_items grow
--   the columns practice already has, so R3 can copy practice's routes rather
--   than invent review ones. Two triggers do the only logic: a practice item
--   resolving to wrong-or-skipped enqueues it, and a review item resolving
--   writes the attempt and moves the queue — both inside the caller's CAS
--   UPDATE, so the answer and the queue commit together or not at all.
--
-- expected outcome: after this migration a wrong practice answer leaves exactly
--   one active queue entry; answering it correctly in review graduates it;
--   answering it wrong or skipping it supersedes that entry and opens a new one
--   at the back of the line. The calendar's review_due_by_date starts returning
--   real dates because something finally writes the queue.
--
-- trade-offs: the queue stores no question metadata (ruling 19). Content comes
--   from the servable_questions join at prefill, as practice does, so a retired
--   or issue-flagged question cannot be served from a stale copy. The cost is a
--   join R3 must not forget; the alternative is a snapshot that goes stale and
--   re-serves a question the bank has withdrawn.
--
-- edge cases: no catch-all exception handlers anywhere below. Every error path
--   is made unreachable by a guard and proven so by a gate. The OLD.status
--   clause on both triggers is what stops anonymization — which UPDATEs already
--   resolved rows — from re-firing them (G10).
--
-- OWNER-RUN: applied through the tracked pipeline (`supabase db push`); agents
--   hold no service_role. Genesis-extending; genesis-fresh-apply covers it.
--   NOT APPLIED TO PROD BY THIS CHANGE.
--
-- ROLLBACK (INV-06): transactional (BEGIN/COMMIT). Revert is NOT a plain DROP:
--   this migration renames and drops columns on three live tables. Reverting
--   means restoring review_schedule's SM-2 columns (repetition_count,
--   interval_days, ease_factor, first_missed_session_id), renaming queued_at
--   back to next_review_at, restoring review_sessions.source_origin and
--   review_session_items.retry_mode, dropping the columns added here, dropping
--   both triggers, the three functions and the view, and reverting
--   calendar_build_plan_input to its calendar_v1 body. All three tables are
--   empty of real rows at apply time (review_schedule 0, review_session_items 0,
--   review_sessions 1 junk row deleted below), so no forward data is lost.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed —
--   DROP TRIGGER trg_practice_item_enqueue_review ON public.practice_session_items
--   DROP TRIGGER trg_review_item_resolve ON public.review_session_items
--   DROP FUNCTION public.review_queue_record, public.review_queue_graduate,
--     public.practice_item_enqueue_review, public.review_item_resolve
--   DROP VIEW public.review_question_history
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: review_sessions carries one junk row from the dead runtime.
--    Delete it, but only after proving it owns no items. If it does, this
--    migration must not proceed: that would be real student work.
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  v_junk  integer;
  v_items integer;
BEGIN
  SELECT count(*) INTO v_junk FROM public.review_sessions;

  SELECT count(*) INTO v_items
  FROM public.review_session_items i
  JOIN public.review_sessions s ON s.id = i.session_id;

  IF v_items > 0 THEN
    RAISE EXCEPTION
      'R2 pre-flight: review_sessions rows own % item(s); refusing to delete. Investigate before re-running.',
      v_items;
  END IF;

  DELETE FROM public.review_sessions;
  RAISE NOTICE 'R2 pre-flight: deleted % junk review_sessions row(s), 0 items.', v_junk;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1. review_schedule — the mistake queue (plan §1, rulings 12/14/19)
-- ---------------------------------------------------------------------------

-- 1.1 Ruling 14: next_review_at becomes queued_at; the SM-2 columns go.
--     SM-2 was never written (no writer ever existed), so nothing is lost.
ALTER TABLE public.review_schedule RENAME COLUMN next_review_at TO queued_at;
ALTER TABLE public.review_schedule ALTER COLUMN queued_at SET NOT NULL;

ALTER TABLE public.review_schedule
  DROP COLUMN repetition_count,
  DROP COLUMN interval_days,
  DROP COLUMN ease_factor,
  DROP COLUMN first_missed_session_id;

-- 1.2 Provenance: where the entry came from. source_session_id has no FK
--     because it is polymorphic across engines (practice today, full_length
--     when the exam vertical lands, review for a requeue) — ruling 6.
ALTER TABLE public.review_schedule
  ADD COLUMN source_engine     text NOT NULL,
  ADD COLUMN source_session_id uuid NOT NULL,
  ADD COLUMN source_item_id    uuid NOT NULL,
  ADD COLUMN source_outcome    text NOT NULL,
  ADD COLUMN closed_at         timestamptz,
  ADD COLUMN closed_by_item_id uuid;

ALTER TABLE public.review_schedule
  ADD CONSTRAINT review_schedule_source_engine_check
    CHECK (source_engine IN ('practice','full_length','review')),
  ADD CONSTRAINT review_schedule_source_outcome_check
    CHECK (source_outcome IN ('incorrect','skipped'));

-- 1.3 Lifecycle. 'superseded' is new (ruling 12): a fresh miss closes the old
--     entry rather than mutating it, so the history stays one row per event.
ALTER TABLE public.review_schedule DROP CONSTRAINT review_schedule_status_check;
ALTER TABLE public.review_schedule
  ADD CONSTRAINT review_schedule_status_check
    CHECK (status IN ('active','graduated','superseded','retired'));

-- An entry is open exactly when it has no close time. Stated as an equivalence
-- so neither half can drift from the other.
ALTER TABLE public.review_schedule
  ADD CONSTRAINT review_schedule_closed_iff_not_active
    CHECK ((status = 'active') = (closed_at IS NULL));

-- 1.4 Ruling 12: at most one OPEN entry per question, many closed ones.
--     The old unconditional UNIQUE would have allowed only one row ever.
ALTER TABLE public.review_schedule
  DROP CONSTRAINT uq_review_schedule_profile_question;

CREATE UNIQUE INDEX uq_review_schedule_open_question
  ON public.review_schedule (student_id, question_id) WHERE status = 'active';

-- The writer's idempotency key: one source item can enqueue at most once.
ALTER TABLE public.review_schedule
  ADD CONSTRAINT uq_review_schedule_source_item UNIQUE (source_engine, source_item_id);

-- 1.5 Indexes. The due index follows the renamed column; the session index
--     serves the 'session' pool mode (plan §2 row 2).
DROP INDEX idx_review_schedule_due;
CREATE INDEX idx_review_schedule_due
  ON public.review_schedule (student_id, queued_at) WHERE status = 'active';
CREATE INDEX idx_review_schedule_source_session
  ON public.review_schedule (student_id, source_engine, source_session_id);

-- 1.6 The repo said NO ACTION; production has ON DELETE CASCADE
--     (confdeltype='c'). Align the repo to production. No-op in production.
ALTER TABLE public.review_schedule DROP CONSTRAINT review_schedule_student_id_fkey;
ALTER TABLE public.review_schedule
  ADD CONSTRAINT review_schedule_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- 1.7 Grants. review_schedule is granted table-level to authenticated already,
--     so the new columns are covered. None of them is answer-bearing.

-- ---------------------------------------------------------------------------
-- 2. review_sessions — mirror practice_sessions (plan §2: review is practice
--    with a different pool, so the envelope is practice's envelope)
-- ---------------------------------------------------------------------------

-- 2.1 source_origin conflated "which engine produced the miss" with "what this
--     session is". The former now lives on the queue entry (source_engine); the
--     latter is `mode`. Doc 05F §9.3 is amended to stop sending it.
ALTER TABLE public.review_sessions DROP CONSTRAINT review_sessions_source_origin_check;
ALTER TABLE public.review_sessions DROP COLUMN source_origin;

-- 2.2 The practice envelope, column for column. Only the `mode` value-set
--     differs (plan §2 row 2): review's pools are queue / session / filter.
--     Idempotency mirrors practice too: the caller's key is carried inside
--     `filters` as session_start_idempotency_key (practice-canonical.ts:1501),
--     with no dedicated column and no unique constraint — owner ruling
--     2026-09-21, and the plan §2 default that anything not listed there is
--     copied from practice unchanged.
ALTER TABLE public.review_sessions
  ADD COLUMN mode             text NOT NULL DEFAULT 'queue',
  ADD COLUMN filters          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN target_count     integer NOT NULL DEFAULT 1,
  ADD COLUMN platform         text NOT NULL DEFAULT 'web',
  ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN completed_at     timestamptz,
  ADD COLUMN abandoned_at     timestamptz;

-- The defaults above exist only so the ADD succeeds on a non-empty table; the
-- table is empty here, and R3 always supplies these explicitly. Practice
-- carries no defaults on mode/target_count/platform, so neither does review.
ALTER TABLE public.review_sessions
  ALTER COLUMN mode         DROP DEFAULT,
  ALTER COLUMN target_count DROP DEFAULT,
  ALTER COLUMN platform     DROP DEFAULT;

ALTER TABLE public.review_sessions
  ADD CONSTRAINT review_sessions_mode_check
    CHECK (mode IN ('queue','session','filter')),
  ADD CONSTRAINT review_sessions_platform_check
    CHECK (platform IN ('web','mobile')),
  ADD CONSTRAINT review_sessions_target_count_check
    CHECK (target_count > 0);

-- 2.3 Practice's lifecycle: 'created' exists and is the default.
ALTER TABLE public.review_sessions DROP CONSTRAINT review_sessions_status_check;
ALTER TABLE public.review_sessions
  ADD CONSTRAINT review_sessions_status_check
    CHECK (status IN ('created','active','completed','abandoned'));
ALTER TABLE public.review_sessions ALTER COLUMN status SET DEFAULT 'created';

-- 2.4 The practice_sessions_abandoned_not_completed analogue. Stamping
--     completed_at on abandonment makes abandoned work read as finished work
--     to anything that inspects the column (migration 20260817020000).
ALTER TABLE public.review_sessions
  ADD CONSTRAINT review_sessions_abandoned_not_completed
    CHECK ((status <> 'abandoned') OR (completed_at IS NULL AND abandoned_at IS NOT NULL));

-- 2.5 Practice's two indexes, on the review owner column.
CREATE INDEX idx_review_sessions_active
  ON public.review_sessions (student_id) WHERE status = 'active';
-- idx_review_sessions_student (student_id, created_at DESC) already exists and
-- matches idx_practice_sessions_user.

-- ---------------------------------------------------------------------------
-- 3. review_session_items — mirror practice_session_items
-- ---------------------------------------------------------------------------

-- 3.1 The answer, shuffle and item-shape columns practice already has. Types,
--     nullability and defaults copied from practice exactly.
ALTER TABLE public.review_session_items
  ADD COLUMN selected_answer                 text,
  ADD COLUMN is_correct                      boolean,
  ADD COLUMN outcome                         text,
  ADD COLUMN time_spent_ms                   integer,
  ADD COLUMN client_attempt_id               text,
  ADD COLUMN occurred_at                     timestamptz,
  ADD COLUMN option_order                    text[],
  ADD COLUMN option_token_map                jsonb,
  ADD COLUMN client_instance_id              text,
  ADD COLUMN question_item_type              text NOT NULL DEFAULT 'mcq',
  ADD COLUMN question_correct_variants       text[],
  ADD COLUMN question_assets                 jsonb,
  ADD COLUMN question_estimated_time_seconds integer;

-- 3.2 The link back to the queue entry this item is working off.
--     MANDATORY ON DELETE SET NULL: account deletion Layer 1 hard-deletes
--     review_schedule in BOTH modes (20260917000000:612) while anonymize mode
--     keeps items with identity nulled (:753). Anything stricter makes the
--     anonymize path throw for every student who ever did review (G15).
ALTER TABLE public.review_session_items
  ADD COLUMN queue_entry_id uuid REFERENCES public.review_schedule(id) ON DELETE SET NULL;

-- 3.3 retry_mode was the same_question/similar_question slot of the old design.
--     Review always replays the original item, so the column has one value and
--     no reader.
ALTER TABLE public.review_session_items DROP CONSTRAINT review_session_items_retry_mode_check;
ALTER TABLE public.review_session_items DROP COLUMN retry_mode;

-- 3.4 Practice calls the pre-serve state 'pending'; review called it 'queued'.
--     Same state, and 'queued' now means something else entirely (the mistake
--     queue), so the collision is worth removing.
ALTER TABLE public.review_session_items DROP CONSTRAINT review_session_items_status_check;
UPDATE public.review_session_items SET status = 'pending' WHERE status = 'queued';
ALTER TABLE public.review_session_items
  ADD CONSTRAINT review_session_items_status_check
    CHECK (status IN ('pending','served','answered','skipped'));
ALTER TABLE public.review_session_items ALTER COLUMN status SET DEFAULT 'pending';

-- 3.5 Practice's remaining CHECKs, copied verbatim with the review prefix.
ALTER TABLE public.review_session_items
  ADD CONSTRAINT review_session_items_outcome_check
    CHECK ((outcome IS NULL) OR (outcome IN ('correct','incorrect','skipped'))),
  ADD CONSTRAINT review_session_items_question_item_type_check
    CHECK (question_item_type IN ('mcq','grid_in')),
  ADD CONSTRAINT rsi_item_shape_chk
    CHECK (((question_item_type = 'mcq'  AND question_correct_variants IS NULL)
         OR (question_item_type = 'grid_in'
             AND question_correct_variants IS NOT NULL
             AND array_length(question_correct_variants, 1) >= 1
             AND question_options = '[]'::jsonb))),
  ADD CONSTRAINT rsi_resolved_requires_occurred_at
    CHECK ((status <> ALL (ARRAY['answered','skipped'])) OR (occurred_at IS NOT NULL)),
  ADD CONSTRAINT rsi_question_domain_section_canonical
    CHECK (((question_section = 'M'
             AND question_domain IN ('Algebra','Advanced Math',
                                     'Problem Solving and Data Analysis',
                                     'Geometry and Trigonometry'))
         OR (question_section = 'RW'
             AND question_domain IN ('Information and Ideas','Craft and Structure',
                                     'Expression of Ideas',
                                     'Standard English Conventions'))));

-- 3.6 Practice's idempotency index, on the review owner column.
--     idx_review_items_session (session_id, ordinal) already mirrors
--     idx_practice_items_session.
CREATE UNIQUE INDEX uq_review_items_idem
  ON public.review_session_items (student_id, client_attempt_id)
  WHERE client_attempt_id IS NOT NULL;

-- 3.7 Grants. Column-level, mirroring practice's granted set with user_id
--     mapped to student_id, plus created_at and queue_entry_id.
--     NEVER granted: question_correct_answer, question_explanation,
--     question_option_metadata, question_correct_variants, option_token_map —
--     the reveal-matrix columns (Doc 02B §20). Practice grants none of
--     option_order, question_item_type or question_assets, so neither does
--     review. The dropped retry_mode took its own grant with it.
GRANT SELECT (
  selected_answer, is_correct, outcome, time_spent_ms,
  client_attempt_id, occurred_at, queue_entry_id
) ON public.review_session_items TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. The only database logic: two queue functions and two triggers.
--    SECURITY DEFINER with a pinned search_path; EXECUTE revoked from PUBLIC,
--    anon and authenticated (G13). No catch-all exception handlers anywhere:
--    a guard makes each error path unreachable, and a gate proves it.
-- ---------------------------------------------------------------------------

-- 4.1 review_queue_record — the ONLY writer of new queue entries.
--     Used by the practice trigger, the review trigger, the backfill below, and
--     the exam vertical when it lands (ruling 6: no stub code, it just calls
--     this). Idempotent on (source_engine, source_item_id).
CREATE OR REPLACE FUNCTION public.review_queue_record(
  p_student_id        uuid,
  p_question_id       text,
  p_source_engine     text,
  p_source_session_id uuid,
  p_source_item_id    uuid,
  p_source_outcome    text,
  p_at                timestamptz
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_existing uuid;
  v_new      uuid;
BEGIN
  -- The lock is taken BEFORE any read of the state it protects. Two concurrent
  -- misses on one question must not both see "no active entry" and both insert
  -- (G6). Transaction-scoped: released at commit, so the caller's CAS owns it.
  PERFORM pg_advisory_xact_lock(hashtext(p_student_id::text), hashtext(p_question_id));

  -- Replay: this exact source item already enqueued. Returning the existing row
  -- rather than raising is what makes the backfill re-runnable (§4) and makes a
  -- retried CAS harmless (G4).
  SELECT id INTO v_existing
  FROM public.review_schedule
  WHERE source_engine = p_source_engine AND source_item_id = p_source_item_id;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Ruling 12: a new miss supersedes the question's open entry rather than
  -- mutating it, so the queue keeps one row per event. closed_by_item_id is the
  -- review item that closed it, which only exists when review is the source —
  -- a practice miss closes the entry but is not a review item.
  UPDATE public.review_schedule
     SET status            = 'superseded',
         closed_at         = p_at,
         closed_by_item_id = CASE WHEN p_source_engine = 'review' THEN p_source_item_id END,
         updated_at        = p_at
   WHERE student_id = p_student_id
     AND question_id = p_question_id
     AND status = 'active';

  INSERT INTO public.review_schedule (
    student_id, question_id, status, queued_at,
    source_engine, source_session_id, source_item_id, source_outcome,
    created_at, updated_at
  ) VALUES (
    p_student_id, p_question_id, 'active', p_at,
    p_source_engine, p_source_session_id, p_source_item_id, p_source_outcome,
    p_at, p_at
  )
  RETURNING id INTO v_new;

  RETURN v_new;
END
$$;

COMMENT ON FUNCTION public.review_queue_record(uuid, text, text, uuid, uuid, text, timestamptz) IS
  'Ruled plan §3 ruling 12. The only writer of review_schedule entries. Takes the '
  '(student, question) advisory lock before reading, replays on '
  '(source_engine, source_item_id), supersedes the open entry, inserts the new one.';

-- 4.2 review_queue_graduate — ruling 4: one correct review answer graduates.
CREATE OR REPLACE FUNCTION public.review_queue_graduate(
  p_student_id     uuid,
  p_question_id    text,
  p_review_item_id uuid,
  p_at             timestamptz
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_student_id::text), hashtext(p_question_id));

  UPDATE public.review_schedule
     SET status            = 'graduated',
         closed_at         = p_at,
         closed_by_item_id = p_review_item_id,
         updated_at        = p_at
   WHERE student_id = p_student_id
     AND question_id = p_question_id
     AND status = 'active'
  RETURNING id INTO v_id;

  -- No active entry is a normal outcome, not an error: the question may have
  -- graduated in another open session (plan §6, "the same question in two open
  -- sessions"). Returning NULL says "nothing to close" without raising.
  RETURN v_id;
END
$$;

COMMENT ON FUNCTION public.review_queue_graduate(uuid, text, uuid, timestamptz) IS
  'Ruled plan §3 ruling 4. Closes the question''s open queue entry as graduated. '
  'Returns NULL when there is none — the question graduated elsewhere first.';

-- 4.3 Trigger on practice_session_items (ruling 3): the practice writer,
--     atomic with practice's CAS UPDATE.
CREATE OR REPLACE FUNCTION public.practice_item_enqueue_review()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_outcome text;
BEGIN
  -- An anonymized item has no owner to queue for. Practice's anonymize path
  -- UPDATEs user_id to NULL on already-resolved rows (20260917000000:732), so
  -- this is reached on exactly that path and must write nothing (G10).
  IF NEW.user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Ruling 2: misses AND skips enter the queue. Ruling 13: a correct answer
  -- never touches it.
  IF NEW.status = 'answered' AND NEW.is_correct = false THEN
    v_outcome := 'incorrect';
  ELSIF NEW.status = 'skipped' THEN
    v_outcome := 'skipped';
  ELSE
    RETURN NULL;
  END IF;

  -- occurred_at, not answered_at: psi_resolved_requires_occurred_at guarantees
  -- the former on every resolved row, and nothing guarantees the latter.
  PERFORM public.review_queue_record(
    NEW.user_id, NEW.question_id, 'practice',
    NEW.session_id, NEW.id, v_outcome, NEW.occurred_at
  );

  RETURN NULL;
END
$$;

-- The OLD.status clause is the whole reason anonymization cannot re-fire this.
-- Anonymize UPDATEs resolved rows without touching status, so OLD.status is
-- already terminal and the trigger never runs (G10). Without it, every
-- anonymized student would re-enqueue their entire history.
CREATE TRIGGER trg_practice_item_enqueue_review
  AFTER UPDATE ON public.practice_session_items
  FOR EACH ROW
  WHEN (OLD.status NOT IN ('answered','skipped')
        AND (NEW.status = 'skipped'
             OR (NEW.status = 'answered' AND NEW.is_correct = false)))
  EXECUTE FUNCTION public.practice_item_enqueue_review();

-- 4.4 Trigger on review_session_items: writes the attempt and moves the queue,
--     inside the caller's CAS UPDATE. The answer, the attempt and the queue
--     move commit together or not at all.
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
      false,                      -- ruling 9: LISA is out at launch
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

CREATE TRIGGER trg_review_item_resolve
  AFTER UPDATE ON public.review_session_items
  FOR EACH ROW
  WHEN (OLD.status NOT IN ('answered','skipped')
        AND NEW.status IN ('answered','skipped'))
  EXECUTE FUNCTION public.review_item_resolve();

-- 4.5 Nobody but service_role calls these.
REVOKE EXECUTE ON FUNCTION
  public.review_queue_record(uuid, text, text, uuid, uuid, text, timestamptz),
  public.review_queue_graduate(uuid, text, uuid, timestamptz),
  public.practice_item_enqueue_review(),
  public.review_item_resolve()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. review_question_history — the ML read surface (ruling 21).
--    security_invoker so it carries the caller's privileges rather than the
--    view owner's; granted to service_role only, never to authenticated.
--    Stores nothing: every column is derived at read time.
-- ---------------------------------------------------------------------------
CREATE VIEW public.review_question_history WITH (security_invoker = true) AS
SELECT
  q.student_id,
  q.question_id,
  count(*)::integer                                                        AS entry_count,
  count(*) FILTER (WHERE q.source_engine = 'practice')::integer            AS entries_from_practice,
  count(*) FILTER (WHERE q.source_engine = 'review')::integer              AS entries_from_review,
  count(*) FILTER (WHERE q.source_engine = 'full_length')::integer         AS entries_from_full_length,
  count(*) FILTER (WHERE q.source_outcome = 'incorrect')::integer          AS entries_incorrect,
  count(*) FILTER (WHERE q.source_outcome = 'skipped')::integer            AS entries_skipped,
  min(q.queued_at)                                                         AS first_queued_at,
  max(q.queued_at)                                                         AS last_queued_at,
  COALESCE(a.review_attempts, 0)                                           AS review_attempts,
  COALESCE(a.review_fails, 0)                                              AS review_fails,
  max(q.status) FILTER (WHERE q.status = 'active')                         AS open_status,
  max(q.closed_at) FILTER (WHERE q.status = 'graduated')                   AS graduated_at
FROM public.review_schedule q
LEFT JOIN LATERAL (
  SELECT count(*)::integer                                    AS review_attempts,
         count(*) FILTER (WHERE ra.is_correct = false)::integer AS review_fails
  FROM public.review_error_attempts ra
  WHERE ra.student_id = q.student_id AND ra.question_id = q.question_id
) a ON true
GROUP BY q.student_id, q.question_id, a.review_attempts, a.review_fails;

COMMENT ON VIEW public.review_question_history IS
  'Ruled plan §3 ruling 21. One row per (student, question) present in the queue: '
  'entry counts by engine and outcome, first/last queued_at, review attempt and '
  'fail counts, whether an entry is currently open, and the graduation time. '
  'Derived only; stores nothing. service_role only.';

REVOKE ALL ON public.review_question_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.review_question_history TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Backfill (ruling 5). Every existing practice miss and skip replayed
--    through review_queue_record — never inserted directly, so the backfill is
--    itself a test of the writer. Ordered by occurred_at then id so the
--    supersede chain is deterministic and the surviving active entry is the
--    student's most recent miss on that question.
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  r              record;
  v_replayed     integer := 0;
  v_excluded     integer;
  v_entries      integer;
  v_active       integer;
  v_superseded   integer;
  v_pairs        integer;
BEGIN
  SELECT count(*) INTO v_excluded
  FROM public.practice_session_items
  WHERE user_id IS NULL
    AND (status = 'skipped' OR (status = 'answered' AND is_correct = false));

  FOR r IN
    SELECT id, user_id, question_id, session_id, occurred_at,
           CASE WHEN status = 'skipped' THEN 'skipped' ELSE 'incorrect' END AS outcome
    FROM public.practice_session_items
    WHERE user_id IS NOT NULL
      AND (status = 'skipped' OR (status = 'answered' AND is_correct = false))
    ORDER BY occurred_at, id
  LOOP
    PERFORM public.review_queue_record(
      r.user_id, r.question_id, 'practice',
      r.session_id, r.id, r.outcome, r.occurred_at);
    v_replayed := v_replayed + 1;
  END LOOP;

  SELECT count(*) INTO v_entries    FROM public.review_schedule;
  SELECT count(*) INTO v_active     FROM public.review_schedule WHERE status = 'active';
  SELECT count(*) INTO v_superseded FROM public.review_schedule WHERE status = 'superseded';

  SELECT count(*) INTO v_pairs FROM (
    SELECT DISTINCT user_id, question_id
    FROM public.practice_session_items
    WHERE user_id IS NOT NULL
      AND (status = 'skipped' OR (status = 'answered' AND is_correct = false))
  ) p;

  RAISE NOTICE 'R2 BACKFILL: rows replayed         = %', v_replayed;
  RAISE NOTICE 'R2 BACKFILL: rows excluded (NULL user_id) = %', v_excluded;
  RAISE NOTICE 'R2 BACKFILL: entries created       = % (must equal rows replayed)', v_entries;
  RAISE NOTICE 'R2 BACKFILL: active entries        = % (must equal distinct pairs = %)', v_active, v_pairs;
  RAISE NOTICE 'R2 BACKFILL: superseded entries    = % (must equal % - %)', v_superseded, v_entries, v_active;

  IF v_entries <> v_replayed THEN
    RAISE EXCEPTION 'R2 BACKFILL: entries created (%) <> rows replayed (%)', v_entries, v_replayed;
  END IF;
  IF v_active <> v_pairs THEN
    RAISE EXCEPTION 'R2 BACKFILL: active entries (%) <> distinct (user, question) pairs (%)', v_active, v_pairs;
  END IF;
  IF v_superseded <> v_entries - v_active THEN
    RAISE EXCEPTION 'R2 BACKFILL: superseded (%) <> entries (%) - active (%)', v_superseded, v_entries, v_active;
  END IF;
END
$backfill$;

-- ---------------------------------------------------------------------------
-- 7. Calendar (agreed with the calendar team, ruling 14).
--    calendar_build_plan_input reads review_schedule for review_due_by_date.
--    BOTH references to the renamed column change, in THIS migration:
--    PL/pgSQL resolves column names only when the function runs, so shipping
--    one line without the other passes every gate and then fails at plan
--    generation for every student.
--    Re-declared verbatim from 20260917130000_calendar_v1.sql:1975-2142 with
--    next_review_at -> queued_at on its two lines and nothing else changed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_build_plan_input(p_student_id uuid, p_dates date[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_profile   record;
  v_constants jsonb;
  v_today     date;
  v_window    integer;
  v_practice  integer;
  v_review    integer;
  v_horizon_lo date;
  v_horizon_hi date;
  v_degraded  jsonb := '[]'::jsonb;
  v_mastery   jsonb;
BEGIN
  SELECT * INTO v_profile FROM public.student_study_profile WHERE student_id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_build_plan_input: student % has no study profile', p_student_id
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_object_agg(key, value) INTO v_constants FROM public.calendar_runtime_config;
  IF v_constants IS NULL THEN
    RAISE EXCEPTION 'calendar_runtime_config: no rows; the calendar cannot generate without constants'
      USING ERRCODE = '22023';
  END IF;

  -- §8.2 local dates: every date in a plan is the student’s local date, and the
  -- profile’s timezone is what makes "today" mean anything.
  v_today  := (now() AT TIME ZONE v_profile.timezone)::date;
  v_window := public.calendar_require_int(v_constants, 'recent_planned_window_days');
  v_review := public.calendar_require_int(v_constants, 'review_estimated_seconds_per_item');

  -- Doc 02B §41 owns practice timing. It is referenced, never restated (§20 audit rule).
  SELECT public.calendar_require_int(jsonb_build_object('target_seconds_per_question', value),
                                     'target_seconds_per_question')
    INTO v_practice
  FROM public.practice_runtime_config WHERE key = 'target_seconds_per_question';
  IF v_practice IS NULL THEN
    RAISE EXCEPTION 'practice_runtime_config: missing or invalid key ''target_seconds_per_question'''
      USING ERRCODE = '22023';
  END IF;

  v_horizon_lo := COALESCE((SELECT min(d) FROM unnest(p_dates) d), v_today);
  v_horizon_hi := COALESCE((SELECT max(d) FROM unnest(p_dates) d), v_today);

  -- Mastery, in canonical order, one row per domain. A student with no rows is
  -- COLD START, not degraded: all eight unknown is a state the formula has a
  -- branch for (sheet §2 step 3), and calling it degraded would push every new
  -- student onto fallback_v1 for being new.
  SELECT jsonb_agg(jsonb_build_object(
           'section', CASE WHEN d.domain IN ('Algebra','Advanced Math',
                                             'Problem Solving and Data Analysis',
                                             'Geometry and Trigonometry') THEN 'M' ELSE 'RW' END,
           'domain', d.domain,
           'mastery_level', m.mastery_level) ORDER BY d.ord)
    INTO v_mastery
  FROM jsonb_array_elements_text(v_constants -> 'canonical_domain_order')
       WITH ORDINALITY AS d(domain, ord)
  LEFT JOIN public.student_domain_mastery m
    ON m.student_id = p_student_id AND m.domain = d.domain;

  -- The exams seam has no table yet: full-length is a rebuild vertical and its
  -- adapter ships as a fail-open stub (G-08-02, sheet §8 item 12). Recording it
  -- in degraded[] is the honest form — the alternative is a snapshot that claims
  -- the student has never sat an exam, which is a different statement.
  v_degraded := v_degraded || '"exams"'::jsonb;

  RETURN jsonb_build_object(
    'student_id', p_student_id,
    'today', v_today::text,
    'generated_for', jsonb_build_object(
      'dates', COALESCE((SELECT jsonb_agg(d::text ORDER BY d) FROM unnest(p_dates) d), '[]'::jsonb)),

    'profile', jsonb_build_object(
      'timezone', v_profile.timezone,
      'target_exam_date', v_profile.target_exam_date::text,
      'target_score', v_profile.target_score,
      'study_days_mask', v_profile.study_days_mask,
      'daily_minutes', v_profile.daily_minutes,
      'full_length_weekday', v_profile.full_length_weekday,
      'planner_mode', v_profile.planner_mode,
      'setup_date', COALESCE(
        (v_profile.setup_completed_at AT TIME ZONE v_profile.timezone)::date,
        (v_profile.created_at AT TIME ZONE v_profile.timezone)::date)::text),

    'mastery', COALESCE(v_mastery, '[]'::jsonb),

    -- Anything already overdue folds onto today rather than being lost: the
    -- generator walks the horizon forward and never looks behind its first date.
    'review_due_by_date', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', q.d::text, 'due_count', q.n) ORDER BY q.d)
      FROM (
        SELECT greatest((r.queued_at AT TIME ZONE v_profile.timezone)::date, v_today) AS d,
               count(*)::integer AS n
        FROM public.review_schedule r
        WHERE r.student_id = p_student_id
          AND r.status = 'active'
          AND (r.queued_at AT TIME ZONE v_profile.timezone)::date <= v_horizon_hi
        GROUP BY 1
      ) q), '[]'::jsonb),

    'exams', jsonb_build_object(
      'last_completed_local_date', NULL,
      'days_since_exam', NULL,
      'missed_count', NULL,
      'reviewed', NULL,
      'weak_domains', '[]'::jsonb),

    -- The deficit rule measures a domain against what it has had over the
    -- window plus today (sheet §2 step 5). Only domain-level practice blocks
    -- can be attributed. A cold-start section block names no domain, and
    -- guessing how to split it would be inventing history.
    'recent_planned_by_domain', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('domain', q.domain, 'count', q.n) ORDER BY q.domain)
      FROM (
        SELECT e ->> 'domain' AS domain, sum((e ->> 'count')::integer)::integer AS n
        FROM public.calendar_current_plan cp
        JOIN public.calendar_blocks b ON b.block_id = cp.block_id
        CROSS JOIN LATERAL jsonb_array_elements(b.scope -> 'mix') e
        WHERE cp.student_id = p_student_id
          AND b.block_type = 'practice'
          AND b.scope ->> 'level' = 'domain'
          AND cp.scheduled_date >= v_today - v_window
          AND cp.scheduled_date < v_today
        GROUP BY 1
      ) q), '[]'::jsonb),

    -- §12.2 protected state, and the inputs V-12/V-13/V-14 are checked against.
    'started_blocks_by_date', COALESCE((
      SELECT jsonb_agg(DISTINCT jsonb_build_object(
               'scheduled_date', b.scheduled_date::text, 'block_id', b.block_id::text))
      FROM public.calendar_blocks b
      WHERE b.student_id = p_student_id
        AND b.scheduled_date BETWEEN v_horizon_lo AND v_horizon_hi
        AND EXISTS (SELECT 1 FROM public.calendar_block_launches l WHERE l.block_id = b.block_id)
      ), '[]'::jsonb),

    'existing_blocks_by_date', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'scheduled_date', b.scheduled_date::text, 'block_id', b.block_id::text))
      FROM public.calendar_blocks b
      WHERE b.student_id = p_student_id
        AND b.scheduled_date BETWEEN v_horizon_lo AND v_horizon_hi
      ), '[]'::jsonb),

    'current_overrides', COALESCE((
      SELECT jsonb_agg(DISTINCT jsonb_build_object(
               'scheduled_date', cp.scheduled_date::text, 'is_user_override', cp.is_user_override))
      FROM public.calendar_current_plan cp
      WHERE cp.student_id = p_student_id
        AND cp.scheduled_date BETWEEN v_horizon_lo AND v_horizon_hi
      ), '[]'::jsonb),

    'enabled_block_types', v_constants -> 'enabled_block_types',

    'engine_planning', jsonb_build_object(
      'practice_seconds_per_unit', v_practice,
      'review_seconds_per_unit', v_review),

    'constants', v_constants,
    'degraded', v_degraded);
END;
$$;

COMMIT;
