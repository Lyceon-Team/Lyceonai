-- ===========================================================================
-- DELETION PHASE 5 — retention sweeps, and the runtime config wired at last
-- ===========================================================================
-- @spec [SCL-085 PROPOSED (24-month evidence clock: "strip identity rather than deleting";
--        what survives is the dated aggregate); Doc-01_V8 §5.1 (audit_logs purged after
--        `account_deletion_runtime_config.anonymization_retention_days`); Doc-01_V8 App A.5
--        (grace_period_days 7, scheduled_deletion_job_cron daily_at_02_utc,
--        anonymization_retention_days 365); SCL-087 PROPOSED (the purge runs through the one
--        exempt function); owner brief 2026-09-17 "Deletion Vertical: Phases 2, 3, 5" §5]
--        | @implemented [2026-09-17]
--
-- plain English: the evidence bundle has had no expiry since it was built, and
-- `account_deletion_runtime_config` has existed since genesis holding nothing, read by nobody,
-- while the two constants it was meant to own sat hardcoded in a route and a function default.
-- This closes both.
--
-- WHY THE EVIDENCE SWEEP STRIPS AND DOES NOT DELETE. SCL-085's whole shape is that the dated,
-- aggregate record survives permanently — how many deletions, on what dates, with what outcome,
-- consent obtained by what method — because that is what answers a regulator years later, and
-- it answers them without retaining anybody. Deleting the rows would destroy the answer along
-- with the identity. So the sweep NULLs the identity columns and leaves the row.
--
-- WHY subject_email AND requester_email LOSE THEIR NOT NULL. They were NOT NULL because a
-- deletion request with no subject is meaningless at the moment it is made. After the strip the
-- row means something different — "a request was made and answered on these dates" — and NULL
-- is the honest representation of an address we have deliberately destroyed. A sentinel string
-- would be a second way to say NULL, and a reader would have to know it.
--
-- WHY THE DO-NOT-CONTACT PROMISE OUTLIVES THIS SWEEP WITHOUT AN EXEMPTION. The promise is kept
-- by an entry on Resend's team suppression list, which this function cannot reach and no
-- retention window here can expire. There is nothing to exempt: a promise with no end date is
-- not stored in a table that gets stripped at 24 months. What this sweep DOES end is our ability
-- to RETRY a suppression that never landed — `subject_email` is the only address a retry has, so
-- a row still `failed_manual` after 24 months of daily attempts stops being retryable. That is
-- the correct trade: two years of failures is a standing page, not a race to be won later.
--
-- WHAT DRIVES THE CLOCK. `responded_on` — the date the request reached a terminal outcome — and
-- only for rows that HAVE one. A row still `pending` or `executing` has not finished, so its
-- retention clock has not started; those belong to `reconcile_deletion_log`, not here. A sweep
-- that stripped a live request would erase the address of somebody whose deletion is still
-- running.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- Apply order: THIRD of three (20260917100000, 20260917110000, then this file).
-- It reads `public.apply_audit_logs_retention` indirectly (the executor calls it) and seeds the
-- row that `public.audit_logs_retention_days()` from the first file reads.
-- ===========================================================================

BEGIN;

-- ===========================================================================
-- PART 1 — App A.5, seeded at last
-- ===========================================================================
-- Three of App A.5's four keys. `guardian_pending_deletion_visibility` is deliberately NOT
-- seeded: nothing reads it (the guardian pending-deletion indicator is unbuilt), and a config
-- row with no reader is a value that drifts from behaviour without anyone noticing.
--
-- `scheduled_deletion_job_cron` is DESCRIPTIVE, not load-bearing: Vercel reads vercel.json at
-- deploy time and cannot read this table. The row records the intended schedule so the spec, the
-- config and the deployed cron can be compared — and the PG suite compares the seeded value
-- against vercel.json so they cannot drift apart silently.
INSERT INTO public.account_deletion_runtime_config
  (key, value, value_type, min_value, max_value, owner, description, environment)
VALUES
  ('grace_period_days', '7'::jsonb, 'integer', '1'::jsonb, '30'::jsonb, 'Product',
   'Soft-delete grace before hard delete (Doc 01 V8 App A.5).', 'all'),
  ('anonymization_retention_days', '365'::jsonb, 'integer', '30'::jsonb, '3650'::jsonb, 'Product',
   'How long anonymized audit rows are retained before the purge (Doc 01 V8 §5.1 / App A.5).', 'all'),
  ('scheduled_deletion_job_cron', '"daily_at_02_utc"'::jsonb, 'string', NULL, NULL, 'Engineering',
   'Schedule for the T+7 deletion job. Descriptive: Vercel reads vercel.json; this row is the declared intent the PG suite holds vercel.json to.', 'all')
ON CONFLICT (key) DO NOTHING;

-- ===========================================================================
-- PART 2 — the evidence window, defined once
-- ===========================================================================
-- Per SCL-085. One definition; nothing else in the schema states "24". The sweep reads it and
-- the PG suite asserts it, so changing the period is one edit here.
CREATE OR REPLACE FUNCTION public.deletion_evidence_retention_months()
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT 24;
$$;

-- ===========================================================================
-- PART 3 — the columns the strip must be allowed to empty
-- ===========================================================================
ALTER TABLE public.deletion_request_log ALTER COLUMN subject_email   DROP NOT NULL;
ALTER TABLE public.deletion_request_log ALTER COLUMN requester_email DROP NOT NULL;

COMMENT ON COLUMN public.deletion_request_log.subject_email IS
  'The deleted account address. NULL once the 24-month strip has run (SCL-085): the row then carries only the dated aggregate — when it was asked, when it was answered, the outcome.';
COMMENT ON COLUMN public.deletion_request_log.requester_email IS
  'Who asked; equals subject for self-service. NULL after the 24-month strip, as above.';

-- ===========================================================================
-- PART 4 — the evidence strip
-- ===========================================================================
-- Strips identity from terminal log rows past the window and from the consent evidence attached
-- to them, oldest first, at most p_batch_size log rows per call. Returns what it changed AND the
-- cutoff it used, so a run that changed nothing is distinguishable in the logs from a run that
-- never happened.
--
-- IDEMPOTENT WITHOUT A MARKER COLUMN: a stripped row has `subject_email IS NULL`, which is the
-- selection's own exclusion. A second column recording "stripped" would be a second way to ask
-- the same question, and a timestamp column would violate the bundle's no-timestamp rule.
CREATE OR REPLACE FUNCTION public.sweep_deletion_evidence(p_batch_size integer)
RETURNS TABLE (
  stripped_log_rows     integer,
  stripped_consent_rows integer,
  cutoff                date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff  date;
  v_ids     uuid[];
  v_logs    integer;
  v_consent integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    RAISE EXCEPTION 'sweep_deletion_evidence: p_batch_size must be >= 1 (got %)', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  v_cutoff := ((now() AT TIME ZONE 'utc')::date
               - make_interval(months => public.deletion_evidence_retention_months()))::date;

  SELECT array_agg(l.log_id ORDER BY l.log_id)
    INTO v_ids
    FROM (
      SELECT r.log_id
        FROM public.deletion_request_log r
       WHERE r.status IN ('completed', 'cancelled', 'denied')
         AND r.responded_on IS NOT NULL
         AND r.responded_on < v_cutoff
         AND (r.subject_email IS NOT NULL OR r.requester_email IS NOT NULL)
       ORDER BY r.responded_on, r.log_id
       LIMIT p_batch_size
    ) l;

  IF v_ids IS NULL THEN
    RETURN QUERY SELECT 0, 0, v_cutoff;
    RETURN;
  END IF;

  -- The identity columns, and only those. requested_on, responded_on, status and denial_basis
  -- are the aggregate the entry exists to keep.
  UPDATE public.deletion_request_log
     SET subject_email = NULL, requester_email = NULL
   WHERE log_id = ANY (v_ids);
  GET DIAGNOSTICS v_logs = ROW_COUNT;

  -- Consent evidence rides the same clock (SCL-085, one clock for the whole bundle). doc_key,
  -- doc_version, actor_type, minor, consent_source and accepted_on survive: that tuple is what
  -- defends a COPPA claim, and none of it identifies anyone once the network and the browser
  -- family are gone.
  UPDATE public.deletion_consent_evidence
     SET ip_address = NULL, user_agent = NULL
   WHERE log_id = ANY (v_ids)
     AND (ip_address IS NOT NULL OR user_agent IS NOT NULL);
  GET DIAGNOSTICS v_consent = ROW_COUNT;

  -- Nothing here touches the do-not-contact promise: it is an entry on Resend's suppression
  -- list, not a row in this database. See the header.

  RETURN QUERY SELECT v_logs, v_consent, v_cutoff;
END;
$$;
REVOKE ALL ON FUNCTION public.sweep_deletion_evidence(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_deletion_evidence(integer) TO service_role;

COMMIT;
