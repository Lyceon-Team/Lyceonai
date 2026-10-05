-- ===========================================================================
-- Crisis hold on account deletion: flagged transcripts survive, de-linked
--
-- @spec [Doc 03 §14.2 D03:1255 (flagged LISA content kept, manual purge); RS-00 owner ruling
--        2026-10-05 (crisis-flagged = any linked crisis_review_cases or crisis_review_events row;
--        the 7d sweep holds those); owner ruling 2026-10-05 C-01 (a flagged conversation survives
--        account deletion de-linked from the student until the safety owner purges it by hand;
--        crisis data outranks the Privacy Policy's under-13 "across all Lyceon systems" line)]
-- @implemented 2026-10-05
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- plain English: tutor_conversations.student_id and tutor_messages.student_id CASCADE from
-- profiles (20260917130000_declarative_fk_delete_actions.sql:138-139), so deleting an account
-- destroyed the student's crisis-flagged transcripts, which the 7d sweep (RS-00) deliberately
-- keeps. The cascade now NULLs student_id on that student's flagged conversations and their
-- messages BEFORE it deletes the profile, so the FK CASCADE no longer reaches them. Unflagged
-- conversations still go exactly as before. Both modes (hard_delete, anonymize).
--
-- expected outcome: after an account deletion, every flagged conversation of that student still
-- exists with all its messages, student_id NULL on both; the crisis case still points at it
-- (crisis_review_cases.conversation_id is unchanged; its student_id is SET NULL as before).
--
-- trade-offs:
--  - The two columns become nullable. A NULL is allowed only where the conversation is flagged:
--    a CHECK on tutor_conversations (crisis_flagged must be true), and, because a CHECK cannot
--    read another row, a constraint trigger on tutor_messages that refuses a NULL student_id
--    unless the message's conversation is flagged and itself de-linked. Same rule, enforced at
--    the only place it can be.
--  - Child rows that carry their own student_id (instruction assignments/exposures, question
--    links, injection log, memory summaries) still CASCADE: only the transcript is held.
--  - The cascade body is 20261008000000's verbatim plus the CRISIS HOLD block; this file is now
--    its last definition. Mutations resolve it at run time (MIGCASCADE), so they follow.
--
-- edge cases:
--  - A conversation flagged only by a crisis_review_events row (crisis_flagged false) is held too,
--    and is marked crisis_flagged on the way.
--  - Re-running the cascade on a gone profile is the existing no-op.
--  - Readers: every application read filters by a live student id or by conversation id
--    (established 2026-10-05); server/services/tutor-compaction.ts deriveConversationOwner now
--    refuses a conversation with no student.
--
-- rollback (not exact for data: rows already held stay held):
--   restore 20261008000000's execute_account_deletion_cascade definition;
--   DROP TRIGGER tutor_messages_null_student_only_flagged ON public.tutor_messages;
--   DROP FUNCTION public.tutor_messages_null_student_only_flagged();
--   ALTER TABLE public.tutor_conversations DROP CONSTRAINT tutor_conversations_null_student_only_flagged;
--   and SET NOT NULL on both columns only once no held row remains.
-- ===========================================================================

BEGIN;

ALTER TABLE public.tutor_conversations ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE public.tutor_messages      ALTER COLUMN student_id DROP NOT NULL;

ALTER TABLE public.tutor_conversations
  ADD CONSTRAINT tutor_conversations_null_student_only_flagged
  CHECK (student_id IS NOT NULL OR crisis_flagged);

CREATE OR REPLACE FUNCTION public.tutor_messages_null_student_only_flagged()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.student_id IS NULL AND NOT EXISTS (
       SELECT 1 FROM public.tutor_conversations c
        WHERE c.id = NEW.conversation_id AND c.student_id IS NULL AND c.crisis_flagged) THEN
    RAISE EXCEPTION 'tutor_messages_null_student_only_flagged: a message may lose its student only inside a de-linked crisis-flagged conversation'
      USING ERRCODE = '23514', CONSTRAINT = 'tutor_messages_null_student_only_flagged';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_messages_null_student_only_flagged() FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER tutor_messages_null_student_only_flagged
  AFTER INSERT OR UPDATE OF student_id ON public.tutor_messages
  FOR EACH ROW EXECUTE FUNCTION public.tutor_messages_null_student_only_flagged();

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
  v_exam_child    record;   -- E9 commit 0: one row of public.exam_child_tables
  v_exam_pred     text;     -- E9 commit 0: that row's WHERE clause
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

    -- L2-08 .. L2-15, E9 commit 0: every exam table is a ROW of
    -- public.exam_child_tables, walked in `ordinal` order (children before
    -- parents; the E6b order, unchanged). `delete` rows are removed and counted;
    -- `count` rows (score_run_event_ledger, score_runs — insert-once, they leave
    -- with test_sessions through ON DELETE CASCADE, which their trigger admits)
    -- are counted first because that removal is invisible to GET DIAGNOSTICS.
    -- The next exam table is a list row in its own migration, not an edit here;
    -- scripts/ci/exam-deletion-cascade-gates.sql L1 fails while one is missing.
    FOR v_exam_child IN
      SELECT table_name, key_column, key_target, action
        FROM public.exam_child_tables ORDER BY ordinal
    LOOP
      v_exam_pred := CASE v_exam_child.key_target
        WHEN 'session'   THEN format('%I = ANY ($1)', v_exam_child.key_column)
        WHEN 'score_run' THEN format(
          '%I IN (SELECT r.id FROM public.score_runs r WHERE r.test_session_id = ANY ($1))',
          v_exam_child.key_column)
      END;
      IF v_exam_child.action = 'delete' THEN
        EXECUTE format('DELETE FROM public.%I WHERE %s', v_exam_child.table_name, v_exam_pred)
          USING v_exam_sessions;
        GET DIAGNOSTICS v_count = ROW_COUNT;
      ELSE
        EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', v_exam_child.table_name, v_exam_pred)
          INTO v_count USING v_exam_sessions;
      END IF;
      v_result := v_result || jsonb_build_object(v_exam_child.table_name, v_count);
    END LOOP;

  ELSIF p_privacy_mode = 'anonymize' THEN
    -- ====================================================================
    -- FAIL-CLOSED SENTINEL (INV-05E-07): before severing identity, verify
    -- every retained row for this user has its grouping identifier.
    -- ====================================================================
    -- Defense-in-depth: actor_id is DB-enforced NOT NULL (PR-5c seal), so
    -- this cannot fire under normal operation. But INV-05E-07 requires
    -- explicit verification before the identity ↔ actor_id linkage is
    -- destroyed. Runs BEFORE SET NULL so identity col is still queryable.
    -- @spec [Doc 05E §6 INV-05E-07, strengthened; SCL-151 (PROPOSED); owner brief 2026-09-25 R2]
    -- | @implemented [2026-09-25]
    --
    -- WAS: an enumerated seven-table list asking only `actor_id IS NULL`. Both halves failed.
    -- The list could not cover a table added later, and the nullity question cannot see a
    -- WRONG value — which is exactly what `diagnostic-routes.ts` wrote for five production
    -- sessions and 200 items, undetected until the Doc 06D §6.3 scan ran on a real deletion.
    --
    -- IS: catalog-driven, and it checks the VALUE. Every retained row keyed to this profile
    -- must carry THIS PROFILE'S actor_id — the one already read into v_actor_id above, from
    -- `profiles`, before the identity link is destroyed. That single equality subsumes the old
    -- check (NULL <> v_actor_id) and forbids the identity key (p_profile_id <> v_actor_id,
    -- guaranteed because no profile may have id = actor_id, which
    -- public.actor_id_integrity_violations() asserts schema-wide).
    --
    -- Still fail-closed and still HERE, before the SET NULLs: after identity is severed there
    -- is no column left to key the check on.
    DECLARE
      v_sentinel_rec record;
      v_sentinel_col text;
      v_sentinel_cnt bigint;
      v_sentinel_tbls integer := 0;
    BEGIN
      FOR v_sentinel_rec IN
        SELECT c.relname AS tbl,
               (SELECT a2.attname
                  FROM pg_attribute a2
                 WHERE a2.attrelid = c.oid AND a2.attnum > 0 AND NOT a2.attisdropped
                   AND a2.attname IN ('user_id', 'student_id')
                 ORDER BY a2.attname LIMIT 1) AS idcol
          FROM pg_attribute a
          JOIN pg_class     c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND NOT c.relispartition
           AND a.attname = 'actor_id'
           AND a.attnum > 0 AND NOT a.attisdropped
           AND c.relname NOT IN ('profiles', 'anonymized_actors')
         ORDER BY c.relname
      LOOP
        CONTINUE WHEN v_sentinel_rec.idcol IS NULL;
        v_sentinel_col  := v_sentinel_rec.idcol;
        v_sentinel_tbls := v_sentinel_tbls + 1;

        EXECUTE format(
          'SELECT count(*) FROM public.%1$I WHERE %2$I = $1 '
          'AND (actor_id IS NULL OR actor_id <> $2)',
          v_sentinel_rec.tbl, v_sentinel_col
        ) INTO v_sentinel_cnt USING p_profile_id, v_actor_id;

        IF v_sentinel_cnt > 0 THEN
          RAISE EXCEPTION '05E-5d SENTINEL (INV-05E-07): % row(s) in public.% carry an actor_id that is not this profile''s (expected %) — refusing to sever identity from a row whose grouping identifier is wrong or absent. See public.actor_id_integrity_violations().',
            v_sentinel_cnt, v_sentinel_rec.tbl, v_actor_id;
        END IF;
      END LOOP;

      -- A sentinel that inspected nothing would pass silently, which is how a vacuous gate
      -- reads green. The seven tables the old list named are the floor.
      IF v_sentinel_tbls < 7 THEN
        RAISE EXCEPTION '05E-5d SENTINEL: discovered only % actor_id table(s); the catalog query is wrong and the check would pass vacuously', v_sentinel_tbls;
      END IF;
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
    -- (Doc 04A omits client_instance_id); the children (E7a's workspace rows
    -- included: flags, eliminated opaque tokens, highlight offsets — no text) and
    -- the ledger carry no identity; the outbox carries none either and score_runs references it,
    -- so it stays. Counted HERE, before the profile delete, because a severance
    -- done by an FK action is invisible to GET DIAGNOSTICS.
    -- E9 commit 0: the counts come from the list (rows with a student_column).
    FOR v_exam_child IN
      SELECT table_name, student_column
        FROM public.exam_child_tables
       WHERE student_column IS NOT NULL ORDER BY ordinal
    LOOP
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1',
                     v_exam_child.table_name, v_exam_child.student_column)
        INTO v_count USING p_profile_id;
      v_result := v_result || jsonb_build_object(v_exam_child.table_name, v_count);
    END LOOP;

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
  -- CRISIS HOLD (C-01, owner ruling 2026-10-05; both modes)
  -- ========================================================================
  -- A crisis-flagged conversation survives the deletion de-linked from the student, with
  -- every message, until the safety owner purges it by hand (Doc 03 §14.2, D03:1255).
  -- "Flagged" is the RS-00 definition, the same predicate the 7d retention sweep holds by:
  -- any crisis_review_cases or crisis_review_events row names the conversation. NULLing
  -- student_id here, before the profile DELETE below, is what keeps the profile FK CASCADE
  -- off these rows. crisis_flagged is set on the way so the table's CHECK
  -- (tutor_conversations_null_student_only_flagged) can see why the row has no student.
  -- De-linked, not anonymous: the transcript is the student's own words.
  UPDATE public.tutor_conversations c
     SET student_id = NULL,
         crisis_flagged = true
   WHERE c.student_id = p_profile_id
     AND (EXISTS (SELECT 1 FROM public.crisis_review_cases k  WHERE k.conversation_id = c.id)
       OR EXISTS (SELECT 1 FROM public.crisis_review_events v WHERE v.conversation_id = c.id));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('tutor_conversations_crisis_held', v_count);

  UPDATE public.tutor_messages m
     SET student_id = NULL
   WHERE m.student_id = p_profile_id
     AND EXISTS (SELECT 1 FROM public.tutor_conversations c
                  WHERE c.id = m.conversation_id AND c.student_id IS NULL AND c.crisis_flagged);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('tutor_messages_crisis_held', v_count);

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

REVOKE ALL ON FUNCTION public.execute_account_deletion_cascade(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_account_deletion_cascade(uuid, text) TO service_role;

COMMIT;
