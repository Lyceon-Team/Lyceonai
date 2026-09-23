-- ============================================================================
-- E2 — Full-length scoring catalogue: scoring_model_versions + scoring_constants
-- ============================================================================
-- @spec [Doc-04B_V4.3, §7.2 (catalogue DDL, split attestation, race-safe
--        single-active), §7.3 (v1.0 catalogue row), §8.1 (constants table),
--        §8.2 (scoring_constant helper, raises on miss), §8.4 (INSERT/UPDATE/
--        DELETE seal), Appendix A (v1.0 constants)]
--       [Doc-04A_V2.2, §5.1.1 step 6 — test_forms.score_table_version FK
--        precondition: this table and the v1.0 row MUST exist first]
-- @implemented [2026-09-23]
--
-- plain English: creates the two tables the canonical scoring formula reads its
--   version and its constants from, the triggers that make an active version's
--   constants immutable in all three directions, and the helper that fails loud
--   on a missing constant. Seeds the v1.0 catalogue row and the 13 Appendix A
--   constants. No scoring function, no score_runs, no custom owner role — those
--   are later E-series work (§9, §11, §12).
--
-- expected outcome: after apply, scoring_model_versions holds exactly one row
--   ('v1.0', status 'candidate'); scoring_constants holds exactly 13 global
--   (section NULL) rows for v1.0 whose values are Appendix A verbatim.
--   scoring_constant('v1.0', <key>) returns each value; an unknown key raises
--   SQLSTATE P0002 (no_data_found). A future 04A migration can add the
--   test_forms.score_table_version FK against scoring_model_versions(version).
--
-- ---------------------------------------------------------------------------
-- WHY v1.0 IS SEEDED AS 'candidate' AND NOT 'active' — DO NOT "FIX" THIS.
-- ---------------------------------------------------------------------------
--   Appendix A / §7.3 show the v1.0 row inserted with status 'active'. That
--   INSERT cannot be executed as written, by the spec's own §7.2 CHECK
--   `active_or_superseded_attestation_complete`: an active row needs
--   published_at, constants_sha256, validation_packet_sha256 and
--   validation_packet_url all non-null, and two of those are deploy-time values
--   the spec itself marks as not-yet-known:
--     * constants_sha256  — "<computed at deploy time from sorted
--                            scoring_constants rows>" (Appendix A; Doc 04 parent
--                            §14 lists it OPEN, owner "Engineering (deploy
--                            script)")
--     * validation_packet_url — "replace with canonical deploy URL" (§7.3)
--   §7.2 says candidate is exactly the state for this: "Candidate rows have all
--   four nullable while validation work is in progress". Candidate is also the
--   only status in which §8.4 leaves the constants writable, which E4 needs
--   while it runs Python<->PL/pgSQL parity (§18.3, §21.2).
--   OWNER RULING (2026-09-23): seed 'candidate'; set validation_packet_sha256
--   now (Appendix B, fixed at spec lock); leave constants_sha256,
--   validation_packet_url and published_at NULL. E4 performs the §8.4 Tier-3
--   step 5 activation UPDATE, which populates the remaining attestation fields
--   and lets the status-machine trigger stamp published_at.
--   Consequence, intended: while v1.0 is a candidate no form can publish
--   against it (04A §6 gate (a)) and the orchestrator refuses to score
--   (04B §12.1 / §19.6). That is the correct fail-closed state until attested.
--
-- trade-offs:
--   * Spec DDL is reproduced verbatim (function bodies, constraint and trigger
--     names, messages, ERRCODEs). The only additions are repo conventions: the
--     `public.` qualification on CREATE statements, RLS enable, and explicit
--     grants. The trigger functions carry no SET search_path because §7.2/§8.4
--     do not; they resolve `scoring_model_versions` through the caller's
--     search_path, which includes public in every Supabase and CI context.
--   * Two single-active mechanisms exist by design (§7.2): the BEFORE trigger
--     gives a readable message in the sequential case; the partial unique index
--     is what actually holds under concurrency (the trigger cannot see another
--     transaction's uncommitted row). scripts/ci/scoring-catalogue-gates.sh
--     proves the index on a real two-session race.
--   * Grants: §9.4 names no grants for these two tables, so least privilege —
--     service_role gets SELECT only (the future SECURITY DEFINER scoring
--     functions read these tables as their owner, not as service_role; writes
--     are migration/Tier-3 only). The REVOKE ... FROM service_role strips the
--     platform default-privilege arwdDxtm grant in production (see
--     20260827000000_explicit_service_role_grants.sql) so prod and genesis agree.
--     scoring_constant() is SECURITY DEFINER, so EXECUTE is revoked from PUBLIC
--     and granted to service_role only, matching §9.4's posture for scoring
--     functions.
--   * RLS is enabled with no policies: anon/authenticated hold no grant at all,
--     and service_role bypasses RLS in Supabase.
--
-- edge cases:
--   * No routing thresholds here: they live on test_forms (§5.13, §8.3).
--   * No section-specific rows at launch (§22.3); every seed row is global.
--   * scoring_constant() raises on a miss rather than returning NULL (§8.2).
--   * The FK scoring_constants -> scoring_model_versions is ON DELETE NO ACTION
--     (spec DDL). It references no identity table, so the FK delete-action guard
--     does not apply.
--
-- OWNER-RUN: applied through the tracked pipeline (`supabase db push`).
--   Genesis-extending; genesis-fresh-apply covers it. NOT APPLIED TO PROD BY
--   THIS CHANGE.
--
-- ROLLBACK (INV-06): transactional (BEGIN/COMMIT). Pure additive migration;
--   nothing else references these objects yet. Rollback is an exact inverse
--   UNLESS a later migration has added the 04A test_forms FK (drop that first).
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed —
--   DROP TABLE public.scoring_constants;
--   DROP TABLE public.scoring_model_versions;
--   DROP FUNCTION public.scoring_constant(text, text, text);
--   DROP FUNCTION public.scoring_constants_sha256(text);
--   DROP FUNCTION public.prevent_active_scoring_constants_mutation();
--   DROP FUNCTION public.enforce_single_active_scoring_version();
--   DROP FUNCTION public.enforce_scoring_version_status_machine();
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- §7.2 — scoring_model_versions (verbatim)
-- ---------------------------------------------------------------------------
CREATE TABLE public.scoring_model_versions (
  version                   text PRIMARY KEY,                  -- e.g., 'v1.0'
  formula_name              text NOT NULL,                     -- e.g., 'option_a_banded_ceiling'
  formula_doc_ref           text NOT NULL,                     -- e.g., 'Doc 04B V4.3 §6'
  constants_sha256          text NULL,                         -- hash of sorted scoring_constants rows for this version (set on activation)
  validation_packet_sha256  text NULL,                         -- hash of the validation evidence packet (set on activation)
  validation_packet_url     text NULL,                         -- canonical retrieval URL/path for the packet (set on activation)
  status                    text NOT NULL CHECK (status IN ('candidate', 'active', 'superseded')),
  published_at              timestamptz NULL,                  -- NULL while candidate; set on activation
  superseded_at             timestamptz NULL,
  notes                     text NULL,

  -- Active and superseded rows MUST have published_at and all three attestation fields set.
  -- Candidate rows have all four nullable while validation work is in progress.
  CONSTRAINT active_or_superseded_attestation_complete CHECK (
    (status IN ('active', 'superseded')
       AND published_at IS NOT NULL
       AND constants_sha256 IS NOT NULL
       AND validation_packet_sha256 IS NOT NULL
       AND validation_packet_url IS NOT NULL)
    OR (status = 'candidate' AND published_at IS NULL)
  ),
  CONSTRAINT superseded_has_superseded_at CHECK (
    (status = 'superseded' AND superseded_at IS NOT NULL)
    OR (status <> 'superseded' AND superseded_at IS NULL)
  )
);

-- Partial unique index: the authoritative, race-safe "at most one active" rule.
CREATE UNIQUE INDEX one_active_scoring_model_version
  ON public.scoring_model_versions ((status))
  WHERE status = 'active';

-- State-machine trigger: stamps timestamps on transitions, blocks downgrades.
CREATE FUNCTION public.enforce_scoring_version_status_machine() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Block illegal transitions
  IF OLD.status = 'active' AND NEW.status = 'candidate' THEN
    RAISE EXCEPTION 'Cannot downgrade scoring_model_versions from active to candidate';
  END IF;
  IF OLD.status = 'superseded' AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'Cannot revive a superseded scoring_model_version';
  END IF;

  -- Stamp transition timestamps
  IF OLD.status = 'candidate' AND NEW.status = 'active' THEN
    NEW.published_at := COALESCE(NEW.published_at, now());
  END IF;
  IF OLD.status = 'active' AND NEW.status = 'superseded' THEN
    NEW.superseded_at := COALESCE(NEW.superseded_at, now());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_scoring_version_status_machine
  BEFORE INSERT OR UPDATE ON public.scoring_model_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_scoring_version_status_machine();

-- Friendly-error trigger for the single-active rule. The partial unique index above
-- is the actual enforcement; this trigger just produces a more informative error
-- message at the application boundary. Both layers are present by design.
CREATE FUNCTION public.enforce_single_active_scoring_version() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'active' THEN
    IF EXISTS (
      SELECT 1 FROM scoring_model_versions
      WHERE status = 'active' AND version <> NEW.version
    ) THEN
      RAISE EXCEPTION 'Only one scoring model version may be active at a time';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_single_active_scoring_version
  BEFORE INSERT OR UPDATE ON public.scoring_model_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_active_scoring_version();

-- ---------------------------------------------------------------------------
-- §8.1 — scoring_constants (verbatim)
-- ---------------------------------------------------------------------------
CREATE TABLE public.scoring_constants (
  scoring_model_version text NOT NULL REFERENCES public.scoring_model_versions(version),
  key                   text NOT NULL,
  section               text NULL CHECK (section IS NULL OR section IN ('rw', 'math')),
  value                 numeric NOT NULL,
  description           text NOT NULL,
  notes                 text NULL,

  -- Composite uniqueness: per version, per key, per section (with NULL section meaning global)
  CONSTRAINT scoring_constants_value_nonneg CHECK (value >= 0)
);

CREATE UNIQUE INDEX scoring_constants_unique_idx
  ON public.scoring_constants (scoring_model_version, key, COALESCE(section, '__global__'));

-- ---------------------------------------------------------------------------
-- §8.2 — scoring_constant() helper: section-specific wins, else global; raises
-- no_data_found (P0002) on a miss instead of returning NULL. (verbatim)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.scoring_constant(
  p_version text,
  p_key     text,
  p_section text DEFAULT NULL
) RETURNS numeric AS $$
DECLARE
  v_value numeric;
BEGIN
  -- Try section-specific first, then fall back to global
  SELECT value INTO v_value FROM scoring_constants
  WHERE scoring_model_version = p_version
    AND key = p_key
    AND (
      (p_section IS NOT NULL AND section = p_section)
      OR (section IS NULL)
    )
  ORDER BY (section IS NULL)  -- false (section-specific) sorts before true (global)
  LIMIT 1;

  IF v_value IS NULL THEN
    RAISE EXCEPTION 'scoring_constant lookup failed: version=%, key=%, section=%',
      p_version, p_key, COALESCE(p_section, '<global>')
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN v_value;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- §7.2 / §7.3 — canonical constants_sha256 serializer.
-- @spec [Doc-04B_V4.3, §7.2 ("computed by hashing the sorted (key, section,
--        value) tuples"), §7.3, §8.4(a) ("a real, stable hash that any reader
--        can recompute against the live table and verify")]
-- @implemented [2026-09-23]
-- plain English: the ONE implementation of constants_sha256. The spec names the
--   inputs but no byte format; owner ruling 2026-09-23 fixes it here, in the
--   database, so §8.4(a)'s "any reader can recompute" is literally true — a
--   reader runs this function against the live table rather than trusting a
--   script. Format: one line per row, `key|section|trim_scale(value)::text`,
--   section NULL rendered as the empty string; rows ordered by key COLLATE "C",
--   then section COLLATE "C" NULLS FIRST; lines joined by a single LF; UTF-8;
--   SHA-256; lowercase hex.
-- trade-offs / edge cases:
--   * trim_scale(): numeric's text form preserves stored scale, so 0.5 and 0.50
--     would hash differently while being the same number. The hash exists to
--     detect drift in VALUE, not in how a literal was typed.
--   * COLLATE "C" pins byte order independent of the database's collation.
--   * core sha256(bytea) (PG11+), not pgcrypto digest(): no dependency on the
--     `extensions` schema being on search_path.
--   * a version with no constant rows raises no_data_found (P0002), matching
--     scoring_constant(); an empty attestation is never a valid hash.
--   * E4 writes this function's output into scoring_model_versions.
--     constants_sha256 at activation, and the E4 gate asserts the recomputed
--     value equals the stored one.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.scoring_constants_sha256(p_version text) RETURNS text AS $$
DECLARE
  v_payload text;
BEGIN
  SELECT string_agg(
           key || '|' || COALESCE(section, '') || '|' || trim_scale(value)::text,
           E'\n'
           ORDER BY key COLLATE "C", section COLLATE "C" NULLS FIRST)
    INTO v_payload
    FROM scoring_constants
   WHERE scoring_model_version = p_version;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'scoring_constants_sha256: no constants for version=%', p_version
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN encode(sha256(convert_to(v_payload, 'UTF8')), 'hex');
END;
$$ LANGUAGE plpgsql STABLE
   SET search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- §8.4 — seal an active/superseded version's constants against INSERT, UPDATE
-- and DELETE. (verbatim)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.prevent_active_scoring_constants_mutation() RETURNS trigger AS $$
DECLARE
  v_status text;
  v_target_version text;
BEGIN
  -- For INSERT we examine NEW (the row being inserted); for UPDATE and DELETE we
  -- examine OLD (the row being changed). In all cases we check the parent version's
  -- status: if the parent is active or superseded, the constants are sealed.
  v_target_version := CASE TG_OP
    WHEN 'INSERT' THEN NEW.scoring_model_version
    ELSE OLD.scoring_model_version
  END;

  SELECT status INTO v_status
  FROM scoring_model_versions
  WHERE version = v_target_version;

  IF v_status IN ('active', 'superseded') THEN
    RAISE EXCEPTION
      'scoring_constants rows for active/superseded scoring_model_version % are immutable. '
      'Adding, modifying, or deleting constants requires a new scoring_model_version '
      '(Doc 04B V4.3 §8.4 Tier 3 protocol).',
      v_target_version
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_active_scoring_constants_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.scoring_constants
  FOR EACH ROW EXECUTE FUNCTION public.prevent_active_scoring_constants_mutation();

-- ---------------------------------------------------------------------------
-- Repo conventions: RLS on every public table; explicit, least-privilege grants.
-- ---------------------------------------------------------------------------
ALTER TABLE public.scoring_model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scoring_constants      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.scoring_model_versions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.scoring_constants      FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.scoring_model_versions TO service_role;
GRANT SELECT ON TABLE public.scoring_constants      TO service_role;

REVOKE ALL ON FUNCTION public.scoring_constant(text, text, text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_scoring_version_status_machine()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_single_active_scoring_version()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_active_scoring_constants_mutation()   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scoring_constant(text, text, text)         TO service_role;
REVOKE ALL ON FUNCTION public.scoring_constants_sha256(text)             FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scoring_constants_sha256(text)          TO service_role;

-- ---------------------------------------------------------------------------
-- §7.3 / Appendix A — v1.0 catalogue row. status = 'candidate' per the OWNER
-- RULING in the header (Appendix A shows 'active'; its CHECK-required
-- attestation values do not exist until E4 activation).
-- ---------------------------------------------------------------------------
INSERT INTO public.scoring_model_versions (
  version, formula_name, formula_doc_ref,
  constants_sha256,
  validation_packet_sha256,
  validation_packet_url,
  status, published_at
) VALUES (
  'v1.0',
  'option_a_banded_ceiling',
  'Doc 04B V4.3 §6',
  NULL,   -- computed by E4 at activation from sorted scoring_constants rows (§7.2)
  '29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b',  -- Appendix B
  NULL,   -- canonical deploy URL, set by E4 at activation (§7.3)
  'candidate',
  NULL    -- stamped by trg_scoring_version_status_machine on candidate -> active
);

-- ---------------------------------------------------------------------------
-- Appendix A — the 13 v1.0 constants, verbatim. All global (section NULL).
-- Routing thresholds are NOT here (§5.13); section_total_questions and
-- module1_questions are NOT here (§8.3 / Appendix A note).
-- ---------------------------------------------------------------------------
INSERT INTO public.scoring_constants (scoring_model_version, key, section, value, description) VALUES
  ('v1.0', 'alpha_ceiling_exponent', NULL, 0.5,
   'Power function exponent for M1-driven ceiling'),
  ('v1.0', 'ceiling_floor', NULL, 430,
   'Minimum value of the M1-driven ceiling; protects low-M1/strong-M2 students'),
  ('v1.0', 'ceiling_max', NULL, 800,
   'SAT scaled-score maximum per section'),
  ('v1.0', 'deduction_easy', NULL, 15,
   'Scaled points subtracted per wrong easy M2 question'),
  ('v1.0', 'deduction_medium', NULL, 9,
   'Scaled points subtracted per wrong medium M2 question'),
  ('v1.0', 'deduction_hard', NULL, 6,
   'Scaled points subtracted per wrong hard M2 question'),
  ('v1.0', 'raw_floor_base', NULL, 200,
   'Raw-percent floor constant term'),
  ('v1.0', 'raw_floor_multiplier', NULL, 400,
   'Raw-percent floor scaling factor (against total raw fraction)'),
  ('v1.0', 'path_a_floor', NULL, 200,
   'Absolute floor for Path A students'),
  ('v1.0', 'path_b_floor_base', NULL, 450,
   'Path B floor at routing threshold'),
  ('v1.0', 'path_b_floor_bonus_per_m1_point', NULL, 15,
   'Path B floor lift per M1 correct above threshold'),
  ('v1.0', 'path_b_floor_cap', NULL, 580,
   'Maximum value of the Path B graded floor'),
  ('v1.0', 'round_to_nearest', NULL, 10,
   'Final score rounding unit');

COMMIT;
