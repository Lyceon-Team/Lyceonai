-- ============================================================================
-- E4 — ACTIVATE scoring model v1.0 (Doc 04B V4.3 §8.4 Tier-3 step 5)
-- ============================================================================
--
--   ***  POINT OF NO RETURN FOR THE v1.0 CONSTANTS SEAL  ***
--   Once this commits, trg_prevent_active_scoring_constants_mutation (E2,
--   §8.4) refuses every INSERT, UPDATE and DELETE on scoring_constants rows of
--   v1.0, and the status machine refuses active -> candidate. The 13 Appendix
--   A values, and the two CHECKs added by 20260930040000 (D11), are final for
--   v1.0. Any change after this is a new scoring model version (§23.1 Tier 3).
--
-- @spec [Doc-04B_V4.3, §7.2 (attestation CHECK, status machine stamps
--        published_at), §7.3 (three-field attestation), §8.4 Tier 3 step 5,
--        §18.2 / Appendix B (packet hash), §21.2 (lock-time validation)]
-- @implemented [2026-09-24]
--
-- plain English: the legitimate candidate -> active UPDATE of v1.0. It writes
--   constants_sha256 := scoring_constants_sha256('v1.0') (E2's in-database
--   serializer — the only one), validation_packet_url := the repo-hosted
--   packet, and status := 'active'; the E2 status-machine trigger stamps
--   published_at. validation_packet_sha256 was set by E2 and is re-asserted
--   here. The migration then FAILS unless the stored constants hash equals a
--   fresh recomputation AND the ruled literal.
--
-- expected outcome: v1.0 is active, fully attested; forms can publish against
--   it (04A §6.2 gate (a)); score_test_session_from_outbox scores against it.
--
-- OWNER RULINGS carried here:
--   * separate activation file, same PR as the engine (E4 brief);
--   * packet is repo-hosted: scripts/ci/fixtures/scoring-v1.0 (byte-identical
--     reproduction of the Appendix B packet; scripts/ci/scoring-evidence-
--     packet-check.sh recomputes 29c3e0fd… from the committed files). The
--     attested value is the content hash; the URL need not pin a commit;
--   * §21.2's lock-time Python<->PL/pgSQL parity is ALSO run per deploy
--     (scripts/ci/scoring-parity.sh) — owner override of §21.2.
--
-- trade-offs / edge cases:
--   * published_at is the apply time (trigger COALESCE(NULL, now())), not
--     §7.3's illustrative '2026-05-12T00:00:00Z': the attestation is true from
--     the moment it is made, not from the document date.
--   * The WHERE status = 'candidate' guard + row-count assertion make a
--     re-run against an already-active database fail loudly instead of
--     silently doing nothing.
--
-- OWNER-RUN: applied through the tracked pipeline (`supabase db push`),
--   strictly AFTER 20260930040000_scoring_engine.sql. NOT APPLIED TO PROD BY
--   THIS CHANGE.
--
-- ROLLBACK (INV-06): NONE BY DESIGN. The E2 status machine forbids
--   active -> candidate ("Cannot downgrade scoring_model_versions from active
--   to candidate"), and the seal forbids touching the constants. Undoing
--   activation means superseding v1.0 with a new version (Tier 3), never
--   reverting it. Before COMMIT the migration is transactional: any failed
--   assertion below rolls the whole activation back.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — irreversible by
--   design (§8.4 / §7.2 status machine); forward-fix only via a new version.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  k_constants_sha256 CONSTANT text := '5a51132234b2d1654b5362943af2d1fef59eadbc57ed6af50a44211a735680d1';
  k_packet_sha256    CONSTANT text := '29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b';
  k_packet_url       CONSTANT text := 'https://github.com/Lyceon-Team/Lyceonai/tree/exam/scripts/ci/fixtures/scoring-v1.0';
  v_rows    int;
  v_row     public.scoring_model_versions%ROWTYPE;
  v_recomputed text;
BEGIN
  -- Pre-flight: the constants about to be sealed hash to the ruled value.
  v_recomputed := public.scoring_constants_sha256('v1.0');
  IF v_recomputed IS DISTINCT FROM k_constants_sha256 THEN
    RAISE EXCEPTION 'v1.0 activation refused: constants hash % <> ruled %', v_recomputed, k_constants_sha256
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- §8.4 Tier-3 step 5.
  UPDATE public.scoring_model_versions
     SET constants_sha256      = public.scoring_constants_sha256('v1.0'),
         validation_packet_url = k_packet_url,
         status                = 'active'
   WHERE version = 'v1.0'
     AND status = 'candidate';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'v1.0 activation refused: expected exactly 1 candidate v1.0 row, updated %', v_rows
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Post-conditions: stored == recomputed == literal; attestation complete.
  SELECT * INTO v_row FROM public.scoring_model_versions WHERE version = 'v1.0';
  v_recomputed := public.scoring_constants_sha256('v1.0');
  IF v_row.status IS DISTINCT FROM 'active'
     OR v_row.published_at IS NULL
     OR v_row.constants_sha256 IS DISTINCT FROM v_recomputed
     OR v_row.constants_sha256 IS DISTINCT FROM k_constants_sha256
     OR v_row.validation_packet_sha256 IS DISTINCT FROM k_packet_sha256
     OR v_row.validation_packet_url IS DISTINCT FROM k_packet_url THEN
    RAISE EXCEPTION 'v1.0 activation refused: post-condition failed: %', row_to_json(v_row)
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RAISE NOTICE 'v1.0 ACTIVE: constants_sha256=% validation_packet_sha256=% url=% published_at=%',
    v_row.constants_sha256, v_row.validation_packet_sha256, v_row.validation_packet_url, v_row.published_at;
END
$$;

COMMIT;
