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
   * (status IN ('active','past_due') — grace-inclusive per owner ruling 2026-06-14).
   * Fails closed (false) on any RPC error.
   */
  static async isEntitlementActiveForProfile(
    profileId: string,
  ): Promise<boolean> {
    if (!profileId) {
      return false;
    }

    const { data, error } = await supabaseServer.rpc("entitlement_active", {
      p_profile_id: profileId,
    });

    if (error) {
      logger.error(
        "ENTITLEMENT",
        "rpc_failed",
        "entitlement_active RPC failed; failing closed",
        { profileId, error: error.message, code: error.code },
      );
      return false;
    }

    return data === true;
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
          { profileId, featureKey, error: featureError.message },
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

  /**
   * @spec [Doc-03B_V4.1 §3.4, INV-03-02, SCL-032, SCL-079]
   * @implemented 2026-08-09
   * @amended 2026-09-01 — fail-open on query error (SCL-079, owner ruling)
   *
   * plain English: Checks whether the student has an active full-length exam
   * session (status = 'in_progress'). Returns true if a live exam is in
   * progress, false otherwise.
   *
   * DELIBERATE FAIL-OPEN on query error (SCL-079, Karl ruling 2026-09-01):
   * When the query fails — missing table, connection error, any DB error —
   * this returns false (allow) and logs a warning. This is a narrow, stated
   * exception to the general fail-closed rule. Justification from SCL-032's
   * threat model: a student in another tab has Gemini, ChatGPT, and search,
   * all of which give more than an anti-leak tutor. The exam block is
   * low-value integrity protection; its absence during infrastructure failure
   * costs little. Blocking ALL tutoring costs a lot — verified in production
   * 2026-09-01 where the missing table blocked 100% of LISA traffic.
   *
   * This exception does NOT generalize. Every other fail-closed gate on the
   * LISA surface (entitlement, anti-leak, crisis) stays closed. Do not copy
   * this pattern without an owner ruling.
   *
   * When the query succeeds: an active exam row → true (block, INV-03-02
   * enforced); no active exam row → false (allow). The invariant works
   * correctly when the exam vertical exists.
   *
   * trade-offs: caching (30s soft TTL per spec) is not implemented in this
   * pass — every call is a live query. The caching layer (01A Part III key
   * `live_exam:{student_id}`, invalidated via `exam_status_changed` NOTIFY)
   * is a separate concern to be added once the NOTIFY channel is wired.
   *
   * bugs fixed 2026-09-01: table name was `full_length_exams` (no migration,
   * does not exist); correct table is `full_length_exam_sessions`. Column was
   * `student_id`; correct column is `user_id`.
   */
  static async isLiveExamInProgress(studentId: string): Promise<boolean> {
    if (!studentId) {
      return true; // fail closed — missing identity is a programming error
    }

    const { data, error } = await supabaseServer
      .from("full_length_exam_sessions")
      .select("id")
      .eq("user_id", studentId)
      .eq("status", "in_progress")
      .limit(1)
      .maybeSingle();

    if (error) {
      // DELIBERATE FAIL-OPEN — see SCL-079. Log at warn, not error, because
      // this is an expected condition when the exam vertical is not yet built.
      // The gate allows the turn through; it does not silently swallow.
      logger.warn(
        "ENTITLEMENT",
        "live_exam_check_failed_open",
        "full_length_exam_sessions query failed; failing OPEN per SCL-079 " +
          "(exam gate allows turn, logs warning)",
        { studentId, error: error.message, code: error.code },
      );
      return false; // fail OPEN — allow tutor access (SCL-079)
    }

    return data !== null;
  }
}
