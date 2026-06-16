/**
 * Get guardian link for a specific studentId from canonical guardian_links table.
 * Only returns ACTIVE links.
 * Returns { account_id, student_user_id } if linked, else null.
 */
export async function getGuardianLinkForStudent(
  guardianProfileId: string,
  studentId: string,
): Promise<{ account_id: string | null; student_user_id: string } | null> {
  const { data, error } = await supabaseServer
    .from("guardian_links")
    .select("account_id, student_user_id")
    .eq("guardian_profile_id", guardianProfileId)
    .eq("student_user_id", studentId)
    .eq("status", "active")
    .single();
  if (error && error.code !== "PGRST116") {
    console.error("[Account] Failed to get guardian link for student:", error);
    throw new Error(`Failed to get guardian link: ${error.message}`);
  }
  return data || null;
}

/**
 * Check if a guardian is actively linked to a specific student.
 * Canonical check: guardian_links WHERE status = 'active'.
 */
export async function isGuardianLinkedToStudent(
  guardianProfileId: string,
  studentId: string,
): Promise<boolean> {
  const link = await getGuardianLinkForStudent(guardianProfileId, studentId);
  return link !== null;
}

/**
 * Create a new guardian↔student link in the canonical guardian_links table.
 */
export async function createGuardianLink(
  guardianProfileId: string,
  studentId: string,
  accountId?: string,
): Promise<{
  id: string;
  guardian_profile_id: string;
  student_user_id: string;
}> {
  const { data: guardianActiveLinks, error: guardianLinksError } =
    await supabaseServer
      .from("guardian_links")
      .select("student_user_id")
      .eq("guardian_profile_id", guardianProfileId)
      .eq("status", "active")
      .order("linked_at", { ascending: true })
      .limit(2);

  if (guardianLinksError) {
    throw new Error(
      `Failed to validate guardian active links: ${guardianLinksError.message}`,
    );
  }

  if (
    (guardianActiveLinks || []).some(
      (row: any) => row.student_user_id !== studentId,
    )
  ) {
    const conflictErr = new Error(
      "Guardian already has an active linked student",
    );
    (conflictErr as any).code = "GUARDIAN_ALREADY_LINKED";
    throw conflictErr;
  }

  const { data: studentActiveLinks, error: studentLinksError } =
    await supabaseServer
      .from("guardian_links")
      .select("guardian_profile_id")
      .eq("student_user_id", studentId)
      .eq("status", "active")
      .order("linked_at", { ascending: true })
      .limit(2);

  if (studentLinksError) {
    throw new Error(
      `Failed to validate student active links: ${studentLinksError.message}`,
    );
  }

  if (
    (studentActiveLinks || []).some(
      (row: any) => row.guardian_profile_id !== guardianProfileId,
    )
  ) {
    const conflictErr = new Error(
      "Student is already linked to another guardian",
    );
    (conflictErr as any).code = "STUDENT_ALREADY_LINKED";
    throw conflictErr;
  }

  const { data, error } = await supabaseServer
    .from("guardian_links")
    .upsert(
      {
        guardian_profile_id: guardianProfileId,
        student_user_id: studentId,
        account_id: accountId || null,
        status: "active",
        linked_at: new Date().toISOString(),
        revoked_at: null,
      },
      { onConflict: "guardian_profile_id,student_user_id" },
    )
    .select("id, guardian_profile_id, student_user_id")
    .single();

  if (error) {
    console.error("[Account] Failed to create guardian link:", error);
    throw new Error(`Failed to create guardian link: ${error.message}`);
  }

  return data;
}

/**
 * Revoke a guardian↔student link. Sets status='revoked' in guardian_links.
 * Immediately revokes guardian visibility without affecting student data.
 */
export async function revokeGuardianLink(
  guardianProfileId: string,
  studentId: string,
): Promise<void> {
  // Revoke in canonical table
  const { data, error } = await supabaseServer
    .from("guardian_links")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("guardian_profile_id", guardianProfileId)
    .eq("student_user_id", studentId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[Account] Failed to revoke guardian link:", error);
    throw new Error(`Failed to revoke guardian link: ${error.message}`);
  }

  if (!data?.id) {
    const conflictErr = new Error("Guardian link is not active");
    (conflictErr as any).code = "LINK_NOT_ACTIVE";
    throw conflictErr;
  }
}
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { SupabaseClient } from "@supabase/supabase-js";
import { EntitlementService } from "../services/entitlement-service";

/**
 * Ensures a user has an associated lyceon_account and membership.
 * Calls the RPC ensure_account_for_user(p_user_id, p_role) to create or fetch account.
 * Returns the account_id.
 */
export async function ensureAccountForUser(
  supabase: SupabaseClient,
  userId: string,
  role: "student" | "guardian" | "admin",
): Promise<string> {
  const { data, error } = await supabase.rpc("ensure_account_for_user", {
    p_user_id: userId,
    p_role: role,
  });

  if (error) {
    console.error("[Account] RPC ensure_account_for_user failed:", error);
    throw new Error(
      `RPC ensure_account_for_user failed: code=${error.code} message=${error.message} details=${error.details ?? ""} hint=${error.hint ?? ""}`,
    );
  }

  if (!data) {
    throw new Error("RPC ensure_account_for_user returned no accountId");
  }

  return data as string;
}

/**
 * Get account_id for a user by looking up account_members
 */
export async function getAccountIdForUser(
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("account_members")
    .select("account_id")
    .eq("user_id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("[Account] Failed to get account for user:", error);
    throw new Error(`Failed to get account: ${error.message}`);
  }

  return data?.account_id || null;
}

/**
 * Get all account memberships for a user
 */
export async function getAllAccountsForUser(
  userId: string,
): Promise<Array<{ accountId: string; role: string; createdAt: string }>> {
  const { data, error } = await supabaseServer
    .from("account_members")
    .select("account_id, role, accounts(created_at)")
    .eq("user_id", userId)
    .order("created_at", { foreignTable: "accounts", ascending: false });

  if (error) {
    console.error("[Account] Failed to get accounts for user:", error);
    throw new Error(`Failed to get accounts: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    accountId: row.account_id,
    role: row.role,
    createdAt: row.accounts?.created_at || new Date().toISOString(),
  }));
}

interface Entitlement {
  account_id: string;
  // Legacy in-app storage field (HALT-1 storage drift: genesis uses `tier`, not `plan`).
  plan: "free" | "paid";
  // Genesis-aligned status enum (genesis.sql:172). The writer persists Stripe's status
  // verbatim into this set (STRIPE-001); no legacy 'inactive' (absence of a row = unpaid).
  status: EntitlementStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  // STRIPE-001: genesis-aligned authoritative fields persisted verbatim from Stripe by the writer.
  tier?: EntitlementTier;
  current_period_start?: string | null;
  cancel_at_period_end?: boolean;
}

export type PairPremiumSource = "student" | "guardian" | "both" | "none";

export interface LinkedPairPremiumAccess {
  role: "student" | "guardian";
  hasPremiumAccess: boolean;
  hasActiveLink: boolean;
  premiumSource: PairPremiumSource;
  reason: string;
  studentUserId: string | null;
  guardianUserId: string | null;
  studentAccountId: string | null;
  guardianAccountId: string | null;
  studentEntitlementStatus: Entitlement["status"] | "missing";
  guardianEntitlementStatus: Entitlement["status"] | "missing";
  studentEntitlementExpired: boolean;
  guardianEntitlementExpired: boolean;
}

/**
 * @spec [SP25-001 | Doc-05B §5.3 canonical predicate] @implemented 2026-06-14
 * plain English: the divergent TS entitlement predicate `isEntitlementActive` was deleted.
 * There is exactly ONE entitlement evaluator now — `EntitlementService.isEntitlementActiveForProfile`
 * (server/services/entitlement-service.ts), which delegates to the single SQL predicate
 * `public.entitlement_active(p_profile_id)`. All route-facing active/inactive decisions key on the
 * profile id (= user.id) and flow through that one oracle. Diagnostic fields below (status/expired)
 * are presentation-only metadata, NOT a second gate.
 */
function isEntitlementExpired(entitlement: Entitlement | null): boolean {
  if (!entitlement?.current_period_end) return false;
  return new Date(entitlement.current_period_end) <= new Date();
}
interface UsageDaily {
  practice_questions_used: number;
  ai_messages_used: number;
}

// FREEMIUM-QUOTA-001: the free-tier PRACTICE quota is NOT hardcoded — it is the canonical
// config constant practice_runtime_config.daily_quota_free (Doc 02B §41; seeded = 40), read at
// request time. Only ai_chat remains a local constant (no config row exists for it yet).
const FREE_TIER_LIMITS = {
  ai_chat: 5,
};

/**
 * Canonical read of the free-tier daily PRACTICE quota from practice_runtime_config (the
 * seeded WS-2 config-constants table; key 'daily_quota_free'). No hardcoded quota — the value
 * lives only in the DB (the single source of truth). Throws if the config row is missing/invalid
 * (a seed/ops error) so the usage-limit caller surfaces it rather than silently enforcing a
 * wrong default.
 */
export async function getPracticeDailyFreeQuota(): Promise<number> {
  const { data, error } = await supabaseServer
    .from("practice_runtime_config")
    .select("value")
    .eq("key", "daily_quota_free")
    .single();
  if (error || !data) {
    throw new Error(
      "practice_runtime_config.daily_quota_free is not configured",
    );
  }
  const raw = (data as { value: unknown }).value;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `practice_runtime_config.daily_quota_free is invalid: ${String(raw)}`,
    );
  }
  return parsed;
}

/**
 * Get or create entitlement by account_id
 */
export async function getOrCreateEntitlement(
  accountId: string,
): Promise<Entitlement> {
  const { data: existing, error: fetchErr } = await supabaseServer
    .from("entitlements")
    .select("*")
    .eq("account_id", accountId)
    .single();

  if (existing) {
    return existing as Entitlement;
  }

  if (fetchErr && fetchErr.code !== "PGRST116") {
    throw new Error(`Failed to fetch entitlement: ${fetchErr.message}`);
  }

  const { data: created, error: createErr } = await supabaseServer
    .from("entitlements")
    .insert({ account_id: accountId })
    .select()
    .single();

  if (createErr) {
    throw new Error(`Failed to create entitlement: ${createErr.message}`);
  }

  return created as Entitlement;
}

/**
 * Get entitlement by account_id
 */
export async function getEntitlement(
  accountId: string,
): Promise<Entitlement | null> {
  const { data, error } = await supabaseServer
    .from("entitlements")
    .select("*")
    .eq("account_id", accountId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch entitlement: ${error.message}`);
  }

  return data as Entitlement | null;
}

/**
 * Upsert entitlement by account_id (UNIQUE constraint).
 * WEBHOOK-ONLY: This is the only writer for plan/status/current_period_end/stripe_subscription_id.
 */
export async function upsertEntitlement(
  accountId: string,
  updates: Partial<Omit<Entitlement, "account_id">>,
): Promise<Entitlement> {
  const { data, error } = await supabaseServer
    .from("entitlements")
    .upsert({ account_id: accountId, ...updates }, { onConflict: "account_id" })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to upsert entitlement: ${error.message}`);
  }

  return data as Entitlement;
}

/**
 * Update entitlement stripe_customer_id only (non-premium metadata).
 */
export async function setEntitlementStripeCustomerId(
  accountId: string,
  stripeCustomerId: string,
): Promise<Entitlement> {
  const { data, error } = await supabaseServer
    .from("entitlements")
    .update({ stripe_customer_id: stripeCustomerId })
    .eq("account_id", accountId)
    .select()
    .single();

  if (error) {
    throw new Error(
      `Failed to update entitlement stripe_customer_id: ${error.message}`,
    );
  }

  return data as Entitlement;
}

/**
 * Get entitlement by Stripe customer ID
 */
export async function getEntitlementByStripeCustomer(
  customerId: string,
): Promise<Entitlement | null> {
  const { data, error } = await supabaseServer
    .from("entitlements")
    .select("*")
    .eq("stripe_customer_id", customerId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `Failed to fetch entitlement by customer: ${error.message}`,
    );
  }

  return data as Entitlement | null;
}

/**
 * Get daily usage by account_id + day (UTC date)
 */
export async function getDailyUsage(accountId: string): Promise<UsageDaily> {
  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabaseServer
    .from("usage_daily")
    .select("practice_questions_used, ai_messages_used")
    .eq("account_id", accountId)
    .eq("day", today)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch daily usage: ${error.message}`);
  }

  return data || { practice_questions_used: 0, ai_messages_used: 0 };
}

/**
 * Increment usage by account_id + day
 */
export async function incrementUsage(
  accountId: string,
  type: "practice" | "ai_chat",
): Promise<UsageDaily> {
  const today = new Date().toISOString().split("T")[0];
  const column =
    type === "practice" ? "practice_questions_used" : "ai_messages_used";

  const { data: existing } = await supabaseServer
    .from("usage_daily")
    .select("*")
    .eq("account_id", accountId)
    .eq("day", today)
    .single();

  if (existing) {
    const { data, error } = await supabaseServer
      .from("usage_daily")
      .update({
        [column]: (existing[column] || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("account_id", accountId)
      .eq("day", today)
      .select("practice_questions_used, ai_messages_used")
      .single();

    if (error) throw new Error(`Failed to increment usage: ${error.message}`);
    return data as UsageDaily;
  }

  const { data, error } = await supabaseServer
    .from("usage_daily")
    .insert({
      account_id: accountId,
      day: today,
      practice_questions_used: type === "practice" ? 1 : 0,
      ai_messages_used: type === "ai_chat" ? 1 : 0,
      updated_at: new Date().toISOString(),
    })
    .select("practice_questions_used, ai_messages_used")
    .single();

  if (error) throw new Error(`Failed to create usage record: ${error.message}`);
  return data as UsageDaily;
}

/**
 * Check usage limit by account_id
 * Free limits: practice = practice_runtime_config.daily_quota_free (config, seeded 40); ai_chat 5/day
 */
export async function checkUsageLimit(
  accountId: string,
  type: "practice" | "ai_chat",
  options?: { premiumOverride?: boolean },
): Promise<{
  allowed: boolean;
  current: number;
  limit: number;
  resetAt: string;
}> {
  // SP25-001: entitlement is evaluated by the SINGLE canonical evaluator at the call site
  // (createUsageLimitMiddleware resolves premiumOverride via resolveLinkedPairPremiumAccess*,
  // which delegates to EntitlementService -> entitlement_active RPC). checkUsageLimit must NOT
  // re-evaluate entitlement itself — that would reintroduce a second evaluator. It only enforces
  // the free-tier daily quota when the caller reports no premium access.
  if (options?.premiumOverride) {
    return { allowed: true, current: 0, limit: Infinity, resetAt: "" };
  }

  const usage = await getDailyUsage(accountId);
  const current =
    type === "practice"
      ? usage.practice_questions_used
      : usage.ai_messages_used;
  // FREEMIUM-QUOTA-001: practice quota comes from the canonical config table, not a hardcode.
  const limit =
    type === "practice"
      ? await getPracticeDailyFreeQuota()
      : FREE_TIER_LIMITS.ai_chat;

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  const resetAt = tomorrow.toISOString();

  return {
    allowed: current < limit,
    current,
    limit,
    resetAt,
  };
}

/**
 * Get the primary linked student for a guardian.
 * CANONICAL: Reads from guardian_links WHERE status='active'.
 * Returns the first linked student's user_id.
 */
export async function getPrimaryGuardianLink(
  guardianUserId: string,
): Promise<{ student_user_id: string; account_id: string | null } | null> {
  const { data, error } = await supabaseServer
    .from("guardian_links")
    .select("student_user_id, account_id, linked_at")
    .eq("guardian_profile_id", guardianUserId)
    .eq("status", "active")
    .order("linked_at", { ascending: true })
    .limit(2);

  if (error) {
    console.error("[Account] Failed to get primary guardian link:", error);
    throw new Error(`Failed to get primary guardian link: ${error.message}`);
  }

  if ((data || []).length > 1) {
    throw new Error(
      "Guardian has multiple active student links; 1:1 invariant violated",
    );
  }

  const link = data?.[0];
  if (!link?.student_user_id) {
    return null;
  }

  return {
    student_user_id: link.student_user_id,
    account_id: link.account_id ?? null,
  };
}

/**
 * Get ALL active student links for a guardian.
 * CANONICAL: Reads from guardian_links WHERE status='active'.
 */
export async function getAllGuardianStudentLinks(
  guardianUserId: string,
): Promise<Array<{ student_user_id: string; linked_at: string }>> {
  const { data, error } = await supabaseServer
    .from("guardian_links")
    .select("student_user_id, linked_at")
    .eq("guardian_profile_id", guardianUserId)
    .eq("status", "active")
    .order("linked_at", { ascending: true })
    .limit(2);

  if (error) {
    console.error("[Account] Failed to get guardian student links:", error);
    throw new Error(`Failed to get guardian student links: ${error.message}`);
  }

  if ((data || []).length > 1) {
    throw new Error(
      "Guardian has multiple active student links; 1:1 invariant violated",
    );
  }

  return data || [];
}

export async function getLinkedGuardianForStudent(
  studentUserId: string,
): Promise<{ guardian_profile_id: string; account_id: string | null } | null> {
  const { data, error } = await supabaseServer
    .from("guardian_links")
    .select("guardian_profile_id, account_id, linked_at")
    .eq("student_user_id", studentUserId)
    .eq("status", "active")
    .order("linked_at", { ascending: true })
    .limit(2);

  if (error) {
    throw new Error(`Failed to get linked guardian: ${error.message}`);
  }

  if ((data || []).length > 1) {
    throw new Error(
      "Student has multiple active guardian links; 1:1 invariant violated",
    );
  }

  const link = data?.[0];
  if (!link?.guardian_profile_id) {
    return null;
  }

  return {
    guardian_profile_id: link.guardian_profile_id,
    account_id: link.account_id ?? null,
  };
}

export async function resolveLinkedPairPremiumAccessForStudent(
  studentUserId: string,
): Promise<LinkedPairPremiumAccess> {
  const studentAccountId = await ensureAccountForUser(
    supabaseServer,
    studentUserId,
    "student",
  );
  const studentEntitlement = studentAccountId
    ? await getEntitlement(studentAccountId)
    : null;

  const guardianLink = await getLinkedGuardianForStudent(studentUserId);
  const guardianUserId = guardianLink?.guardian_profile_id ?? null;
  const guardianAccountId = guardianUserId
    ? await getAccountIdForUser(guardianUserId)
    : null;
  const guardianEntitlement = guardianAccountId
    ? await getEntitlement(guardianAccountId)
    : null;

  // SP25-001: single evaluator — the active/inactive gate keys on the student's profile id
  // (= studentUserId) and flows through the one canonical RPC. Diagnostic fields below are
  // presentation-only and read from getEntitlement; they are NOT a second gate.
  const studentActive =
    await EntitlementService.isEntitlementActiveForProfile(studentUserId);
  const hasActiveLink = !!guardianLink;
  const hasPremiumAccess = studentActive;

  return {
    role: "student",
    hasPremiumAccess,
    hasActiveLink,
    premiumSource: studentActive ? "student" : "none",
    reason: hasPremiumAccess
      ? "Student has active premium entitlement."
      : hasActiveLink
        ? "Linked student account does not have an active premium entitlement."
        : "Student account does not have an active premium entitlement.",
    studentUserId,
    guardianUserId,
    studentAccountId,
    guardianAccountId,
    studentEntitlementStatus: studentEntitlement?.status ?? "missing",
    guardianEntitlementStatus: guardianEntitlement?.status ?? "missing",
    studentEntitlementExpired: isEntitlementExpired(studentEntitlement),
    guardianEntitlementExpired: isEntitlementExpired(guardianEntitlement),
  };
}

export async function resolveLinkedPairPremiumAccessForGuardian(
  guardianUserId: string,
  requestedStudentId?: string,
): Promise<LinkedPairPremiumAccess> {
  const guardianAccountId = await getAccountIdForUser(guardianUserId);
  const guardianEntitlement = guardianAccountId
    ? await getEntitlement(guardianAccountId)
    : null;

  const link = requestedStudentId
    ? await getGuardianLinkForStudent(guardianUserId, requestedStudentId)
    : await getPrimaryGuardianLink(guardianUserId);

  if (!link?.student_user_id) {
    return {
      role: "guardian",
      hasPremiumAccess: false,
      hasActiveLink: false,
      premiumSource: "none",
      reason: "Guardian has no linked student.",
      studentUserId: null,
      guardianUserId,
      studentAccountId: null,
      guardianAccountId,
      studentEntitlementStatus: "missing",
      guardianEntitlementStatus: guardianEntitlement?.status ?? "missing",
      studentEntitlementExpired: false,
      guardianEntitlementExpired: isEntitlementExpired(guardianEntitlement),
    };
  }

  const studentAccountId =
    link.account_id ??
    (await ensureAccountForUser(
      supabaseServer,
      link.student_user_id,
      "student",
    ));
  const studentEntitlement = studentAccountId
    ? await getEntitlement(studentAccountId)
    : null;

  // SP25-001: single evaluator — the guardian's access derives from the LINKED student's
  // entitlement, evaluated on the student's profile id via the one canonical RPC. Guardian model:
  // visibility requires active link (resolved above) AND active student entitlement (here).
  const studentActive = await EntitlementService.isEntitlementActiveForProfile(
    link.student_user_id,
  );
  const hasPremiumAccess = studentActive;

  return {
    role: "guardian",
    hasPremiumAccess,
    hasActiveLink: true,
    premiumSource: studentActive ? "student" : "none",
    reason: hasPremiumAccess
      ? "Linked student has active premium entitlement."
      : "Linked student account does not have an active premium entitlement.",
    studentUserId: link.student_user_id,
    guardianUserId,
    studentAccountId,
    guardianAccountId,
    studentEntitlementStatus: studentEntitlement?.status ?? "missing",
    guardianEntitlementStatus: guardianEntitlement?.status ?? "missing",
    studentEntitlementExpired: isEntitlementExpired(studentEntitlement),
    guardianEntitlementExpired: isEntitlementExpired(guardianEntitlement),
  };
}

/**
 * Canonical genesis entitlement status enum
 * (supabase/migrations/00000000000000_genesis.sql:172 CHECK constraint).
 */
export type EntitlementStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "trialing";

/**
 * Canonical genesis entitlement tier enum
 * (supabase/migrations/00000000000000_genesis.sql:171 CHECK constraint).
 */
export type EntitlementTier = "free" | "premium";

const STRIPE_STATUS_TO_GENESIS: Record<string, EntitlementStatus> = {
  active: "active",
  past_due: "past_due",
  canceled: "canceled",
  unpaid: "unpaid",
  incomplete: "incomplete",
  incomplete_expired: "incomplete_expired",
  trialing: "trialing",
};

/**
 * @spec [Doc-01_V8 §20–§24 entitlements; genesis.sql:171–172 | STRIPE-001] @implemented 2026-06-14
 * plain English: pure, authoritative Stripe-status -> genesis-entitlement mapping. The writer is a thin
 * idempotent receiver: it accepts the status Stripe reports and persists it verbatim into the canonical
 * genesis `entitlements.status` enum. NO transition graph, NO trial-ending computation, NO
 * canceled-at-request-time / temporal logic, NO grace derivation — `status` is authoritative as Stripe
 * reports it, and period fields are passed through unchanged.
 * tier is a static lookup (entitled statuses -> premium; terminal/none statuses -> free), not temporal.
 * expected outcome: returns the exact genesis status + tier for the given Stripe subscription status.
 * edge cases: an unrecognized Stripe status maps to a terminal { tier:'free', status:'canceled' } rather
 * than inventing a non-genesis value; recognized statuses are an exact 1:1 passthrough.
 */
export function mapStripeStatusToEntitlement(stripeStatus: string): {
  tier: EntitlementTier;
  status: EntitlementStatus;
} {
  const status = STRIPE_STATUS_TO_GENESIS[stripeStatus] ?? "canceled";
  // Entitled (paid/grace) statuses confer premium tier; everything else is free.
  // This is a static membership lookup, not a temporal/transition decision.
  const tier: EntitlementTier =
    status === "active" || status === "trialing" || status === "past_due"
      ? "premium"
      : "free";
  return { tier, status };
}

export { FREE_TIER_LIMITS };
