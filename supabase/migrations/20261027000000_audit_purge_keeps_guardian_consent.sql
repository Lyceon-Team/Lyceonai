-- ===========================================================================
-- Audit purge keeps guardian-link consent rows
--
-- @spec [Doc-01_V8 §5.1 D01:222 ("Guardian consent events | Permanent (anonymized after 1 year) |
--        COPPA compliance evidence"); owner ruling 2026-10-05 C-02 (the guardian_link_* audit rows
--        are the consent records, kept permanently; no one-year anonymising step for live accounts;
--        D01:222 governs over D01:251)]
-- @implemented 2026-10-05
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- plain English: apply_audit_logs_retention('purge_expired') deleted every audit_logs row older
-- than audit_logs_retention_days() (365), with no action filter, so the guardian-link consent
-- rows went at one year. It now skips the three actions guardian_link_audit writes
-- (20260828000000_guardian_link_audited_transitions.sql:114/173/220, and their later redefinitions
-- 20260901000000:87, 20260903000000:616, 20260915000000:95, 20261013000000:94, 20261014000000:79).
--
-- expected outcome: an old consent row survives every purge; every other old row is purged as
-- before. strip_identity is unchanged, so a deleted account's consent rows keep no identity.
--
-- trade-offs: the body is 20260917100000's verbatim except the one predicate; this file is now the
-- function's last definition, and the mutation aimed at its strip_identity branch (M32 in
-- scripts/ci/deletion-evidence-gate.mutations.sh) is re-pointed here in the same change.
-- `guardian_link_redeem` is NOT an audit action (it is a legal_acceptances.consent_source), so it is
-- not listed.
--
-- edge cases: rows kept by this rule still count toward nothing; the purge's batch limit applies
-- only to deletable rows, so a backlog of kept rows can never starve the purge.
--
-- rollback (exact: restores 20260917100000's body): re-run that file's apply_audit_logs_retention
-- definition, i.e. the same function without the `AND b.action NOT IN (...)` line.
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_audit_logs_retention(
  p_action      text,
  p_profile_id  uuid    DEFAULT NULL,
  p_batch_size  integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff timestamptz;
  v_rows   bigint;
BEGIN
  IF p_action NOT IN ('strip_identity', 'purge_expired') THEN
    RAISE EXCEPTION 'apply_audit_logs_retention: unknown action %', p_action USING ERRCODE = '22023';
  END IF;
  IF p_action = 'strip_identity' AND p_profile_id IS NULL THEN
    RAISE EXCEPTION 'apply_audit_logs_retention: strip_identity requires a profile id' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'purge_expired' AND (p_batch_size IS NULL OR p_batch_size < 1) THEN
    RAISE EXCEPTION 'apply_audit_logs_retention: p_batch_size must be >= 1 (got %)', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  -- Open the gate for this transaction only.
  PERFORM set_config('lyceon.audit_logs_retention', 'on', true);

  IF p_action = 'strip_identity' THEN
    UPDATE public.audit_logs
       SET actor_profile_id  = NULL,
           target_profile_id = NULL
     WHERE actor_profile_id = p_profile_id
        OR target_profile_id = p_profile_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    -- Close it again, so nothing later in THIS transaction inherits the exemption.
    PERFORM set_config('lyceon.audit_logs_retention', 'off', true);
    RETURN jsonb_build_object('action', p_action, 'rows', v_rows, 'cutoff', NULL);
  END IF;

  v_cutoff := now() - make_interval(days => public.audit_logs_retention_days());

  -- Guardian-link consent rows are never purged by age (D01:222; owner ruling 2026-10-05 C-02).
  -- The three actions are exactly those guardian_link_audit writes; strip_identity still severs
  -- their actor/target at account deletion.
  DELETE FROM public.audit_logs a
   WHERE a.id IN (
     SELECT b.id FROM public.audit_logs b
      WHERE b.created_at < v_cutoff
        AND b.action NOT IN ('guardian_link_initiated', 'guardian_link_accepted', 'guardian_link_revoked')
      ORDER BY b.created_at
      LIMIT p_batch_size
   );
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  PERFORM set_config('lyceon.audit_logs_retention', 'off', true);
  RETURN jsonb_build_object('action', p_action, 'rows', v_rows, 'cutoff', v_cutoff);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_audit_logs_retention(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_audit_logs_retention(text, uuid, integer) TO service_role;

COMMIT;
