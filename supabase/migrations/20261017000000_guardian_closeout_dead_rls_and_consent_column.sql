-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- Guardian closeout, category F: drop the twelve `*_student_read` / `*_guardian_read` RLS
-- policies on the six KPI / mastery / projection tables, the two boolean guardian gate
-- functions only those policies called, and `profiles.consent_given_at`.
--
-- @spec [Guardian_Closure_Plan G-NEW-15 (owner, 2026-09-30, approved for the closeout);
--        SCL-196 (amends Doc 05B §2.4's enforcement line and §11.1's policy list, Doc 05C
--        §7.4's read policies and §11.1's "must exist" list); guardian closeout brief 2026-10-01,
--        Part B category F] | @implemented [2026-10-01]
--
-- plain English: every read of these six tables runs on the service role, which bypasses RLS,
-- and the route layer is the enforcing layer (`resolveSubject` → `guardian_view_decision`, the
-- entitlement gate, and SCL-188's guardian projection of the KPI routes). The policies read as a
-- live access path and are not the one the app uses. With RLS still ENABLED and no SELECT
-- policy left, `anon` and `authenticated` read zero rows of these tables — denial by absence,
-- the posture `student_skill_mastery` already has for guardians.
--
-- WHAT THE BRIEF ASSUMED, AND WHAT THE MIGRATED SCHEMA SAYS. G-NEW-15 records that production
-- grants `authenticated` no SELECT on these tables, so the policies "can never apply". The
-- migration pipeline does grant `authenticated` COLUMN-level SELECT on all six (e.g.
-- `student_domain_mastery.mastery_level`, every `student_overall_kpi` counter), which a
-- table-level grant query does not show. Where those column grants exist the guardian policies
-- are LIVE: a guardian's JWT could read a linked student's KPI counters through PostgREST,
-- around SCL-188's projection. Dropping the guardian policies closes that path wherever it is
-- open; dropping the student policies removes a direct-read path no client uses (the client
-- issues no `supabase.from(...)`). The column grants themselves are left as they are: with no
-- policy they grant nothing, and narrowing them is outside this approval.
--
-- ORDER MATTERS: the guardian policies call `guardian_can_view_student(uuid)`, which calls
-- `guardian_can_view_student_as(uuid, uuid)`; a function cannot be dropped while a policy or
-- another function depends on it, and there is deliberately no CASCADE, so an unexpected
-- dependent makes this migration fail rather than silently take something else with it.
-- `guardian_view_decision(uuid, uuid)` — the ONE derivation, called by the server — is kept.
--
-- `profiles.consent_given_at`: referenced by nothing but its genesis definition — no function
-- body, policy, view, trigger, TypeScript reader or writer (inventory row F3). The consent flow
-- that would have written it was removed in G2-05.
--
-- Mutations: no scripts/ci/*.mutations.sh entry targets any object dropped here (grep,
-- 2026-10-01). The gates that pinned them are updated in the same change:
-- guardian-view-decision-gate.sql (GATEs 0, 9, 11, 12, 13), guardian-mirror-gates.sh,
-- 05b-domain-kpi-gates.sh, 05c-projection-gates.sh, guardian-revoke-party.pg.ci.test.ts.
-- ---------------------------------------------------------------------------

BEGIN;

DROP POLICY IF EXISTS student_overall_kpi_student_read ON public.student_overall_kpi;
DROP POLICY IF EXISTS student_overall_kpi_guardian_read ON public.student_overall_kpi;
DROP POLICY IF EXISTS student_section_kpi_student_read ON public.student_section_kpi;
DROP POLICY IF EXISTS student_section_kpi_guardian_read ON public.student_section_kpi;
DROP POLICY IF EXISTS student_domain_kpi_student_read ON public.student_domain_kpi;
DROP POLICY IF EXISTS student_domain_kpi_guardian_read ON public.student_domain_kpi;
DROP POLICY IF EXISTS student_domain_mastery_student_read ON public.student_domain_mastery;
DROP POLICY IF EXISTS student_domain_mastery_guardian_read ON public.student_domain_mastery;
DROP POLICY IF EXISTS student_section_projections_student_read ON public.student_section_projections;
DROP POLICY IF EXISTS student_section_projections_guardian_read ON public.student_section_projections;
DROP POLICY IF EXISTS projection_snapshots_student_read ON public.student_section_projection_snapshots;
DROP POLICY IF EXISTS projection_snapshots_guardian_read ON public.student_section_projection_snapshots;

DROP FUNCTION IF EXISTS public.guardian_can_view_student(uuid);
DROP FUNCTION IF EXISTS public.guardian_can_view_student_as(uuid, uuid);

-- Its catalog comment named the two forms just dropped; say what is true now.
COMMENT ON FUNCTION public.guardian_view_decision(uuid, uuid) IS
  'THE guardian-visibility derivation (Doc 01 V8 §35 + §38.1, Doc 05B §10.1/§10.3), and its only form: the server''s subject resolver calls it on the service role. Returns allow | not_linked | student_unentitled. Service-role only: the guardian id is an argument, so direct callers could otherwise probe arbitrary link pairs. The boolean forms guardian_can_view_student / _as were dropped with the RLS policies that called them (20261017000000, SCL-196).';

ALTER TABLE public.profiles DROP COLUMN IF EXISTS consent_given_at;

COMMIT;
