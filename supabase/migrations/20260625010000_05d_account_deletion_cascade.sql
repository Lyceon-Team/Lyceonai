-- ============================================================================
-- 05D §10 Account-Deletion Cascade — HARD-DELETE mode (PR-3)
-- ============================================================================
-- @spec [Doc-05D_V1, §10 Account-Deletion Cascade & One-Way Anonymization]
-- @implemented [2026-06-25]
-- plain English: single-transaction cascade that hard-deletes ALL derived state
--   (Layer 1: mastery/KPI/projections, Layer 2: practice/review event + audit rows)
--   for a completed deletion request. Clears RESTRICT FKs, deletes event sources,
--   then deletes the profile + auth.users row. Storage purge is NOT done here —
--   storage.protect_delete() blocks direct SQL; PR-4 orchestration purges via API.
--   LYCEON-MIGRATION-REVIEWED (storage-purge removal — protect_delete trigger) Idempotent: re-run on an already-
--   deleted profile is a clean no-op. The 'anonymize' privacy mode is stubbed but
--   not enabled (BLOCKING_PRIVACY_GAP §10.4 — requires privacy/compliance sign-off).
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- FK-SAFETY: every DELETE respects child-before-parent ordering. The ONLY FK
--   constraints dropped are on audit_logs (actor_profile_id, target_profile_id) —
--   converted to plain UUID columns (opaque historical refs). All practice/review
--   FKs to profiles remain intact and enforced; rows are deleted explicitly before
--   profile deletion. 36 operator-identity FK edges (*_config + *_config_history
--   updated_by/changed_by_profile_id) are preflight-guarded: cascade refuses with
--   PROFILE_HAS_OPERATIONAL_CONFIG_REFERENCES before any destructive step.
--   LYCEON-MIGRATION-REVIEWED
--
-- PR-4 reuse: the cron driver (grace-expiry) selects qualifying profiles and calls
--   this function in a loop. PR-4 adds ZERO schema.
--
-- OWNER RULINGS (applied):
--   Q2: deletion request row is DELETED (not preserved) by the cascade. §10.5
--       "remains in soft-delete state" is satisfied by transactional rollback on
--       failure — the request survives if cascade fails. On success, the request
--       row is consumed and gone with the profile.
--   Q3: review_schedule added as L1 table #11 (spec §10.2 lists 10; Q3 ruling
--       classifies review_schedule as identity-linked SM-2 state, not event data).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DDL — Drop audit_logs FK constraints (Q6 ruling)
-- ----------------------------------------------------------------------------
-- audit_logs has a prevent_update_delete trigger (genesis line 275) making rows
-- immutable. The FK constraints on actor_profile_id / target_profile_id block
-- profile deletion (NO ACTION). Dropping them converts the columns to plain UUID
-- references — historical audit rows keep the original profile UUID as an opaque
-- identifier. The immutability trigger is UNTOUCHED.

ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_actor_profile_id_fkey;

ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_target_profile_id_fkey;

-- ----------------------------------------------------------------------------
-- 2. CASCADE FUNCTION
-- ----------------------------------------------------------------------------

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
  v_op_ref   record;  -- LYCEON-MIGRATION-REVIEWED (operator-FK preflight guard)
BEGIN
  -- ========================================================================
  -- PRIVACY MODE GUARD
  -- ========================================================================
  -- 'anonymize' mode deferred: BLOCKING_PRIVACY_GAP (§10.4). The surrogate/FK
  -- design (Layer 2 UPDATE with v_surrogate) requires either FK drops or a
  -- tombstone profile row — deferred to a post-counsel PR.
  IF p_privacy_mode = 'anonymize' THEN
    RAISE EXCEPTION 'anonymize mode not yet enabled — BLOCKING_PRIVACY_GAP (§10.4). '
      'Layer 2 anonymization requires privacy/compliance sign-off + FK resolution. '
      'Use hard_delete (default) until then.';
  END IF;
  IF p_privacy_mode <> 'hard_delete' THEN
    RAISE EXCEPTION 'unknown p_privacy_mode: %. Valid: hard_delete', p_privacy_mode;
  END IF;

  -- ========================================================================
  -- IDEMPOTENCY: profile already gone → clean no-op (§10.5)
  -- ========================================================================
  -- §10.5 defines idempotency as "the function may be called again … identical
  -- result." In hard-delete mode the profile row IS the idempotency signal:
  -- absent profile ⟹ cascade already completed ⟹ return no_op. The deletion
  -- request row is also gone (Q2 ruling), so profile absence is the only
  -- durable signal. This deviates from §10.5's assumption that the request
  -- "remains in soft-delete state," which is satisfied instead by
  -- transactional rollback on failure. LYCEON-MIGRATION-REVIEWED
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RETURN jsonb_build_object('status', 'no_op', 'reason', 'profile does not exist (already cascaded)');
  END IF;

  -- ========================================================================
  -- STATUS GUARD: require a completed deletion request
  -- ========================================================================
  -- The cron driver (PR-4) updates the request to 'completed' after running
  -- deidentify_user, then calls this function. Prevents accidental cascade
  -- of profiles that haven't gone through the full grace-period flow.
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_requests
     WHERE profile_id = p_profile_id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'no completed deletion request for profile %. '
      'The cron driver must mark the request completed (after deidentify_user) before calling cascade.',
      p_profile_id;
  END IF;

  -- ========================================================================
  -- OPERATOR-FK PREFLIGHT GUARD (fail-closed, before ANY destructive step)
  -- ========================================================================
  -- 36 operator-identity FK edges (updated_by_profile_id / changed_by_profile_id
  -- across 18 *_config + 18 *_config_history governance tables). Operator
  -- attribution is governance data — must BLOCK deletion until consciously
  -- reassigned (same posture as the RESTRICT identity seam). The guard
  -- refuses cascade with a clear error BEFORE any rows are deleted.
  --
  -- FK-surface exhaustive partition (59 edges total, proven 2026-06-25):
  --   5 auto-CASCADE  (abuse_score_incidents, abuse_scores, legal_acceptances,
  --                     notification_outbox, rate_limit_ledger)
  --   1 auto-SET-NULL (profiles.guardian_profile_id self-FK)
  --   9 pre-cleared   (entitlements, 4×guardian_links, 2×guardian_consent_requests,
  --                     2×account_deletion_requests)
  --   6 L1/L2-deleted (review_schedule, practice_sessions, practice_session_items,
  --                     review_sessions, review_session_items, review_error_attempts)
  --   2 dropped       (audit_logs actor/target — Q6 ruling)
  --  36 operator-guarded (this preflight)
  --  ── ─────────────────────────────────────────────────────
  --  59 total = complete partition, no edge unaccounted
  -- LYCEON-MIGRATION-REVIEWED
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
  -- Doc-01 identity seam. Raw DELETE for now; if Doc-01 later adds
  -- entitlement/Stripe teardown logic, this seam calls into it.

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
  -- If this profile is the actor for ANOTHER profile's deletion request
  -- (e.g., guardian requested student's deletion, now guardian is being deleted),
  -- reassign actor to the other request's own profile (self-requested). The
  -- NOT NULL constraint prevents SET NULL; this preserves the pending deletion.
  UPDATE public.account_deletion_requests
     SET actor_profile_id = profile_id
   WHERE actor_profile_id = p_profile_id AND profile_id <> p_profile_id;

  -- PS-5. account_deletion_requests — delete THIS profile's request rows
  -- (profile_id → profiles ON DELETE RESTRICT; actor_profile_id → profiles NO ACTION)
  -- Deleting the row releases both FKs.
  DELETE FROM public.account_deletion_requests WHERE profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('account_deletion_requests', v_count);

  -- ========================================================================
  -- LAYER 1: Hard-delete identity-linked derived state (§10.2 steps 1–10 + review_schedule)
  -- ========================================================================
  -- No FK between these tables; the listed order is canonical per spec.
  -- None have FK to profiles (student_id is by convention only).

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

  -- L1-11. review_schedule (Q3 ruling: L1 hard-delete — identity-linked SM-2 state, not event data)
  DELETE FROM public.review_schedule WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('review_schedule', v_count);

  -- ========================================================================
  -- LAYER 2: Hard-delete event/audit sources (§10.4 conservative fallback)
  -- ========================================================================
  -- Children-before-parent FK-safe order. practice_session_items and
  -- review_error_attempts are the canonical mastery event sources (seam §2 R1).
  -- In hard-delete mode, all event + session + audit rows are removed.

  -- L2-01. practice_session_items (child of practice_sessions via ON DELETE CASCADE)
  DELETE FROM public.practice_session_items WHERE user_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('practice_session_items', v_count);

  -- L2-02. practice_sessions (parent — children already deleted in L2-01)
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

  -- L2-05. review_sessions (parent — children already deleted in L2-03/L2-04)
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

  -- ========================================================================
  -- PROFILE + AUTH DELETE
  -- ========================================================================
  -- All child rows with FKs to profiles are now deleted. The remaining CASCADE
  -- FKs fire automatically: rate_limit_ledger, abuse_score_incidents,
  -- abuse_scores, notification_outbox, legal_acceptances.
  -- audit_logs FKs were dropped (DDL above) — rows remain as opaque refs.
  -- profiles.guardian_profile_id SET NULL self-FK fires for other profiles
  -- that reference this profile as their guardian.
  -- Operator-FK edges (36 config/history tables) were preflight-guarded above.
  -- LYCEON-MIGRATION-REVIEWED

  DELETE FROM public.profiles WHERE id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('profiles', v_count);

  -- Storage purge is OWNED BY THE PR-4 orchestration layer: the grace-expiry
  -- edge function calls the Supabase Storage API to delete the user's objects
  -- BEFORE invoking this cascade. Direct DELETE FROM storage.objects is blocked
  -- by storage.protect_delete() — storage deletion is an API operation, not a
  -- SQL one. See §10 storage-purge seam (PR-4).
  -- GAP-PR4-STORAGE: PR-4 grace-expiry driver must purge storage.objects via
  -- the Supabase Storage API BEFORE calling execute_account_deletion_cascade;
  -- SQL cascade cannot delete storage (protect_delete trigger).
  -- LYCEON-MIGRATION-REVIEWED

  -- auth.users — profiles.id REFERENCES auth.users(id) ON DELETE RESTRICT.
  -- The profile row is gone, so the RESTRICT is released.
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

-- ----------------------------------------------------------------------------
-- DOWN (reversible)
-- ----------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.execute_account_deletion_cascade(uuid, text);
-- ALTER TABLE public.audit_logs
--   ADD CONSTRAINT audit_logs_actor_profile_id_fkey
--     FOREIGN KEY (actor_profile_id) REFERENCES public.profiles(id);
-- ALTER TABLE public.audit_logs
--   ADD CONSTRAINT audit_logs_target_profile_id_fkey
--     FOREIGN KEY (target_profile_id) REFERENCES public.profiles(id);
