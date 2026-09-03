/**
 * Guardian↔student linkage — the canonical `guardian_links` data layer.
 *
 * @spec [Doc-01_V8, §35 Guardian-student linkage; §36.3 Revocation; SCL-080, which
 *        supersedes §36.1's two-step initiation] | @implemented [2026-08-26; SCL-080 2026-09-01]
 *
 * plain English: create, read and revoke the links between a guardian and the students they
 * can see. What it does: writes rows to `guardian_links` using the column names and status
 * domain the table actually has. Expected outcome: a redeemed student code lands the link
 * straight in `active` — SCL-080 removed the acceptance step, because the student's choice
 * to share the code IS the consent, so there is no second party left to wait for and no
 * pending status to pass through. A guardian may hold links to more than one student.
 * Trade-offs and edge cases are stated per function.
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
} from "../../packages/shared/src/guardian-link-schema";

/**
 * The row contract lives in `packages/shared` per coding-standards §7.2 — Zod first, types
 * inferred, one definition. Re-exported here so existing importers of `account.ts` keep
 * resolving without a second declaration to drift from it.
 */
export type {
  GuardianLink,
  GuardianLinkStatus,
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
 * WHY THIS EXISTS SEPARATELY FROM THE WRITE THAT FOLLOWS IT.
 *   Q7 draws the enumeration line at PARTY-HOOD, not at authorization: a caller named on the
 *   link already knows it exists, so telling them "that link is not active" leaks nothing,
 *   while a caller who is not on it must not learn the link exists at all. The audited write
 *   raises the same error for both — the party in the wrong state, and the stranger — so a
 *   route cannot tell those two apart from its error alone. This read is how the route
 *   answers "are you on this link?" BEFORE attempting the write, and it is deliberately
 *   status-agnostic: a revoked link the caller is named on is still theirs to be told about.
 *
 * @revised [2026-09-01 — SCL-080] This docblock used to justify the read against
 * `acceptGuardianLink`, which was deleted with the acceptance step. The remaining caller is
 * the STUDENT's revoke route (`server/routes/student-resources.ts`), and the reasoning is
 * unchanged — party-hood before the write — so the read stays and only the name goes.
 *
 * trade-off: the row is read twice on the success path, once here and once inside the audited
 * write. Accepted rather than optimised away: the second read costs a primary-key lookup, and
 * the compare-and-swap inside the write still owns correctness against a concurrent
 * transition, so nothing here is load-bearing for the race.
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
/**
 * Create a LIVE guardian link, audited. The single owner of that write.
 *
 * @spec [SCL-080; Doc-01_V8 §35] | @implemented [2026-09-01]
 *
 * plain English: a guardian redeemed a student's code, so the link exists immediately —
 * there is no acceptance step to wait for. Expected outcome: one `active` row and one audit
 * record, both written inside the function so neither can happen without the other.
 *
 * Delegates to `create_active_guardian_link_audited`, which supersedes
 * `create_guardian_link_audited` — that one hardcoded a pending status and had no path to
 * `active`. Writing the INSERT here instead would fork link creation into two
 * implementations and bypass the audit trail, which CLAUDE.md forbids by name.
 *
 * Errors are surfaced through `throwGuardianLinkError` so `LY004` (already linked) reaches
 * the route as the 409 it is, rather than a 500.
 */
export async function createActiveGuardianLink(
  guardianProfileId: string,
  studentProfileId: string,
  requestId?: string,
): Promise<GuardianLink> {
  const { data, error } = await supabaseServer.rpc(
    "create_active_guardian_link_audited",
    {
      p_guardian_id: guardianProfileId,
      p_student_id: studentProfileId,
      p_request_id: requestId ?? null,
    },
  );

  if (error) {
    throwGuardianLinkError(error, "create_active_link");
  }
  if (!data) {
    throw new Error("Failed to create guardian link: no row returned");
  }
  return parseGuardianLink(data);
}

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
import { resolveEntitlementDisplay } from "./entitlement-display";

// ── Retired accounts model (owner ruling 2026-08-24) ─────────────────
//
// The following functions were removed:
//   - ensureAccountForUser  — called missing RPC ensure_account_for_user
//   - getAccountIdForUser   — read from non-existent account_members table
//   - getAllAccountsForUser  — read from non-existent account_members + accounts
//
// The production schema uses profile_id = auth.users.id directly, with
// entitlements keyed on profile_id and no account_id indirection.
// See WS-GL_Stage1_Audit.md §1 blocker B-3.
//
// getAllAccountsForUser is still imported by account-routes.ts (/api/account/status).
// That route returns { hasAccount: false } when the query returns empty,
// which is the correct degraded behavior. The route itself is a separate
// cleanup item — it does not cause 500s.

/**
 * Stub — getAllAccountsForUser reads from the non-existent account_members
 * table. Returns empty so /api/account/status degrades to { hasAccount: false }
 * instead of throwing PGRST205 on every request.
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
  /**
   * SCL-045 / migration 20260827010000: the subscription ITEM this entitlement
   * is keyed to. One item per entitled student, so one guardian subscription
   * carries several. Nullable because rows written before 2026-08-27 have no
   * item id — it is not derivable in SQL and arrives on the next
   * `customer.subscription.updated`.
   */
  stripe_subscription_item_id: string | null;
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
  /**
   * The PRODUCT the conferring student holds, beside the standing-good status.
   *
   * @spec [Doc 01 V8 §31.2 — the reference derivation is
   *        `snap.isActive && snap.tier === 'premium'`] | @implemented [2026-09-03]
   *
   * Added because the guardian branch of `GET /api/billing/status` had no tier
   * to consult and therefore applied none, while the self-pay branch applied
   * `tier === "premium"`. One route, two branches, two answers for one student.
   * `resolveEntitlementDisplay` now decides for both, and it needs this field.
   */
  studentEntitlementTier: Entitlement["tier"] | "free";
  /**
   * The SQL predicate's raw verdict for the conferring student, before the
   * product check. Exposed so a caller can reach `resolveEntitlementDisplay`
   * with the same two inputs the self-pay branch uses, rather than re-deriving
   * standing-good from `studentEntitlementStatus` in TypeScript (SP25-001).
   */
  studentStandingGood: boolean;
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
      "profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id, stripe_price_id, current_period_start, current_period_end, cancel_at_period_end",
    )
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch entitlement: ${error.message}`);
  }

  return data as Entitlement | null;
}

/**
 * @spec [SCL-073 disputes; genesis.sql:173 `stripe_subscription_id TEXT UNIQUE`]
 * @implemented [2026-08-27]
 * plain English: find EVERY entitlement a Stripe subscription pays for.
 * Expected outcome: a list — empty when the subscription pays for nothing we
 * hold, one row on the individual path, N rows on a guardian subscription that
 * funds N students.
 *
 * @revised [2026-08-28 — Codex HIGH-4] It previously returned ONE row via
 * `.maybeSingle()`. That was correct only while `stripe_subscription_id` was
 * UNIQUE. Migration `20260827010000` dropped that constraint and moved the key
 * to `stripe_subscription_item_id`, so on a guardian subscription `maybeSingle`
 * raises rather than returning rows — meaning a chargeback or a full refund
 * against a guardian invoice revoked NOBODY. The migration's own header named
 * this function as work to be done and it was not done; this is that change.
 *
 * Trade-off: callers must now decide what several rows mean. That decision is
 * theirs and differs by path — several rows on ONE subscription is the normal
 * guardian shape, whereas several SUBSCRIPTIONS matching one charge is still
 * ambiguous and still fails closed. Collapsing both into "one row" is what hid
 * the defect. Edge case: a subscription id we never recorded returns `[]`
 * rather than throwing, because a dispute on a charge unrelated to any
 * entitlement is a fact, not an error.
 */
export async function getEntitlementsBySubscriptionId(
  stripeSubscriptionId: string,
): Promise<Entitlement[]> {
  const { data, error } = await supabaseServer
    .from("entitlements")
    .select(
      "profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id, stripe_price_id, current_period_start, current_period_end, cancel_at_period_end",
    )
    .eq("stripe_subscription_id", stripeSubscriptionId)
    // Deterministic order so a fan-out revokes in a stable, reproducible
    // sequence and a partial failure is replayable.
    .order("stripe_subscription_item_id", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to fetch entitlements by subscription: ${error.message}`,
    );
  }

  return (data ?? []) as Entitlement[];
}

/**
 * @spec [Doc-01_V8 §20–§24; genesis.sql:168–181 | STRIPE-001] @implemented 2026-08-09
 * plain English: webhook-only upsert keyed on UNIQUE(profile_id). Persists Stripe's
 * authoritative subscription state verbatim into the genesis entitlements table.
 * onConflict targets the profile_id_unique constraint (added by migration).
 * stripe_customer_id is NOT written here — it lives on profiles (genesis:149).
 */
/**
 * The shape a writer may hand `upsertEntitlement`. Exported so callers that
 * build an update in one place and apply it in another (the dispute/refund
 * fan-out) can name the type instead of widening it to a string.
 */
export type EntitlementUpdate = Partial<Omit<Entitlement, "profile_id">>;

export async function upsertEntitlement(
  profileId: string,
  updates: EntitlementUpdate,
): Promise<Entitlement> {
  const { data, error } = await supabaseServer
    .from("entitlements")
    .upsert({ profile_id: profileId, ...updates }, { onConflict: "profile_id" })
    .select(
      "profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id, stripe_price_id, current_period_start, current_period_end, cancel_at_period_end",
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
 * @spec [Doc-01_V8 §4; genesis.sql:149,160; SCL-070 amendment | owner ruling 2026-08-31]
 * @implemented [2026-08-31]
 *
 * plain English: the REVERSE of `getProfileStripeCustomerId` — given a Stripe
 * Customer id, find the Lyceon profile that holds it. Needed because
 * `customer.deleted` arrives carrying only the Customer id, and by then the
 * Customer is gone from Stripe, so the payer cannot be re-read from the API.
 * Our own row is the only remaining link.
 *
 * expected outcome: the payer's `profiles.id`, or null when no profile holds
 * this Customer.
 *
 * trade-offs / edge cases:
 *  - `profiles.stripe_customer_id` is UNIQUE (genesis:149) and indexed
 *    (genesis:160), so at most one row can match; `maybeSingle` is exact here,
 *    not a convenience.
 *  - NULL is a FACT, not an error: a Customer we never recorded funds nothing
 *    of ours, so the caller changes nothing. Absence and ambiguity are
 *    different failures and must not share a branch.
 */
export async function getProfileIdByStripeCustomerId(
  stripeCustomerId: string,
): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to read profile by stripe_customer_id: ${error.message}`,
    );
  }

  return data?.id ?? null;
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
 * plain English: the student's oldest active guardian link, or null. A 1:1-era shape kept
 * for its existing callers, no longer throwing when the student has more than one guardian.
 * Its guardian-side twin `getPrimaryGuardianLink` was DELETED by SCL-080's sweep — it had no
 * callers left once the §31.3 fold below replaced it.
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

  /**
   * The SAME derivation the guardian fold uses, so the derived guardian answer
   * and the student's own answer cannot differ (owner ruling 2026-09-03).
   *
   * BEHAVIOUR DELTA, STATED. This previously returned the bare predicate, so a
   * row that was billing-healthy on the FREE tier granted paid access. It now
   * also requires `tier === "premium"`, per Doc 01 V8 §31.2's reference
   * derivation (`snap.isActive && snap.tier === 'premium'`) and Doc 02B's
   * entitlement matrix, which puts paid KPI behind the premium product rather
   * than behind billing health. Verified against production on 2026-09-03: all
   * entitlement rows are (`premium`, `active`), so no live account changes
   * state. The consumer is `resolvePaidKpiAccessForStudent`.
   */
  const hasPremiumAccess = resolveEntitlementDisplay({
    standingGood: studentActive,
    tier: studentEntitlement?.tier ?? "free",
    status: studentEntitlement?.status ?? "missing",
  }).effectiveAccess;

  return {
    role: "student",
    hasPremiumAccess,
    hasActiveLink,
    premiumSource: hasPremiumAccess ? "student" : "none",
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
    studentEntitlementTier: studentEntitlement?.tier ?? "free",
    studentStandingGood: studentActive,
    guardianEntitlementStatus: guardianEntitlement?.status ?? "missing",
    studentEntitlementExpired: isEntitlementExpired(studentEntitlement),
    guardianEntitlementExpired: isEntitlementExpired(guardianEntitlement),
  };
}

/**
 * @spec [Doc 01 V8 §31.3 — a guardian's premium derives from ANY ONE active
 *        premium student; SP25-001 single evaluator] | @implemented [2026-08-27]
 * plain English: find the linked student whose entitlement gives this guardian
 * premium. Expected outcome: a HEALTHY paying student if one is linked; failing
 * that any entitled student (which is where `past_due` and `trialing` land);
 * failing that the first link, so "linked but nobody has paid" stays
 * distinguishable from "not linked at all"; null only when there are no links.
 * Trade-off: every link is evaluated rather than short-circuiting on the first
 * hit — §31.2's own reference derivation is a `Promise.all` over all of them and
 * §31.2.1 rules that sufficient at V1 scale, so this moves toward the spec, not
 * away. Ordering within each preference tier is deterministic because
 * `getAllGuardianStudentLinks` orders by `created_at`.
 *
 * Consumes WS-GL Phase B's reader. No second link reader is built here.
 */
async function resolveConferringLink(guardianProfileId: string): Promise<{
  link: GuardianLink;
  active: boolean;
  entitlement: Entitlement | null;
} | null> {
  const links = await getAllGuardianStudentLinks(guardianProfileId);
  if (links.length === 0) return null;

  const candidates = links.filter(
    (candidate): candidate is GuardianLink & { student_profile_id: string } =>
      typeof candidate.student_profile_id === "string" &&
      candidate.student_profile_id.length > 0,
  );

  /**
   * EVERY link is evaluated, in parallel — the first-match-wins short-circuit
   * that stood here is gone.
   *
   * @spec [Doc 01 V8 §31.2, whose reference derivation is a `Promise.all` over
   *        every linked student followed by `.some(...)`; §31.2.1 rules that
   *        pattern sufficient at V1 scale, "typical guardian has 1-3 linked
   *        students"] | @implemented [2026-09-03]
   *
   * WHY THE SHORT-CIRCUIT WAS A DEFECT. `isEntitlementActiveForProfile` counts
   * `past_due` as entitled (SCL-029). So a guardian whose FIRST-created link is
   * a `past_due` student and whose second is a healthy `active` one stopped at
   * the first, reported that student's status as the guardian's, and — while
   * `SubscriptionPaywall` still had its `needsPaymentUpdate` early return —
   * locked the guardian out of their entire dashboard on account of a student
   * who was still, by the platform's own predicate, entitled. Preferring a
   * healthy link makes the masking impossible rather than merely unlikely.
   *
   * The verdict AND the row travel with the link: the caller needs `status` and
   * `tier` to reach `resolveEntitlementDisplay`, and re-reading them there
   * would be a second round trip for facts already in hand.
   */
  const verdicts = await Promise.all(
    candidates.map(async (link) => {
      const [active, entitlement] = await Promise.all([
        EntitlementService.isEntitlementActiveForProfile(
          link.student_profile_id,
        ),
        getEntitlementForProfile(link.student_profile_id),
      ]);
      return { link: link as GuardianLink, active, entitlement };
    }),
  );

  // Preference order: a healthy paying student, then any entitled student
  // (which is where `past_due` and `trialing` land), then the first link at all
  // — because "linked but nobody has paid" and "not linked" are different facts
  // and only the second one is `hasActiveLink: false`.
  const healthy = verdicts.find(
    (verdict) => verdict.active && verdict.entitlement?.status === "active",
  );
  if (healthy) return healthy;

  const entitled = verdicts.find((verdict) => verdict.active);
  if (entitled) return entitled;

  const firstCandidate = verdicts[0];
  if (firstCandidate) {
    return { ...firstCandidate, active: false };
  }

  const first = links[0];
  return first ? { link: first, active: false, entitlement: null } : null;
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

  // §31.3: a guardian's premium derives from ANY ONE active premium student —
  // a fold over every active link, not a lookup of one.
  //
  // The defect this replaced: `getPrimaryGuardianLink` (since deleted) returned
  // the OLDEST active link, so a guardian with two linked students where only the
  // SECOND is premium derived `free`. The link that confers access is whichever
  // student is actually entitled, and until this fold existed nothing looked
  // past the first.
  //
  // Asking about a NAMED student is a different question and keeps its
  // single-link behaviour: "does this guardian have access at all" folds,
  // "what is this guardian's access to THIS student" does not.
  const folded = requestedStudentId
    ? null
    : await resolveConferringLink(guardianUserId);
  const link = requestedStudentId
    ? await getGuardianLinkForStudent(guardianUserId, requestedStudentId)
    : (folded?.link ?? null);

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
      studentEntitlementTier: "free",
      studentStandingGood: false,
      guardianEntitlementStatus: guardianEntitlement?.status ?? "missing",
      studentEntitlementExpired: false,
      guardianEntitlementExpired: isEntitlementExpired(guardianEntitlement),
    };
  }

  // profile_id = student_profile_id. Reuse the fold's row when it produced one:
  // it read THIS student on THIS request, so reading again would be a second
  // round trip for facts already in hand. The named-student path has no fold.
  const studentEntitlement =
    folded !== null
      ? folded.entitlement
      : await getEntitlementForProfile(link.student_profile_id);

  // SP25-001: single evaluator — the guardian's access derives from the LINKED student's
  // entitlement, evaluated on the student's profile id via the one canonical RPC. Guardian model:
  // visibility requires active link (resolved above) AND active student entitlement (here).
  const studentActive =
    folded !== null
      ? folded.active
      : await EntitlementService.isEntitlementActiveForProfile(
          link.student_profile_id,
        );

  /**
   * §31.2's derivation verbatim: `snap.isActive && snap.tier === 'premium'`.
   *
   * The tier half used to be missing here, which is how the guardian branch of
   * `GET /api/billing/status` came to answer a question the self-pay branch
   * answered differently for the same student. `resolveEntitlementDisplay` is
   * now the only place either branch applies either fact (owner ruling
   * 2026-09-03: "one resolver, both branches").
   *
   * `studentActive` is still the SQL predicate's verdict, not a TS re-derivation
   * of it — SP25-001's single-evaluator rule is untouched. The resolver supplies
   * the PRODUCT check the predicate deliberately does not make.
   */
  const hasPremiumAccess = resolveEntitlementDisplay({
    standingGood: studentActive,
    tier: studentEntitlement?.tier ?? "free",
    status: studentEntitlement?.status ?? "missing",
  }).effectiveAccess;

  return {
    role: "guardian",
    hasPremiumAccess,
    hasActiveLink: true,
    // Follows `hasPremiumAccess`, not the bare predicate: a student who is
    // billing-healthy on the FREE tier confers nothing, and naming them as the
    // source would be the same tier-blind answer this change removes.
    premiumSource: hasPremiumAccess ? "student" : "none",
    reason: hasPremiumAccess
      ? "Linked student has active premium entitlement."
      : "Linked student account does not have an active premium entitlement.",
    studentUserId: link.student_profile_id,
    guardianUserId,
    studentAccountId: link.student_profile_id,
    guardianAccountId: guardianUserId,
    studentEntitlementStatus: studentEntitlement?.status ?? "missing",
    studentEntitlementTier: studentEntitlement?.tier ?? "free",
    studentStandingGood: studentActive,
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
