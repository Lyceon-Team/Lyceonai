import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
// Type-only: the runtime client here is always `supabaseServer` or one the caller passes. This
// import exists so the dependency is typed as the real client rather than a hand-written shape
// the real client happens not to satisfy.
import type { getSupabaseAdmin } from "../middleware/supabase-auth";
import { logger } from "../logger";
import { RESEND_API_BASE_URL } from "./notifications/transport";

// @spec [ICO direct-marketing and erasure guidance (suppression list rather than deletion of the
// contact record); SCL-085 PROPOSED (evidence bundle; suppression is the member exempt from the
// 24-month strip); owner brief 2026-09-17 "Deletion Vertical: Phases 2, 3, 5" §2]
// | @implemented [2026-09-17]
//
// plain English: keeping "never contact me again" after the account is gone. Deleting the
// account destroys the address, so the only way to honour the promise is to keep something
// derived from it that outgoing mail can be compared against. That something is an HMAC of the
// address under a secret the database never sees.
//
// WHAT THIS IS NOT. It is not a registration check. Nothing here is consulted at signup:
// refusing a suppressed address would make the signup form answer "was this address once
// deleted", and would lock out a student the deletion flow explicitly invited to come back.
//
// WHY THE UNKNOWN CASE DEFERS RATHER THAN SENDS OR FAILS. Three outcomes are possible when the
// dispatcher asks "is this address suppressed": yes, no, and cannot tell (no secret, or the
// read failed). Sending on cannot-tell would breach a do-not-contact request; failing the
// message permanently would lose a legitimate notification over a transient database error.
// Deferring is neither: nothing is sent, nothing is lost, the run is logged, and the next pass
// asks again. The secret's absence is already fatal at startup in production, so cannot-tell is
// a real anomaly rather than an ordinary state.

/** Suppression status for one address. `unknown` is a refusal to guess, not a default. */
export type SuppressionStatus = "suppressed" | "not_suppressed" | "unknown";

/** The one capability both call paths need from whichever supabase client they are given. */
type SupabaseRpcClient = Pick<ReturnType<typeof getSupabaseAdmin>, "rpc">;

/**
 * Lowercased and trimmed before hashing, so `A@Example.com ` and `a@example.com` are one
 * address. Without this the promise would be keepable only for the exact casing the person
 * happened to type on the day they asked.
 */
export function normaliseAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * HMAC-SHA256 of the normalised address, hex. Returns null when the secret is absent — callers
 * must treat that as `unknown`, never as "no match".
 *
 * ROTATION. Rotating `SUPPRESSION_HMAC_SECRET` invalidates every stored hash, and the addresses
 * they came from no longer exist to re-hash, so live suppressions cannot survive a rotation.
 * The secret is therefore non-rotatable while any suppression stands; that is recorded here, in
 * the migration, in `contracts/notifications.contract.md` and in the secret-class inventory.
 */
export function hashSuppressionAddress(
  address: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const secret = env.SUPPRESSION_HMAC_SECRET;
  if (typeof secret !== "string" || secret.length === 0) return null;
  return createHmac("sha256", secret).update(normaliseAddress(address)).digest("hex");
}

/** Constant-time compare, for callers that check a candidate hash against a stored one. */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Is this address on the do-not-contact list? Asked by the notification dispatcher before every
 * product send. The address is hashed here; only the hash reaches the database.
 */
export async function getSuppressionStatus(
  address: string,
  deps: {
    /**
     * Defaults to `supabaseServer`, the SAME client the notification dispatcher uses for every
     * other read on that path. Reaching for a second client inside one call path would fork the
     * transport: it is a different object to configure, to mock and to fail.
     */
    admin?: SupabaseRpcClient;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<SuppressionStatus> {
  const hash = hashSuppressionAddress(address, deps.env ?? process.env);
  if (hash === null) {
    logger.error(
      "NOTIFICATIONS",
      "suppression_secret_missing",
      "SUPPRESSION_HMAC_SECRET is not set; cannot check the do-not-contact list, so nothing is sent",
    );
    return "unknown";
  }
  try {
    const admin = deps.admin ?? (supabaseServer as unknown as SupabaseRpcClient);
    const { data, error } = await admin.rpc("is_address_suppressed", {
      p_address_hash: hash,
    });
    if (error) {
      logger.error(
        "NOTIFICATIONS",
        "suppression_read_failed",
        "Could not read the do-not-contact list; nothing is sent this pass",
        { code: error.code, message: error.message },
      );
      return "unknown";
    }
    return data === true ? "suppressed" : "not_suppressed";
  } catch (err) {
    logger.error(
      "NOTIFICATIONS",
      "suppression_read_failed",
      "Could not read the do-not-contact list; nothing is sent this pass",
      { message: err instanceof Error ? err.message : String(err) },
    );
    return "unknown";
  }
}

/**
 * The delivery-side half: ask the provider to suppress the address too, so a send that bypasses
 * our own check (a stray script, a future surface) still does not reach them.
 *
 * Best-effort by construction. The local hash is the enforcing half; this call failing must
 * never fail a deletion, so the outcome is returned for the caller to record and never thrown.
 */
export async function addProviderSuppression(
  address: string,
  deps: {
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<boolean> {
  const envSource = deps.env ?? process.env;
  const apiKey = envSource.RESEND_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    logger.warn(
      "NOTIFICATIONS",
      "provider_suppression_unconfigured",
      "RESEND_API_KEY is not set; the address was not added to the provider suppression list",
    );
    return false;
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = (deps.baseUrl ?? RESEND_API_BASE_URL).replace(/\/$/, "");
  try {
    const response = await fetchImpl(`${baseUrl}/suppressions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ email: normaliseAddress(address) }),
    });
    if (!response.ok) {
      logger.warn(
        "NOTIFICATIONS",
        "provider_suppression_rejected",
        "The provider did not accept the suppression; the local record still stands",
        { status: response.status },
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(
      "NOTIFICATIONS",
      "provider_suppression_failed",
      "Could not reach the provider suppression list; the local record still stands",
      { message: err instanceof Error ? err.message : String(err) },
    );
    return false;
  }
}

/**
 * Record the do-not-contact request for a completed deletion. The SQL function decides whether
 * the person actually asked (`deletion_request_log.suppression_requested`), so this cannot
 * manufacture a suppression nor drop one. Never throws: a deletion that has already committed
 * must not be reported as failed because a suppression write did not land.
 */
export async function recordDeletionSuppression(
  args: {
    logId: string;
    address: string;
    /** Defaults to `supabaseServer`; the executor passes its own service-role client. */
    admin?: SupabaseRpcClient;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    requestId?: string;
  },
): Promise<void> {
  const hash = hashSuppressionAddress(args.address, args.env ?? process.env);
  if (hash === null) {
    logger.error(
      "DELETION",
      "suppression_secret_missing",
      "SUPPRESSION_HMAC_SECRET is not set; a requested do-not-contact record was NOT written",
      undefined,
      { requestId: args.requestId },
    );
    return;
  }
  try {
    const admin = args.admin ?? (supabaseServer as unknown as SupabaseRpcClient);
    // THE DATABASE DECIDES. `deletion_request_log.suppression_requested` is the single truth of
    // what the person asked for, so the write is attempted first and the PROVIDER call happens
    // only if that gate said yes. The other order would suppress an address at the provider for
    // somebody who never asked — permanently, and invisibly to us.
    const { data, error } = await admin.rpc("record_deletion_suppression", {
      p_log_id: args.logId,
      p_address_hash: hash,
    });
    if (error) {
      logger.error(
        "DELETION",
        "suppression_write_failed",
        "Could not record the do-not-contact request; the deletion itself is committed",
        undefined,
        { code: error.code, message: error.message, requestId: args.requestId },
      );
      return;
    }
    const result = (data ?? {}) as { recorded?: number; requested?: boolean };
    if (result.requested !== true) return;

    const providerSynced = await addProviderSuppression(args.address, {
      ...(args.env ? { env: args.env } : {}),
      ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
    });
    logger.info(
      "DELETION",
      "suppression_recorded",
      "Do-not-contact record written for a completed deletion",
      { recorded: result.recorded ?? 0, providerSynced, requestId: args.requestId },
    );
  } catch (err) {
    logger.error(
      "DELETION",
      "suppression_write_failed",
      "Could not record the do-not-contact request; the deletion itself is committed",
      undefined,
      { message: err instanceof Error ? err.message : String(err), requestId: args.requestId },
    );
  }
}
