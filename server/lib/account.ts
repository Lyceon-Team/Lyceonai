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

/**
 * @spec [Doc-01_V8 §20–§24; genesis.sql:168–181]
 * Genesis-aligned entitlement row shape. Key: profile_id (= user.id from auth.users),
 * NOT account_id (dead column that never existed on prod).
 * stripe_customer_id lives on profiles, NOT entitlements.
 */
interface Entitlement {
  profile_id: string;
  tier: EntitlementTier;
  status: EntitlementStatus;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
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
  /** @deprecated diagnostic only — profileId = userId in the new model */
  studentAccountId: string | null;
  /** @deprecated diagnostic only — profileId = userId in the new model */
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
 * @spec [Doc-01_V8 §20–§24; genesis.sql:168–181] @implemented 2026-08-09
 * Read entitlement row for a profile. Returns null when no row exists (= free tier).
 * Queries by profile_id (= auth.users.id). No auto-create — absence of a row
 * means free tier; the webhook upsert is the only writer.
 */
export async function getEntitlementForProfile(
  profileId: string,
): Promise<Entitlement | null> {
  const { data, error } = await supabaseServer
    .from("entitlements")
    .select(
      "profile_id, tier, status, stripe_subscription_id, stripe_price_id, current_period_start, current_period_end, cancel_at_period_end",
    )
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch entitlement: ${error.message}`);
  }

  return data as Entitlement | null;
}

/**
 * @spec [Doc-01_V8 §20–§24; genesis.sql:168–181 | STRIPE-001] @implemented 2026-08-09
 * plain English: webhook-only upsert keyed on UNIQUE(profile_id). Persists Stripe's
 * authoritative subscription state verbatim into the genesis entitlements table.
 * onConflict targets the profile_id_unique constraint (added by migration).
 * stripe_customer_id is NOT written here — it lives on profiles (genesis:149).
 */
export async function upsertEntitlement(
  profileId: string,
  updates: Partial<Omit<Entitlement, "profile_id">>,
): Promise<Entitlement> {
  const { data, error } = await supabaseServer
    .from("entitlements")
    .upsert({ profile_id: profileId, ...updates }, { onConflict: "profile_id" })
    .select(
      "profile_id, tier, status, stripe_subscription_id, stripe_price_id, current_period_start, current_period_end, cancel_at_period_end",
    )
    .single();

  if (error) {
    throw new Error(`Failed to upsert entitlement: ${error.message}`);
  }

  return data as Entitlement;
}

/**
 * @spec [Doc-01_V8 §4; genesis.sql:149] @implemented 2026-08-09
 * plain English: read stripe_customer_id from the profiles table (genesis:149),
 * NOT from entitlements (which has no such column).
 */
export async function getProfileStripeCustomerId(
  profileId: string,
): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", profileId)
    .single();

  if (error) {
    throw new Error(
      `Failed to read stripe_customer_id from profile: ${error.message}`,
    );
  }

  return data?.stripe_customer_id ?? null;
}

/**
 * @spec [Doc-01_V8 §4; genesis.sql:149] @implemented 2026-08-09
 * plain English: write stripe_customer_id to the profiles table (genesis:149).
 * Called once during first checkout to persist the Stripe customer for a profile.
 */
export async function setProfileStripeCustomerId(
  profileId: string,
  stripeCustomerId: string,
): Promise<void> {
  const { error } = await supabaseServer
    .from("profiles")
    .update({ stripe_customer_id: stripeCustomerId })
    .eq("id", profileId);

  if (error) {
    throw new Error(
      `Failed to set stripe_customer_id on profile: ${error.message}`,
    );
  }
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

/**
 * @spec [Doc-01_V8 §20–§24; SP25-001] @implemented 2026-08-09
 * plain English: resolve premium access for a student. profile_id = userId (auth.users.id).
 * No ensureAccountForUser RPC — profile_id IS the user id, entitlement is read directly.
 * The active/inactive gate is the single canonical evaluator (EntitlementService).
 * Diagnostic fields (status/expired) are presentation-only metadata, NOT a second gate.
 */
export async function resolveLinkedPairPremiumAccessForStudent(
  studentUserId: string,
): Promise<LinkedPairPremiumAccess> {
  // profile_id = userId — read entitlement directly, no account indirection
  const studentEntitlement = await getEntitlementForProfile(studentUserId);

  const guardianLink = await getLinkedGuardianForStudent(studentUserId);
  const guardianUserId = guardianLink?.guardian_profile_id ?? null;
  const guardianEntitlement = guardianUserId
    ? await getEntitlementForProfile(guardianUserId)
    : null;

  // SP25-001: single evaluator — the active/inactive gate keys on the student's profile id
  // (= studentUserId) and flows through the one canonical RPC. Diagnostic fields below are
  // presentation-only and read from getEntitlementForProfile; they are NOT a second gate.
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
    studentAccountId: studentUserId,
    guardianAccountId: guardianUserId,
    studentEntitlementStatus: studentEntitlement?.status ?? "missing",
    guardianEntitlementStatus: guardianEntitlement?.status ?? "missing",
    studentEntitlementExpired: isEntitlementExpired(studentEntitlement),
    guardianEntitlementExpired: isEntitlementExpired(guardianEntitlement),
  };
}

/**
 * @spec [Doc-01_V8 §20–§24; SP25-001; guardian trust model] @implemented 2026-08-09
 * plain English: resolve premium access for a guardian. Guardian access derives from the
 * LINKED STUDENT's entitlement — guardian's own entitlement is diagnostic-only metadata.
 * profile_id = userId — no ensureAccountForUser / getAccountIdForUser indirection.
 */
export async function resolveLinkedPairPremiumAccessForGuardian(
  guardianUserId: string,
  requestedStudentId?: string,
): Promise<LinkedPairPremiumAccess> {
  // profile_id = userId — read guardian entitlement directly (diagnostic only)
  const guardianEntitlement = await getEntitlementForProfile(guardianUserId);

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
      guardianAccountId: guardianUserId,
      studentEntitlementStatus: "missing",
      guardianEntitlementStatus: guardianEntitlement?.status ?? "missing",
      studentEntitlementExpired: false,
      guardianEntitlementExpired: isEntitlementExpired(guardianEntitlement),
    };
  }

  // profile_id = student_user_id — read entitlement directly
  const studentEntitlement = await getEntitlementForProfile(
    link.student_user_id,
  );

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
    studentAccountId: link.student_user_id,
    guardianAccountId: guardianUserId,
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
