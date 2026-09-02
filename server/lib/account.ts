/**
 * Guardian↔student linkage — the canonical `guardian_links` data layer.
 *
 * @spec [Doc-01_V8, §35 Guardian-student linkage; §36.1 Initiation; §36.3 Revocation]
 *       | @implemented [2026-08-26]
 *
 * plain English: create, read, accept and revoke the links between a guardian and the
 * students they can see. What it does: writes rows to `guardian_links` using the column
 * names and status domain the table actually has, and moves a link through the two-step
 * lifecycle §36.1 specifies rather than writing it straight to `active`. Expected outcome:
 * a guardian-initiated link lands in `pending_student_accept` and becomes `active` only
 * when the student accepts; the reverse for a student-initiated one; a guardian may hold
 * links to more than one student. Trade-offs and edge cases are stated per function.
 *
 * WHAT THIS REPLACES, AND WHY. The previous implementation referenced four columns that
 * do not exist on this table — `student_user_id`, `account_id`, `linked_at`, and an
 * `upsert` onConflict target built from two of them — so every read and every write
 * failed at the database (`WS-GL_Stage1_Audit.md` §1, §3.2). It also enforced a 1:1
 * guardian↔student rule that §35 does not state and §31.3 explicitly contradicts:
 * *"If a guardian has multiple linked students, any one active premium student grants the
 * guardian premium derivation."* That rule was a retired V6 artifact; it is gone.
 *
 * The `accounts` model is retired on this surface (owner ruling 2026-08-24). There is no
 * `accounts` table, no `account_members`, and no `ensure_account_for_user` RPC in
 * production, so `account_id` could never resolve. It is removed, not defaulted.
 */

import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import {
  GUARDIAN_LINK_ERROR,
  GuardianLinkError,
  GUARDIAN_LINK_COLUMNS,
  GUARDIAN_LINK_SQLSTATE,
  parseGuardianLink,
  parseGuardianLinks,
  type GuardianLink,
  type GuardianLinkInitiator,
} from "../../packages/shared/src/guardian-link-schema";

/**
 * The row contract lives in `packages/shared` per coding-standards §7.2 — Zod first, types
 * inferred, one definition. Re-exported here so existing importers of `account.ts` keep
 * resolving without a second declaration to drift from it.
 */
export type {
  GuardianLink,
  GuardianLinkStatus,
  GuardianLinkInitiator,
} from "../../packages/shared/src/guardian-link-schema";

/**
 * Error contract re-exported from `packages/shared` so importers of this module keep
 * resolving. The definitions live there, not here — see that file for why.
 */
export {
  GUARDIAN_LINK_ERROR,
  GuardianLinkError,
} from "../../packages/shared/src/guardian-link-schema";

/**
 * @spec [migration 20260828000000; owner ruling 2026-08-27 Q5] | @implemented [2026-08-28]
 *
 * plain English: turn a PostgREST error from one of the audited transition functions into the
 * module's own error type, or rethrow.
 *
 * The functions raise custom SQLSTATEs which PostgREST surfaces as `error.code`, so this maps
 * a CODE, never a message. An unmapped code is NOT swallowed into a generic failure: it throws
 * with the code visible, because a transition failing for a reason nobody enumerated is exactly
 * what an operator needs to see.
 */
function throwGuardianLinkError(
  error: { code?: string | null; message?: string | null },
  context: string,
): never {
  const mapped = error.code ? GUARDIAN_LINK_SQLSTATE[error.code] : undefined;
  if (mapped) {
    throw new GuardianLinkError(mapped, error.message ?? mapped);
  }
  logger.error("GUARDIAN", context, "Guardian link transition failed", {
    code: error.code ?? null,
    reason: error.message ?? "unknown",
  });
  throw new Error(
    `${context} failed: ${error.message ?? "unknown"} (${error.code ?? "no code"})`,
  );
}

/**
 * @spec [Doc-01_V8, §35] | @implemented [2026-08-26]
 * plain English: is this guardian actively linked to this student? Returns the active row
 * or null. Expected outcome: a single row, because `unique_active_link` makes more than one
 * active row for a pair impossible. Edge case: PostgREST's `PGRST116` (no rows) is not an
 * error here — it is the "not linked" answer — so it is filtered out rather than thrown.
 */
export async function getGuardianLinkForStudent(
  guardianProfileId: string,
  studentProfileId: string,
): Promise<GuardianLink | null> {
  const { data, error } = await supabaseServer
    .from("guardian_links")
    .select(GUARDIAN_LINK_COLUMNS)
    .eq("guardian_profile_id", guardianProfileId)
    .eq("student_profile_id", studentProfileId)
    .eq("status", "active")
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    logger.error(
      "GUARDIAN",
      "get_link_for_student",
      "Failed to read guardian link",
      { reason: error.message },
    );
    throw new Error(`Failed to get guardian link: ${error.message}`);
  }
  return data ? parseGuardianLink(data) : null;
}

/**
 * @spec [Doc-01_V8, §36.1/§36.3; owner ruling 2026-08-27 Q7 — "404 if the caller is not a party
 *   to the link at all; keep the informative response if they are"] | @implemented [2026-08-28]
 *
 * plain English: read the most recent link between one guardian and one student, WHATEVER its
 * status. Expected outcome: the row, or null when the two have never been linked at all.
 *
 * WHY THIS IS NOT `getGuardianLinkForStudent`, WHICH QUERIES THE SAME TABLE ON THE SAME PAIR.
 *   That one filters `status = 'active'` and answers "may this guardian see this student right
 *   now?" — the question every read gate asks. This one answers a different question, the only
 *   one Q7's 404-versus-409 split turns on: "has this guardian ever been a party to a link with
 *   this student?" A guardian holding a REVOKED link is not authorized, but is a party, and a
 *   party already knows the link exists — so telling them "there is no active link" leaks
 *   nothing, while telling a stranger the same thing confirms a student they have no business
 *   confirming. Collapsing the two readers would force one of those two answers to be wrong.
 *
 * Edge case: a pair may hold several rows over time (linked, revoked, linked again), since
 * `unique_active_link` constrains only the active one. Party-hood needs existence, not a
 * particular row, so this returns the most recent by `initiated_at` and callers use it as a
 * predicate.
 */
export async function getAnyGuardianLinkForPair(
  guardianProfileId: string,
  studentProfileId: string,
): Promise<GuardianLink | null> {
  const { data, error } = await supabaseServer
    .from("guardian_links")
    .select(GUARDIAN_LINK_COLUMNS)
    .eq("guardian_profile_id", guardianProfileId)
    .eq("student_profile_id", studentProfileId)
    .order("initiated_at", { ascending: false })
    .limit(1);

  if (error) {
    logger.error(
      "GUARDIAN",
      "get_any_link_for_pair",
      "Failed to read guardian link",
      { reason: error.message },
    );
    throw new Error(`Failed to get guardian link: ${error.message}`);
  }
  const row = (data ?? [])[0];
  return row ? parseGuardianLink(row) : null;
}

/**
 * @spec [Doc-01_V8, §36.1 Initiation; owner ruling 2026-08-27 Q7 — "404 if the caller is not
 *   a party to the link at all; keep the informative response if they are"]
 *   | @implemented [2026-08-27]
 *
 * plain English: read one link by its id, whatever its status. Expected outcome: the row, or
 * null if no such link exists.
 *
 * WHY THIS EXISTS SEPARATELY FROM `acceptGuardianLink`, WHICH ALSO READS THE ROW.
 *   Q7 draws the enumeration line at PARTY-HOOD, not at authorization: a caller named on the
 *   link already knows it exists, so telling them "awaiting the other party" leaks nothing,
 *   while a caller who is not on it must not learn the link exists at all. `acceptGuardianLink`
 *   raises the same `WRONG_ACCEPTOR` for both — the party who must wait, and the stranger —
 *   so a route cannot tell those two apart from its error alone. This read is how the route
 *   answers "are you on this link?" BEFORE the accept attempt, and it is deliberately status-
 *   agnostic: a revoked link the caller is named on is still theirs to be told about.
 *
 * trade-off: the row is read twice on the success path, once here and once inside
 * `acceptGuardianLink`. That is accepted rather than optimised away, because the alternative —
 * widening the domain function's error contract — changes a function the guardian route also
 * calls, and that unification is its own step (adoption plan step 6). The second read costs a
 * primary-key lookup; the compare-and-swap inside `acceptGuardianLink` still owns correctness
 * against a concurrent transition, so nothing here is load-bearing for the race.
 */
export async function getGuardianLinkById(
  linkId: string,
): Promise<GuardianLink | null> {
  const { data, error } = await supabaseServer
    .from("guardian_links")
    .select(GUARDIAN_LINK_COLUMNS)
    .eq("id", linkId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    logger.error("GUARDIAN", "get_link_by_id", "Failed to read guardian link", {
      reason: error.message,
    });
    throw new Error(`Failed to get guardian link: ${error.message}`);
  }
  return data ? parseGuardianLink(data) : null;
}

/**
 * @spec [Doc-01_V8, §35; §38 Guardian visibility model] | @implemented [2026-08-26]
 * plain English: the gate every guardian read surface calls before showing a student's data.
 * Expected outcome: true only when an ACTIVE link exists — a pending link grants nothing,
 * which is the point of §36.1's two-step flow.
 */
export async function isGuardianLinkedToStudent(
  guardianProfileId: string,
  studentProfileId: string,
): Promise<boolean> {
  const link = await getGuardianLinkForStudent(
    guardianProfileId,
    studentProfileId,
  );
  return link !== null;
}

/**
 * @spec [Doc-01_V8, §36.1 Initiation] | @implemented [2026-08-26]
 * plain English: start a link. What it does: writes one `guardian_links` row in the pending
 * state §36.1 assigns to the initiating party, with `initiated_by` and `initiated_at` set.
 * Expected outcome: `pending_student_accept` for a guardian-initiated link,
 * `pending_guardian_accept` for a student-initiated one — never `active`, because §36.1
 * makes acceptance by the counterparty the only route to `active`.
 * Trade-off: §35 permits a guardian to hold links to more than one student, so this refuses
 * only a duplicate of the SAME pair, not a second student. Edge case: a pair that already
 * has an active or pending row raises ALREADY_EXISTS rather than writing a second row, which
 * `unique_active_link` would reject anyway — this turns a 23505 into a typed error.
 */
export async function createGuardianLink(
  guardianProfileId: string,
  studentProfileId: string,
  initiatedBy: GuardianLinkInitiator,
  requestId?: string,
): Promise<GuardianLink> {
  const { data, error } = await supabaseServer.rpc(
    "create_guardian_link_audited",
    {
      p_guardian_id: guardianProfileId,
      p_student_id: studentProfileId,
      p_initiated_by: initiatedBy,
      p_request_id: requestId ?? null,
    },
  );

  if (error) {
    throwGuardianLinkError(error, "create_link");
  }
  if (!data) {
    throw new Error("Failed to create guardian link: no row returned");
  }
  return parseGuardianLink(data);
}

/**
 * @spec [Doc-01_V8, §36.1 Initiation steps 5] | @implemented [2026-08-26]
 * plain English: the counterparty confirms, and the link goes live. What it does: sets
 * `status='active'`, `accepted_at` and `accepted_by_profile_id` on a pending row.
 * Expected outcome: the three columns §36.1 leaves unwritten until this moment are all
 * populated in one statement. Trade-off: the acceptor is checked against the pending status
 * server-side — a guardian cannot accept a link that is waiting on the student, which is the
 * whole content of the two-step flow. Edge case: a link already active, or already revoked,
 * raises NOT_PENDING rather than silently re-accepting.
 */
export async function acceptGuardianLink(
  linkId: string,
  acceptingProfileId: string,
  requestId?: string,
): Promise<GuardianLink> {
  const { data, error } = await supabaseServer.rpc(
    "accept_guardian_link_audited",
    {
      p_link_id: linkId,
      p_accepting_profile_id: acceptingProfileId,
      p_request_id: requestId ?? null,
    },
  );

  if (error) {
    throwGuardianLinkError(error, "accept_link");
  }
  if (!data) {
    throw new Error("Failed to accept guardian link: no row returned");
  }
  return parseGuardianLink(data);
}

/**
 * @spec [Doc-01_V8, §36.3 Revocation] | @implemented [2026-08-26]
 * plain English: either party ends an active link. What it does: sets `status='revoked'`,
 * `revoked_at`, `revoked_by_profile_id` and `revocation_reason`. Expected outcome:
 * revocation is immediate and the guardian loses visibility on the next read, because every
 * read gate requires `status='active'`. Trade-off: §36.3 lets *either* party revoke, so the
 * revoker is passed in rather than assumed to be the guardian. Edge case: revoking a link
 * that is not active raises NOT_ACTIVE rather than writing a second revocation.
 *
 * §36.4's "keep or cancel the subscription?" prompt and §36.5's NOTIFY are NOT emitted here.
 * §36.5 has no listener (grounding audit G-07: the Supabase HTTP client cannot LISTEN), so
 * emitting it would be a write nothing reads; both are recorded as deferred in
 * `WS-GL_Stage2_Closure_Plan.md` §4.
 */
export async function revokeGuardianLink(
  guardianProfileId: string,
  studentProfileId: string,
  revokedByProfileId: string,
  revocationReason?: string,
  requestId?: string,
): Promise<GuardianLink> {
  const { data, error } = await supabaseServer.rpc(
    "revoke_guardian_link_audited",
    {
      p_guardian_id: guardianProfileId,
      p_student_id: studentProfileId,
      p_revoked_by: revokedByProfileId,
      p_reason: revocationReason ?? null,
      p_request_id: requestId ?? null,
    },
  );

  if (error) {
    throwGuardianLinkError(error, "revoke_link");
  }
  if (!data) {
    throw new Error("Failed to revoke guardian link: no row returned");
  }
  return parseGuardianLink(data);
}

import { EntitlementService } from "../services/entitlement-service";

/**
 * Stub — the accounts model is retired (owner ruling 2026-08-24).
 * `account-routes.ts` calls this; returning [] degrades to { hasAccount: false }.
 *
 * @deprecated WS-T1: `lyceon_accounts`, `account_members`, and the
 * `ensure_account_for_user` RPC never existed in production. The profile_id
 * model replaced them before launch. This stub keeps the route handler
 * compile-safe until account-routes is cleaned up.
 */
export async function getAllAccountsForUser(
  _userId: string,
): Promise<Array<{ accountId: string; role: string; createdAt: string }>> {
  return [];
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
 * @spec [Doc-01_V8, §35 Guardian-student linkage; §31.3 Guardian with multiple linked students]
 *       | @implemented [2026-08-26]
 * plain English: every ACTIVE link a guardian holds. What it does: reads `guardian_links`
 * for this guardian where status is active, oldest first. Expected outcome: a list, not a
 * list-of-at-most-one — §35 says guardians are linked to "one or more students" and §31.3
 * spells out the multi-student case explicitly. Trade-off: this used to be plural-named and
 * singular-behaved — it capped at `.limit(2)` and threw "1:1 invariant violated" on the
 * second row. That invariant is a retired V6 rule the spec never restates; both the cap and
 * the throw are gone. Edge case: no links returns `[]`, not null.
 */
export async function getAllGuardianStudentLinks(
  guardianProfileId: string,
): Promise<GuardianLink[]> {
  const { data, error } = await supabaseServer
    .from("guardian_links")
    .select(GUARDIAN_LINK_COLUMNS)
    .eq("guardian_profile_id", guardianProfileId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) {
    logger.error(
      "GUARDIAN",
      "list_links",
      "Failed to read guardian student links",
      { reason: error.message },
    );
    throw new Error(`Failed to get guardian student links: ${error.message}`);
  }

  return parseGuardianLinks(data ?? []);
}

/**
 * @spec [Doc-01_V8, §35; §31.3] | @implemented [2026-08-26]
 * plain English: the guardian's oldest active link, or null. What it does: returns the first
 * row `getAllGuardianStudentLinks` yields. Expected outcome: with one link, identical to the
 * previous behaviour; with several, a deterministic choice (oldest `created_at`) instead of
 * the thrown "1:1 invariant violated".
 *
 * TRADE-OFF, STATED PLAINLY: this function is a 1:1-era shape. §31.3 says a guardian's
 * premium derives from *any one* active premium student, which is a fold over ALL links, not
 * a lookup of one. Making `resolveLinkedPairPremiumAccessForGuardian` perform that fold is a
 * behaviour change on the entitlement surface, which is outside WS-GL's edit scope (Charter
 * §0). So this keeps its single-link contract and stops throwing; the §31.3 derivation is
 * reported as an entitlement-surface item, not silently half-built here.
 */
export async function getPrimaryGuardianLink(
  guardianProfileId: string,
): Promise<GuardianLink | null> {
  const links = await getAllGuardianStudentLinks(guardianProfileId);
  return links[0] ?? null;
}

/**
 * @spec [Doc-01_V8, §35] | @implemented [2026-08-26]
 * plain English: the guardians actively linked to a given student. Expected outcome: a list
 * — §35 constrains neither side to one, and the previous "Student has multiple active
 * guardian links; 1:1 invariant violated" throw enforced a rule the spec does not state.
 * Edge case: ordering is by `created_at` so the result is deterministic.
 */
export async function getActiveGuardianLinksForStudent(
  studentProfileId: string,
): Promise<GuardianLink[]> {
  const { data, error } = await supabaseServer
    .from("guardian_links")
    .select(GUARDIAN_LINK_COLUMNS)
    .eq("student_profile_id", studentProfileId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to get linked guardians: ${error.message}`);
  }

  return parseGuardianLinks(data ?? []);
}

/**
 * @spec [Doc-01_V8, §35] | @implemented [2026-08-26]
 * plain English: the student's oldest active guardian link, or null. Same 1:1-era shape and
 * same trade-off as `getPrimaryGuardianLink` — kept for its existing callers, no longer
 * throwing when the student has more than one guardian.
 */
export async function getLinkedGuardianForStudent(
  studentProfileId: string,
): Promise<GuardianLink | null> {
  const links = await getActiveGuardianLinksForStudent(studentProfileId);
  return links[0] ?? null;
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

  // Consequence edit, declared per WS-GL Stage 2 Closure Plan §10 (ruling 3): the callee's
  // contract now names the column the table actually has. Field rename only — no behaviour
  // delta, and unbreakable by this change because `student_user_id` exists on no table.
  if (!link?.student_profile_id) {
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

  // profile_id = student_profile_id — read entitlement directly
  const studentEntitlement = await getEntitlementForProfile(
    link.student_profile_id,
  );

  // SP25-001: single evaluator — the guardian's access derives from the LINKED student's
  // entitlement, evaluated on the student's profile id via the one canonical RPC. Guardian model:
  // visibility requires active link (resolved above) AND active student entitlement (here).
  const studentActive = await EntitlementService.isEntitlementActiveForProfile(
    link.student_profile_id,
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
    studentUserId: link.student_profile_id,
    guardianUserId,
    studentAccountId: link.student_profile_id,
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
