import type { SupabaseClient, User } from "@supabase/supabase-js";
import { logger } from "../logger.js";
import { parseRuntimeRole, type RuntimeRole } from "./auth-role.js";
import { settle, type Result } from "../../packages/shared/src/result";

/**
 * @spec [Doc-01_V8 Part I — Identity Model (one profiles row per authenticated user) | contracts/auth-login-e2e.contract.md AL-7]
 * Thrown when an authenticated user has NO profile but their email already anchors a profile under a
 * DIFFERENT auth identity — i.e. the same human authenticating via a second provider on the same email
 * while Supabase identity-linking is OFF (so the handle_new_user trigger correctly skipped creating a
 * duplicate). Callers translate this to a deliberate, server-authoritative "sign in with your original
 * method" outcome instead of forking one human into two profiles.
 *
 * TRANSITIONAL (Option A): active WHILE identity-linking is OFF. At launch, when linking is turned ON,
 * a second verified-email identity maps to the SAME auth id (this case becomes unreachable) and this
 * guard is retired — closing G10. The genesis idx_profiles_email_active unique index stays the DB backstop.
 */
/**
 * @spec [Guardian_Closure_Plan G2-02; audit G-AUD-23] | @implemented [2026-09-29]
 *
 * plain English: the profile's stored role is not one the application understands (the
 * `profile_role` enum also holds 'tutor' and 'teacher'). The session must be refused, and the
 * row must be left as it is: an operator decides what the account is, never a default.
 */
export class UnrecognizedRoleError extends Error {
  readonly userId: string;
  constructor(userId: string) {
    super("Profile role is not one this application recognises");
    this.name = "UnrecognizedRoleError";
    this.userId = userId;
  }
}

export class AccountEmailConflictError extends Error {
  readonly code = "ACCOUNT_EMAIL_CONFLICT" as const;
  constructor(message: string) {
    super(message);
    this.name = "AccountEmailConflictError";
  }
}

const ACCOUNT_EMAIL_CONFLICT_MESSAGE =
  "An account already exists for this email. Sign in with your original method.";

// 2026-10-20 (owner ruling Q2 on #1271, Karl): `deleted_at` is read here so the account-deletion
// lock takes it from this read instead of re-reading the same row. It never reaches `req.user`
// (supabaseAuthMiddleware builds that field by field); the lock reads it through
// `authProfileDeletionState` in server/middleware/supabase-auth.ts.
const PROFILE_SELECT =
  "id, email, display_name, role, is_under_13, guardian_email, student_link_code, profile_completed_at, actor_id, deleted_at";

type ProfileRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: RuntimeRole;
  is_under_13: boolean;
  guardian_email: string | null;
  student_link_code: string | null;
  profile_completed_at: string | null;
  actor_id: string;
  /** Soft-delete stamp (Doc-01_V8 §40.3). For the deletion lock only; never copied to req.user. */
  deleted_at: string | null;
};

type ProfileReadResponse = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

/** The one read of a profile row by id: the first read of `ensureProfileForAuthUser`. */
function readProfileRow(
  supabaseAdmin: SupabaseClient,
  userId: string,
): PromiseLike<ProfileReadResponse> {
  return supabaseAdmin
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", userId)
    .maybeSingle();
}

/**
 * @spec [owner ruling (Karl) 2026-10-19 on #1257, ruling 1 (relayed 2026-10-20): "start the profile
 *        read IN PARALLEL with the Supabase session check (getUser), keyed on the token's
 *        (unverified) user id, and DISCARD it if the ids don't match"; Coding Standards §6.1]
 * | @implemented [2026-10-20]
 *
 * plain English: the profile read, STARTED before the session is verified, for the id the session
 * cookie claims. It is only a head start: `ensureProfileForAuthUser` uses its result only when that
 * id equals the id `getUser()` verified (and the row's own id agrees); otherwise it is dropped and
 * the read is made again with the verified id, exactly as before. Held in `settle`, so a dropped
 * read never surfaces as an unhandled rejection, and a failure is rethrown only where it is used.
 * The claimed id is never logged and never reaches a decision.
 */
export type SpeculativeProfileRead = {
  readonly claimedUserId: string;
  readonly read: Promise<Result<ProfileReadResponse, unknown>>;
};

export function startSpeculativeProfileRead(
  supabaseAdmin: SupabaseClient,
  claimedUserId: string,
): SpeculativeProfileRead {
  return {
    claimedUserId,
    read: settle(
      Promise.resolve().then(() =>
        readProfileRow(supabaseAdmin, claimedUserId),
      ),
    ),
  };
}

/**
 * The speculative read's response, if and only if it was keyed on the verified id. `null` means
 * "not usable": the caller reads again with the verified id.
 */
async function usableSpeculativeRead(
  speculative: SpeculativeProfileRead | null | undefined,
  verifiedUserId: string,
): Promise<ProfileReadResponse | null> {
  if (!speculative || speculative.claimedUserId !== verifiedUserId) return null;
  const outcome = await speculative.read;
  // A thrown read is rethrown exactly where the awaited read used to throw.
  if (!outcome.ok) throw outcome.error;
  const row = outcome.value.data as { id?: unknown } | null;
  // Belt and braces: a row for any other id is never used.
  if (row !== null && row !== undefined && row.id !== verifiedUserId)
    return null;
  return outcome.value;
}

type EnsureProfileContext = {
  source: "supabase_auth_middleware" | "google_oauth_callback";
  requestId?: string;
};

/**
 * @spec [contracts/auth-login-e2e.contract.md AL-4/AL-7 | docs/SpecAudit/50-auth-entitlement/auth-ssr-gap-analysis.md G1]
 * @implemented [2026-06-19]
 * plain English: READ-AND-RECONCILE the profile of an already-authenticated user. The SINGLE profile
 * creator is the handle_new_user trigger (migration 20260619000000), which inserts exactly one row in
 * the SAME transaction as the auth.users insert — so by the time any authenticated request or the OAuth
 * callback runs, the row exists. This function therefore NEVER creates a profile. It reads the row the
 * trigger made, refuses (UnrecognizedRoleError, G2-02) a role the app does not know without writing it, and reconciles the only two ways the row can
 * legitimately be absent: (1) a same-email second identity under linking-OFF (owned by another auth id)
 * → AL-7 conflict; (2) genuinely absent + unowned → trigger anomaly, hard error (never silently create).
 * Expected outcome: existing users read fast; the duplicate-identity edge is refused cleanly; a missing
 * profile fails loud instead of being papered over by a second writer. Trade-off: a profile deleted out
 * from under a live auth user surfaces as an error rather than self-healing — intentional (fail loud).
 */
export async function ensureProfileForAuthUser(
  supabaseAdmin: SupabaseClient,
  user: User,
  context: EnsureProfileContext,
  // 2026-10-20 (ruling 1 on #1257): an optional head start (see startSpeculativeProfileRead). Used
  // only when keyed on `user.id` (the verified id); otherwise the read below runs as it always did.
  speculative?: SpeculativeProfileRead | null,
): Promise<ProfileRow> {
  const { data: existingProfile, error: existingProfileError } =
    ((await usableSpeculativeRead(speculative, user.id)) ??
      (await readProfileRow(supabaseAdmin, user.id))) as {
      data: (Omit<ProfileRow, "role"> & { role: unknown }) | null;
      error: { message: string; code?: string } | null;
    };

  if (existingProfileError && existingProfileError.code !== "PGRST116") {
    throw new Error(
      `Failed to load profile for auth user: ${existingProfileError.message}`,
    );
  }

  if (existingProfile) {
    // G2-02: parse, never default, and never write. The previous code mapped an unknown role
    // to 'student' and UPDATEd the row, so a 'tutor'/'teacher' account became a student.
    const role = parseRuntimeRole(existingProfile.role);
    if (role === null) {
      throw new UnrecognizedRoleError(user.id);
    }
    // G2-04: nothing about guardian links is loaded here. Whether an under-13 student may use a
    // learning surface is read from `guardian_links` by the gate itself, on every request
    // (`requireGuardianLinkForUnder13`), so a session can never carry a stale answer.
    return { ...(existingProfile as Omit<ProfileRow, "role">), role };
  }

  // ---- Profile absent. The trigger is the single creator, so we NEVER create here — we reconcile the
  // ---- only two legitimate non-create edges.

  // AL-7 transitional conflict guard (ACTIVE WHILE IDENTITY-LINKING IS OFF — Option A; retire at launch
  // when linking is ON → closes G10). The one way the profile can legitimately be absent is a same-email
  // SECOND identity under linking-OFF: GoTrue minted a NEW auth id for an email that already anchors a
  // profile, so the catch-all handle_new_user trigger skipped the duplicate (idx_profiles_email_active).
  // Surface the deliberate "use your original method" conflict; the OAuth callback signs the refused
  // duplicate identity out and redirects ?error=account_exists. @spec Doc-01_V8 Part I | AL-7.
  const email = user.email ?? "";
  if (email) {
    const { data: emailOwner, error: emailOwnerError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .neq("id", user.id)
      .maybeSingle();

    if (emailOwnerError && emailOwnerError.code !== "PGRST116") {
      throw new Error(
        `Failed to check email ownership during profile bootstrap: ${emailOwnerError.message}`,
      );
    }

    if (emailOwner) {
      logger.warn(
        "AUTH",
        "account_email_conflict",
        "Same-email second identity (linking OFF): email owned by another auth id; refusing the duplicate",
        {
          attemptedUserId: user.id,
          existingProfileId: emailOwner.id,
          source: context.source,
          requestId: context.requestId,
        },
      );
      throw new AccountEmailConflictError(ACCOUNT_EMAIL_CONFLICT_MESSAGE);
    }
  }

  // Profile absent AND email unowned: handle_new_user should have created it in-txn — an environment/
  // trigger anomaly. Never create here (single creator = the trigger); fail loud so it is caught, not
  // silently papered over by a second writer.
  logger.error(
    "AUTH",
    "profile_missing_after_trigger",
    "Authenticated user has no profile and no conflicting email owner — handle_new_user trigger anomaly",
    {
      userId: user.id,
      source: context.source,
      requestId: context.requestId,
    },
  );
  throw new Error(
    `Profile missing for auth user ${user.id} and not owned by another identity; handle_new_user trigger did not create it`,
  );
}
