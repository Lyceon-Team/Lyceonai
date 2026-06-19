import type { SupabaseClient, User } from "@supabase/supabase-js";
import { logger } from "../logger.js";
import { normalizeRuntimeRole, type RuntimeRole } from "./auth-role.js";

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
export class AccountEmailConflictError extends Error {
  readonly code = "ACCOUNT_EMAIL_CONFLICT" as const;
  constructor(message: string) {
    super(message);
    this.name = "AccountEmailConflictError";
  }
}

const ACCOUNT_EMAIL_CONFLICT_MESSAGE =
  "An account already exists for this email. Sign in with your original method.";

const PROFILE_SELECT =
  "id, email, display_name, role, is_under_13, guardian_consent, guardian_email, student_link_code, profile_completed_at";

type ProfileRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: RuntimeRole;
  is_under_13: boolean;
  guardian_consent: boolean;
  guardian_email: string | null;
  student_link_code: string | null;
  profile_completed_at: string | null;
};

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
 * trigger made, normalizes a legacy/missing role if needed, and reconciles the only two ways the row can
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
): Promise<ProfileRow> {
  const { data: existingProfile, error: existingProfileError } =
    await supabaseAdmin
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", user.id)
      .maybeSingle();

  if (existingProfileError && existingProfileError.code !== "PGRST116") {
    throw new Error(
      `Failed to load profile for auth user: ${existingProfileError.message}`,
    );
  }

  if (existingProfile) {
    const normalizedRole = normalizeRuntimeRole(existingProfile.role);

    if (existingProfile.role !== normalizedRole) {
      const { data: updatedProfile, error: updateError } = await supabaseAdmin
        .from("profiles")
        .update({
          role: normalizedRole,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)
        .select(PROFILE_SELECT)
        .single();

      if (updateError || !updatedProfile) {
        throw new Error(
          `Failed to normalize profile role: ${updateError?.message || "profile update returned null"}`,
        );
      }

      logger.info(
        "AUTH",
        "profile_role_normalized",
        "Normalized legacy or missing profile role",
        {
          userId: user.id,
          fromRole: existingProfile.role,
          toRole: normalizedRole,
          source: context.source,
          requestId: context.requestId,
        },
      );

      return {
        ...(updatedProfile as Omit<ProfileRow, "role">),
        role: normalizedRole,
      };
    }

    return {
      ...(existingProfile as Omit<ProfileRow, "role">),
      role: normalizedRole,
    };
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
