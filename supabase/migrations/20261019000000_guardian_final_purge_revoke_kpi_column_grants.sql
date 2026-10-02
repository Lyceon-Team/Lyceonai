-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- Guardian final purge, item 2: revoke `authenticated`'s SELECT on the eight KPI / mastery /
-- projection tables, and drop the two student read policies left on the skill tables.
--
-- @spec [Guardian_Closure_Plan G-NEW-15 (the column-grant finding) and "Handed off" rows
--        inventory F6 + "Column grants"; owner brief 2026-10-02 ("Guardian vertical: last PR",
--        item 2); SCL-198 (amends Doc 05A §2.4, INV-05A-12, §7.3, §7.4, §10.1, §10.3, §13;
--        Doc 05B §5.4, §6.6, §6.7, §15 and §2.4 / §11.1 as SCL-196 left them; Doc 05C §7.5 and
--        §7.4 / §11.1 as SCL-196 left them: no direct-read path to these tables for
--        `authenticated`; visibility is enforced at the service-role route layer)]
-- | @implemented [2026-10-02]
--
-- plain English: every read of these eight tables runs on the service role (`supabaseServer`,
-- `getSupabaseAdmin()`; nineteen call sites, none with a user JWT; established for this PR with
-- `git grep` over client/, server/, apps/, scripts/ and a catalog check that no function
-- `authenticated` or `anon` may execute reads them). The column-level SELECT the pipeline grants
-- `authenticated` is what made G-NEW-15's guardian policies live in the first place; with the
-- policies gone it grants nothing, but it is the one ingredient a future read policy would need
-- to reopen the path. This removes it, so a direct read is refused outright (42501) rather than
-- filtered to zero rows.
--
-- A table-level REVOKE also revokes the column-level grants on every column of the table
-- (PostgreSQL REVOKE semantics), so one statement per table covers all of them. `anon` is
-- revoked too: it holds nothing in the migrated schema, and a stray grant in a long-lived
-- database (Supabase's default ACLs) would be the same hole one role over.
--
-- The two skill-table policies (`student_skill_kpi_student_read`,
-- `student_skill_mastery_student_read`) are the last read policies on the eight; they are the
-- same dead-by-grant class as the twelve 20261017000000 dropped (inventory F6), and without
-- the grant they could never apply. RLS stays ENABLED on all eight.
--
-- Untouched: `service_role`'s grants (the only reader), every write path, the account-deletion
-- functions, `profiles.guardian_email`, `profiles.guardian_profile_id`.
--
-- Mutations: no scripts/ci/*.mutations.sh entry targeted these grants or policies before this
-- change (grep, 2026-10-02). Gated by GATE 14 of scripts/ci/guardian-view-decision-gate.sql
-- (fails if `authenticated` or `anon` regains SELECT on any of the eight, or a policy
-- reappears on the skill tables; plants M3/M4 in guardian-view-decision-gate.mutations.sh red
-- it by name) and by scripts/ci/guardian-mirror-gates.sh (a direct authenticated read is now
-- refused).
--
-- rollback (exact: the column grants and policies as the pipeline held them before this file;
-- no data is touched):
--   GRANT SELECT (student_id, events_total, events_last_7d, events_last_30d, accuracy_overall,
--     accuracy_last_7d, accuracy_last_30d, sections_active, current_streak_days,
--     longest_streak_days, last_active_at) ON public.student_overall_kpi TO authenticated;
--   GRANT SELECT (student_id, section, events_total, events_last_7d, events_last_30d,
--     accuracy_overall, accuracy_last_7d, accuracy_last_30d, current_streak_days,
--     last_active_at) ON public.student_section_kpi TO authenticated;
--   GRANT SELECT (student_id, section, domain, events_total, events_last_7d, events_last_30d,
--     accuracy_overall, accuracy_last_7d, accuracy_last_30d, last_active_at)
--     ON public.student_domain_kpi TO authenticated;
--   GRANT SELECT (student_id, section, domain, mastery_level, computed_at)
--     ON public.student_domain_mastery TO authenticated;
--   GRANT SELECT (student_id, section, projected_score_mid, projected_score_low,
--     projected_score_high, range_width, relevant_question_count, computed_at)
--     ON public.student_section_projections TO authenticated;
--   GRANT SELECT (student_id, section, projected_score_mid, projected_score_low,
--     projected_score_high, range_width, relevant_question_count, snapshot_at, snapshot_kind)
--     ON public.student_section_projection_snapshots TO authenticated;
--   GRANT SELECT (student_id, section, domain, skill, events_total, events_last_7d,
--     events_last_30d, accuracy_overall, accuracy_last_7d, accuracy_last_30d, last_active_at)
--     ON public.student_skill_kpi TO authenticated;
--   GRANT SELECT (student_id, section, domain, skill, mastery_level, computed_at)
--     ON public.student_skill_mastery TO authenticated;
--   CREATE POLICY student_skill_kpi_student_read ON public.student_skill_kpi
--     FOR SELECT TO authenticated USING (student_id = auth.uid());
--   CREATE POLICY student_skill_mastery_student_read ON public.student_skill_mastery
--     FOR SELECT TO authenticated USING (student_id = auth.uid());
--   (`anon` held nothing on these tables in the pipeline, so there is nothing to restore for it.)
-- ---------------------------------------------------------------------------

BEGIN;

REVOKE SELECT ON TABLE public.student_overall_kpi FROM authenticated, anon;
REVOKE SELECT ON TABLE public.student_section_kpi FROM authenticated, anon;
REVOKE SELECT ON TABLE public.student_domain_kpi FROM authenticated, anon;
REVOKE SELECT ON TABLE public.student_domain_mastery FROM authenticated, anon;
REVOKE SELECT ON TABLE public.student_section_projections FROM authenticated, anon;
REVOKE SELECT ON TABLE public.student_section_projection_snapshots FROM authenticated, anon;
REVOKE SELECT ON TABLE public.student_skill_kpi FROM authenticated, anon;
REVOKE SELECT ON TABLE public.student_skill_mastery FROM authenticated, anon;

DROP POLICY IF EXISTS student_skill_kpi_student_read ON public.student_skill_kpi;
DROP POLICY IF EXISTS student_skill_mastery_student_read ON public.student_skill_mastery;

-- Post-condition, checked where it is applied: a partial apply fails here, not silently.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'student_overall_kpi', 'student_section_kpi', 'student_domain_kpi', 'student_domain_mastery',
    'student_section_projections', 'student_section_projection_snapshots',
    'student_skill_kpi', 'student_skill_mastery'
  ] LOOP
    IF has_any_column_privilege('authenticated', 'public.' || t, 'SELECT')
       OR has_any_column_privilege('anon', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'kpi read grants: authenticated or anon can still SELECT public.%', t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'kpi read grants: RLS is not enabled on public.%', t;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('student_skill_kpi', 'student_skill_mastery')
  ) THEN
    RAISE EXCEPTION 'kpi read grants: a policy remains on student_skill_kpi / student_skill_mastery';
  END IF;
END $$;

COMMIT;
