/**
 * Password change, the password-recovery grant, and the "has a password at all" check.
 *
 * @spec [Brief 8 ruling 4 (owner, 2026-10-01): current password required, checked on the server,
 *        before updating; F-38 refuse accounts with no password identity with a defined error;
 *        owner choice 2026-10-01: "/update-password" is reachable only with a recovery grant
 *        written by /auth/callback after verifyOtp(type = recovery); contracts/auth-standard-flow
 *        AS-5/AS-6 (native Supabase calls, no admin.updateUserById); Coding Standards §3.6, §12.1]
 * | @implemented [2026-10-01]
 *
 * plain English: two ways to set a password, and they no longer overlap.
 *   1. Settings → change password: the student types the current password. It is checked by
 *      signing in with it on a throwaway, non-persisting client — Supabase has no "verify
 *      password" call, and a sign-in is the check GoTrue itself trusts. The new password is then
 *      set with `updateUser` ON THAT FRESH SESSION, so Supabase's "Secure password change"
 *      (reauthentication for sessions older than 24 hours) is satisfied natively rather than
 *      bypassed with an admin call. The throwaway session is then signed out (scope `local`, so
 *      only it ends).
 *   2. Forgot password → /update-password: no current password, because the student proved
 *      control of the email instead. The callback records that proof as a grant
 *      (`password_recovery_grants`, 15 minutes, single use); /update-password requires it and
 *      spends it. An ordinary signed-in session has no grant, so it cannot use this path to skip
 *      the current-password check.
 *
 * Google-only accounts (F-38): an account with no `email` identity has no password to change.
 * Both paths refuse it with `NO_PASSWORD_IDENTITY`; the UI hides the form for it.
 *
 * Never logged: a password, an email, a token. Only codes, ids and the request id.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { err, ok, type Result } from "../../packages/shared/src/result";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { getSupabaseAdmin } from "../middleware/supabase-auth";
import {
  checkAndIncrement,
  RateLimitUnavailableError,
  type LedgerClient,
} from "../../packages/shared/src/services/rate-limit-ledger";
import { revokeOtherSessions } from "./session-revoke";

/** The recovery grant's lifetime: long enough to type a new password, short enough to be single-sitting. */
export const RECOVERY_GRANT_TTL_SECONDS = 15 * 60;

export type PasswordAuthClients = {
  /** A fresh anon client with no persisted session: used once, for one verification. */
  verifier: () => SupabaseClient;
  /** The service-role client, for reading the account's identities. */
  admin: () => SupabaseClient;
};

function defaultClients(): PasswordAuthClients {
  return {
    verifier: () =>
      createClient(
        process.env.SUPABASE_URL ?? "",
        process.env.SUPABASE_ANON_KEY ?? "",
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        },
      ),
    admin: () => getSupabaseAdmin(),
  };
}

let clientsOverride: PasswordAuthClients | null = null;

/** Tests substitute the transport (a GoTrue stand-in), never this module's logic. */
export function setPasswordAuthClientsForTests(
  clients: PasswordAuthClients | null,
): void {
  clientsOverride = clients;
}

function clients(): PasswordAuthClients {
  return clientsOverride ?? defaultClients();
}

/**
 * F-38: does this account sign in with a password at all? Throws on a read failure, so the caller
 * answers 500 rather than guessing either way.
 */
export async function hasPasswordIdentity(userId: string): Promise<boolean> {
  const { data, error } = await clients()
    .admin()
    .auth.admin.getUserById(userId);
  if (error || !data.user) {
    throw new Error("identity_read_failed");
  }
  return (data.user.identities ?? []).some(
    (identity) => identity.provider === "email",
  );
}

export type PasswordChangeFailure =
  | { kind: "current_incorrect" }
  | { kind: "verify_failed" }
  | { kind: "update_failed" };

/**
 * Settings' change: verify `currentPassword` by signing in with it, set `newPassword` on that
 * session, then end that session. The caller has already parsed both passwords and refused a
 * Google-only account.
 */
export async function changePasswordWithCurrent(input: {
  email: string;
  currentPassword: string;
  newPassword: string;
  requestId?: string;
}): Promise<Result<void, PasswordChangeFailure>> {
  const verifier = clients().verifier();
  const signIn = await verifier.auth.signInWithPassword({
    email: input.email,
    password: input.currentPassword,
  });
  if (signIn.error || !signIn.data.session) {
    // GoTrue answers a wrong password with `invalid_credentials` (HTTP 400). Anything else —
    // a 5xx, a rate limit — is not the student's mistake and must not read as one.
    const wrongPassword =
      signIn.error?.code === "invalid_credentials" ||
      signIn.error?.status === 400;
    logger.warn(
      "AUTH",
      wrongPassword
        ? "change_password_current_incorrect"
        : "change_password_verify_failed",
      "Current-password check did not pass",
      { code: signIn.error?.code ?? null, requestId: input.requestId },
    );
    return err(
      wrongPassword ? { kind: "current_incorrect" } : { kind: "verify_failed" },
    );
  }

  const update = await verifier.auth.updateUser({
    password: input.newPassword,
  });

  // End the verification session whatever happened. Scope `local`: only this throwaway session —
  // never the student's own browser session.
  const signOut = await verifier.auth.signOut({ scope: "local" });
  if (signOut.error) {
    logger.warn(
      "AUTH",
      "change_password_verifier_signout_failed",
      "Could not end the verification session",
      { code: signOut.error.code ?? null, requestId: input.requestId },
    );
  }

  if (update.error) {
    logger.warn("AUTH", "change_password_update_failed", "updateUser refused", {
      code: update.error.code ?? null,
      requestId: input.requestId,
    });
    return err({ kind: "update_failed" });
  }
  return ok(undefined);
}

/** Written by /auth/callback after verifyOtp(type = recovery) succeeds. Throws on failure. */
export async function grantPasswordRecovery(profileId: string): Promise<void> {
  const { error } = await supabaseServer.rpc("grant_password_recovery", {
    p_profile_id: profileId,
    p_ttl_seconds: RECOVERY_GRANT_TTL_SECONDS,
  });
  if (error) throw new Error("recovery_grant_write_failed");
}

/** Is there a live, unspent grant for this profile? Throws on a read failure. */
export async function hasLivePasswordRecovery(
  profileId: string,
): Promise<boolean> {
  const { data, error } = await supabaseServer.rpc("password_recovery_live", {
    p_profile_id: profileId,
  });
  if (error) throw new Error("recovery_grant_read_failed");
  return data === true;
}

/** Spend the grant after the password was set. A failure is logged; the grant expires anyway. */
export async function consumePasswordRecovery(
  profileId: string,
  requestId?: string,
): Promise<void> {
  const { error } = await supabaseServer.rpc("consume_password_recovery", {
    p_profile_id: profileId,
  });
  if (error) {
    logger.warn(
      "AUTH",
      "recovery_grant_consume_failed",
      "Could not spend the recovery grant; it expires on its own",
      { requestId },
    );
  }
}

// ── F-46 (Brief 12 ruling 1, owner 2026-10-02): Doc 01 §12.1 steps 2 and 6 ───────────────────

/** Doc 01A §39.2 / §46: the reset bucket, seeded at 3 per hour by 20261018000000. */
export const PASSWORD_RESET_BUCKET = "password_reset_requests_hourly";

/** `send`: ask Supabase to mail the link. `suppress`: send nothing; the caller answers the same. */
export type PasswordResetDecision = "send" | "suppress";

/**
 * @spec [Doc 01 §12.1 step 2; Doc 01A §39–§47 (RateLimitLedger; §41 profile-keyed ledger);
 *        Brief 12 ruling 1; AS3-AS5-RESET-ENUM-001] | @implemented [2026-10-02]
 *
 * plain English: may this reset request send an email? The address is matched to its account
 * (`password_reset_subject`, case- and space-folded), and the request is counted against that
 * account's `password_reset_requests_hourly` bucket, so the limit holds across requests,
 * browsers and IPs. The caller answers every outcome with the same generic response, and holds it
 * to the same minimum duration (`holdPasswordResetResponse`), so neither the body nor the time it
 * takes tells a caller whether an address has an account.
 *
 * Outcomes:
 *   - an address with no account: `send`. Supabase mails nothing to an unknown address, and the
 *     ledger cannot count it (Doc 01A §41 keys on a profile), so the provider's own behaviour and
 *     timing are kept exactly as they were;
 *   - within the limit: `send`;
 *   - over the limit: `suppress`;
 *   - the lookup or the ledger unreadable: `suppress`, logged at ERROR. A limiter that opens on
 *     failure is not one (Doc 01A §39's fail-closed posture), and the response does not change.
 *
 * Never logged: the address, the profile id, a token. Only the event and the request id.
 */
export async function decidePasswordResetSend(
  email: string,
  requestId?: string,
): Promise<PasswordResetDecision> {
  try {
    const { data, error } = await supabaseServer.rpc("password_reset_subject", {
      p_email: email.trim().toLowerCase(),
    });
    if (error) throw new Error("password_reset_subject_failed");
    if (typeof data !== "string" || data.length === 0) return "send";

    const result = await checkAndIncrement(
      supabaseServer as unknown as LedgerClient,
      { profileId: data, bucketKey: PASSWORD_RESET_BUCKET },
    );
    if (!result.allowed) {
      logger.info(
        "AUTH",
        "password_reset_throttled",
        "Reset email suppressed: the account's hourly reset limit is reached",
        { requestId },
      );
      return "suppress";
    }
    return "send";
  } catch (error: unknown) {
    logger.error(
      "AUTH",
      "password_reset_throttle_unavailable",
      "Reset throttle unreadable; no email sent (fail closed)",
      undefined,
      {
        requestId,
        reason:
          error instanceof RateLimitUnavailableError
            ? "ledger_unavailable"
            : "lookup_failed",
      },
    );
    return "suppress";
  }
}

/**
 * @spec [Doc 01 §12.1 step 2; AS3-AS5-RESET-ENUM-001; SCL-197 (PROPOSED)] | @implemented [2026-10-02]
 *
 * plain English: every reset response, sent or suppressed, known address or not, is held until at
 * least this long after the request began. Only a request that sends reaches the provider, so
 * without the floor a suppressed (over-limit) request would answer measurably faster, and that
 * speed would say "this address has an account". The floor is set above the provider's usual
 * round trip, so all three outcomes leave at the same time in the common case.
 *
 * Trade-offs, stated: a provider call slower than the floor still finishes later than a suppressed
 * request, so this narrows the timing channel rather than closing it; and every reset request costs
 * the requester about two seconds, which a "check your email" flow absorbs. The residual is recorded
 * for the owner in SCL-197. Edge case: the floor is measured from the handler's start, so it never
 * adds to a request that already took longer.
 */
export const PASSWORD_RESET_RESPONSE_FLOOR_MS = 2_000;

let responseFloorOverrideMs: number | null = null;

/** Tests shorten the floor; they never remove it. */
export function setPasswordResetResponseFloorForTests(ms: number | null): void {
  responseFloorOverrideMs = ms;
}

export async function holdPasswordResetResponse(
  startedAtMs: number,
): Promise<void> {
  const floor = responseFloorOverrideMs ?? PASSWORD_RESET_RESPONSE_FLOOR_MS;
  const wait = startedAtMs + floor - Date.now();
  if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
}

/**
 * @spec [Doc 01 §12.1 step 6 ("reset completes → all active sessions invalidated"); Brief 12
 *        ruling 1; register F-46] | @implemented [2026-10-02]
 *
 * plain English: after a recovery password update succeeds, sign out every OTHER session of the
 * account, so a device that knew the old password is locked out; the recovery session itself is
 * kept, so the student lands signed in. Same call, scope and failure handling as the deletion
 * request (F-32): best-effort, one ERROR line with the request id only, and the password update
 * still succeeds.
 */
export async function revokeOtherSessionsAfterRecovery(
  sessionClient: SupabaseClient,
  requestId?: string,
): Promise<void> {
  await revokeOtherSessions(clients().admin(), sessionClient, {
    component: "AUTH",
    event: "password_reset_revoke_failed",
    message:
      "Session revoke failed after a recovery password update; the update stands",
    requestId,
  });
}
