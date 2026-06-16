-- ============================================================================
-- ENTITLEMENT-001 — entitlement_active must include 'trialing' (HALT-1 / SP-25 ruling)
-- ============================================================================
-- The canonical entitled set is {active, past_due, trialing} (contracts/auth-entitlement-sp25
-- .contract.md §1: launch ships a 7-day Stripe-native trial; `trialing` is a first-class entitled
-- state). The predicate shipped in 20260613010000_05b_domain_mastery_kpi.sql was {active, past_due}
-- only, so the SINGLE SQL source of truth denied trialing students/guardians (and contradicted its
-- own contract). This forward migration corrects the predicate AND the matching partial index so a
-- fresh genesis apply AND already-applied environments converge on {active, past_due, trialing}.
-- Idempotent (CREATE OR REPLACE + DROP/CREATE INDEX). LYCEON-MIGRATION-REVIEWED

CREATE OR REPLACE FUNCTION public.entitlement_active(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.entitlements e
    WHERE e.profile_id = p_profile_id AND e.status IN ('active','past_due','trialing')
  );
$$;
-- Same grant posture as the original (entitlement oracle): never granted to authenticated; reachable
-- only via guardian_can_view_student (SECURITY DEFINER) or service_role. LYCEON-MIGRATION-REVIEWED
REVOKE ALL ON FUNCTION public.entitlement_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.entitlement_active(uuid) TO service_role;

-- The matching partial index (genesis idx_entitlements_active) must include trialing too, so the
-- entitled lookups stay index-backed. Recreate it with the corrected predicate.
DROP INDEX IF EXISTS public.idx_entitlements_active;
CREATE INDEX idx_entitlements_active ON public.entitlements (profile_id)
  WHERE status = 'active' OR status = 'past_due' OR status = 'trialing';
