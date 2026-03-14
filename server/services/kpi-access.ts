import { getEntitlement, resolveLinkedPairPremiumAccessForStudent } from "../lib/account";

export interface KpiEntitlementAccess {
  hasPaidAccess: boolean;
  accountId: string | null;
  plan: "free" | "paid";
  status: "active" | "trialing" | "past_due" | "canceled" | "inactive";
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

export async function resolvePaidKpiAccessForStudent(studentUserId: string): Promise<KpiEntitlementAccess> {
  try {
    const access = await resolveLinkedPairPremiumAccessForStudent(studentUserId);

    let status: KpiEntitlementAccess['status'] = 'inactive';
    let currentPeriodEnd: string | null = null;
    let sourceAccountId: string | null = access.studentAccountId;

    if (access.premiumSource === 'guardian') {
      sourceAccountId = access.guardianAccountId;
    }

    if (sourceAccountId) {
      const sourceEntitlement = await getEntitlement(sourceAccountId);
      if (sourceEntitlement) {
        status = sourceEntitlement.status;
        currentPeriodEnd = sourceEntitlement.current_period_end;
      }
    }

    return {
      hasPaidAccess: access.hasPremiumAccess,
      accountId: sourceAccountId,
      plan: access.hasPremiumAccess ? 'paid' : 'free',
      status: access.hasPremiumAccess ? status : 'inactive',
      currentPeriodEnd: access.hasPremiumAccess ? currentPeriodEnd : null,
      reason: access.reason,
    };
  } catch (err: any) {
    return baseFree(err?.message || "Failed to resolve entitlement state.");
  }
}

export async function resolvePaidKpiAccessForUser(userId: string, role: "student" | "guardian" | "admin"): Promise<KpiEntitlementAccess> {
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

  return baseFree("Guardian access is resolved via linked student entitlement middleware.");
}

