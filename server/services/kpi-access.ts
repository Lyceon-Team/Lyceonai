import {
  getEntitlementForProfile,
  resolveLinkedPairPremiumAccessForStudent,
  type EntitlementStatus,
} from "../lib/account";

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

export async function resolvePaidKpiAccessForUser(
  userId: string,
  role: "student" | "guardian" | "admin",
): Promise<KpiEntitlementAccess> {
  if (role === "admin") {
    return {
      hasPaidAccess: true,
      accountId: null,
      plan: "paid",
      status: "active",
      currentPeriodEnd: null,
      reason: "Admin bypass.",
    };
  }

  if (role === "student") {
    return resolvePaidKpiAccessForStudent(userId);
  }

  return baseFree(
    "Guardian access is resolved via linked student entitlement middleware.",
  );
}
