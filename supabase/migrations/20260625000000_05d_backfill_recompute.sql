-- ============================================================================
-- PR-2 — 05D Backfill Recompute + Q4 TODO Closure + Q2 Atomicity
-- ============================================================================
-- @spec [Doc-05D_V1 §7.2 (backfill_recompute_student) / §4.2 (triggered_by constraint)]
--   [Doc-05A_V1 §5.1 (recompute_skill_mastery downstream chain / Q4)]
--   [Doc-05A_V1 §4.9 (apply_mastery_event GUC provenance / Q2)]
-- @implemented [2026-06-25]
-- plain English: builds the never-computed backfill RPC and closes two upstream gaps.
--   (1) Q4: recompute_skill_mastery gets conditional downstream fan-out via
--       p_chain_downstream boolean DEFAULT true (prevents AB/BA advisory-lock
--       deadlock when the backfill calls recompute_skill_mastery with
--       p_chain_downstream := false, then handles domain/KPI/projection itself
--       in strict skill→domain→KPI→projection order with lock-order monotonicity).
--   (2) Q2: apply_mastery_event sets GUC app.mastery_refresh_trigger = 'event'
--       before refresh_domain_mastery, closing the NULL provenance bug.
--   (3) mastery_domain_refresh_audit_log.triggered_by gets NOT NULL + CHECK
--       constraint (table is empty at deploy time — zero data migration).
--   (4) canonical_mastery_events_for_student: per-student accessor (R3) wrapping
--       canonical_mastery_events with no entity filter.
--   (5) backfill_recompute_student (§7.2): the 05D-owned never-computed backfill
--       RPC, strict dependency order, idempotent (NOT EXISTS selection).
--
-- OWNER-RUN: tracked pipeline; 05A-owned surgical edits (CREATE OR REPLACE on
--   apply_mastery_event; DROP+CREATE on recompute_skill_mastery for signature change).
-- ROLLBACK (INV-06): transactional. Revert = restore old function bodies (4-param
--   recompute_skill_mastery, apply_mastery_event without GUC), DROP the new
--   functions, ALTER COLUMN triggered_by DROP NOT NULL + DROP CONSTRAINT.
--   No table creates beyond the constraint. LYCEON-MIGRATION-REVIEWED
--
-- ORDERING CONSTRAINT: function replacements that SET the GUC (§2, §3) MUST
--   land BEFORE the NOT NULL + CHECK constraint (§4) so any concurrent event
--   during migration apply does not write NULL into triggered_by.
-- ============================================================================

BEGIN;

-- ============================================================================
-- §1. canonical_mastery_events_for_student (R3 accessor — Doc 05D §7.2 / §11.1-B)
-- ============================================================================
-- Per-student accessor returning ALL mastery events across all sections/domains/skills.
-- Used by backfill_recompute_student to discover the full (section,domain,skill) universe
-- for a student. Mirrors the canonical_mastery_events derivation logic (practice_session_items
-- + review_error_attempts) without entity-level filters — canonical_mastery_events requires
-- section/domain params and cannot return all-student events. This is the thin per-student
-- wrapper the spec (Doc 05D §7.2 / §11.1-B) contracts as canonical_mastery_events_for_student.
-- @adaptation A4 (same as canonical_mastery_events): full_length_answer events (test_session_answers
--   from Doc 04B) are omitted — BLOCKING_UPSTREAM_GAP (Doc 05D §12 / Doc 05A A4). The 04B seam
--   tables do not exist yet; the UNION branch is added when WS-4 lands. diagnostic_attempt events
--   are physically stored as practice_session_items rows (Doc 05A §11.4), so they are covered.
-- LYCEON-MIGRATION-REVIEWED
CREATE OR REPLACE FUNCTION public.canonical_mastery_events_for_student(
  p_student_id uuid
) RETURNS TABLE (
  event_id uuid, event_source_kind text, source_family text, section text, domain text,
  skill text, difficulty smallint, correct boolean, occurred_at timestamptz, question_id text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    pi.id                       AS event_id,
    'practice_attempt'::text    AS event_source_kind,
    'practice'::text            AS source_family,
    pi.question_section         AS section,
    pi.question_domain          AS domain,
    pi.question_skill           AS skill,
    pi.question_difficulty      AS difficulty,
    pi.is_correct               AS correct,
    pi.occurred_at              AS occurred_at,
    pi.question_id              AS question_id
  FROM public.practice_session_items pi
  WHERE pi.user_id = p_student_id
    AND pi.status  = 'answered'
    AND pi.question_section IN ('M','RW')

  UNION ALL

  SELECT
    ra.id, 'review_error_attempt'::text, 'review'::text,
    ra.section, ra.domain, ra.skill, ra.difficulty,
    ra.is_correct, ra.occurred_at, ra.question_id
  FROM public.review_error_attempts ra
  WHERE ra.student_id = p_student_id
    AND ra.section IN ('M','RW');
$$;

REVOKE ALL ON FUNCTION public.canonical_mastery_events_for_student(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonical_mastery_events_for_student(uuid) TO service_role;


-- ============================================================================
-- §2. recompute_skill_mastery — Q4 TODO closure (Doc 05A §5.1 downstream chain)
-- ============================================================================
-- SIGNATURE CHANGE: 4-param → 5-param (+ p_chain_downstream boolean DEFAULT true).
-- Must DROP the old signature then CREATE the new one. The DEFAULT true preserves
-- backward compatibility: all existing call sites (apply_mastery_event via the
-- TODO that was never wired, and any future direct callers) get the fan-out
-- automatically. The backfill path passes p_chain_downstream := false to prevent
-- the AB/BA advisory-lock deadlock documented in pr2-05d-backfill-recompute-audit.md §2.
--
-- GUC provenance: when p_chain_downstream fires, the function sets the GUC
-- 'app.mastery_refresh_trigger' via COALESCE(NULLIF(current_setting, ''), 'backfill_recompute')
-- so refresh_domain_mastery's audit row records 'backfill_recompute' when called
-- standalone (outside apply_mastery_event's 'event' GUC). When called from
-- apply_mastery_event, the GUC is already 'event' (set in §3 below) and the
-- COALESCE inherits it. LYCEON-MIGRATION-REVIEWED
-- ----------------------------------------------------------------------------

-- Drop old 4-param signature (Postgres overloads by param list; the old sig must go)
DROP FUNCTION IF EXISTS public.recompute_skill_mastery(uuid, text, text, text);

CREATE FUNCTION public.recompute_skill_mastery(
  p_student_id uuid, p_section text, p_domain text, p_skill text,
  p_chain_downstream boolean DEFAULT true
) RETURNS public.student_skill_mastery LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_constants jsonb; v_constants_hash text; v_active_version text;
  v_total integer; v_acc_test numeric; v_acc_practice numeric; v_acc_review numeric;
  v_score numeric; v_pct numeric; v_level smallint; v_row public.student_skill_mastery;
BEGIN
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_student_id::text||'|'||p_section||'|'||p_domain||'|'||p_skill));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'MASTERY_LOCK_TIMEOUT: recompute (%, %, %, %)', p_student_id, p_section, p_domain, p_skill;
  END;
  v_constants := public.canonicalize_mastery_constants();
  v_constants_hash := encode(extensions.digest(public.canonicalize_mastery_constants_serialized(), 'sha256'), 'hex'); -- pgcrypto lives in extensions schema (genesis); LYCEON-MIGRATION-REVIEWED
  v_active_version := v_constants->>'mastery_model_version';
  SELECT total_events, acc_test, acc_practice, acc_review, mastery_score, mastery_pct, mastery_level
    INTO v_total, v_acc_test, v_acc_practice, v_acc_review, v_score, v_pct, v_level
  FROM public.compute_mastery_for_entity(p_student_id, 'skill', p_section, p_domain, p_skill);
  INSERT INTO public.student_skill_mastery
    (student_id, section, domain, skill, mastery_score, mastery_pct, mastery_level,
     acc_test, acc_practice, acc_review, event_count_total, mastery_model_version,
     constants_snapshot_hash, last_event_id, last_event_occurred_at, computed_at)
  SELECT p_student_id, p_section, p_domain, p_skill, v_score, v_pct, v_level,
     v_acc_test, v_acc_practice, v_acc_review, v_total, v_active_version, v_constants_hash,
     ce.event_id, ce.occurred_at, now()
  FROM public.canonical_mastery_events(p_student_id, 'skill', p_section, p_domain, p_skill) ce
  ORDER BY ce.occurred_at DESC, ce.event_id DESC LIMIT 1
  ON CONFLICT (student_id, section, domain, skill) DO UPDATE SET
     mastery_score=EXCLUDED.mastery_score, mastery_pct=EXCLUDED.mastery_pct, mastery_level=EXCLUDED.mastery_level,
     acc_test=EXCLUDED.acc_test, acc_practice=EXCLUDED.acc_practice, acc_review=EXCLUDED.acc_review,
     event_count_total=EXCLUDED.event_count_total, mastery_model_version=EXCLUDED.mastery_model_version,
     constants_snapshot_hash=EXCLUDED.constants_snapshot_hash, last_event_id=EXCLUDED.last_event_id,
     last_event_occurred_at=EXCLUDED.last_event_occurred_at, computed_at=EXCLUDED.computed_at
  RETURNING * INTO v_row;
  IF v_row.student_id IS NULL THEN
    UPDATE public.student_skill_mastery SET mastery_score=NULL, mastery_pct=NULL, mastery_level=NULL,
      acc_test=NULL, acc_practice=NULL, acc_review=NULL, event_count_total=0,
      mastery_model_version=v_active_version, constants_snapshot_hash=v_constants_hash, computed_at=now()
    WHERE student_id=p_student_id AND section=p_section AND domain=p_domain AND skill=p_skill
    RETURNING * INTO v_row;
  END IF;

  -- Q4 CLOSURE (Doc 05A §5.1): conditional downstream fan-out. When p_chain_downstream
  -- is true (the default — event-time path via apply_mastery_event or standalone recompute),
  -- fire refresh_domain_mastery + bump_projection_refresh_counter in this transaction.
  -- When false (backfill path), the caller handles domain/KPI/projection in strict
  -- skill→domain→KPI→projection order with lock-order monotonicity (Doc 05D §7.2).
  -- Provenance GUC: COALESCE(NULLIF(...,''),'backfill_recompute') inherits an already-set
  -- GUC (apply_mastery_event sets 'event') or defaults to 'backfill_recompute' for
  -- standalone recompute calls. LYCEON-MIGRATION-REVIEWED
  -- set_config(name, value, is_local) with is_local=true = SET LOCAL semantics.
  -- SET LOCAL cannot evaluate expressions, so set_config is required here. LYCEON-MIGRATION-REVIEWED
  IF p_chain_downstream THEN
    PERFORM set_config('app.mastery_refresh_trigger',
      COALESCE(NULLIF(current_setting('app.mastery_refresh_trigger', true), ''), 'backfill_recompute'),
      true);
    PERFORM public.refresh_domain_mastery(p_student_id, p_section, p_domain);
    PERFORM public.bump_projection_refresh_counter(p_student_id, p_section);
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_skill_mastery(uuid, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_skill_mastery(uuid, text, text, text, boolean) TO service_role;


-- ============================================================================
-- §3. apply_mastery_event — Q2 GUC provenance fix (Doc 05A §4.9)
-- ============================================================================
-- CREATE OR REPLACE (signature unchanged — 12 params). The ONLY change from the
-- live body: adds SET LOCAL app.mastery_refresh_trigger = 'event' before the
-- §4.9 PERFORM refresh_domain_mastery call. This closes the NULL provenance bug
-- where refresh_domain_mastery's audit row recorded triggered_by = NULL because
-- the GUC was never set on the event path. LYCEON-MIGRATION-REVIEWED
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_mastery_event(
  p_student_id        uuid,
  p_section           text,
  p_domain            text,
  p_skill             text,
  p_difficulty        smallint,
  p_source_family     text,
  p_event_source_kind text,
  p_correct           boolean,
  p_occurred_at       timestamptz,
  p_event_id          uuid,
  p_question_id       text,
  p_section_state     text DEFAULT NULL
) RETURNS public.student_skill_mastery
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_constants jsonb; v_constants_hash text; v_active_version text;
  v_existing_audit uuid;
  v_before_score numeric; v_before_level smallint;
  v_total integer; v_acc_test numeric; v_acc_practice numeric; v_acc_review numeric;
  v_score numeric; v_pct numeric; v_level smallint;
  v_result_row public.student_skill_mastery;
  v_expected_family text;
  v_event_present integer;   -- self-enforcing seam guard (LC-D1-001); LYCEON-MIGRATION-REVIEWED
BEGIN
  -- §4.2 Step 1: required fields
  IF p_student_id IS NULL OR p_section IS NULL OR p_domain IS NULL OR p_skill IS NULL
     OR p_difficulty IS NULL OR p_source_family IS NULL OR p_event_source_kind IS NULL
     OR p_correct IS NULL OR p_occurred_at IS NULL OR p_event_id IS NULL OR p_question_id IS NULL THEN
    RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: required field is NULL';
  END IF;
  -- §4.2 Step 2: enums
  IF p_section NOT IN ('M','RW') THEN RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: section %', p_section; END IF;
  IF p_difficulty NOT IN (1,2,3) THEN RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: difficulty %', p_difficulty; END IF;
  IF p_source_family NOT IN ('practice','review','test') THEN
    RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: source_family %', p_source_family; END IF;
  IF p_event_source_kind NOT IN ('practice_attempt','diagnostic_attempt','review_error_attempt','full_length_answer') THEN
    RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: event_source_kind %', p_event_source_kind; END IF;
  -- §4.2 Step 2: (event_source_kind -> source_family) mapping
  v_expected_family := CASE p_event_source_kind
    WHEN 'practice_attempt'     THEN 'practice'
    WHEN 'diagnostic_attempt'   THEN 'practice'   -- §11.4: diagnostics are regular practice events
    WHEN 'review_error_attempt' THEN 'review'
    WHEN 'full_length_answer'   THEN 'test'
  END;
  IF v_expected_family IS DISTINCT FROM p_source_family THEN
    RAISE EXCEPTION 'MASTERY_SOURCE_KIND_FAMILY_MISMATCH: % maps to %, not %',
      p_event_source_kind, v_expected_family, p_source_family;
  END IF;
  -- §4.2 Step 3: cross-field consistency
  IF p_source_family = 'test' AND (p_section_state IS NULL OR p_section_state <> 'submitted') THEN
    RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: test event requires section_state=submitted';
  END IF;
  IF p_occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: occurred_at beyond 5-minute skew tolerance';
  END IF;
  -- §4.2 Step 4 (domain/skill canonicality): consultative, non-blocking in V1.0 — skipped.

  -- §4.3 Step 1: event-level advisory lock (serializes concurrent submissions of the SAME event)
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('mastery_event|' || p_event_source_kind || '|' || p_event_id::text));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'MASTERY_LOCK_TIMEOUT: event-level lock (%, %)', p_event_source_kind, p_event_id;
  END;
  -- §4.3 Step 2: race-free audit lookup on (event_source_kind, event_id) — already processed -> return
  SELECT audit_row_id INTO v_existing_audit
  FROM public.mastery_event_audit_log
  WHERE event_source_kind = p_event_source_kind AND event_id = p_event_id
  LIMIT 1;
  IF v_existing_audit IS NOT NULL THEN
    SELECT * INTO v_result_row FROM public.student_skill_mastery
    WHERE student_id = p_student_id AND section = p_section AND domain = p_domain AND skill = p_skill;
    RETURN v_result_row;
  END IF;

  -- §4.4 student-skill advisory lock (serializes concurrent DIFFERENT events to the same entity)
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_student_id::text||'|'||p_section||'|'||p_domain||'|'||p_skill));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'MASTERY_LOCK_TIMEOUT: advisory lock (%, %, %, %)', p_student_id, p_section, p_domain, p_skill;
  END;

  -- SELF-ENFORCING SEAM (LC-D1-001): the triggering event MUST be durably derived in the
  -- production canonical_mastery_events for THIS entity before any mastery/audit write. This
  -- makes the RPC defend the insert-then-call ordering law (Doc 05A §4.1 / RB-05A-V1-08 /
  -- seam §3 HALT-2) at its OWN boundary — a caller that splits the transaction, never inserted
  -- the answer, or supplies a stale/foreign event_id is REFUSED here (no torn write), regardless
  -- of caller-transaction discipline. The spec's seam is caller-owned-insert + RPC-re-derive
  -- (NOT a single DB-owned insert+apply), so the durable-derivation assertion is the correct
  -- self-enforcement. exactly-once: event_id is the answer-row PK (unique per source table). LYCEON-MIGRATION-REVIEWED
  SELECT count(*) INTO v_event_present
  FROM public.canonical_mastery_events(p_student_id, 'skill', p_section, p_domain, p_skill) ce
  WHERE ce.event_id = p_event_id AND ce.event_source_kind = p_event_source_kind;
  IF v_event_present <> 1 THEN
    RAISE EXCEPTION 'MASTERY_EVENT_NOT_DERIVED: (%, %) not derivable exactly once in canonical_mastery_events for (%, %, %, %) [found %] — answer must be durably inserted before apply_mastery_event',
      p_event_source_kind, p_event_id, p_student_id, p_section, p_domain, p_skill, v_event_present;
  END IF;

  -- §4.5 constants + snapshot hash (pgcrypto in extensions schema, genesis)
  v_constants := public.canonicalize_mastery_constants();
  v_constants_hash := encode(extensions.digest(public.canonicalize_mastery_constants_serialized(), 'sha256'), 'hex');
  v_active_version := v_constants->>'mastery_model_version';

  -- §4.6 compute (pure; re-derives from canonical_mastery_events visible at call time — insert-first law)
  SELECT total_events, acc_test, acc_practice, acc_review, mastery_score, mastery_pct, mastery_level
    INTO v_total, v_acc_test, v_acc_practice, v_acc_review, v_score, v_pct, v_level
  FROM public.compute_mastery_for_entity(p_student_id, 'skill', p_section, p_domain, p_skill);

  -- §4.7 read before-state under the lock, then upsert
  SELECT mastery_score, mastery_level INTO v_before_score, v_before_level
  FROM public.student_skill_mastery
  WHERE student_id = p_student_id AND section = p_section AND domain = p_domain AND skill = p_skill;

  INSERT INTO public.student_skill_mastery
    (student_id, section, domain, skill, mastery_score, mastery_pct, mastery_level,
     acc_test, acc_practice, acc_review, event_count_total, mastery_model_version,
     constants_snapshot_hash, last_event_id, last_event_occurred_at, computed_at)
  VALUES
    (p_student_id, p_section, p_domain, p_skill, v_score, v_pct, v_level,
     v_acc_test, v_acc_practice, v_acc_review, v_total, v_active_version,
     v_constants_hash, p_event_id, p_occurred_at, now())
  ON CONFLICT (student_id, section, domain, skill) DO UPDATE SET
     mastery_score=EXCLUDED.mastery_score, mastery_pct=EXCLUDED.mastery_pct, mastery_level=EXCLUDED.mastery_level,
     acc_test=EXCLUDED.acc_test, acc_practice=EXCLUDED.acc_practice, acc_review=EXCLUDED.acc_review,
     event_count_total=EXCLUDED.event_count_total, mastery_model_version=EXCLUDED.mastery_model_version,
     constants_snapshot_hash=EXCLUDED.constants_snapshot_hash, last_event_id=EXCLUDED.last_event_id,
     last_event_occurred_at=EXCLUDED.last_event_occurred_at, computed_at=EXCLUDED.computed_at
  RETURNING * INTO v_result_row;

  -- §4.8 audit insert; unique_violation -> race-completed idempotent re-entry (§4.11 / RB-05A-V1-01)
  BEGIN
    -- applied_at listed explicitly with now() per §4.8 verbatim (not relying on the DEFAULT). LYCEON-MIGRATION-REVIEWED
    INSERT INTO public.mastery_event_audit_log
      (student_id, section, domain, skill, source_family, event_source_kind, event_id, question_id,
       difficulty, correct, occurred_at, mastery_score_before, mastery_score_after,
       mastery_level_before, mastery_level_after, event_count_after, constants_snapshot_hash, mastery_model_version,
       applied_at)
    VALUES
      (p_student_id, p_section, p_domain, p_skill, p_source_family, p_event_source_kind, p_event_id, p_question_id,
       p_difficulty, p_correct, p_occurred_at, v_before_score, v_score,
       v_before_level, v_level, v_total, v_constants_hash, v_active_version,
       now());
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_result_row FROM public.student_skill_mastery
    WHERE student_id = p_student_id AND section = p_section AND domain = p_domain AND skill = p_skill;
    RETURN v_result_row;
  END;

  -- §4.9 downstream chain (AM-3 RETIRED — 05B/05C wave). In this SAME transaction: refresh domain
  -- mastery (which fans out to the 4 KPI refreshers, Doc 05B §4.9), then run the 05C-owned
  -- projection-refresh throttle (Doc 05C §8.4 — fires compute_section_projection on the every-Nth
  -- event, else just increments the counter). Any failure rolls back the WHOLE event (Parent §7.8):
  -- skill + domain + 4 KPI + (throttled) projection are one atomic unit, or none. LYCEON-MIGRATION-REVIEWED
  --
  -- Q2 FIX: set GUC provenance BEFORE refresh_domain_mastery so the audit row records
  -- triggered_by = 'event' (Doc 05D §4.2 constraint). Previously NULL (GUC was never set). LYCEON-MIGRATION-REVIEWED
  SET LOCAL app.mastery_refresh_trigger = 'event';
  PERFORM public.refresh_domain_mastery(p_student_id, p_section, p_domain);
  PERFORM public.bump_projection_refresh_counter(p_student_id, p_section);

  -- §4.10 return
  RETURN v_result_row;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_mastery_event(uuid, text, text, text, smallint, text, text, boolean, timestamptz, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_mastery_event(uuid, text, text, text, smallint, text, text, boolean, timestamptz, uuid, text, text) TO service_role;


-- ============================================================================
-- §4. mastery_domain_refresh_audit_log — Q2 atomicity (triggered_by NOT NULL + CHECK)
-- ============================================================================
-- Doc 05D §4.2: triggered_by text NOT NULL CHECK (triggered_by IN ('event','backfill_recompute')).
-- Live table has: triggered_by text (nullable, no CHECK). Zero rows at deploy — no data migration.
--
-- ORDERING PROOF: §2 (recompute_skill_mastery) and §3 (apply_mastery_event) landed ABOVE, so
-- both GUC-setting codepaths are active BEFORE this constraint. Any concurrent event during
-- migration apply hits the new apply_mastery_event body (with SET LOCAL ... = 'event') and
-- satisfies the NOT NULL + CHECK. Any recompute_skill_mastery standalone call gets
-- COALESCE(NULLIF(...), 'backfill_recompute') and also satisfies. LYCEON-MIGRATION-REVIEWED
--
-- NULL semantics proof: Postgres CHECK evaluates to UNKNOWN on NULL, which PASSES the check.
-- Therefore NOT NULL is required ALONGSIDE the CHECK — neither alone is sufficient.
-- AF-1/AF-2 (last_event_id, last_event_occurred_at columns from Doc 05D §4.2) are DEFERRED
-- LOW gaps — tracked, not in PR-2 scope (Q-PR2-3 ruling). LYCEON-MIGRATION-REVIEWED
-- ----------------------------------------------------------------------------
ALTER TABLE public.mastery_domain_refresh_audit_log
  ALTER COLUMN triggered_by SET NOT NULL;
ALTER TABLE public.mastery_domain_refresh_audit_log
  ADD CONSTRAINT mastery_domain_refresh_audit_log_triggered_by_check
  CHECK (triggered_by IN ('event','backfill_recompute'));


-- ============================================================================
-- §5. backfill_recompute_student (Doc 05D §7.2 — the 05D-owned never-computed backfill RPC)
-- ============================================================================
-- Strict dependency order: skill → domain → KPI → projection (INV-05D-17 / §7.4).
-- Lock-order monotonicity: step 1 acquires ALL skill locks (via recompute_skill_mastery)
-- before step 2 acquires ANY domain lock (via refresh_domain_mastery). No AB/BA interleaving.
-- Idempotent: re-run produces byte-identical output (NOT EXISTS = false on re-run,
-- terminal KPI/projection are deterministic upserts). §7.3 bounded batch driver is NOT in
-- PR-2 scope (Q-PR2-4 ruling). LYCEON-MIGRATION-REVIEWED
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_recompute_student(
  p_student_id  uuid,
  p_t_now       timestamptz DEFAULT now()
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE
  v_sec   text;
  v_dom   text;
  v_skl   text;
BEGIN
  -- Student-level advisory lock: serializes backfill against concurrent live events for
  -- the same student (Doc 05D §7.2). lock_timeout is generous (10s) because the backfill
  -- touches every entity for the student.
  -- @reconciliation RB-05D-PR2-01: §7.2 spec body shows lock BEFORE lock_timeout; this
  --   migration sets lock_timeout BEFORE the lock call (operationally correct — the timeout
  --   must govern the subsequent lock attempt). Matches the established pattern in
  --   apply_mastery_event §4.3/§4.4 and recompute_skill_mastery. The EXCEPTION handler is
  --   also not in the spec body but matches the same established pattern. Spec body is an
  --   editorial ordering error; the implementation is correct. LYCEON-MIGRATION-REVIEWED
  SET LOCAL lock_timeout = '10s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('backfill|' || p_student_id::text));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'MASTERY_LOCK_TIMEOUT: backfill_recompute_student (%)', p_student_id;
  END;

  -- GUC provenance: all downstream audit rows record 'backfill_recompute' (Doc 05D §4.2).
  -- SET LOCAL scopes to this transaction — does not leak to concurrent sessions.
  SET LOCAL app.mastery_refresh_trigger = 'backfill_recompute';

  -- STRICT DEPENDENCY ORDER (INV-05D-17): skill → domain → KPI → projection.
  -- Each step calls a sibling-owned RPC (INV-05D-A1 — 05D never reimplements a formula).

  -- 1. Skill mastery: call 05A's locked recompute_skill_mastery (RB-05D-V1-A)
  --    with p_chain_downstream := false — the backfill handles domain/KPI/projection
  --    itself in steps 2–4 with lock-order monotonicity. NOT EXISTS selection: only
  --    skills with events but no student_skill_mastery row.
  FOR v_sec, v_dom, v_skl IN
    SELECT DISTINCT e.section, e.domain, e.skill
    FROM   public.canonical_mastery_events_for_student(p_student_id) e
    WHERE  NOT EXISTS (
               SELECT 1 FROM public.student_skill_mastery sm
               WHERE  sm.student_id = p_student_id
                 AND  sm.section = e.section
                 AND  sm.domain  = e.domain
                 AND  sm.skill   = e.skill)
  LOOP
    PERFORM public.recompute_skill_mastery(
      p_student_id, v_sec, v_dom, v_skl,
      false  -- p_chain_downstream := false (deadlock prevention)
    );
  END LOOP;

  -- 2. Domain mastery: 05B's refresh_domain_mastery for every (section,domain) with
  --    events but no student_domain_mastery row. refresh_domain_mastery internally
  --    chains the 4 KPI refreshers (05B §4.9), so step 3 is partially satisfied
  --    by step 2 for the domains it touches. NOT EXISTS selection: never-computed only.
  --    SINGLE-FIRE PROOF: with p_chain_downstream=false in step 1, no domain refresh
  --    has fired yet — step 2's NOT EXISTS correctly selects all domains that need it.
  FOR v_sec, v_dom IN
    SELECT DISTINCT e.section, e.domain
    FROM   public.canonical_mastery_events_for_student(p_student_id) e
    WHERE  NOT EXISTS (
               SELECT 1 FROM public.student_domain_mastery dm
               WHERE  dm.student_id = p_student_id
                 AND  dm.section = e.section
                 AND  dm.domain  = e.domain)
  LOOP
    PERFORM public.refresh_domain_mastery(p_student_id, v_sec, v_dom);
  END LOOP;

  -- 3. KPI rollups (TERMINAL SURFACE — refreshed unconditionally, RB-05D-V1-04).
  --    refresh_domain_mastery (step 2) already chained the section/domain/skill/overall
  --    KPI refreshers per 05B §4.9 for domains it touched; this terminal refresh
  --    guarantees the four KPI surfaces reflect final derived state even when domain
  --    rows pre-existed (partial-legacy student). Deterministic upsert, not a
  --    reimplementation. p_t_now flows through for §8 determinism verification.
  PERFORM public.refresh_section_kpi(p_student_id, 'M',  p_t_now);
  PERFORM public.refresh_section_kpi(p_student_id, 'RW', p_t_now);
  PERFORM public.refresh_overall_kpi(p_student_id, p_t_now);

  -- 4. Projection (TERMINAL SURFACE — refreshed unconditionally, RB-05D-V1-04).
  --    The Q4 gate inside compute_section_projection self-protects (emits NULL
  --    projection if the 8-domain gate is not met), so calling it unconditionally
  --    is correct and deterministic. p_t_now flows through for §8 determinism.
  PERFORM public.compute_section_projection(p_student_id, 'M',  p_t_now);
  PERFORM public.compute_section_projection(p_student_id, 'RW', p_t_now);
END;
$func$;

REVOKE ALL ON FUNCTION public.backfill_recompute_student(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_recompute_student(uuid, timestamptz) TO service_role;


-- ============================================================================
-- §6. CI Guards — structural assertions (Doc 05D §11.1-J / pr2-05d-backfill-recompute-audit.md §3)
-- ============================================================================

-- 6.1 backfill_calls_recompute_skill_mastery (RB-05D-V1-A)
-- Asserts backfill_recompute_student calls 05A's locked recompute_skill_mastery RPC,
-- NOT the pure compute_mastery_for_entity (which computes but never persists).
DO $ci_guard$
DECLARE
  v_body text;
BEGIN
  SELECT prosrc INTO v_body FROM pg_proc
  WHERE proname = 'backfill_recompute_student' AND pronamespace = 'public'::regnamespace;
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL: backfill_recompute_student not found';
  END IF;
  IF v_body NOT LIKE '%recompute_skill_mastery%' THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL [backfill_calls_recompute_skill_mastery]: backfill must call recompute_skill_mastery, not compute_mastery_for_entity';
  END IF;
END;
$ci_guard$;

-- 6.2 lock_order_monotonicity
-- Asserts backfill_recompute_student calls recompute_skill_mastery with
-- p_chain_downstream := false (or literal false), ensuring ALL skill locks
-- are acquired (step 1) before ANY domain lock (step 2). Without this,
-- AB/BA deadlock between backfill and concurrent events.
DO $ci_guard$
DECLARE
  v_body text;
  v_skill_pos integer;
  v_domain_pos integer;
BEGIN
  SELECT prosrc INTO v_body FROM pg_proc
  WHERE proname = 'backfill_recompute_student' AND pronamespace = 'public'::regnamespace;
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL: backfill_recompute_student not found';
  END IF;
  -- p_chain_downstream must be false in the recompute_skill_mastery call
  IF v_body NOT LIKE '%recompute_skill_mastery%false%' THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL [lock_order_monotonicity]: recompute_skill_mastery must be called with p_chain_downstream := false in backfill';
  END IF;
  -- Skill loop must appear before domain loop (positional order in the body)
  v_skill_pos := position('recompute_skill_mastery' in v_body);
  v_domain_pos := position('refresh_domain_mastery' in v_body);
  IF v_skill_pos = 0 OR v_domain_pos = 0 OR v_skill_pos >= v_domain_pos THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL [lock_order_monotonicity]: skill loop must precede domain loop in backfill_recompute_student';
  END IF;
END;
$ci_guard$;

-- 6.3 q2_atomicity_proof
-- Asserts apply_mastery_event sets GUC 'event' before calling refresh_domain_mastery,
-- and mastery_domain_refresh_audit_log.triggered_by is NOT NULL with a CHECK constraint.
DO $ci_guard$
DECLARE
  v_body text;
  v_guc_pos integer;
  v_refresh_pos integer;
  v_is_nullable boolean;
  v_has_check boolean;
BEGIN
  SELECT prosrc INTO v_body FROM pg_proc
  WHERE proname = 'apply_mastery_event' AND pronamespace = 'public'::regnamespace;
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL: apply_mastery_event not found';
  END IF;
  v_guc_pos := position('mastery_refresh_trigger' in v_body);
  v_refresh_pos := position('refresh_domain_mastery' in v_body);
  IF v_guc_pos = 0 THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL [q2_atomicity]: apply_mastery_event must SET app.mastery_refresh_trigger before refresh_domain_mastery';
  END IF;
  IF v_refresh_pos = 0 OR v_guc_pos >= v_refresh_pos THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL [q2_atomicity]: GUC set must precede refresh_domain_mastery call';
  END IF;
  -- Column NOT NULL check
  SELECT (is_nullable = 'NO') INTO v_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'mastery_domain_refresh_audit_log' AND column_name = 'triggered_by';
  IF NOT v_is_nullable THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL [q2_atomicity]: triggered_by must be NOT NULL';
  END IF;
  -- CHECK constraint exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.check_constraints cc
    JOIN information_schema.constraint_column_usage ccu USING (constraint_schema, constraint_name)
    WHERE ccu.table_schema = 'public'
      AND ccu.table_name = 'mastery_domain_refresh_audit_log'
      AND ccu.column_name = 'triggered_by'
      AND cc.check_clause LIKE '%event%'
      AND cc.check_clause LIKE '%backfill_recompute%'
  ) INTO v_has_check;
  IF NOT v_has_check THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL [q2_atomicity]: triggered_by must have CHECK (triggered_by IN (''event'',''backfill_recompute''))';
  END IF;
END;
$ci_guard$;

-- 6.4 single_fire_not_exists
-- Asserts backfill_recompute_student uses NOT EXISTS filters for both skill and domain
-- loops (never-computed selection only), preventing double-fire.
DO $ci_guard$
DECLARE
  v_body text;
  v_not_exists_count integer;
BEGIN
  SELECT prosrc INTO v_body FROM pg_proc
  WHERE proname = 'backfill_recompute_student' AND pronamespace = 'public'::regnamespace;
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL: backfill_recompute_student not found';
  END IF;
  -- Must have at least 2 NOT EXISTS (one for skill, one for domain)
  v_not_exists_count := (length(v_body) - length(replace(lower(v_body), 'not exists', ''))) / length('not exists');
  IF v_not_exists_count < 2 THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL [single_fire_not_exists]: backfill must use NOT EXISTS for both skill and domain loops (found %)', v_not_exists_count;
  END IF;
END;
$ci_guard$;

-- 6.5 recompute_skill_mastery_has_conditional_chain
-- Asserts recompute_skill_mastery has the p_chain_downstream parameter and conditional
-- fan-out (the IF p_chain_downstream THEN block).
DO $ci_guard$
DECLARE
  v_body text;
  v_has_param boolean;
BEGIN
  SELECT prosrc INTO v_body FROM pg_proc
  WHERE proname = 'recompute_skill_mastery' AND pronamespace = 'public'::regnamespace;
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL: recompute_skill_mastery not found';
  END IF;
  IF v_body NOT LIKE '%p_chain_downstream%' THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL [recompute_conditional_chain]: recompute_skill_mastery must reference p_chain_downstream';
  END IF;
  IF v_body NOT LIKE '%refresh_domain_mastery%' THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL [recompute_conditional_chain]: recompute_skill_mastery must call refresh_domain_mastery when p_chain_downstream is true';
  END IF;
  -- Verify the boolean param exists in the function signature
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'recompute_skill_mastery'
      AND n.nspname = 'public'
      AND 'boolean'::regtype = ANY(p.proargtypes)
  ) INTO v_has_param;
  IF NOT v_has_param THEN
    RAISE EXCEPTION 'CI_GUARD_FAIL [recompute_conditional_chain]: recompute_skill_mastery must have boolean parameter in signature';
  END IF;
END;
$ci_guard$;

COMMIT;
