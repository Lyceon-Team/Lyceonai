-- ============================================================================
-- Fixture for the session-lifecycle DB gate (steps 2, 1, 8, 9).
-- ============================================================================
-- SEVEN students, and the shape of the set is the whole argument. Each one exists
-- to make a specific wrong implementation fail:
--
--   A  not_taken        no diagnostic at all — the function must answer for a
--                       student the VIEW has no row for
--   B  not_taken        ONE ABANDONED diagnostic. Ruling Q1: abandonment does not
--                       spend the diagnostic. An implementation that counted any
--                       diagnostic session would call this in_progress or worse.
--   C  in_progress      one active diagnostic
--   D  baseline_pending completed, zero snapshots — the prod shape this workstream
--                       exists to fix
--   E  baseline_pending completed + TWO diagnostic_baseline snapshot rows whose
--                       projected_score_mid is NULL.
--                       *** THE DISCRIMINATING ROW ***
--                       compute_section_projection writes an explicit ALL-NULL row
--                       when the Q4 evidence gate fails, so `count(*) >= 2` reads
--                       this student as baseline_ready and shows them a card with
--                       no numbers in it. Only a predicate that also requires a
--                       non-NULL mid gets this right. Without student E the gate
--                       cannot tell the two implementations apart.
--   F  baseline_ready   completed + two real snapshots
--   G  baseline_pending completed AND active at once — production's actual shape
--                       before resolve-duplicate-diagnostic.sql runs. Proves the
--                       CASE precedence matches resolveDiagnosticStartDecision,
--                       which checks completed FIRST and treats it as terminal.
--                       Swap the two CASE arms and this student reads in_progress.
-- ============================================================================

\set ON_ERROR_STOP on

\if :{?seed}

DO $seed$
DECLARE
  v_a uuid := 'aaaa1111-0000-4000-8000-000000000001';
  v_b uuid := 'aaaa1111-0000-4000-8000-000000000002';
  v_c uuid := 'aaaa1111-0000-4000-8000-000000000003';
  v_d uuid := 'aaaa1111-0000-4000-8000-000000000004';
  v_e uuid := 'aaaa1111-0000-4000-8000-000000000005';
  v_f uuid := 'aaaa1111-0000-4000-8000-000000000006';
  v_g uuid := 'aaaa1111-0000-4000-8000-000000000007';
  v_ids uuid[];
  v_id  uuid;
  v_actor uuid;
BEGIN
  v_ids := ARRAY[v_a, v_b, v_c, v_d, v_e, v_f, v_g];

  -- Distinct emails per student. handle_new_user refuses a second identity for an
  -- email that already owns a profile, so a shared email would silently leave six
  -- of these seven students without a profile row — and SELECT ... INTO would hand
  -- back a NULL actor_id rather than complaining.
  FOREACH v_id IN ARRAY v_ids LOOP
    INSERT INTO auth.users (id, email)
    VALUES (v_id, 'slc-' || right(v_id::text, 12) || '@example.com');
  END LOOP;

  -- B: abandoned only. Written the honest way (abandoned_at, no completed_at) so
  -- the fixture does not depend on whether step 9's migration has been applied.
  SELECT actor_id INTO v_actor FROM public.profiles WHERE id = v_b;
  INSERT INTO public.practice_sessions
    (user_id, mode, target_count, platform, status, actor_id, last_activity_at, abandoned_at)
  VALUES (v_b, 'diagnostic', 40, 'web', 'abandoned', v_actor,
          now() - interval '9 days', now() - interval '9 days');

  -- C: in flight
  SELECT actor_id INTO v_actor FROM public.profiles WHERE id = v_c;
  INSERT INTO public.practice_sessions
    (user_id, mode, target_count, platform, status, actor_id)
  VALUES (v_c, 'diagnostic', 40, 'web', 'active', v_actor);

  -- D, E, F, G: completed
  FOREACH v_id IN ARRAY ARRAY[v_d, v_e, v_f, v_g] LOOP
    SELECT actor_id INTO v_actor FROM public.profiles WHERE id = v_id;
    INSERT INTO public.practice_sessions
      (user_id, mode, target_count, platform, status, actor_id, completed_at, last_activity_at)
    VALUES (v_id, 'diagnostic', 40, 'web', 'completed', v_actor,
            now() - interval '3 days', now() - interval '3 days');
  END LOOP;

  -- G also holds an in-flight one at the same time.
  SELECT actor_id INTO v_actor FROM public.profiles WHERE id = v_g;
  INSERT INTO public.practice_sessions
    (user_id, mode, target_count, platform, status, actor_id)
  VALUES (v_g, 'diagnostic', 40, 'web', 'active', v_actor);

  -- E: two baseline rows, both all-NULL. This is what the evidence gate writes.
  INSERT INTO public.student_section_projection_snapshots
    (student_id, section, projected_score_mid, snapshot_kind)
  VALUES (v_e, 'M', NULL, 'diagnostic_baseline'),
         (v_e, 'RW', NULL, 'diagnostic_baseline');

  -- F: a real baseline.
  INSERT INTO public.student_section_projection_snapshots
    (student_id, section, projected_score_mid, projected_score_low, projected_score_high, snapshot_kind)
  VALUES (v_f, 'M', 520, 480, 560, 'diagnostic_baseline'),
         (v_f, 'RW', 540, 500, 580, 'diagnostic_baseline');
END $seed$;

\endif

-- ---------------------------------------------------------------------------
-- Step 9 fixture: an abandoned session carrying the BUG-4 completed_at stamp.
-- Seeded on a database whose migrations stop BEFORE 20260817020000, because the
-- constraint that migration adds is exactly what makes this row unwritable.
-- ---------------------------------------------------------------------------
\if :{?seed_legacy_abandoned}

DO $legacy$
DECLARE
  v_h uuid := 'bbbb2222-0000-4000-8000-000000000008';
  v_actor uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_h, 'slc-legacy@example.com');
  SELECT actor_id INTO v_actor FROM public.profiles WHERE id = v_h;

  -- The defect, reproduced exactly: status='abandoned' with completed_at set.
  INSERT INTO public.practice_sessions
    (user_id, mode, target_count, platform, status, actor_id, completed_at, last_activity_at)
  VALUES (v_h, 'balanced', 10, 'web', 'abandoned', v_actor,
          '2026-08-01 12:00:00Z', '2026-08-01 11:30:00Z');

  -- A second abandoned row with NO completed_at at all — the shape
  -- resolve-duplicate-diagnostic.sql deliberately leaves behind. Its abandoned_at
  -- must come from last_activity_at, not from a NULL, and not from now().
  INSERT INTO public.practice_sessions
    (user_id, mode, target_count, platform, status, actor_id, completed_at, last_activity_at)
  VALUES (v_h, 'balanced', 10, 'web', 'abandoned', v_actor,
          NULL, '2026-08-02 09:15:00Z');
END $legacy$;

\endif

-- ---------------------------------------------------------------------------
-- Step 10 fixture: idle and fresh sessions of both kinds.
-- ---------------------------------------------------------------------------
\if :{?seed_stale}

DO $stale$
DECLARE
  v_s uuid := 'cccc3333-0000-4000-8000-000000000009';
  v_actor uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_s, 'slc-stale@example.com');
  SELECT actor_id INTO v_actor FROM public.profiles WHERE id = v_s;

  INSERT INTO public.practice_sessions
    (user_id, mode, target_count, platform, status, actor_id, last_activity_at, client_instance_id)
  VALUES
    -- idle practice, past the 7-day window -> must be swept
    (v_s, 'balanced', 10, 'web', 'active', v_actor, now() - interval '8 days', 'stale-practice'),
    (v_s, 'timed',    10, 'web', 'created', v_actor, now() - interval '30 days', 'stale-created'),
    -- idle DIAGNOSTIC, past the window -> must NOT be swept (ruling Q1)
    (v_s, 'diagnostic', 40, 'web', 'active', v_actor, now() - interval '30 days', 'stale-diagnostic'),
    -- fresh practice, inside the window -> must NOT be swept
    (v_s, 'balanced', 10, 'web', 'active', v_actor, now() - interval '6 days', 'fresh-practice');
END $stale$;

\endif

-- ---------------------------------------------------------------------------
-- S2-C fixture: one student, TWO completed diagnostics. Seeded on a database
-- whose migrations stop BEFORE 20260817000000, because that migration is what
-- makes this state unwritable.
-- ---------------------------------------------------------------------------
\if :{?seed_two_completed}

DO $dup$
DECLARE
  v_x uuid := 'dddd4444-0000-4000-8000-00000000000a';
  v_actor uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_x, 'slc-dup@example.com');
  SELECT actor_id INTO v_actor FROM public.profiles WHERE id = v_x;

  INSERT INTO public.practice_sessions
    (user_id, mode, target_count, platform, status, actor_id, completed_at, last_activity_at)
  VALUES
    (v_x, 'diagnostic', 40, 'web', 'completed', v_actor, now() - interval '5 days', now() - interval '5 days'),
    (v_x, 'diagnostic', 40, 'web', 'completed', v_actor, now() - interval '2 days', now() - interval '2 days');
END $dup$;

\endif
