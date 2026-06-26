-- ============================================================================
-- PR-5d: Anonymize Disposition (Doc 05E §4/§5/§6/§8 step 4)
-- ============================================================================
-- @spec [Doc-05E §3/§4/§5/§6/§8 step 4, INV-05E-01 through INV-05E-08, SCL-004, SCL-010]
-- @implemented [2026-06-26]
-- plain English: enables the 'anonymize' privacy mode in execute_account_deletion_cascade,
--   replacing the BLOCKING_PRIVACY_GAP stub. Anonymize mode per §5 disposition:
--     L1: DELETE all derived state (shared with hard-delete)
--     L2: SET NULL identity + fingerprint columns on 5 activity tables (rows retained)
--     L3: SET NULL identity on 2 audit tables (rows retained, idempotency untouched)
--     Profile + auth: DELETE (destroys actor_id ↔ identity linkage per §3 Rule 4)
--   Records actor_id in anonymized_actors ledger before profile deletion.
--   Substrate: DROP NOT NULL on audit student_id (×2) + fingerprint client_instance_id (×2).
--   Closes SCL-004: student_kpi_rollups_current added to L1 for both modes.
--   L1→L2 ordering proven safe (INV-05E-08 atomicity): zero triggers on any L1/L2/L3
--     table, zero FKs from L1→L2, all L1 DELETEs are simple WHERE student_id = p_profile_id.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED

-- ============================================================================
-- PART 1: Substrate — DROP NOT NULL for anonymize SET NULL targets
-- ============================================================================

-- S-1/S-2: audit table student_id (preserved NOT NULL in 5a substrate for 5d optionality;
-- now resolved: anonymize disposition SETs NULL per §5 "one-way anonymized")
ALTER TABLE public.mastery_event_audit_log          ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE public.mastery_domain_refresh_audit_log ALTER COLUMN student_id DROP NOT NULL;

-- S-3/S-4: fingerprint columns (§5.1 / §7: client/device/session fingerprints removed at
-- anonymization). client_instance_id is a session identifier — re-identification risk.
ALTER TABLE public.practice_sessions ALTER COLUMN client_instance_id DROP NOT NULL;
ALTER TABLE public.review_sessions   ALTER COLUMN client_instance_id DROP NOT NULL;

-- ============================================================================
-- PART 2: Replace cascade function (anonymize branch + SCL-004 fix)
-- ============================================================================
-- Replaces the function defined in 20260625010000_05d_account_deletion_cascade.sql.
-- The DDL (audit_logs FK drops) from that migration is NOT repeated — already applied.
-- Changes from original:
--   1. 'anonymize' mode implemented (was BLOCKING_PRIVACY_GAP RAISE)
--   2. student_kpi_rollups_current added to L1 (SCL-004, both modes)
--   3. v_actor_id captured for anonymize sentinel + ledger insert
--   4. Mode guard updated: valid modes are 'hard_delete' and 'anonymize'
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
  v_op_ref   record;
  v_actor_id  uuid;
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
  -- OPERATOR-FK PREFLIGHT GUARD (fail-closed, before ANY destructive step)
  -- ========================================================================
  -- 36 operator-identity FK edges (updated_by_profile_id / changed_by_profile_id
  -- across 18 *_config + 18 *_config_history governance tables). Operator
  -- attribution is governance data — must BLOCK deletion until consciously
  -- reassigned. The guard refuses cascade with a clear error BEFORE any rows
  -- are deleted. LYCEON-MIGRATION-REVIEWED
  FOR v_op_ref IN
    SELECT * FROM (VALUES
      ('abuse_score_runtime_config'::text,              'updated_by_profile_id'::text),
      ('abuse_score_runtime_config_history',            'changed_by_profile_id'),
      ('account_deletion_runtime_config',               'updated_by_profile_id'),
      ('account_deletion_runtime_config_history',       'changed_by_profile_id'),
      ('auth_mfa_config',                               'updated_by_profile_id'),
      ('auth_mfa_config_history',                       'changed_by_profile_id'),
      ('auth_runtime_config',                           'updated_by_profile_id'),
      ('auth_runtime_config_history',                   'changed_by_profile_id'),
      ('caching_runtime_config',                        'updated_by_profile_id'),
      ('caching_runtime_config_history',                'changed_by_profile_id'),
      ('consent_runtime_config',                        'updated_by_profile_id'),
      ('consent_runtime_config_history',                'changed_by_profile_id'),
      ('entitlement_runtime_config',                    'updated_by_profile_id'),
      ('entitlement_runtime_config_history',            'changed_by_profile_id'),
      ('exam_runtime_config',                           'updated_by_profile_id'),
      ('exam_runtime_config_history',                   'changed_by_profile_id'),
      ('full_length_adaptive_config',                   'updated_by_profile_id'),
      ('full_length_adaptive_config_history',           'changed_by_profile_id'),
      ('idempotency_runtime_config',                    'updated_by_profile_id'),
      ('idempotency_runtime_config_history',            'changed_by_profile_id'),
      ('internal_service_auth_config',                  'updated_by_profile_id'),
      ('internal_service_auth_config_history',          'changed_by_profile_id'),
      ('mastery_constants',                             'updated_by_profile_id'),
      ('mastery_constants_history',                     'changed_by_profile_id'),
      ('mobile_auth_config',                            'updated_by_profile_id'),
      ('mobile_auth_config_history',                    'changed_by_profile_id'),
      ('observability_runtime_config',                  'updated_by_profile_id'),
      ('observability_runtime_config_history',          'changed_by_profile_id'),
      ('practice_runtime_config',                       'updated_by_profile_id'),
      ('practice_runtime_config_history',               'changed_by_profile_id'),
      ('rate_limit_runtime_config',                     'updated_by_profile_id'),
      ('rate_limit_runtime_config_history',             'changed_by_profile_id'),
      ('review_runtime_config',                         'updated_by_profile_id'),
      ('review_runtime_config_history',                 'changed_by_profile_id'),
      ('tutor_context_runtime_config',                  'updated_by_profile_id'),
      ('tutor_context_runtime_config_history',          'changed_by_profile_id')
    ) AS t(tbl, col)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE %I = $1',
      v_op_ref.tbl, v_op_ref.col
    ) INTO v_count USING p_profile_id;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'PROFILE_HAS_OPERATIONAL_CONFIG_REFERENCES: '
        'profile % is referenced as an operator in %.% '
        '— reassign config attributions before deletion',
        p_profile_id, v_op_ref.tbl, v_op_ref.col;
    END IF;
  END LOOP;

  -- ========================================================================
  -- PRE-CLEAR: RESTRICT + NO ACTION FKs that block profile deletion
  -- ========================================================================

  -- PS-1. entitlements (profile_id → profiles ON DELETE RESTRICT)
  DELETE FROM public.entitlements WHERE profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('entitlements', v_count);

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

  -- L1-11. review_schedule (Q3 ruling: L1 — identity-linked SM-2 state, not event data)
  DELETE FROM public.review_schedule WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('review_schedule', v_count);

  -- L1-12. student_kpi_rollups_current (SCL-004: was missing from L1 in both modes)
  DELETE FROM public.student_kpi_rollups_current WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_kpi_rollups_current', v_count);

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
        ('mastery_domain_refresh_audit_log', 'student_id')
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
       SET user_id = NULL, client_attempt_id = NULL
     WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_session_items', v_count);

    -- L2-02. practice_sessions (identity + fingerprint)
    UPDATE public.practice_sessions
       SET user_id = NULL, client_instance_id = NULL
     WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_sessions', v_count);

    -- L2-03. review_error_attempts (identity + fingerprint)
    UPDATE public.review_error_attempts
       SET student_id = NULL, client_attempt_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_error_attempts', v_count);

    -- L2-04. review_session_items (identity only — no fingerprint columns)
    UPDATE public.review_session_items
       SET student_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_session_items', v_count);

    -- L2-05. review_sessions (identity + fingerprint)
    UPDATE public.review_sessions
       SET student_id = NULL, client_instance_id = NULL
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
    -- ANONYMIZED_ACTORS LEDGER (§3.1): record that this actor_id is
    -- anonymized, BEFORE profile deletion destroys the mapping
    -- ====================================================================
    INSERT INTO public.anonymized_actors (actor_id, anonymized_at)
    VALUES (v_actor_id, now())
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
  -- abuse_scores, notification_outbox, legal_acceptances.
  -- profiles.guardian_profile_id SET NULL self-FK fires for other profiles.
  -- Operator-FK edges (36 config/history) were preflight-guarded above.
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
