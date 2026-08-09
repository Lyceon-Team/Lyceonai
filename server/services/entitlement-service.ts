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
  static async isEntitlementActiveForProfile(profileId: string): Promise<boolean> {
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
        { profileId, error: error.message, code: error.code }
      );
      return false;
    }

    return data === true;
  }

  /**
   * @spec [Doc-03B_V4.1 §3.4, INV-03-02]
   * @implemented 2026-08-09
   *
   * plain English: Checks whether the student has an active full-length exam
   * session (status = 'in_progress'). Returns true if a live exam is in
   * progress, false otherwise. Fails CLOSED (returns true) on DB error — a
   * failing live-exam check must never allow tutor access during an exam.
   *
   * trade-offs: caching (30s soft TTL per spec) is not implemented in this
   * pass — every call is a live query. The caching layer (01A Part III key
   * `live_exam:{student_id}`, invalidated via `exam_status_changed` NOTIFY)
   * is a separate concern to be added once the NOTIFY channel is wired.
   */
  static async isLiveExamInProgress(studentId: string): Promise<boolean> {
    if (!studentId) {
      return true; // fail closed
    }

    const { data, error } = await supabaseServer
      .from("full_length_exams")
      .select("id")
      .eq("student_id", studentId)
      .eq("status", "in_progress")
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error(
        "ENTITLEMENT",
        "live_exam_check_failed",
        "full_length_exams live-exam query failed; failing closed (INV-03-02)",
        { studentId, error: error.message, code: error.code },
      );
      return true; // fail closed — block tutor access
    }

    return data !== null;
  }
}
