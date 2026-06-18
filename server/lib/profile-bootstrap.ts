import type { SupabaseClient, User } from "@supabase/supabase-js";
import { logger } from "../logger.js";
import { normalizeRuntimeRole, type RuntimeRole } from "./auth-role.js";

/**
 * @spec [Doc-01_V8 Part I — Identity Model (one profiles row per authenticated user) | contracts/auth-login-e2e.contract.md AL-7]
 * Thrown when a profile bootstrap would create a SECOND profile for an email already anchored by a
 * DIFFERENT auth identity — i.e. the same human authenticating via a second provider on the same
 * email when Supabase identity-linking is not merging them. Callers translate this to a deliberate,
 * server-authoritative "sign in with your original method" outcome instead of forking one human into
 * two profiles. The genesis unique index idx_profiles_email_active is the hard DB backstop; this is
 * the clean, typed surface over it. Config-agnostic: correct whether or not the dashboard toggle is set.
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

function resolveBootstrapRoleFromMetadata(user: User): "student" | "guardian" {
  const metadataRole = user.user_metadata?.role;

  if (metadataRole === "admin") {
    logger.warn(
      "AUTH",
      "admin_role_blocked",
      "Blocked attempt to bootstrap admin role from user metadata",
      {
        userId: user.id,
        email: user.email,
      },
    );
    return "student";
  }

  return metadataRole === "guardian" ? "guardian" : "student";
}

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

  const bootstrapRole = resolveBootstrapRoleFromMetadata(user);

  // AL-7 (profile-per-human, config-agnostic): never fork one human into two profiles. If this email
  // already anchors a profile under a DIFFERENT auth id (same human via a second provider when
  // identity-linking did not merge them), surface a deliberate conflict instead of attempting a
  // duplicate. The genesis idx_profiles_email_active unique index is the hard backstop; the 23505
  // translation below covers casing/race edges this exact pre-check can miss. @spec Doc-01_V8 Part I.
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
        "Blocked duplicate profile for an email already owned by another identity",
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

  const { data: newProfile, error: createError } = await supabaseAdmin
    .from("profiles")
    .insert({
      id: user.id,
      email: user.email || "",
      display_name:
        user.user_metadata?.display_name ||
        user.user_metadata?.full_name ||
        null,
      role: bootstrapRole,
      is_under_13: user.user_metadata?.is_under_13 || false,
      guardian_consent: user.user_metadata?.guardian_consent || false,
      guardian_email: user.user_metadata?.guardian_email || null,
    })
    .select(PROFILE_SELECT)
    .single();

  if (createError || !newProfile) {
    // Race/casing backstop: the genesis idx_profiles_email_active unique index rejects a second
    // profile for the same email (lower(email)). Translate that to the same deliberate conflict.
    if (createError?.code === "23505") {
      logger.warn(
        "AUTH",
        "account_email_conflict",
        "Duplicate profile insert rejected by unique index",
        {
          attemptedUserId: user.id,
          source: context.source,
          requestId: context.requestId,
        },
      );
      throw new AccountEmailConflictError(ACCOUNT_EMAIL_CONFLICT_MESSAGE);
    }
    throw new Error(
      `Failed to auto-create profile: ${createError?.message || "profile insert returned null"}`,
    );
  }

  logger.info(
    "AUTH",
    "profile_auto_created",
    "Profile auto-created with canonical bootstrap role",
    {
      userId: newProfile.id,
      role: bootstrapRole,
      source: context.source,
      requestId: context.requestId,
    },
  );

  return {
    ...(newProfile as Omit<ProfileRow, "role">),
    role: bootstrapRole,
  };
}
