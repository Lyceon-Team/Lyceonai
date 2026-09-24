-- ============================================================================
-- SCORING CATALOGUE GATES — every §7.2 / §8.1 / §8.2 / §8.4 constraint observed
-- rejecting (or accepting) what the spec says it must.
-- ============================================================================
-- @spec [Doc-04B_V4.3, §7.2, §7.3, §8.1, §8.2, §8.4, Appendix A]
-- @implemented [2026-09-23]
--
-- plain English: runs against a genesis-fresh-applied database. Each named
--   check sits in its own transaction that is ROLLED BACK, so the checks are
--   independent and the seeded catalogue is left exactly as the migration
--   wrote it. A check passes only by printing its own `ok   [Cn ...]` NOTICE;
--   scripts/ci/scoring-catalogue-gates.sh requires every expected id to print
--   and no ERROR to appear. A failed assertion raises
--   `SCG FAIL [Cn ...]: <why>`, naming the check.
--
-- Every rejection check asserts the SPECIFIC SQLSTATE and constraint name or
--   message — "some error happened" is not a pass, because an unrelated error
--   (a typo, a missing grant) would otherwise masquerade as the constraint.
--
-- C1 (the two-session race against the partial unique index) cannot be written
--   in one session: the friendly trigger fires first there, and hides the
--   index. It lives in the .sh runner. S1 below covers the trigger.
--
-- The activation used by C2/C3/C4/C8 is the legitimate §8.4 Tier-3 step 5
--   UPDATE (all attestation fields populated, published_at stamped by the
--   status-machine trigger), done inside the rolled-back transaction.
-- ============================================================================

\set ON_ERROR_STOP 0
SET client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- P1 — seed shape: exactly 1 version row, 13 constants, Appendix A verbatim.
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_versions int;
  v_constants int;
  v_row public.scoring_model_versions%ROWTYPE;
  v_mismatch text;
BEGIN
  SELECT count(*) INTO v_versions FROM public.scoring_model_versions;
  SELECT count(*) INTO v_constants FROM public.scoring_constants;
  IF v_versions <> 1 OR v_constants <> 13 THEN
    RAISE EXCEPTION 'SCG FAIL [P1 seed-shape]: expected 1 version / 13 constants, got % / %',
      v_versions, v_constants;
  END IF;

  SELECT * INTO v_row FROM public.scoring_model_versions WHERE version = 'v1.0';
  IF v_row.status IS DISTINCT FROM 'candidate'
     OR v_row.formula_name IS DISTINCT FROM 'option_a_banded_ceiling'
     OR v_row.formula_doc_ref IS DISTINCT FROM 'Doc 04B V4.3 §6'
     OR v_row.validation_packet_sha256 IS DISTINCT FROM '29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b'
     OR v_row.constants_sha256 IS NOT NULL
     OR v_row.validation_packet_url IS NOT NULL
     OR v_row.published_at IS NOT NULL
     OR v_row.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'SCG FAIL [P1 seed-shape]: v1.0 row is not the ruled candidate row: %', row_to_json(v_row);
  END IF;

  -- Appendix A, verbatim. Every key global; values compared as numeric.
  WITH expected(key, value) AS (VALUES
    ('alpha_ceiling_exponent', 0.5::numeric), ('ceiling_floor', 430), ('ceiling_max', 800),
    ('deduction_easy', 15), ('deduction_medium', 9), ('deduction_hard', 6),
    ('raw_floor_base', 200), ('raw_floor_multiplier', 400), ('path_a_floor', 200),
    ('path_b_floor_base', 450), ('path_b_floor_bonus_per_m1_point', 15),
    ('path_b_floor_cap', 580), ('round_to_nearest', 10))
  SELECT string_agg(coalesce(e.key, c.key), ', ') INTO v_mismatch
  FROM expected e
  FULL JOIN (SELECT key, value FROM public.scoring_constants
             WHERE scoring_model_version = 'v1.0' AND section IS NULL) c USING (key)
  WHERE e.value IS DISTINCT FROM c.value;
  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'SCG FAIL [P1 seed-shape]: constants differ from Appendix A: %', v_mismatch;
  END IF;

  -- …and the helper returns each of them.
  IF public.scoring_constant('v1.0', 'alpha_ceiling_exponent') <> 0.5
     OR public.scoring_constant('v1.0', 'path_b_floor_cap', 'math') <> 580 THEN
    RAISE EXCEPTION 'SCG FAIL [P1 seed-shape]: scoring_constant() did not return the seeded value';
  END IF;
  RAISE NOTICE 'ok   [P1 seed-shape] 1 version (v1.0 candidate, packet hash set), 13 Appendix A constants';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- G1 — privileges: RLS on; anon/authenticated hold nothing; service_role SELECT
-- only on the tables and EXECUTE only on scoring_constant().
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_tables
  WHERE schemaname = 'public' AND tablename IN ('scoring_model_versions', 'scoring_constants')
    AND rowsecurity;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'SCG FAIL [G1 privileges]: RLS enabled on % of 2 catalogue tables', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name IN ('scoring_model_versions', 'scoring_constants')
    AND (grantee IN ('anon', 'authenticated', 'PUBLIC')
         OR (grantee = 'service_role' AND privilege_type <> 'SELECT'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'SCG FAIL [G1 privileges]: % excess table grant(s) on the catalogue', v_n;
  END IF;

  IF has_function_privilege('anon', 'public.scoring_constant(text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.scoring_constant(text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.scoring_constant(text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SCG FAIL [G1 privileges]: scoring_constant() EXECUTE is not service_role-only';
  END IF;
  IF has_function_privilege('anon', 'public.scoring_constants_sha256(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.scoring_constants_sha256(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.scoring_constants_sha256(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SCG FAIL [G1 privileges]: scoring_constants_sha256() EXECUTE is not service_role-only';
  END IF;
  RAISE NOTICE 'ok   [G1 privileges] RLS on both; service_role SELECT only; helpers EXECUTE service_role only';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- S1 — friendly single-active trigger, sequential case. With one committed
-- active row, a second active INSERT is refused by the trigger's message
-- (the index never gets the chance). C1 in the runner covers the race.
-- ---------------------------------------------------------------------------
BEGIN;
UPDATE public.scoring_model_versions
   SET status = 'active',
       constants_sha256 = 'gate-fixture',
       validation_packet_url = 'git://lyceon-spec/04B/v4.3/evidence_packet_v42/'
 WHERE version = 'v1.0';
DO $$
DECLARE
  v_raised boolean := false; v_state text; v_msg text;
BEGIN
  BEGIN
    INSERT INTO public.scoring_model_versions
      (version, formula_name, formula_doc_ref, constants_sha256, validation_packet_sha256,
       validation_packet_url, status, published_at)
    VALUES ('zz_s1', 'f', 'd', 'h', 'p', 'u', 'active', now());
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCG FAIL [S1 single-active-friendly-trigger]: second active row was accepted';
  END IF;
  IF v_state <> 'P0001' OR v_msg <> 'Only one scoring model version may be active at a time' THEN
    RAISE EXCEPTION 'SCG FAIL [S1 single-active-friendly-trigger]: wrong error % "%"', v_state, v_msg;
  END IF;
  RAISE NOTICE 'ok   [S1 single-active-friendly-trigger] P0001 "%"', v_msg;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- C2 — UPDATE a constant of an ACTIVE version -> §8.4 trigger raises 23000.
-- ---------------------------------------------------------------------------
BEGIN;
UPDATE public.scoring_model_versions
   SET status = 'active',
       constants_sha256 = 'gate-fixture',
       validation_packet_url = 'git://lyceon-spec/04B/v4.3/evidence_packet_v42/'
 WHERE version = 'v1.0';
DO $$
DECLARE
  v_raised boolean := false; v_state text; v_msg text;
BEGIN
  IF (SELECT published_at FROM public.scoring_model_versions WHERE version = 'v1.0') IS NULL THEN
    RAISE EXCEPTION 'SCG FAIL [C2 update-active-constant]: activation did not stamp published_at';
  END IF;
  BEGIN
    UPDATE public.scoring_constants SET value = value + 1
     WHERE scoring_model_version = 'v1.0' AND key = 'deduction_easy';
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCG FAIL [C2 update-active-constant]: UPDATE on an active version''s constant succeeded';
  END IF;
  IF v_state <> '23000' OR v_msg NOT LIKE 'scoring_constants rows for active/superseded scoring_model_version v1.0 are immutable.%' THEN
    RAISE EXCEPTION 'SCG FAIL [C2 update-active-constant]: wrong error % "%"', v_state, v_msg;
  END IF;
  RAISE NOTICE 'ok   [C2 update-active-constant] 23000 sealed';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- C3 — INSERT a NEW constant into an ACTIVE version -> §8.4 trigger raises 23000.
-- (The V4.3 INSERT gap. Nothing else stops this row: the key is new, so the
-- unique index is silent, and the value is valid.)
-- ---------------------------------------------------------------------------
BEGIN;
UPDATE public.scoring_model_versions
   SET status = 'active',
       constants_sha256 = 'gate-fixture',
       validation_packet_url = 'git://lyceon-spec/04B/v4.3/evidence_packet_v42/'
 WHERE version = 'v1.0';
DO $$
DECLARE
  v_raised boolean := false; v_state text; v_msg text;
BEGIN
  BEGIN
    INSERT INTO public.scoring_constants (scoring_model_version, key, section, value, description)
    VALUES ('v1.0', 'zz_smuggled_constant', NULL, 1, 'gate plant');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCG FAIL [C3 insert-into-active-version]: a new constant was INSERTed into an active version';
  END IF;
  IF v_state <> '23000' OR v_msg NOT LIKE 'scoring_constants rows for active/superseded scoring_model_version v1.0 are immutable.%' THEN
    RAISE EXCEPTION 'SCG FAIL [C3 insert-into-active-version]: wrong error % "%"', v_state, v_msg;
  END IF;
  RAISE NOTICE 'ok   [C3 insert-into-active-version] 23000 sealed';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- C4 — DELETE a constant of an ACTIVE version -> §8.4 trigger raises 23000.
-- ---------------------------------------------------------------------------
BEGIN;
UPDATE public.scoring_model_versions
   SET status = 'active',
       constants_sha256 = 'gate-fixture',
       validation_packet_url = 'git://lyceon-spec/04B/v4.3/evidence_packet_v42/'
 WHERE version = 'v1.0';
DO $$
DECLARE
  v_raised boolean := false; v_state text; v_msg text;
BEGIN
  BEGIN
    DELETE FROM public.scoring_constants
     WHERE scoring_model_version = 'v1.0' AND key = 'round_to_nearest';
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCG FAIL [C4 delete-active-constant]: DELETE on an active version''s constant succeeded';
  END IF;
  IF v_state <> '23000' OR v_msg NOT LIKE 'scoring_constants rows for active/superseded scoring_model_version v1.0 are immutable.%' THEN
    RAISE EXCEPTION 'SCG FAIL [C4 delete-active-constant]: wrong error % "%"', v_state, v_msg;
  END IF;
  RAISE NOTICE 'ok   [C4 delete-active-constant] 23000 sealed';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- C5 — UPDATE a constant of a CANDIDATE version -> succeeds (work in progress).
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_n int;
BEGIN
  UPDATE public.scoring_constants SET value = value + 1
   WHERE scoring_model_version = 'v1.0' AND key = 'deduction_easy';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 OR public.scoring_constant('v1.0', 'deduction_easy') <> 16 THEN
    RAISE EXCEPTION 'SCG FAIL [C5 update-candidate-constant]: candidate constant not updated (rows=%)', v_n;
  END IF;
  RAISE NOTICE 'ok   [C5 update-candidate-constant] candidate constants writable';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- C6 — scoring_constant() on a missing key raises P0002, never returns NULL.
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_raised boolean := false; v_state text; v_msg text; v_val numeric;
BEGIN
  BEGIN
    v_val := public.scoring_constant('v1.0', 'nonexistent_key');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCG FAIL [C6 missing-constant-raises]: scoring_constant returned % instead of raising', coalesce(v_val::text, 'NULL');
  END IF;
  IF v_state <> 'P0002'
     OR v_msg <> 'scoring_constant lookup failed: version=v1.0, key=nonexistent_key, section=<global>' THEN
    RAISE EXCEPTION 'SCG FAIL [C6 missing-constant-raises]: wrong error % "%"', v_state, v_msg;
  END IF;
  RAISE NOTICE 'ok   [C6 missing-constant-raises] P0002 "%"', v_msg;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- C7 — duplicate (version, key, section) -> scoring_constants_unique_idx 23505,
-- for section NULL (the COALESCE case) and for a real section.
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_raised boolean; v_state text; v_msg text; v_con text;
BEGIN
  -- NULL section: must collide with the seeded global ceiling_max.
  v_raised := false;
  BEGIN
    INSERT INTO public.scoring_constants (scoring_model_version, key, section, value, description)
    VALUES ('v1.0', 'ceiling_max', NULL, 800, 'gate duplicate');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_con = CONSTRAINT_NAME;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCG FAIL [C7 unique-version-key-section]: duplicate (v1.0, ceiling_max, NULL) accepted';
  END IF;
  IF v_state <> '23505' OR v_con IS DISTINCT FROM 'scoring_constants_unique_idx' THEN
    RAISE EXCEPTION 'SCG FAIL [C7 unique-version-key-section]: NULL-section dup: wrong error % % "%"', v_state, v_con, v_msg;
  END IF;

  -- Real section: first 'rw' row is fine (section-specific beside a global), second collides.
  INSERT INTO public.scoring_constants (scoring_model_version, key, section, value, description)
  VALUES ('v1.0', 'ceiling_max', 'rw', 800, 'gate section row');
  v_raised := false;
  BEGIN
    INSERT INTO public.scoring_constants (scoring_model_version, key, section, value, description)
    VALUES ('v1.0', 'ceiling_max', 'rw', 800, 'gate section duplicate');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_con = CONSTRAINT_NAME;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCG FAIL [C7 unique-version-key-section]: duplicate (v1.0, ceiling_max, rw) accepted';
  END IF;
  IF v_state <> '23505' OR v_con IS DISTINCT FROM 'scoring_constants_unique_idx' THEN
    RAISE EXCEPTION 'SCG FAIL [C7 unique-version-key-section]: rw dup: wrong error % % "%"', v_state, v_con, v_msg;
  END IF;
  RAISE NOTICE 'ok   [C7 unique-version-key-section] 23505 scoring_constants_unique_idx (NULL and rw)';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- C8 — active -> candidate is refused by the status-machine trigger.
-- published_at is cleared in the same UPDATE so the §7.2 CHECK would ACCEPT the
-- resulting row: the trigger is the only thing standing in the way.
-- ---------------------------------------------------------------------------
BEGIN;
UPDATE public.scoring_model_versions
   SET status = 'active',
       constants_sha256 = 'gate-fixture',
       validation_packet_url = 'git://lyceon-spec/04B/v4.3/evidence_packet_v42/'
 WHERE version = 'v1.0';
DO $$
DECLARE
  v_raised boolean := false; v_state text; v_msg text;
BEGIN
  BEGIN
    UPDATE public.scoring_model_versions
       SET status = 'candidate', published_at = NULL
     WHERE version = 'v1.0';
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCG FAIL [C8 no-downgrade-active-to-candidate]: active -> candidate accepted';
  END IF;
  IF v_state <> 'P0001' OR v_msg <> 'Cannot downgrade scoring_model_versions from active to candidate' THEN
    RAISE EXCEPTION 'SCG FAIL [C8 no-downgrade-active-to-candidate]: wrong error % "%"', v_state, v_msg;
  END IF;
  RAISE NOTICE 'ok   [C8 no-downgrade-active-to-candidate] P0001 "%"', v_msg;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- C9 — INSERT status='active' with constants_sha256 NULL (every other
-- attestation field set) -> CHECK active_or_superseded_attestation_complete.
-- v1.0 is a candidate, so the single-active trigger/index are not in play.
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_raised boolean := false; v_state text; v_msg text; v_con text;
BEGIN
  BEGIN
    INSERT INTO public.scoring_model_versions
      (version, formula_name, formula_doc_ref, constants_sha256, validation_packet_sha256,
       validation_packet_url, status, published_at)
    VALUES ('zz_c9', 'option_a_banded_ceiling', 'Doc 04B V4.3 §6', NULL,
            '29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b',
            'git://lyceon-spec/04B/v4.3/evidence_packet_v42/', 'active', now());
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_con = CONSTRAINT_NAME;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCG FAIL [C9 active-requires-constants-sha256]: active row with NULL constants_sha256 accepted';
  END IF;
  IF v_state <> '23514' OR v_con IS DISTINCT FROM 'active_or_superseded_attestation_complete' THEN
    RAISE EXCEPTION 'SCG FAIL [C9 active-requires-constants-sha256]: wrong error % % "%"', v_state, v_con, v_msg;
  END IF;
  RAISE NOTICE 'ok   [C9 active-requires-constants-sha256] 23514 active_or_superseded_attestation_complete';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- S2 — value >= 0 CHECK (scoring_constants_value_nonneg).
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_raised boolean := false; v_state text; v_con text;
BEGIN
  BEGIN
    INSERT INTO public.scoring_constants (scoring_model_version, key, section, value, description)
    VALUES ('v1.0', 'zz_negative', NULL, -1, 'gate negative');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
  END;
  IF NOT v_raised OR v_state <> '23514' OR v_con IS DISTINCT FROM 'scoring_constants_value_nonneg' THEN
    RAISE EXCEPTION 'SCG FAIL [S2 value-nonneg]: raised=% state=% constraint=%', v_raised, v_state, v_con;
  END IF;
  RAISE NOTICE 'ok   [S2 value-nonneg] 23514 scoring_constants_value_nonneg';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- H1 — canonical constants_sha256 (owner ruling 2026-09-23): the in-database
-- serializer reproduces the ruled v1.0 hash; value scale does not affect it
-- (0.5 and 0.50 hash identically, via trim_scale); a version with no constants
-- raises P0002 rather than hashing an empty payload. The literal below is the
-- value E4 writes into scoring_model_versions.constants_sha256 at activation.
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  k_expected CONSTANT text := '5a51132234b2d1654b5362943af2d1fef59eadbc57ed6af50a44211a735680d1';
  v_hash text;
  v_state text;
BEGIN
  v_hash := public.scoring_constants_sha256('v1.0');
  IF v_hash IS DISTINCT FROM k_expected THEN
    RAISE EXCEPTION 'SCG FAIL [H1 constants-sha256]: v1.0 hashed to %, expected %', v_hash, k_expected;
  END IF;

  -- v1.0 is a candidate, so its constants are writable here (rolled back below).
  UPDATE public.scoring_constants SET value = 0.50
   WHERE scoring_model_version = 'v1.0' AND key = 'alpha_ceiling_exponent' AND section IS NULL;
  IF (SELECT value::text FROM public.scoring_constants
       WHERE scoring_model_version = 'v1.0' AND key = 'alpha_ceiling_exponent') <> '0.50' THEN
    RAISE EXCEPTION 'SCG FAIL [H1 constants-sha256]: could not stage a scale-2 value for the scale check';
  END IF;
  v_hash := public.scoring_constants_sha256('v1.0');
  IF v_hash IS DISTINCT FROM k_expected THEN
    RAISE EXCEPTION 'SCG FAIL [H1 constants-sha256]: 0.50 hashed differently from 0.5 (%): scale leaks into the hash', v_hash;
  END IF;

  BEGIN
    PERFORM public.scoring_constants_sha256('no_such_version');
    RAISE EXCEPTION 'SCG FAIL [H1 constants-sha256]: unknown version returned a hash instead of raising';
  EXCEPTION WHEN no_data_found THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM 'P0002' THEN
    RAISE EXCEPTION 'SCG FAIL [H1 constants-sha256]: unknown version raised % not P0002', v_state;
  END IF;
  RAISE NOTICE 'ok   [H1 constants-sha256] v1.0 = % ; scale-invariant ; unknown version P0002', k_expected;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- P2 — the catalogue is unchanged after every check above (all rolled back).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM public.scoring_model_versions) <> 1
     OR (SELECT status FROM public.scoring_model_versions WHERE version = 'v1.0') <> 'candidate'
     OR (SELECT count(*) FROM public.scoring_constants) <> 13
     OR public.scoring_constant('v1.0', 'deduction_easy') <> 15 THEN
    RAISE EXCEPTION 'SCG FAIL [P2 catalogue-untouched]: a check leaked state';
  END IF;
  RAISE NOTICE 'ok   [P2 catalogue-untouched] still 1 candidate version / 13 constants';
END $$;
