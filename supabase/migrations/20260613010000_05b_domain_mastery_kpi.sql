-- ============================================================================
-- 05B — Domain Mastery & KPI Rollups (Doc 05B V1.0 LOCKED) — refresh_domain_mastery
--       + 4 KPI refreshers + KPI tables + recency constants + guardian RLS
-- ============================================================================
-- @spec [Doc-05B_V1 §3 (INV-05B-13/14/15) / §4 (refresh_domain_mastery) / §5
--   (student_domain_mastery schema + visibility) / §6 (KPI tables) / §7 (KPI refreshers,
--   compute_streak_days, read_kpi_recency_constants) / §9 (recency constants) / §10
--   (guardian RLS)] [Doc-05 Parent §4.2/§6/§9/§11.1] [contract ws3-05b-05c §A/§B/§C/§G1/§G2]
-- @implemented [2026-06-13]
-- plain English: completes the spine apply_mastery_event -> skill -> DOMAIN -> KPI. The
--   domain tier is an INDEPENDENT event aggregation at domain grain (INV-05B-13): it calls
--   the ONE formula impl compute_mastery_for_entity('domain', ..., p_skill=NULL) and NEVER
--   reads student_skill_mastery as a roll-up source. Four KPI refreshers (section/domain/skill/
--   overall) are the single writers of their materialized-derivative tables (INV-05B-14),
--   reading recency windows from mastery_constants via read_kpi_recency_constants (INV-05B-15;
--   no INTERVAL '7 days'/'30 days' literals). student_domain_mastery + section/domain/overall
--   KPI are guardian-readable (active link AND active entitlement); student_skill_kpi is
--   student-self only (denial by absence). refresh_domain_mastery fires all four KPI refreshers
--   in the same transaction (§4.9).
--
-- @adaptation A3/A4 (mirrors lane-c 20260613000000): Doc 05B §7's KPI UNIONs are written
--   against practice_attempts_v0 / test_session_answers / test_session_sections; the LIVE
--   canonical event source in this repo is practice_session_items[status='answered'] +
--   review_error_attempts (Doc 02B §8 / frozen seam §2; A3/SP-22), and the test/full-length
--   branch is the Doc 04 seam (WS-4) — those tables do not exist yet. Per RB-05B-V1-07 the
--   KPI fns re-derive the canonical event taxonomy; here that taxonomy is the SAME production
--   stream apply_mastery_event already consumes via canonical_mastery_events. The test branch
--   is added when WS-4 lands the test answer surface (symmetric with lane-c A4). occurred_at on
--   practice items = answered_at (seam §2 R1); is_correct -> correct.
-- @adaptation GUARDIAN-RLS: Doc 05B §5.3/§6.6 reference guardian_student_links(guardian_id,
--   linked_student_id, link_active) + student_entitlements(student_id, active); the genesis
--   identity model (Doc 01 V8) names guardian_links(guardian_profile_id, student_profile_id,
--   status='active') + entitlements(profile_id, status = 'active'). NARROWED to active-only (spec §5.3 active=true; safer guardian posture; past_due grace excluded — owner may widen). LYCEON-MIGRATION-REVIEWED. The guardian
--   read predicate is reconciled to those tables, preserving the Parent §11.1 semantics:
--   active link AND active student entitlement. auth.uid() = the guardian profile id.
--
-- @adaptation ADMIN-ROLE: Doc 05B §5.4/§6.7 name admin_role for admin reads; the genesis
--   3-role model (anon/authenticated/service_role) treats admin as a PROFILE role and routes
--   admin/internal DB reads via service_role (same SP-20 ruling as 20260610010000). The
--   admin_role GRANTs are therefore folded into service_role (which already has GRANT ALL).
--
-- @adaptation AUDIT-TABLE: Doc 05B §4.8 names the 05D-owned mastery_domain_refresh_audit_log
--   (separate from 05A's mastery_event_audit_log because 05B logs per-domain refreshes, not
--   per-event applications). 05D has not landed; per §4.8 ("if 05B names a domain audit table,
--   create it") this migration creates mastery_domain_refresh_audit_log with the §4.8 columns
--   so every domain refresh writes one audit row. Ownership transfers to 05D when it lands.
--
-- OWNER-RUN: tracked pipeline; genesis-extending; genesis-fresh-apply gate covers it.
-- ROLLBACK (INV-06): transactional; reviewed. Revert =
--   DROP FUNCTION refresh_domain_mastery(uuid,text,text), refresh_section_kpi(uuid,text,timestamptz),
--     refresh_domain_kpi(uuid,text,text,timestamptz), refresh_skill_kpi(uuid,text,text,timestamptz),
--     refresh_overall_kpi(uuid,timestamptz), compute_streak_days(uuid,text,text,text,timestamptz),
--     compute_longest_streak_days(uuid,timestamptz), read_kpi_recency_constants();
--   DROP TABLE student_section_kpi, student_domain_kpi, student_skill_kpi, student_overall_kpi,
--     mastery_domain_refresh_audit_log;
--   ALTER TABLE public.student_domain_mastery DROP COLUMN acc_test, DROP COLUMN acc_practice,
--     DROP COLUMN acc_review, DROP COLUMN last_event_id, DROP COLUMN last_event_occurred_at;
--   DELETE FROM mastery_constants WHERE key IN ('KPI_RECENCY_WINDOW_SHORT_DAYS','KPI_RECENCY_WINDOW_LONG_DAYS').
--   CREATE/ALTER-add/seed only; no forward-data destruction. LYCEON-MIGRATION-REVIEWED
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Recency-window operational constants (Doc 05B §9, RB-05P-V1-15).
--    Live in mastery_constants but are EXCLUDED from canonicalize_mastery_constants's IN-list
--    (20260610010000) — so they never enter constants_snapshot_hash (§9.4). Operational, not
--    formula-affecting. value stored as a jsonb integer scalar (matches the #>>'{}' cast in
--    read_kpi_recency_constants). Seed (top-level, not a function body) — not literals-in-code.
-- ----------------------------------------------------------------------------
INSERT INTO public.mastery_constants (key, value, description) VALUES
  ('KPI_RECENCY_WINDOW_SHORT_DAYS', '7',  'KPI short recency window in days (Doc 05B §9; excluded from constants_snapshot_hash)'),
  ('KPI_RECENCY_WINDOW_LONG_DAYS',  '30', 'KPI long recency window in days (Doc 05B §9; excluded from constants_snapshot_hash)')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1. student_domain_mastery — EXTEND the B-WS3-1 shell (20260610010000), do NOT recreate.
--    §5.1 adds per-source accuracies (admin-only) + RB-05B-V1-08 audit anchors.
-- ----------------------------------------------------------------------------
ALTER TABLE public.student_domain_mastery
  ADD COLUMN IF NOT EXISTS acc_test               numeric(7,6),
  ADD COLUMN IF NOT EXISTS acc_practice           numeric(7,6),
  ADD COLUMN IF NOT EXISTS acc_review             numeric(7,6),
  ADD COLUMN IF NOT EXISTS last_event_id          uuid,
  ADD COLUMN IF NOT EXISTS last_event_occurred_at timestamptz;

-- §5.1 indexes
CREATE INDEX IF NOT EXISTS idx_student_domain_mastery_student
  ON public.student_domain_mastery (student_id);
CREATE INDEX IF NOT EXISTS idx_student_domain_mastery_student_section
  ON public.student_domain_mastery (student_id, section);
CREATE INDEX IF NOT EXISTS idx_student_domain_mastery_computed_at
  ON public.student_domain_mastery (computed_at);

-- §5.3 RLS — student-self read + guardian read (active link AND active entitlement, §11.1).
-- (RLS already enabled in 20260610010000; the shell had no read policies. Single writer is
--  refresh_domain_mastery via service_role, which bypasses RLS — no write policy by design.)
-- student_domain_mastery is the GUARDIAN-readable domain mastery surface (the critical
-- difference from 05A's student_skill_mastery, which has NO guardian policy).
CREATE POLICY student_domain_mastery_student_read ON public.student_domain_mastery
  FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY student_domain_mastery_guardian_read ON public.student_domain_mastery
  FOR SELECT TO authenticated USING (
    student_id IN (
      SELECT gl.student_profile_id
      FROM   public.guardian_links gl
      WHERE  gl.guardian_profile_id = auth.uid()
        AND  gl.status = 'active'
        AND  EXISTS (
          SELECT 1 FROM public.entitlements e
          WHERE  e.profile_id = gl.student_profile_id
            AND  e.status = 'active'
        )
    )
  );

-- §5.2/§5.4 column GRANTs: mastery_level + identity + computed_at to student & guardian
-- (both via the `authenticated` role + the per-policy row filter). mastery_score / mastery_pct /
-- acc_* / event_count_total / versioning / last_event_* are admin/service-only (INV-05A-12).
-- service_role already has GRANT ALL from 20260610010000; the added acc_* columns inherit it.
GRANT SELECT (student_id, section, domain, mastery_level, computed_at)
  ON public.student_domain_mastery TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. KPI tables (Doc 05B §6) — 4 net-new materialized derivatives (INV-05B-14).
--    Single writer per table named in the comment above each. RLS deny-all baseline +
--    explicit read policies. REVOKE ALL FROM PUBLIC; service_role writes.
-- ----------------------------------------------------------------------------

-- §6.1 student_section_kpi — SINGLE WRITER: public.refresh_section_kpi
CREATE TABLE public.student_section_kpi (
  student_id            uuid          NOT NULL,
  section               text          NOT NULL CHECK (section IN ('M','RW')),
  events_total          integer       NOT NULL DEFAULT 0 CHECK (events_total >= 0),
  events_last_7d        integer       NOT NULL DEFAULT 0 CHECK (events_last_7d >= 0),
  events_last_30d       integer       NOT NULL DEFAULT 0 CHECK (events_last_30d >= 0),
  accuracy_overall      numeric(5,4),
  accuracy_last_7d      numeric(5,4),
  accuracy_last_30d     numeric(5,4),
  current_streak_days   integer       NOT NULL DEFAULT 0 CHECK (current_streak_days >= 0),
  last_active_at        timestamptz,
  kpi_refresh_version   text          NOT NULL DEFAULT 'v1.0',
  refreshed_at          timestamptz   NOT NULL DEFAULT now(),
  refreshed_at_t_now    timestamptz   NOT NULL,
  PRIMARY KEY (student_id, section)
);
CREATE INDEX idx_student_section_kpi_student ON public.student_section_kpi (student_id);

-- §6.2 student_domain_kpi — SINGLE WRITER: public.refresh_domain_kpi (no streak; §6.2)
CREATE TABLE public.student_domain_kpi (
  student_id            uuid          NOT NULL,
  section               text          NOT NULL CHECK (section IN ('M','RW')),
  domain                text          NOT NULL,
  events_total          integer       NOT NULL DEFAULT 0 CHECK (events_total >= 0),
  events_last_7d        integer       NOT NULL DEFAULT 0 CHECK (events_last_7d >= 0),
  events_last_30d       integer       NOT NULL DEFAULT 0 CHECK (events_last_30d >= 0),
  accuracy_overall      numeric(5,4),
  accuracy_last_7d      numeric(5,4),
  accuracy_last_30d     numeric(5,4),
  last_active_at        timestamptz,
  kpi_refresh_version   text          NOT NULL DEFAULT 'v1.0',
  refreshed_at          timestamptz   NOT NULL DEFAULT now(),
  refreshed_at_t_now    timestamptz   NOT NULL,
  PRIMARY KEY (student_id, section, domain)
);
CREATE INDEX idx_student_domain_kpi_student ON public.student_domain_kpi (student_id);
CREATE INDEX idx_student_domain_kpi_student_section ON public.student_domain_kpi (student_id, section);

-- §6.3 student_skill_kpi — SINGLE WRITER: public.refresh_skill_kpi. STUDENT-SELF ONLY (§2.4).
CREATE TABLE public.student_skill_kpi (
  student_id            uuid          NOT NULL,
  section               text          NOT NULL CHECK (section IN ('M','RW')),
  domain                text          NOT NULL,
  skill                 text          NOT NULL,
  events_total          integer       NOT NULL DEFAULT 0 CHECK (events_total >= 0),
  events_last_7d        integer       NOT NULL DEFAULT 0 CHECK (events_last_7d >= 0),
  events_last_30d       integer       NOT NULL DEFAULT 0 CHECK (events_last_30d >= 0),
  accuracy_overall      numeric(5,4),
  accuracy_last_7d      numeric(5,4),
  accuracy_last_30d     numeric(5,4),
  last_active_at        timestamptz,
  kpi_refresh_version   text          NOT NULL DEFAULT 'v1.0',
  refreshed_at          timestamptz   NOT NULL DEFAULT now(),
  refreshed_at_t_now    timestamptz   NOT NULL,
  PRIMARY KEY (student_id, section, domain, skill)
);
CREATE INDEX idx_student_skill_kpi_student ON public.student_skill_kpi (student_id);
CREATE INDEX idx_student_skill_kpi_student_section_domain
  ON public.student_skill_kpi (student_id, section, domain);

-- §6.4 student_overall_kpi — SINGLE WRITER: public.refresh_overall_kpi
CREATE TABLE public.student_overall_kpi (
  student_id            uuid          NOT NULL,
  events_total          integer       NOT NULL DEFAULT 0 CHECK (events_total >= 0),
  events_last_7d        integer       NOT NULL DEFAULT 0 CHECK (events_last_7d >= 0),
  events_last_30d       integer       NOT NULL DEFAULT 0 CHECK (events_last_30d >= 0),
  accuracy_overall      numeric(5,4),
  accuracy_last_7d      numeric(5,4),
  accuracy_last_30d     numeric(5,4),
  sections_active       smallint      NOT NULL DEFAULT 0 CHECK (sections_active BETWEEN 0 AND 2),
  current_streak_days   integer       NOT NULL DEFAULT 0 CHECK (current_streak_days >= 0),
  longest_streak_days   integer       NOT NULL DEFAULT 0 CHECK (longest_streak_days >= 0),
  last_active_at        timestamptz,
  kpi_refresh_version   text          NOT NULL DEFAULT 'v1.0',
  refreshed_at          timestamptz   NOT NULL DEFAULT now(),
  refreshed_at_t_now    timestamptz   NOT NULL,
  PRIMARY KEY (student_id)
);

-- §4.8 mastery_domain_refresh_audit_log — 05D-owned; created here (see header AUDIT-TABLE note).
-- SINGLE WRITER: public.refresh_domain_mastery. One audit row per domain refresh.
CREATE TABLE public.mastery_domain_refresh_audit_log (
  audit_row_id          uuid          NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            uuid          NOT NULL,
  section               text          NOT NULL CHECK (section IN ('M','RW')),
  domain                text          NOT NULL,
  mastery_score_before  numeric(5,4),
  mastery_score_after   numeric(5,4),
  mastery_level_before  smallint,
  mastery_level_after   smallint,
  event_count_after     integer       NOT NULL CHECK (event_count_after >= 0),
  constants_snapshot_hash text        NOT NULL,
  mastery_model_version text          NOT NULL,
  triggered_by          text,
  applied_at            timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX idx_mastery_domain_refresh_audit_student
  ON public.mastery_domain_refresh_audit_log (student_id, section, domain, applied_at DESC);

-- §6.6 RLS enable + REVOKE ALL FROM PUBLIC + service_role writes
ALTER TABLE public.student_section_kpi              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_domain_kpi               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_skill_kpi                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_overall_kpi              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mastery_domain_refresh_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.student_section_kpi, public.student_domain_kpi, public.student_skill_kpi,
  public.student_overall_kpi, public.mastery_domain_refresh_audit_log FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.student_section_kpi, public.student_domain_kpi, public.student_skill_kpi,
  public.student_overall_kpi, public.mastery_domain_refresh_audit_log TO service_role;

-- §6.6 read policies. section/domain/overall: student-self + guardian. skill: student-self ONLY.
CREATE POLICY student_section_kpi_student_read ON public.student_section_kpi
  FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY student_section_kpi_guardian_read ON public.student_section_kpi
  FOR SELECT TO authenticated USING (
    student_id IN (
      SELECT gl.student_profile_id FROM public.guardian_links gl
      WHERE gl.guardian_profile_id = auth.uid() AND gl.status = 'active'
        AND EXISTS (SELECT 1 FROM public.entitlements e
                    WHERE e.profile_id = gl.student_profile_id AND e.status = 'active')
    )
  );

CREATE POLICY student_domain_kpi_student_read ON public.student_domain_kpi
  FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY student_domain_kpi_guardian_read ON public.student_domain_kpi
  FOR SELECT TO authenticated USING (
    student_id IN (
      SELECT gl.student_profile_id FROM public.guardian_links gl
      WHERE gl.guardian_profile_id = auth.uid() AND gl.status = 'active'
        AND EXISTS (SELECT 1 FROM public.entitlements e
                    WHERE e.profile_id = gl.student_profile_id AND e.status = 'active')
    )
  );

-- student_skill_kpi: STUDENT-SELF ONLY — NO guardian policy (§2.4; denial by absence,
-- matching 05A's student_skill_mastery pattern).
CREATE POLICY student_skill_kpi_student_read ON public.student_skill_kpi
  FOR SELECT TO authenticated USING (student_id = auth.uid());

CREATE POLICY student_overall_kpi_student_read ON public.student_overall_kpi
  FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY student_overall_kpi_guardian_read ON public.student_overall_kpi
  FOR SELECT TO authenticated USING (
    student_id IN (
      SELECT gl.student_profile_id FROM public.guardian_links gl
      WHERE gl.guardian_profile_id = auth.uid() AND gl.status = 'active'
        AND EXISTS (SELECT 1 FROM public.entitlements e
                    WHERE e.profile_id = gl.student_profile_id AND e.status = 'active')
    )
  );

-- §6.7 column GRANTs to authenticated (engagement metrics only; audit cols admin/service only).
GRANT SELECT (
  student_id, section,
  events_total, events_last_7d, events_last_30d,
  accuracy_overall, accuracy_last_7d, accuracy_last_30d,
  current_streak_days, last_active_at
) ON public.student_section_kpi TO authenticated;

GRANT SELECT (
  student_id, section, domain,
  events_total, events_last_7d, events_last_30d,
  accuracy_overall, accuracy_last_7d, accuracy_last_30d,
  last_active_at
) ON public.student_domain_kpi TO authenticated;

GRANT SELECT (
  student_id, section, domain, skill,
  events_total, events_last_7d, events_last_30d,
  accuracy_overall, accuracy_last_7d, accuracy_last_30d,
  last_active_at
) ON public.student_skill_kpi TO authenticated;

GRANT SELECT (
  student_id,
  events_total, events_last_7d, events_last_30d,
  accuracy_overall, accuracy_last_7d, accuracy_last_30d,
  sections_active,
  current_streak_days, longest_streak_days, last_active_at
) ON public.student_overall_kpi TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. read_kpi_recency_constants (Doc 05B §9.1, RB-05B-V1-01) — VERBATIM.
--    Reads mastery_constants DIRECTLY (NOT canonicalize_mastery_constants) so KPI windows stay
--    out of the formula hash. The SOLE constants reader for KPI refreshers + compute_streak_days
--    (INV-05B-15). Numeric bounds 365 / 0 are structural validation guards, not tunable params.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.read_kpi_recency_constants(
  OUT short_days integer,
  OUT long_days  integer
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE
  v_short jsonb;
  v_long  jsonb;
BEGIN
  SELECT value INTO v_short FROM public.mastery_constants
   WHERE key = 'KPI_RECENCY_WINDOW_SHORT_DAYS';
  SELECT value INTO v_long  FROM public.mastery_constants
   WHERE key = 'KPI_RECENCY_WINDOW_LONG_DAYS';

  IF v_short IS NULL OR v_long IS NULL THEN
    RAISE EXCEPTION 'KPI_CONSTANTS_MISSING: KPI_RECENCY_WINDOW_SHORT_DAYS or KPI_RECENCY_WINDOW_LONG_DAYS missing from mastery_constants';
  END IF;

  short_days := (v_short #>> '{}')::integer;
  long_days  := (v_long  #>> '{}')::integer;

  IF short_days <= 0 OR long_days <= 0 OR short_days > 365 OR long_days > 365 THEN
    RAISE EXCEPTION 'KPI_CONSTANTS_OUT_OF_RANGE: short_days=% long_days=% (expected 1..365)', short_days, long_days;
  END IF;
END;
$func$;

REVOKE ALL ON FUNCTION public.read_kpi_recency_constants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_kpi_recency_constants() TO service_role;

-- ----------------------------------------------------------------------------
-- 4. compute_streak_days / compute_longest_streak_days (Doc 05B §7.6) — UTC-day, 730-day cap.
--    RB-05B-V1-03: filters by p_section AND p_domain AND p_skill. The 730 cap is a structural
--    runaway-loop safety bound (not a tunable parameter); 1/0 are loop/day arithmetic.
--    @adaptation A3/A4: canonical event stream = practice_session_items[answered] +
--    review_error_attempts (no test branch / WS-4), same as canonical_mastery_events.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_streak_days(
  p_student_id  uuid,
  p_section     text DEFAULT NULL,
  p_domain      text DEFAULT NULL,
  p_skill       text DEFAULT NULL,
  p_t_now       timestamptz DEFAULT now()
) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_streak integer := 0;
  v_today  date := (p_t_now AT TIME ZONE 'UTC')::date;
  v_check_date date;
  v_has_event boolean;
BEGIN
  v_check_date := v_today;
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM (
        SELECT (e.occurred_at AT TIME ZONE 'UTC')::date AS event_date, e.section, e.domain, e.skill
        FROM (
          SELECT pi.occurred_at, pi.question_section AS section, pi.question_domain AS domain, pi.question_skill AS skill
          FROM public.practice_session_items pi
          WHERE pi.user_id = p_student_id AND pi.status = 'answered'
          UNION ALL
          SELECT ra.occurred_at, ra.section, ra.domain, ra.skill
          FROM public.review_error_attempts ra
          WHERE ra.student_id = p_student_id
        ) e
      ) ev
      WHERE ev.event_date = v_check_date
        AND (p_section IS NULL OR ev.section = p_section)
        AND (p_domain  IS NULL OR ev.domain  = p_domain)
        AND (p_skill   IS NULL OR ev.skill   = p_skill)
    ) INTO v_has_event;

    IF v_has_event THEN
      v_streak := v_streak + 1;
      v_check_date := v_check_date - 1;
    ELSE
      EXIT;
    END IF;

    IF v_streak >= 730 THEN
      EXIT;
    END IF;
  END LOOP;

  RETURN v_streak;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_streak_days(uuid, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_streak_days(uuid, text, text, text, timestamptz) TO service_role;

-- §7.5 longest streak: walks the FULL canonical history, returns the max consecutive-day run.
-- Pure derivation from canonical events (RB-05B-V1-04) — no preserved state. 730-day cap mirrors
-- compute_streak_days. distinct active UTC days -> island-and-gap max run length.
CREATE OR REPLACE FUNCTION public.compute_longest_streak_days(
  p_student_id  uuid,
  p_t_now       timestamptz DEFAULT now()
) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_longest integer := 0;
BEGIN
  WITH active_days AS (
    SELECT DISTINCT (e.occurred_at AT TIME ZONE 'UTC')::date AS d
    FROM (
      SELECT pi.occurred_at
      FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered'
      UNION ALL
      SELECT ra.occurred_at
      FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id
    ) e
    WHERE e.occurred_at IS NOT NULL
  ),
  islands AS (
    -- gaps-and-islands: consecutive days share (d - row_number()) as the island key.
    SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::integer AS grp
    FROM active_days
  )
  SELECT COALESCE(MAX(run_len), 0) INTO v_longest
  FROM (SELECT COUNT(*) AS run_len FROM islands GROUP BY grp) r;

  RETURN v_longest;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_longest_streak_days(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_longest_streak_days(uuid, timestamptz) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. refresh_section_kpi (Doc 05B §7.2) — SINGLE WRITER of student_section_kpi.
--    @adaptation A3/A4: event UNION = practice_session_items[answered] + review_error_attempts.
--    The 4 (ROUND decimals) is a storage-precision arg, not a denylisted formula constant.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_section_kpi(
  p_student_id  uuid,
  p_section     text,
  p_t_now       timestamptz DEFAULT now()
) RETURNS public.student_section_kpi
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_short_days     integer;
  v_long_days      integer;
  v_bad_count      integer;
  v_t_short_cutoff timestamptz;
  v_t_long_cutoff  timestamptz;
  v_result_row     public.student_section_kpi;
BEGIN
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('kpi_section|' || p_student_id::text || '|' || p_section));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'KPI_LOCK_TIMEOUT: section KPI lock (%, %)', p_student_id, p_section;
  END;

  SELECT short_days, long_days INTO v_short_days, v_long_days FROM public.read_kpi_recency_constants();
  v_t_short_cutoff := p_t_now - make_interval(days => v_short_days);
  v_t_long_cutoff  := p_t_now - make_interval(days => v_long_days);

  -- RB-05B-V1-02: explicit data-integrity validation, no silent NULL filter.
  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered' AND pi.question_section = p_section
    UNION ALL
    SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id AND ra.section = p_section
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'KPI_HISTORICAL_DATA_INVALID: % canonical rows have NULL correct/occurred_at for student %, section % (refresh_section_kpi)', v_bad_count, p_student_id, p_section;
  END IF;

  WITH section_events AS (
    SELECT correct, occurred_at FROM (
      SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered' AND pi.question_section = p_section
      UNION ALL
      SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id AND ra.section = p_section
    ) e
  ),
  aggregates AS (
    SELECT
      COUNT(*)                                                AS evt_total,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) AS evt_7d,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff)  AS evt_30d,
      CASE WHEN COUNT(*) > 0
           THEN SUM(CASE WHEN correct THEN 1 ELSE 0 END)::numeric / COUNT(*) ELSE NULL END AS acc_overall,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) > 0
           THEN SUM(CASE WHEN correct AND occurred_at >= v_t_short_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) ELSE NULL END AS acc_7d,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) > 0
           THEN SUM(CASE WHEN correct AND occurred_at >= v_t_long_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) ELSE NULL END AS acc_30d,
      MAX(occurred_at) AS last_active
    FROM section_events
  ),
  streak AS (
    SELECT public.compute_streak_days(p_student_id, p_section, NULL::text, NULL::text, p_t_now) AS current_streak
  )
  INSERT INTO public.student_section_kpi (
    student_id, section, events_total, events_last_7d, events_last_30d,
    accuracy_overall, accuracy_last_7d, accuracy_last_30d,
    current_streak_days, last_active_at, kpi_refresh_version, refreshed_at, refreshed_at_t_now
  )
  SELECT p_student_id, p_section, a.evt_total, a.evt_7d, a.evt_30d,
    ROUND(a.acc_overall, 4), ROUND(a.acc_7d, 4), ROUND(a.acc_30d, 4),
    s.current_streak, a.last_active, 'v1.0', now(), p_t_now
  FROM aggregates a CROSS JOIN streak s
  ON CONFLICT (student_id, section) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    current_streak_days=EXCLUDED.current_streak_days, last_active_at=EXCLUDED.last_active_at,
    kpi_refresh_version=EXCLUDED.kpi_refresh_version, refreshed_at=EXCLUDED.refreshed_at,
    refreshed_at_t_now=EXCLUDED.refreshed_at_t_now
  RETURNING * INTO v_result_row;

  RETURN v_result_row;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_section_kpi(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_section_kpi(uuid, text, timestamptz) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. refresh_domain_kpi (Doc 05B §7.3) — SINGLE WRITER of student_domain_kpi. No streak (§6.2).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_domain_kpi(
  p_student_id  uuid,
  p_section     text,
  p_domain      text,
  p_t_now       timestamptz DEFAULT now()
) RETURNS public.student_domain_kpi
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_short_days     integer;
  v_long_days      integer;
  v_bad_count      integer;
  v_t_short_cutoff timestamptz;
  v_t_long_cutoff  timestamptz;
  v_result_row     public.student_domain_kpi;
BEGIN
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('kpi_domain|' || p_student_id::text || '|' || p_section || '|' || p_domain));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'KPI_LOCK_TIMEOUT: domain KPI lock (%, %, %)', p_student_id, p_section, p_domain;
  END;

  SELECT short_days, long_days INTO v_short_days, v_long_days FROM public.read_kpi_recency_constants();
  v_t_short_cutoff := p_t_now - make_interval(days => v_short_days);
  v_t_long_cutoff  := p_t_now - make_interval(days => v_long_days);

  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered'
        AND pi.question_section = p_section AND pi.question_domain = p_domain
    UNION ALL
    SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id AND ra.section = p_section AND ra.domain = p_domain
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'KPI_HISTORICAL_DATA_INVALID: % canonical rows have NULL correct/occurred_at for student %, section %, domain % (refresh_domain_kpi)', v_bad_count, p_student_id, p_section, p_domain;
  END IF;

  WITH domain_events AS (
    SELECT correct, occurred_at FROM (
      SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered'
          AND pi.question_section = p_section AND pi.question_domain = p_domain
      UNION ALL
      SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id AND ra.section = p_section AND ra.domain = p_domain
    ) e
  ),
  aggregates AS (
    SELECT
      COUNT(*)                                                AS evt_total,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) AS evt_7d,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff)  AS evt_30d,
      CASE WHEN COUNT(*) > 0
           THEN SUM(CASE WHEN correct THEN 1 ELSE 0 END)::numeric / COUNT(*) ELSE NULL END AS acc_overall,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) > 0
           THEN SUM(CASE WHEN correct AND occurred_at >= v_t_short_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) ELSE NULL END AS acc_7d,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) > 0
           THEN SUM(CASE WHEN correct AND occurred_at >= v_t_long_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) ELSE NULL END AS acc_30d,
      MAX(occurred_at) AS last_active
    FROM domain_events
  )
  INSERT INTO public.student_domain_kpi (
    student_id, section, domain, events_total, events_last_7d, events_last_30d,
    accuracy_overall, accuracy_last_7d, accuracy_last_30d,
    last_active_at, kpi_refresh_version, refreshed_at, refreshed_at_t_now
  )
  SELECT p_student_id, p_section, p_domain, a.evt_total, a.evt_7d, a.evt_30d,
    ROUND(a.acc_overall, 4), ROUND(a.acc_7d, 4), ROUND(a.acc_30d, 4),
    a.last_active, 'v1.0', now(), p_t_now
  FROM aggregates a
  ON CONFLICT (student_id, section, domain) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    last_active_at=EXCLUDED.last_active_at, kpi_refresh_version=EXCLUDED.kpi_refresh_version,
    refreshed_at=EXCLUDED.refreshed_at, refreshed_at_t_now=EXCLUDED.refreshed_at_t_now
  RETURNING * INTO v_result_row;

  RETURN v_result_row;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_domain_kpi(uuid, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_domain_kpi(uuid, text, text, timestamptz) TO service_role;

-- ----------------------------------------------------------------------------
-- 7. refresh_skill_kpi (Doc 05B §7.4) — SINGLE WRITER of student_skill_kpi. Refreshes ALL
--    skills in (section, domain). RETURNS void (touches multiple rows). Skill-grain NULL check.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_skill_kpi(
  p_student_id  uuid,
  p_section     text,
  p_domain      text,
  p_t_now       timestamptz DEFAULT now()
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_short_days     integer;
  v_long_days      integer;
  v_bad_count      integer;
  v_t_short_cutoff timestamptz;
  v_t_long_cutoff  timestamptz;
BEGIN
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('kpi_skill_batch|' || p_student_id::text || '|' || p_section || '|' || p_domain));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'KPI_LOCK_TIMEOUT: skill KPI batch lock (%, %, %)', p_student_id, p_section, p_domain;
  END;

  SELECT short_days, long_days INTO v_short_days, v_long_days FROM public.read_kpi_recency_constants();
  v_t_short_cutoff := p_t_now - make_interval(days => v_short_days);
  v_t_long_cutoff  := p_t_now - make_interval(days => v_long_days);

  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.question_skill AS skill, pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered'
        AND pi.question_section = p_section AND pi.question_domain = p_domain
    UNION ALL
    SELECT ra.skill, ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id AND ra.section = p_section AND ra.domain = p_domain
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL OR e.skill IS NULL;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'KPI_HISTORICAL_DATA_INVALID: % canonical rows have NULL correct/occurred_at/skill for student %, section %, domain % (refresh_skill_kpi)', v_bad_count, p_student_id, p_section, p_domain;
  END IF;

  WITH skill_events AS (
    SELECT skill, correct, occurred_at FROM (
      SELECT pi.question_skill AS skill, pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered'
          AND pi.question_section = p_section AND pi.question_domain = p_domain
      UNION ALL
      SELECT ra.skill, ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id AND ra.section = p_section AND ra.domain = p_domain
    ) e
  )
  INSERT INTO public.student_skill_kpi (
    student_id, section, domain, skill, events_total, events_last_7d, events_last_30d,
    accuracy_overall, accuracy_last_7d, accuracy_last_30d,
    last_active_at, kpi_refresh_version, refreshed_at, refreshed_at_t_now
  )
  SELECT
    p_student_id, p_section, p_domain, se.skill,
    COUNT(*),
    COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff),
    COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff),
    ROUND(SUM(CASE WHEN correct THEN 1 ELSE 0 END)::numeric / COUNT(*), 4),
    CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) > 0
         THEN ROUND(SUM(CASE WHEN correct AND occurred_at >= v_t_short_cutoff THEN 1 ELSE 0 END)::numeric
              / COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff), 4) ELSE NULL END,
    CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) > 0
         THEN ROUND(SUM(CASE WHEN correct AND occurred_at >= v_t_long_cutoff THEN 1 ELSE 0 END)::numeric
              / COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff), 4) ELSE NULL END,
    MAX(occurred_at),
    'v1.0', now(), p_t_now
  FROM skill_events se
  GROUP BY se.skill
  ON CONFLICT (student_id, section, domain, skill) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    last_active_at=EXCLUDED.last_active_at, kpi_refresh_version=EXCLUDED.kpi_refresh_version,
    refreshed_at=EXCLUDED.refreshed_at, refreshed_at_t_now=EXCLUDED.refreshed_at_t_now;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_skill_kpi(uuid, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_skill_kpi(uuid, text, text, timestamptz) TO service_role;

-- ----------------------------------------------------------------------------
-- 8. refresh_overall_kpi (Doc 05B §7.5) — SINGLE WRITER of student_overall_kpi. All sections,
--    overall streak + longest streak (RB-05B-V1-04: pure EXCLUDED.longest_streak_days, no GREATEST).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_overall_kpi(
  p_student_id  uuid,
  p_t_now       timestamptz DEFAULT now()
) RETURNS public.student_overall_kpi
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_short_days     integer;
  v_long_days      integer;
  v_bad_count      integer;
  v_t_short_cutoff timestamptz;
  v_t_long_cutoff  timestamptz;
  v_result_row     public.student_overall_kpi;
BEGIN
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('kpi_overall|' || p_student_id::text));
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'KPI_LOCK_TIMEOUT: overall KPI lock (%)', p_student_id;
  END;

  SELECT short_days, long_days INTO v_short_days, v_long_days FROM public.read_kpi_recency_constants();
  v_t_short_cutoff := p_t_now - make_interval(days => v_short_days);
  v_t_long_cutoff  := p_t_now - make_interval(days => v_long_days);

  SELECT count(*) INTO v_bad_count FROM (
    SELECT pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
      WHERE pi.user_id = p_student_id AND pi.status = 'answered'
    UNION ALL
    SELECT ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
      WHERE ra.student_id = p_student_id
  ) e WHERE e.correct IS NULL OR e.occurred_at IS NULL;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'KPI_HISTORICAL_DATA_INVALID: % canonical rows have NULL correct/occurred_at for student % (refresh_overall_kpi)', v_bad_count, p_student_id;
  END IF;

  WITH all_events AS (
    SELECT section, correct, occurred_at FROM (
      SELECT pi.question_section AS section, pi.is_correct AS correct, pi.occurred_at FROM public.practice_session_items pi
        WHERE pi.user_id = p_student_id AND pi.status = 'answered'
      UNION ALL
      SELECT ra.section, ra.is_correct, ra.occurred_at FROM public.review_error_attempts ra
        WHERE ra.student_id = p_student_id
    ) e
  ),
  aggregates AS (
    SELECT
      COUNT(*) AS evt_total,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) AS evt_7d,
      COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff)  AS evt_30d,
      CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(CASE WHEN correct THEN 1 ELSE 0 END)::numeric / COUNT(*), 4) ELSE NULL END AS acc_overall,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff) > 0
           THEN ROUND(SUM(CASE WHEN correct AND occurred_at >= v_t_short_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_short_cutoff), 4) ELSE NULL END AS acc_7d,
      CASE WHEN COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff) > 0
           THEN ROUND(SUM(CASE WHEN correct AND occurred_at >= v_t_long_cutoff THEN 1 ELSE 0 END)::numeric
                / COUNT(*) FILTER (WHERE occurred_at >= v_t_long_cutoff), 4) ELSE NULL END AS acc_30d,
      COUNT(DISTINCT section)::smallint AS sec_active,
      MAX(occurred_at) AS last_active
    FROM all_events
  ),
  streak AS (
    SELECT
      public.compute_streak_days(p_student_id, NULL::text, NULL::text, NULL::text, p_t_now) AS current_streak,
      public.compute_longest_streak_days(p_student_id, p_t_now) AS longest_streak
  )
  INSERT INTO public.student_overall_kpi (
    student_id, events_total, events_last_7d, events_last_30d,
    accuracy_overall, accuracy_last_7d, accuracy_last_30d,
    sections_active, current_streak_days, longest_streak_days, last_active_at,
    kpi_refresh_version, refreshed_at, refreshed_at_t_now
  )
  SELECT p_student_id, a.evt_total, a.evt_7d, a.evt_30d,
    a.acc_overall, a.acc_7d, a.acc_30d,
    a.sec_active, s.current_streak, s.longest_streak, a.last_active,
    'v1.0', now(), p_t_now
  FROM aggregates a CROSS JOIN streak s
  ON CONFLICT (student_id) DO UPDATE SET
    events_total=EXCLUDED.events_total, events_last_7d=EXCLUDED.events_last_7d,
    events_last_30d=EXCLUDED.events_last_30d, accuracy_overall=EXCLUDED.accuracy_overall,
    accuracy_last_7d=EXCLUDED.accuracy_last_7d, accuracy_last_30d=EXCLUDED.accuracy_last_30d,
    sections_active=EXCLUDED.sections_active, current_streak_days=EXCLUDED.current_streak_days,
    longest_streak_days=EXCLUDED.longest_streak_days, last_active_at=EXCLUDED.last_active_at,
    kpi_refresh_version=EXCLUDED.kpi_refresh_version, refreshed_at=EXCLUDED.refreshed_at,
    refreshed_at_t_now=EXCLUDED.refreshed_at_t_now
  RETURNING * INTO v_result_row;

  RETURN v_result_row;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_overall_kpi(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_overall_kpi(uuid, timestamptz) TO service_role;

-- ----------------------------------------------------------------------------
-- 9. refresh_domain_mastery (Doc 05B §4, VERBATIM-faithful) — SINGLE WRITER of
--    student_domain_mastery. INV-05B-13: the ONLY mastery computation is
--    compute_mastery_for_entity('domain', ..., p_skill=NULL) — NO skill roll-up, NEVER reads
--    student_skill_mastery. §4.9: fires all four KPI refreshers in the same transaction.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_domain_mastery(
  p_student_id  uuid,
  p_section     text,
  p_domain      text
) RETURNS public.student_domain_mastery
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_constants              jsonb;
  v_constants_hash         text;
  v_active_version         text;
  v_before_score           numeric;
  v_before_level           smallint;
  v_total_events           integer;
  v_acc_test               numeric;
  v_acc_practice           numeric;
  v_acc_review             numeric;
  v_mastery_score          numeric;
  v_mastery_pct            numeric;
  v_mastery_level          smallint;
  v_last_event_id          uuid;          -- RB-05B-V1-08
  v_last_event_occurred_at timestamptz;   -- RB-05B-V1-08
  v_result_row             public.student_domain_mastery;
BEGIN
  -- §4.2 Step 1: required fields
  IF p_student_id IS NULL OR p_section IS NULL OR p_domain IS NULL THEN
    RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: required field is NULL (student=%, section=%, domain=%)', p_student_id, p_section, p_domain;
  END IF;
  -- §4.2 Step 2: section enum
  IF p_section NOT IN ('M','RW') THEN
    RAISE EXCEPTION 'MASTERY_VALIDATION_FAILED: section %', p_section;
  END IF;
  -- §4.2 Step 2 + Step 3: domain canonicality is BLOCKING in 05B; (section, domain) pair valid
  -- per Parent §10.2. Cross-section domain -> DOMAIN_SECTION_MISMATCH.
  IF p_section = 'M' AND p_domain NOT IN
       ('Algebra','Advanced Math','Problem Solving and Data Analysis','Geometry and Trigonometry') THEN
    RAISE EXCEPTION 'DOMAIN_SECTION_MISMATCH: domain % is not a canonical M domain', p_domain;
  END IF;
  IF p_section = 'RW' AND p_domain NOT IN
       ('Information and Ideas','Craft and Structure','Expression of Ideas','Standard English Conventions') THEN
    RAISE EXCEPTION 'DOMAIN_SECTION_MISMATCH: domain % is not a canonical RW domain', p_domain;
  END IF;

  -- §4.3 student-domain advisory transaction lock (prefix 'mastery_domain|' — cannot collide
  -- with 05A's 'mastery_event|' or the student-skill lock).
  SET LOCAL lock_timeout = '5s';
  BEGIN
    PERFORM pg_advisory_xact_lock(
      hashtext('mastery_domain|' || p_student_id::text || '|' || p_section || '|' || p_domain)
    );
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RAISE EXCEPTION 'MASTERY_LOCK_TIMEOUT: could not acquire student-domain advisory lock for (%, %, %) within 5 seconds',
      p_student_id, p_section, p_domain;
  END;

  -- §4.4 constants + snapshot hash (pgcrypto in extensions schema, genesis; same as 05A §4.5).
  v_constants := public.canonicalize_mastery_constants();
  v_constants_hash := encode(extensions.digest(public.canonicalize_mastery_constants_serialized(), 'sha256'), 'hex');
  v_active_version := v_constants->>'mastery_model_version';

  -- §4.5 compute domain mastery via the SHARED formula function (INV-05B-13 / INV-05A-11): the
  -- ONLY mastery computation in 05B. entity_type='domain', p_skill=NULL — aggregates events over
  -- ALL skills in the domain. NOT a roll-up of student_skill_mastery.
  SELECT total_events, acc_test, acc_practice, acc_review, mastery_score, mastery_pct, mastery_level
    INTO v_total_events, v_acc_test, v_acc_practice, v_acc_review, v_mastery_score, v_mastery_pct, v_mastery_level
  FROM public.compute_mastery_for_entity(
    p_student_id  => p_student_id,
    p_entity_type => 'domain',
    p_section     => p_section,
    p_domain      => p_domain,
    p_skill       => NULL
  );

  -- §4.6 capture before-state under the lock (NULL on first refresh — correct audit value).
  SELECT mastery_score, mastery_level INTO v_before_score, v_before_level
  FROM public.student_domain_mastery
  WHERE student_id = p_student_id AND section = p_section AND domain = p_domain;

  -- §4.7 RB-05B-V1-08: capture argmax(occurred_at) event in this domain (audit anchor; position 1
  -- of the formula). Purely derived — NULL on cold start. (occurred_at DESC, event_id DESC).
  SELECT cme.event_id, cme.occurred_at INTO v_last_event_id, v_last_event_occurred_at
  FROM public.canonical_mastery_events(p_student_id, 'domain', p_section, p_domain, NULL) cme
  ORDER BY cme.occurred_at DESC, cme.event_id DESC
  LIMIT 1;

  -- §4.7 upsert the domain mastery row
  INSERT INTO public.student_domain_mastery (
    student_id, section, domain,
    mastery_score, mastery_pct, mastery_level,
    acc_test, acc_practice, acc_review,
    event_count_total, mastery_model_version, constants_snapshot_hash, computed_at,
    last_event_id, last_event_occurred_at
  ) VALUES (
    p_student_id, p_section, p_domain,
    v_mastery_score, v_mastery_pct, v_mastery_level,
    v_acc_test, v_acc_practice, v_acc_review,
    v_total_events, v_active_version, v_constants_hash, now(),
    v_last_event_id, v_last_event_occurred_at
  )
  ON CONFLICT (student_id, section, domain) DO UPDATE SET
    mastery_score=EXCLUDED.mastery_score, mastery_pct=EXCLUDED.mastery_pct, mastery_level=EXCLUDED.mastery_level,
    acc_test=EXCLUDED.acc_test, acc_practice=EXCLUDED.acc_practice, acc_review=EXCLUDED.acc_review,
    event_count_total=EXCLUDED.event_count_total, mastery_model_version=EXCLUDED.mastery_model_version,
    constants_snapshot_hash=EXCLUDED.constants_snapshot_hash, computed_at=EXCLUDED.computed_at,
    last_event_id=EXCLUDED.last_event_id, last_event_occurred_at=EXCLUDED.last_event_occurred_at
  RETURNING * INTO v_result_row;

  -- §4.8 audit row — one per domain refresh (mastery_domain_refresh_audit_log; see header note).
  INSERT INTO public.mastery_domain_refresh_audit_log (
    audit_row_id, student_id, section, domain,
    mastery_score_before, mastery_score_after, mastery_level_before, mastery_level_after,
    event_count_after, constants_snapshot_hash, mastery_model_version, triggered_by, applied_at
  ) VALUES (
    gen_random_uuid(), p_student_id, p_section, p_domain,
    v_before_score, v_mastery_score, v_before_level, v_mastery_level,
    v_total_events, v_constants_hash, v_active_version,
    current_setting('app.mastery_refresh_trigger', true), now()
  );

  -- §4.9 downstream KPI refreshes — all four, SAME transaction (§2.3 / §8.1). Any failure rolls
  -- back the whole chain.
  PERFORM public.refresh_section_kpi(p_student_id, p_section);
  PERFORM public.refresh_domain_kpi(p_student_id, p_section, p_domain);
  PERFORM public.refresh_skill_kpi(p_student_id, p_section, p_domain);
  PERFORM public.refresh_overall_kpi(p_student_id);

  -- §4.10 return
  RETURN v_result_row;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_domain_mastery(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_domain_mastery(uuid, text, text) TO service_role;

COMMIT;
