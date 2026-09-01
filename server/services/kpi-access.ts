import {
  getEntitlementForProfile,
  resolveLinkedPairPremiumAccessForStudent,
  type EntitlementStatus,
} from "../lib/account";
import { EntitlementService } from "./entitlement-service";

/**
 * @spec [Doc 05 Parent §15.2 + AC#19 — guardians read the student's aggregates through a
 *   gate; Doc 04C invariant #7 — "Guardians MUST NOT see fields the student does not see";
 *   owner ruling 2026-08-23 — "the guardian sees exactly what the student sees, no more and
 *   no less"] | @implemented [2026-08-24]
 *
 * plain English: does THIS STUDENT have historical-trend KPIs? The subject is always the
 * student, whoever is asking.
 *
 * WHY THIS IS SHARED AND NOT INLINE.
 *   The student KPI route derived this from the student's own entitlement, fail-closed. The
 *   guardian route passed a hardcoded `true`. So a guardian could see a premium surface the
 *   student's own entitlement denied them — the payer's view was more permissive than the
 *   learner's, which inverts the trust model and violates 04C invariant #7 outright.
 *
 *   The defect was possible because the derivation existed in one place and the guardian
 *   route simply did not call it. One exported function, two call sites, same subject: a
 *   future guardian surface cannot re-answer this question differently, because there is
 *   only one place the question is answered.
 *
 * FAIL-CLOSED. An entitlement read that throws returns false — hide the premium surface
 * rather than 500 the endpoint, and never let a failed read widen access. An error is not
 * an entitlement.
 */
export async function resolveHistoricalTrendsAccess(
  studentProfileId: string,
): Promise<boolean> {
  try {
    return await EntitlementService.canAccessFeature(
      studentProfileId,
      "historical_trends",
    );
  } catch {
    return false;
  }
}

export interface KpiEntitlementAccess {
  hasPaidAccess: boolean;
  accountId: string | null;
  plan: "free" | "paid";
  // genesis entitlement status, or the 'inactive' sentinel for "no entitlement row".
  status: EntitlementStatus | "inactive";
  currentPeriodEnd: string | null;
  reason: string;
}

function baseFree(reason: string): KpiEntitlementAccess {
  return {
    hasPaidAccess: false,
    accountId: null,
    plan: "free",
    status: "inactive",
    currentPeriodEnd: null,
    reason,
  };
}

/**
 * @spec [Doc-01_V8 §20–§24] @implemented 2026-08-09
 * plain English: resolve paid KPI access for a student. profile_id = studentUserId.
 * Reads entitlement directly by profile_id — no account indirection.
 */
export async function resolvePaidKpiAccessForStudent(
  studentUserId: string,
): Promise<KpiEntitlementAccess> {
  try {
    const access =
      await resolveLinkedPairPremiumAccessForStudent(studentUserId);

    let status: KpiEntitlementAccess["status"] = "inactive";
    let currentPeriodEnd: string | null = null;

    // profile_id = studentUserId — read entitlement directly
    const sourceEntitlement = await getEntitlementForProfile(studentUserId);
    if (sourceEntitlement) {
      status = sourceEntitlement.status;
      currentPeriodEnd = sourceEntitlement.current_period_end;
    }

    return {
      hasPaidAccess: access.hasPremiumAccess,
      accountId: studentUserId,
      plan: access.hasPremiumAccess ? "paid" : "free",
      status: access.hasPremiumAccess ? status : "inactive",
      currentPeriodEnd: access.hasPremiumAccess ? currentPeriodEnd : null,
      reason: access.reason,
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error
        ? err.message
        : "Failed to resolve entitlement state.";
    return baseFree(msg);
  }
}

/**
 * @spec [Doc-03B_V2 §3.2; Karl ruling 2026-08-05 #1/#2] | @implemented 2026-08-05
 * plain English: Resolve whether userId has paid access. Admin bypass REMOVED per Karl
 * ruling #1 (student-only for LISA) and #2 (admin safety-review is a separate surface).
 * Admin callers now receive the same entitlement evaluation as students — no implicit
 * hasPaidAccess:true for role=admin.
 *
 * expected outcome: only students with active entitlements get hasPaidAccess:true.
 * trade-offs: admin users without entitlements will receive hasPaidAccess:false on any
 * surface that calls this function. Admin tooling must use a dedicated admin surface.
 */
export async function resolvePaidKpiAccessForUser(
  userId: string,
  role: "student" | "guardian" | "admin",
): Promise<KpiEntitlementAccess> {
  if (role === "student" || role === "admin") {
    return resolvePaidKpiAccessForStudent(userId);
  }

  return baseFree(
    "Guardian access is resolved via linked student entitlement middleware.",
  );
}
