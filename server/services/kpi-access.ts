import { ensureAccountForUser, getEntitlement } from "../lib/account";
import { getSupabaseAdmin } from "../middleware/supabase-auth";

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

function isAccessActive(plan: "free" | "paid", status: string, currentPeriodEnd: string | null): boolean {
  if (plan !== "paid") return false;
  if (!(status === "active" || status === "trialing")) return false;
  if (!currentPeriodEnd) return true;
  return new Date(currentPeriodEnd) > new Date();
}

export async function resolvePaidKpiAccessForStudent(studentUserId: string): Promise<KpiEntitlementAccess> {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const accountId = await ensureAccountForUser(supabaseAdmin, studentUserId, "student");
    if (!accountId) {
      return baseFree("No student account is linked to this user.");
    }

    const entitlement = await getEntitlement(accountId);
    if (!entitlement) {
      return {
        ...baseFree("No entitlement record found for student account."),
        accountId,
      };
    }

    const hasPaidAccess = isAccessActive(entitlement.plan, entitlement.status, entitlement.current_period_end);

    return {
      hasPaidAccess,
      accountId,
      plan: entitlement.plan,
      status: entitlement.status,
      currentPeriodEnd: entitlement.current_period_end,
      reason: hasPaidAccess
        ? "Student has active paid entitlement."
        : "Student entitlement is free/inactive/expired for premium KPI surfaces.",
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

