-- ===========================================================================
-- DELETION PHASE 2 — suppression (do-not-contact), evidence side
-- ===========================================================================
-- @spec [ICO direct-marketing and erasure guidance (a suppression list is the endorsed way to
--        honour "delete me and never contact me again" — "you should use one ... instead of
--        just deleting their details"); SCL-085 PROPOSED (the evidence bundle and its 24-month
--        clock; suppression is the one member exempt from the strip); plan v4 §3.6;
--        owner brief 2026-09-17 "Deletion Vertical: Phases 2, 3, 5" §2]
--        | @implemented [2026-09-17]
--
-- plain English: deleting an account destroys the address, which is exactly what makes
-- "never contact me again" hard to keep — there is nothing left to compare an outgoing message
-- against. This table is the minimum that keeps the promise enforceable: a keyed hash of the
-- address, and nothing else.
--
-- WHY A KEYED HASH AND NOT THE ADDRESS. The record persists for as long as the suppression
-- stands, which is indefinitely. A plaintext column would therefore be a permanent list of the
-- email addresses of deleted accounts — mostly minors — which is a worse artefact than the one
-- deletion was asked to remove. The hash is HMAC-SHA256 under `SUPPRESSION_HMAC_SECRET`, which
-- lives in the application environment and never in the database: a reader of this table alone
-- cannot test a candidate address, and a reader of a database backup alone cannot either.
-- Rotating the secret invalidates every stored hash and requires re-hashing the table from the
-- addresses, which no longer exist — so the secret is effectively non-rotatable while
-- suppressions stand. That is stated here, in `contracts/notifications.contract.md` and in the
-- secret-class inventory rather than discovered later.
--
-- WHY IT IS ON THE EVIDENCE SIDE AND KEYED BY log_id. It is part of the record of what was asked
-- and what was done, so it takes the bundle's constraints: no timestamp column, no key into the
-- pseudonymous graph, RLS on with no policies, service_role reads only, writes through the
-- gated function below. The address hash is not such a key — it is derived from an identifier
-- that the actor_id side has never held.
--
-- WHAT IT DOES NOT DO. It does not block re-registration, and nothing here is consulted at
-- signup. Refusing a suppressed address at signup would turn the registration form into an
-- oracle for "was this address once deleted", and would lock out a student who wants to come
-- back — which the deletion flow explicitly invites them to do.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- Apply order: SECOND of three (20260917100000, then this file, then 20260917120000).
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.deletion_suppression (
  log_id        uuid PRIMARY KEY REFERENCES public.deletion_request_log(log_id) ON DELETE CASCADE,
  address_hash  text NOT NULL UNIQUE
);

COMMENT ON TABLE public.deletion_suppression IS
  'Do-not-contact records for deleted accounts (owner brief 2026-09-17 §2). One row per deletion request that asked for suppression. Evidence-bundle constraints: no timestamp column, no identity-graph key, RLS on with zero policies. EXEMPT from the 24-month evidence strip — the record is what makes the promise enforceable, so it lives as long as the suppression stands.';
COMMENT ON COLUMN public.deletion_suppression.address_hash IS
  'HMAC-SHA256 of the lowercased, trimmed address under SUPPRESSION_HMAC_SECRET, computed in the application. The secret is never stored in the database, so this table alone cannot test a candidate address.';
-- There is deliberately no "synced with the provider" column. Whether the provider accepted the
-- address is an operational fact about one API call, not part of the record of what was asked and
-- done, and it is already in the logs. A column would be a second place to keep it in step.

ALTER TABLE public.deletion_suppression ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deletion_suppression FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.deletion_suppression TO service_role;

-- ---------------------------------------------------------------------------
-- The write, gated on what the person actually asked for
-- ---------------------------------------------------------------------------
-- The truth of "did they ask to be suppressed" lives in ONE place —
-- `deletion_request_log.suppression_requested` — and is checked here rather than trusted from
-- the caller, so a bug in the executor cannot manufacture a suppression the person never
-- requested, nor drop one they did. Idempotent on both keys: re-running a pass, or a person who
-- deletes, returns and deletes again, must not raise.
CREATE OR REPLACE FUNCTION public.record_deletion_suppression(
  p_log_id       uuid,
  p_address_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requested boolean;
  v_rows      bigint;
BEGIN
  IF p_address_hash IS NULL OR btrim(p_address_hash) = '' THEN
    RAISE EXCEPTION 'record_deletion_suppression: address hash is required' USING ERRCODE = '22023';
  END IF;

  SELECT l.suppression_requested INTO v_requested
    FROM public.deletion_request_log l
   WHERE l.log_id = p_log_id;

  IF v_requested IS NULL THEN
    RAISE EXCEPTION 'record_deletion_suppression: no deletion request log row %', p_log_id
      USING ERRCODE = '22023';
  END IF;

  -- `requested` is returned, not just acted on: it is what the caller gates the PROVIDER call
  -- on. Suppressing an address at the provider for somebody who never asked would block their
  -- mail for ever, including after they come back and register again.
  IF NOT v_requested THEN
    RETURN jsonb_build_object('recorded', 0, 'requested', false);
  END IF;

  INSERT INTO public.deletion_suppression (log_id, address_hash)
  VALUES (p_log_id, p_address_hash)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object('recorded', v_rows, 'requested', true);
END;
$$;
REVOKE ALL ON FUNCTION public.record_deletion_suppression(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_deletion_suppression(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- The read, for the send paths
-- ---------------------------------------------------------------------------
-- Takes a hash, never an address: the caller has the secret and does the hashing, so no address
-- crosses into the database on the read path either.
CREATE OR REPLACE FUNCTION public.is_address_suppressed(p_address_hash text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.deletion_suppression s WHERE s.address_hash = p_address_hash
  );
$$;
REVOKE ALL ON FUNCTION public.is_address_suppressed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_address_suppressed(text) TO service_role;

COMMIT;
