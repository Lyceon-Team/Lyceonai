/**
 * @spec [Doc-01_V8 §20–§24 entitlements; Doc-05B §5.3 canonical predicate | SP25-001]
 * @implemented 2026-06-14
 *
 * plain English: THE single route-facing entitlement evaluator. Every server-side
 * "is this profile entitled?" decision goes through this service, which delegates to
 * the ONE canonical SQL predicate `public.entitlement_active(p_profile_id uuid)`
 * (supabase/migrations/20260613010000_05b_domain_mastery_kpi.sql:107). That RPC is the
 * same boolean oracle the guardian-mirror RLS policies consume, so the application-layer
 * gate cannot drift from the database-layer gate.
 *
 * Why this exists: prior to SP25-001 there were TWO evaluators — the SQL predicate
 * (status IN ('active','past_due'), keyed by profile_id) and a divergent TS predicate
 * `isEntitlementActive` (status {active,trialing}, keyed by a synthetic account_id,
 * reading a non-existent `plan` column). The TS predicate is now deleted; this service
 * is the only consumer route handlers and middleware are allowed to reach for the
 * active/inactive decision.
 *
 * expected outcome: `isEntitlementActiveForProfile(profileId)` returns the canonical
 * grace-inclusive verdict (active OR past_due) for the given profile id (= the user's
 * auth id; entitlements are student-scoped and keyed by profiles.id per genesis §20–24).
 *
 * trade-offs / edge cases:
 *  - The RPC is REVOKE ALL FROM PUBLIC and GRANT EXECUTE only to service_role, so this
 *    service MUST call it through the service-role client (supabaseServer). It is never
 *    callable from an authenticated user client.
 *  - On RPC error we fail CLOSED (return false) and log — an entitlement check must never
 *    fail open into paid access.
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { classifyError } from "../lib/redact";

export type EntitlementActiveResult = {
  active: boolean;
};

/**
 * Single canonical route-facing entitlement evaluator.
 * Delegates to the one SQL predicate `public.entitlement_active(p_profile_id)`.
 */
export class EntitlementService {
  /**
   * Returns true iff the profile has a canonical active entitlement
   * (status IN ('active','past_due','trialing') — grace-inclusive per owner
   * ruling 2026-06-14, widened to include `trialing` by SCL-029 and verified
   * against the live `entitlement_active` function body on 2026-09-02; this
   * docstring previously omitted `trialing` and was wrong).
   * Fails closed (false) on any RPC error.
   */
  static async isEntitlementActiveForProfile(
    profileId: string,
  ): Promise<boolean> {
    const verdict =
      await EntitlementService.evaluateEntitlementActive(profileId);
    // An unreadable answer is not an entitled one. Unchanged behaviour for
    // every existing caller: this is the ACCESS question, and denying access we
    // cannot justify is the safe direction.
    return verdict.ok ? verdict.active : false;
  }

  /**
   * The same predicate, with the read failure kept instead of swallowed.
   *
   * @spec [SCL-029 — the platform entitlement predicate is the one definition
   *        of "entitled"] | @implemented [2026-09-02]
   *
   * plain English: answers "is this profile entitled?" and, separately, "could
   * we tell?". Expected outcome: one definition of entitled, two call sites
   * that need OPPOSITE failure directions, and neither has to re-implement the
   * predicate to get one.
   *
   * WHY IT EXISTS. `isEntitlementActiveForProfile` collapses an RPC error into
   * `false`, which is right for ACCESS — deny what we cannot justify. It is
   * exactly wrong for a PURCHASE GUARD, where `false` means "not entitled, go
   * ahead and charge them": a transient RPC failure would silently re-open the
   * double-purchase gap the guard exists to close. The alternative was a second
   * query in the checkout route, which would fork the definition of entitled —
   * the Charter's "one fact, one source" rule refuses that. So the predicate
   * stays in one place and the failure POLICY moves to the caller.
   */
  static async evaluateEntitlementActive(
    profileId: string,
  ): Promise<{ ok: true; active: boolean } | { ok: false }> {
    if (!profileId) {
      // Not a read failure: an absent profile id is definitively not entitled.
      return { ok: true, active: false };
    }

    const { data, error } = await supabaseServer.rpc("entitlement_active", {
      p_profile_id: profileId,
    });

    if (error) {
      logger.error(
        "ENTITLEMENT",
        "rpc_failed",
        "entitlement_active RPC failed; the caller decides which way to fail",
        // Codex HIGH-6: `error.message` is vendor free text and may quote a row
        // or a constraint containing an identifier. Log the allow-listed class.
        // `profileId` is additionally digested at the logger boundary.
        { profileId, ...classifyError(error) },
      );
      return { ok: false };
    }

    return { ok: true, active: data === true };
  }

  /**
   * @spec [Doc-01_V8 §20 entitlement_features] @implemented 2026-08-12
   *
   * plain English: feature-scoped entitlement gate. Joins the canonical
   * entitlement_active predicate with entitlement_features.required_tier
   * to answer "can this profile access this specific feature?"
   *
   * expected outcome: returns true iff the feature exists, is enabled,
   * and either (a) its required_tier is 'free', or (b) its required_tier
   * is 'premium' AND the profile has an active entitlement.
   *
   * trade-offs / edge cases:
   *  - FAIL-CLOSED: unknown feature key, disabled feature, DB error,
   *    or entitlement-read error all return false. An entitlement-read
   *    failure must never accidentally grant the paid view.
   *  - This function is PROFILE-scoped, not role-scoped. Admin bypass
   *    is the caller's responsibility (check role before calling).
   *  - No caching — each call reads entitlement_features fresh. Acceptable
   *    for the projection endpoint's request rate; revisit if used on
   *    high-frequency paths.
   */
  static async canAccessFeature(
    profileId: string,
    featureKey: string,
  ): Promise<boolean> {
    if (!profileId || !featureKey) {
      return false;
    }

    try {
      const { data: feature, error: featureError } = await supabaseServer
        .from("entitlement_features")
        .select("required_tier, enabled")
        .eq("feature_key", featureKey)
        .maybeSingle();

      if (featureError) {
        logger.error(
          "ENTITLEMENT",
          "feature_read_failed",
          "entitlement_features read failed; failing closed",
          { profileId, featureKey, ...classifyError(featureError) },
        );
        return false;
      }

      // Unknown feature key or disabled feature → deny.
      if (!feature || feature.enabled !== true) {
        return false;
      }

      // Free-tier features are always accessible.
      if (feature.required_tier === "free") {
        return true;
      }

      // Premium feature: delegate to the canonical entitlement predicate.
      // await is required so a thrown/rejected RPC is caught by the surrounding
      // try/catch and fails closed (return false). Without await, an un-awaited
      // promise rejection escapes the catch block.
      return await EntitlementService.isEntitlementActiveForProfile(profileId);
    } catch {
      // Unexpected error → fail closed.
      logger.error(
        "ENTITLEMENT",
        "can_access_feature_threw",
        "canAccessFeature threw unexpectedly; failing closed",
        { profileId, featureKey },
      );
      return false;
    }
  }
}
