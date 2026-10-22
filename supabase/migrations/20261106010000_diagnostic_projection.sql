-- ============================================================================
-- LYCEON-MIGRATION-REVIEWED
--
-- The diagnostic projection (SCL-236): a stored, write-once projection per completed
-- diagnostic session, computed from that session's answers only, plus the one function that
-- may complete a diagnostic.
-- ============================================================================
-- @spec [SCL-236 (Doc 05C §12A new stored value; §12 post-completion state; Doc 05A §11.4),
--        SCL-235 (Doc 02B §12 free/paid); owner rulings 2026-10-16 (1-5) and 2026-10-17
--        (binding constraints 1-7; D1 = (a), D2 = yes); Doc 05E L1 (derived state deleted in
--        both deletion modes)] | @implemented [2026-10-17]
--
-- plain English:
--   1. student_diagnostic_projections — one row per (diagnostic session, section). Write-once:
--      no API role holds INSERT/UPDATE/DELETE (only the SECURITY DEFINER functions below write
--      it), and a trigger rejects every UPDATE, owner included. RLS on, no policies: every read
--      is the server's (the projection tables' pattern, SCL-198). ON DELETE CASCADE from the
--      session covers hard_delete; the account-deletion cascade deletes it at L1 in BOTH modes
--      (it is derived state, recomputable from retained activity).
--   2. One in-flight diagnostic per student: a partial unique index on (user_id) for
--      created/active diagnostic sessions (the race the 2026-10-17 report found).
--   3. compute_diagnostic_projection(session) — reads the session's ANSWERED items only
--      (practice_session_items.session_id = the session, status = 'answered'), derived through
--      canonical_mastery_events and joined back to those item ids, so the event shape is the
--      canonical one and no practice, review, QOTD or full-length event can enter. Per-domain
--      mastery by compute_mastery_core (Doc 05A, unchanged); gate, mastery term and range by
--      projection_core (Doc 05C §6, unchanged) with fl1 = fl2 = NULL (State A) and
--      relevant_question_count = the session's answered items in the section. Returns the two
--      rows; writes nothing. Deterministic: no wall clock enters the maths.
--   4. complete_diagnostic_session(session, now, filters) — the ONLY code that sets a
--      diagnostic to 'completed'. In one transaction: lock the session; if it is active/created,
--      set completed (completed_at stamped once, never rewritten); store the projection rows
--      (ON CONFLICT DO NOTHING, so replays and races cannot duplicate or change them); on the
--      transition only, refresh the live projection for both sections (D2; Doc 05C §12 names
--      diagnostic completion as a refresh boundary). An abandoned session is never completed.
--   5. diagnostic_projection_repair(limit) — stores the rows for every completed diagnostic
--      that has none (the backfill, and the daily sweep). Each session in its own subtransaction.
--   6. student_diagnostic_states — baseline_ready is now "the stored diagnostic projection
--      exists for the completed session" (both sections, either status). The four state
--      literals are unchanged (diagnostic-state-gate).
--   7. execute_account_deletion_cascade — 20261027000001's body verbatim plus one L1 step.
--
-- trade-offs: canonical_mastery_events is called once per answered (section, domain) of the
--   session (8 calls) and filtered to the session's item ids; it scans the student's other
--   events for that domain and discards them. That is the price of using the canonical event
--   derivation instead of a second copy of it.
--
-- ROLLBACK: DROP FUNCTION diagnostic_projection_repair(integer), complete_diagnostic_session(
--   uuid, timestamptz, jsonb), compute_diagnostic_projection(uuid); DROP TABLE
--   student_diagnostic_projections; DROP INDEX practice_sessions_one_inflight_diagnostic_uq;
--   re-apply student_diagnostic_states from 20260817010000 and
--   execute_account_deletion_cascade from 20261027000001.
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. The stored value
-- ----------------------------------------------------------------------------
CREATE TABLE public.student_diagnostic_projections (
  practice_session_id       uuid          NOT NULL
      REFERENCES public.practice_sessions(id) ON DELETE CASCADE,
  section                   text          NOT NULL CHECK (section IN ('M', 'RW')),
  student_id                uuid          NOT NULL,
  status                    text          NOT NULL
      CHECK (status IN ('computed', 'insufficient_evidence')),
  projected_score_mid       integer       NULL
      CHECK (projected_score_mid  IS NULL OR projected_score_mid  BETWEEN 200 AND 800),
  projected_score_low       integer       NULL
      CHECK (projected_score_low  IS NULL OR projected_score_low  BETWEEN 200 AND 800),
  projected_score_high      integer       NULL
      CHECK (projected_score_high IS NULL OR projected_score_high BETWEEN 200 AND 800),
  range_width               integer       NULL CHECK (range_width IS NULL OR range_width >= 0),
  relevant_question_count   integer       NULL
      CHECK (relevant_question_count IS NULL OR relevant_question_count >= 0),
  mastery_term              numeric(8,4)  NULL,
  answered_count            integer       NOT NULL CHECK (answered_count >= 0),
  domain_mastery            jsonb         NOT NULL,
  mastery_constants_hash    text          NOT NULL,
  projection_constants_hash text          NOT NULL,
  mastery_model_version     text          NOT NULL,
  computed_at               timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_session_id, section),
  -- computed <=> a full range; insufficient_evidence <=> no numbers (INV-05C-14/15).
  CONSTRAINT sdp_status_matches_scores CHECK (
    (status = 'computed'
       AND projected_score_mid IS NOT NULL AND projected_score_low IS NOT NULL
       AND projected_score_high IS NOT NULL AND range_width IS NOT NULL)
    OR
    (status = 'insufficient_evidence'
       AND projected_score_mid IS NULL AND projected_score_low IS NULL
       AND projected_score_high IS NULL AND range_width IS NULL)
  )
);
CREATE INDEX idx_student_diagnostic_projections_student
  ON public.student_diagnostic_projections (student_id);

COMMENT ON TABLE public.student_diagnostic_projections IS
  'SCL-236: the diagnostic projection. One write-once row per (completed diagnostic session, section), computed from that session''s answered items only. Written only by complete_diagnostic_session / diagnostic_projection_repair. The diagnostic_baseline snapshots it replaces stay as audit history and are read by nothing.';

CREATE FUNCTION public.student_diagnostic_projections_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DIAGNOSTIC_PROJECTION_IMMUTABLE: a stored diagnostic projection is never updated (session %, section %)',
    OLD.practice_session_id, OLD.section;
END;
$$;
CREATE TRIGGER student_diagnostic_projections_no_update
  BEFORE UPDATE ON public.student_diagnostic_projections
  FOR EACH ROW EXECUTE FUNCTION public.student_diagnostic_projections_immutable();

ALTER TABLE public.student_diagnostic_projections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_diagnostic_projections FROM PUBLIC;
REVOKE ALL ON public.student_diagnostic_projections FROM anon, authenticated;
REVOKE ALL ON public.student_diagnostic_projections FROM service_role;
GRANT SELECT ON public.student_diagnostic_projections TO service_role;

-- ----------------------------------------------------------------------------
-- 2. At most one diagnostic in flight per student
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX practice_sessions_one_inflight_diagnostic_uq
  ON public.practice_sessions (user_id)
  WHERE (mode = 'diagnostic' AND status IN ('created', 'active'));

-- ----------------------------------------------------------------------------
-- 3. compute_diagnostic_projection — the session's answers through the canonical formulas
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.compute_diagnostic_projection(p_session_id uuid)
RETURNS SETOF public.student_diagnostic_projections
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE
  v_student         uuid;
  v_mode            text;
  v_status          text;
  v_constants       jsonb;
  v_dm_section      text[]    := '{}';
  v_dm_domain       text[]    := '{}';
  v_dm_event_count  integer[] := '{}';
  v_dm_score        numeric[] := '{}';
  v_pair            record;
  v_mastery         record;
  v_pc              record;
  v_core            record;
  v_min_events      integer;
  v_mastery_hash    text;
  v_projection_hash text;
  v_section         text;
  v_answered        integer;
  v_row             public.student_diagnostic_projections;
BEGIN
  SELECT ps.user_id, ps.mode, ps.status
  INTO   v_student, v_mode, v_status
  FROM   public.practice_sessions ps
  WHERE  ps.id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DIAGNOSTIC_PROJECTION_SESSION_NOT_FOUND: %', p_session_id;
  END IF;
  IF v_mode IS DISTINCT FROM 'diagnostic' THEN
    RAISE EXCEPTION 'DIAGNOSTIC_PROJECTION_NOT_DIAGNOSTIC: session % has mode %', p_session_id, v_mode;
  END IF;
  IF v_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'DIAGNOSTIC_PROJECTION_NOT_COMPLETED: session % is %', p_session_id, v_status;
  END IF;
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'DIAGNOSTIC_PROJECTION_NO_STUDENT: session % has no user_id', p_session_id;
  END IF;

  -- Doc 05A per-domain mastery over THIS session's answered items only. The events come from the
  -- canonical derivation, restricted to the session's item ids, so their shape (section, domain,
  -- difficulty, correct, occurred_at, source_family) is exactly what live mastery sees.
  v_constants := public.canonicalize_mastery_constants();
  FOR v_pair IN
    SELECT DISTINCT pi.question_section AS section, pi.question_domain AS domain
    FROM   public.practice_session_items pi
    WHERE  pi.session_id = p_session_id
      AND  pi.status     = 'answered'
    ORDER BY 1, 2
  LOOP
    SELECT * INTO v_mastery
    FROM public.compute_mastery_core(
      ARRAY(
        SELECT ROW(ce.*)::public.mastery_event
        FROM   public.canonical_mastery_events(v_student, 'domain', v_pair.section, v_pair.domain, NULL) ce
        JOIN   public.practice_session_items pi ON pi.id = ce.event_id
        WHERE  pi.session_id = p_session_id
          AND  pi.status     = 'answered'
      ),
      v_constants
    );
    v_dm_section     := v_dm_section     || v_pair.section;
    v_dm_domain      := v_dm_domain      || v_pair.domain;
    v_dm_event_count := v_dm_event_count || v_mastery.total_events;
    v_dm_score       := v_dm_score       || v_mastery.mastery_score;
  END LOOP;

  SELECT * INTO v_pc FROM public.read_projection_constants();
  v_min_events := public.mastery_min_events();
  v_mastery_hash := encode(extensions.digest(public.canonicalize_mastery_constants_serialized(), 'sha256'), 'hex');
  v_projection_hash := encode(
      extensions.digest(convert_to(public.canonicalize_projection_constants_serialized(), 'UTF8'), 'sha256'),
      'hex');

  FOR v_section IN SELECT unnest(ARRAY['M', 'RW']) LOOP
    SELECT count(*)::integer INTO v_answered
    FROM   public.practice_session_items pi
    WHERE  pi.session_id       = p_session_id
      AND  pi.status           = 'answered'
      AND  pi.question_section = v_section;

    -- Doc 05C §6 (gate, mastery term, blend, range): State A, the session's own evidence count.
    SELECT * INTO v_core
    FROM public.projection_core(
        v_student, v_section,
        v_dm_section, v_dm_domain, v_dm_event_count, v_dm_score,
        v_min_events,
        NULL, NULL, v_answered,
        v_pc.target_qcount, v_pc.min_delta, v_pc.max_delta,
        v_pc.mid_round, v_pc.bound_round, v_pc.section_max, v_pc.section_min, v_pc.weights
    );

    v_row.practice_session_id       := p_session_id;
    v_row.section                   := v_section;
    v_row.student_id                := v_student;
    v_row.status                    := CASE WHEN v_core.projected_score_mid IS NULL
                                            THEN 'insufficient_evidence' ELSE 'computed' END;
    v_row.projected_score_mid       := v_core.projected_score_mid;
    v_row.projected_score_low       := v_core.projected_score_low;
    v_row.projected_score_high      := v_core.projected_score_high;
    v_row.range_width               := v_core.range_width;
    v_row.relevant_question_count   := v_core.relevant_question_count;
    v_row.mastery_term              := v_core.mastery_term;
    v_row.answered_count            := v_answered;
    v_row.domain_mastery            := COALESCE((
        SELECT jsonb_object_agg(d.domain, jsonb_build_object('mastery_score', d.score, 'events', d.events))
        FROM   unnest(v_dm_section, v_dm_domain, v_dm_score, v_dm_event_count) AS d(section, domain, score, events)
        WHERE  d.section = v_section), '{}'::jsonb);
    v_row.mastery_constants_hash    := v_mastery_hash;
    v_row.projection_constants_hash := v_projection_hash;
    v_row.mastery_model_version     := public.mastery_model_version();
    v_row.computed_at               := now();
    RETURN NEXT v_row;
  END LOOP;
END;
$func$;

-- ----------------------------------------------------------------------------
-- 4. complete_diagnostic_session — the one completion path
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.complete_diagnostic_session(
  p_session_id uuid,
  p_now        timestamptz,
  p_filters    jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE
  v_student        uuid;
  v_mode           text;
  v_status         text;
  v_completed_now  boolean := false;
  v_stored         integer;
  v_projection     text;
BEGIN
  IF p_session_id IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'DIAGNOSTIC_COMPLETE_INVALID_ARGS';
  END IF;

  -- Serialize every completer of this session (answer, skip, next, replay, race).
  SELECT ps.user_id, ps.mode, ps.status
  INTO   v_student, v_mode, v_status
  FROM   public.practice_sessions ps
  WHERE  ps.id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DIAGNOSTIC_COMPLETE_SESSION_NOT_FOUND: %', p_session_id;
  END IF;
  IF v_mode IS DISTINCT FROM 'diagnostic' THEN
    RAISE EXCEPTION 'DIAGNOSTIC_COMPLETE_NOT_DIAGNOSTIC: session % has mode %', p_session_id, v_mode;
  END IF;

  IF v_status = 'abandoned' THEN
    -- A terminated diagnostic is not spent (ruling Q1) and is never completed behind its back.
    RETURN jsonb_build_object('state', 'abandoned', 'completed_now', false, 'projection', NULL);
  END IF;

  IF v_status IN ('created', 'active') THEN
    BEGIN
      UPDATE public.practice_sessions
         SET status           = 'completed',
             completed_at     = p_now,
             updated_at       = p_now,
             last_activity_at = p_now,
             filters          = COALESCE(p_filters, filters)
       WHERE id = p_session_id;
    EXCEPTION WHEN unique_violation THEN
      -- practice_sessions_one_completed_diagnostic_uq: the student already completed another
      -- diagnostic. This one stays in flight; nothing is stored for it.
      RETURN jsonb_build_object('state', 'conflict_other_completed', 'completed_now', false,
                                'projection', NULL);
    END;
    v_completed_now := true;
  END IF;
  -- v_status = 'completed' (or just became so): completed_at is never rewritten.

  -- The stored projection. Its own subtransaction: a raise here (e.g. MASTERY_HISTORICAL_DATA_
  -- INVALID on a corrupt item) must not undo the completion and strand the student at 40 of 40;
  -- the session stays completed, 'failed' is returned, and diagnostic_projection_repair retries.
  BEGIN
    INSERT INTO public.student_diagnostic_projections
    SELECT * FROM public.compute_diagnostic_projection(p_session_id)
    ON CONFLICT (practice_session_id, section) DO NOTHING;
    GET DIAGNOSTICS v_stored = ROW_COUNT;

    SELECT CASE WHEN bool_and(sdp.status = 'computed') THEN 'computed' ELSE 'insufficient_evidence' END
    INTO   v_projection
    FROM   public.student_diagnostic_projections sdp
    WHERE  sdp.practice_session_id = p_session_id;
  EXCEPTION WHEN OTHERS THEN
    v_stored := 0;
    v_projection := 'failed';
    RAISE WARNING 'complete_diagnostic_session: projection for session % failed (%)', p_session_id, SQLSTATE;
  END;

  -- D2: the transition is a projection refresh boundary (Doc 05C §12) for the LIVE projection.
  -- Best-effort for the same reason; the throttle and the outbox refresh it again later.
  IF v_completed_now THEN
    BEGIN
      PERFORM public.compute_section_projection(v_student, 'M',  p_now);
      PERFORM public.compute_section_projection(v_student, 'RW', p_now);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'complete_diagnostic_session: live refresh for session % failed (%)', p_session_id, SQLSTATE;
    END;
  END IF;

  RETURN jsonb_build_object('state', 'completed', 'completed_now', v_completed_now,
                            'projection', v_projection, 'rows_stored', v_stored);
END;
$func$;

-- ----------------------------------------------------------------------------
-- 5. diagnostic_projection_repair — the backfill and the daily sweep
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.diagnostic_projection_repair(p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE
  v_session   uuid;
  v_examined  integer := 0;
  v_stored    integer := 0;
  v_failed    integer := 0;
  v_n         integer;
BEGIN
  FOR v_session IN
    SELECT ps.id
    FROM   public.practice_sessions ps
    WHERE  ps.mode    = 'diagnostic'
      AND  ps.status  = 'completed'
      AND  ps.user_id IS NOT NULL
      AND  NOT EXISTS (SELECT 1 FROM public.student_diagnostic_projections sdp
                       WHERE sdp.practice_session_id = ps.id)
    ORDER BY ps.completed_at NULLS LAST, ps.id
    LIMIT  GREATEST(COALESCE(p_limit, 0), 0)
  LOOP
    v_examined := v_examined + 1;
    BEGIN
      INSERT INTO public.student_diagnostic_projections
      SELECT * FROM public.compute_diagnostic_projection(v_session)
      ON CONFLICT (practice_session_id, section) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_stored := v_stored + v_n;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING 'diagnostic_projection_repair: session % failed (%)', v_session, SQLSTATE;
    END;
  END LOOP;
  RETURN jsonb_build_object('examined', v_examined, 'rows_stored', v_stored, 'failed', v_failed);
END;
$func$;

REVOKE ALL ON FUNCTION public.compute_diagnostic_projection(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_diagnostic_projection(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_diagnostic_projection(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.complete_diagnostic_session(uuid, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_diagnostic_session(uuid, timestamptz, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_diagnostic_session(uuid, timestamptz, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.diagnostic_projection_repair(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diagnostic_projection_repair(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.diagnostic_projection_repair(integer) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. student_diagnostic_states — baseline_ready from the stored diagnostic projection
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.student_diagnostic_states AS
WITH diag AS (
  SELECT
    ps.user_id                                                        AS student_id,
    count(*) FILTER (WHERE ps.status = 'completed')                   AS completed_count,
    count(*) FILTER (WHERE ps.status IN ('created', 'active'))        AS in_flight_count,
    max(ps.completed_at) FILTER (WHERE ps.status = 'completed')       AS diagnostic_completed_at,
    max(ps.last_activity_at) FILTER (WHERE ps.status = 'completed')   AS diagnostic_last_activity_at
  FROM public.practice_sessions ps
  WHERE ps.mode = 'diagnostic'
    AND ps.user_id IS NOT NULL
  GROUP BY ps.user_id
),
baseline AS (
  SELECT
    sdp.student_id,
    count(DISTINCT sdp.section)                                       AS stored_sections,
    count(DISTINCT sdp.section) FILTER (WHERE sdp.status = 'computed') AS scored_sections,
    min(sdp.computed_at)                                              AS baseline_captured_at
  FROM public.student_diagnostic_projections sdp
  JOIN public.practice_sessions ps
    ON ps.id = sdp.practice_session_id
   AND ps.status = 'completed'
  GROUP BY sdp.student_id
)
SELECT
  d.student_id,
  CASE
    WHEN d.completed_count > 0 AND COALESCE(b.stored_sections, 0) >= 2 THEN 'baseline_ready'
    WHEN d.completed_count > 0                                        THEN 'baseline_pending'
    WHEN d.in_flight_count > 0                                        THEN 'in_progress'
    ELSE                                                                   'not_taken'
  END                                                                 AS state,
  d.completed_count::integer                                          AS completed_diagnostic_count,
  d.in_flight_count::integer                                          AS in_flight_diagnostic_count,
  d.diagnostic_completed_at,
  -- The honest "when did this student finish" for a session whose completed_at was
  -- never stamped: last_activity_at is written on every lifecycle update.
  COALESCE(d.diagnostic_completed_at, d.diagnostic_last_activity_at)  AS diagnostic_finished_at,
  b.baseline_captured_at,
  COALESCE(b.scored_sections, 0)::integer                             AS baseline_scored_sections
FROM diag d
LEFT JOIN baseline b ON b.student_id = d.student_id;

COMMENT ON VIEW public.student_diagnostic_states IS
  'One row per student with any diagnostic session. state is the single canonical answer to "where is this student in the diagnostic lifecycle": not_taken | in_progress | baseline_pending | baseline_ready. baseline_ready = the stored diagnostic projection (SCL-236) exists for the completed session, both sections, computed or insufficient_evidence. Precedence matches resolveDiagnosticStartDecision — completed is checked first and is terminal.';

-- ----------------------------------------------------------------------------
-- 7. execute_account_deletion_cascade — 20261027000001 verbatim + L1-14
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

  -- L1-14. student_diagnostic_projections (SCL-236). Derived state: computed from the diagnostic
  -- session's answers and recomputable from retained activity, so DELETED in both modes like every
  -- other L1 projection table. (hard_delete would also reach it through practice_sessions ON DELETE
  -- CASCADE; anonymize keeps the session, so this line is what removes it there.)
  DELETE FROM public.student_diagnostic_projections WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_diagnostic_projections', v_count);

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
