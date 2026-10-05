import { Router, Request, Response } from "express";
import { resolveFeatureAccess } from "../lib/feature-access";
import { z } from "zod";
import {
  getSupabaseAdmin,
  requireGuardianLinkForUnder13,
  requireRequestUser,
  requireStudentAccount,
} from "../middleware/supabase-auth";
import { isDeletionLifecycleV2Enabled } from "../lib/account-deletion-execute";
import { drainLegalAcceptanceOutbox } from "../lib/legal-acceptance";
import { SUPPORT_EMAIL } from "../lib/support-contact";
import {
  requiredLegalDocsForUse,
  type LegalAccountFacts,
  type OutstandingLegalDoc,
} from "../../shared/legal-consent.js";
import { loadLegalAccountFacts } from "../lib/legal-account-facts";
import { resolveLegalVersion } from "../lib/legal-registry.js";
import type { ResolvedLegalVersion } from "../lib/legal-registry-types.js";
import { logger } from "../logger";
import { hasActiveGuardianLink } from "../lib/guardian-link-state";
import { hasPasswordIdentity } from "../lib/password-credentials";
import { emitEvent } from "../lib/analytics/emit-event";
import { signupSourceSchema } from "../../packages/shared/src/analytics-consent-schema";
import {
  dateOfBirthSchema,
  setDateOfBirthRequestSchema,
} from "../../packages/shared/src/profile-role-choice-schema";
import {
  displayNameSchema,
  profileNameUpdateRequestSchema,
  type ProfileNameUpdateResponse,
} from "../../packages/shared/src/profile-name-schema";
import {
  decideRoleChoice,
  dateOfBirthRefusal,
  guardianAgeRefusal,
  INVALID_DATE_OF_BIRTH,
  isSelfAssignableRole,
  loadRoleChoiceFacts,
  NOT_SELF_ASSIGNABLE,
  supportMessage,
  toIsoDate,
  type RoleChoiceFacts,
  type RoleChoiceRefusal,
} from "../lib/role-choice";
import {
  emitMarketingConsentCaptured,
  setMarketingConsent,
  type MarketingConsentWrite,
} from "../lib/marketing-consent";
import {
  MARKETING_OPT_IN_INELIGIBLE,
  marketingConsentRequestSchema,
  marketingConsentResponseSchema,
  marketingOptInEligible,
} from "../../packages/shared/src/marketing-consent-schema";

const router = Router();

/**
 * Every coded refusal on this surface has one shape, `{ error: { code, message } }`
 * (Coding Standards §8.2), so the client can show the server's message for a known code
 * rather than guessing from a string (G1-02; AS-3).
 */
function sendRoleChoiceRefusal(
  res: Response,
  refusal: RoleChoiceRefusal,
): Response {
  return res.status(refusal.status).json({
    error: { code: refusal.code, message: refusal.message },
    supportEmail: SUPPORT_EMAIL,
  });
}

function calculateAge(birthDate: string): number {
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

/**
 * Which required documents this person does NOT hold at the currently published
 * version. Empty means nothing is outstanding.
 *
 * The version is resolved from `legal/` rather than read from a constant, so
 * publishing v3 re-prompts with no code change — the behaviour a materially
 * changed contract should have, and the property the whole structure exists to
 * deliver.
 *
 * The required SET is derived from the account's own facts, not from a fixed
 * list and not from a role: Parent Terms applies to an account that actually
 * holds a link, Billing Terms to one that has ever paid. Owner ruling
 * 2026-09-16 — whatever a user has not given, prompt for it.
 */
function outstandingLegalDocs(
  legalRows: Array<{ doc_key: string; doc_version: string }>,
  facts: LegalAccountFacts,
): OutstandingLegalDoc[] {
  const outstanding: OutstandingLegalDoc[] = [];
  for (const doc of requiredLegalDocsForUse(facts)) {
    // NEVER THROWS INTO THE PROFILE RESPONSE. This exact call threw
    // `legal/ not found. Looked in: legal, dist/public/legal relative to
    // /var/task` on every request from 2026-09-16T01:22:07Z, and because the
    // throw reached the handler it turned a consent LOOKUP into a total sign-in
    // outage: /api/profile 500, /auth/callback post_auth_finalize_failed.
    //
    // Absence is not ambiguity. Not knowing what somebody owes is not a reason
    // to refuse them their account — consent is a prompt, never a gate, in every
    // role. A document we cannot resolve is logged at ERROR and omitted, so the
    // worst case is a prompt that does not appear yet, not a person who cannot
    // sign in. The generated registry means this should now be unreachable;
    // it stays because "should be unreachable" is what was believed last time.
    let current: ResolvedLegalVersion;
    try {
      current = resolveLegalVersion(doc.slug);
    } catch (err: unknown) {
      logger.error(
        "PROFILE",
        "legal_resolution_failed",
        "Could not resolve a required legal document; omitting it from the outstanding set",
        {
          slug: doc.slug,
          error: err instanceof Error ? err.message : "unknown",
        },
      );
      continue;
    }
    const accepted = legalRows.filter((row) => row.doc_key === doc.docKey);
    if (accepted.some((row) => row.doc_version === current.version)) continue;
    outstanding.push({
      slug: doc.slug,
      docKey: doc.docKey,
      title: current.title,
      version: current.version,
      effectiveDate: current.effectiveDate,
      // Most recent by string order is good enough: versions are "N.M" and the
      // legacy rows are ISO dates, both of which sort sensibly among themselves.
      // `.at(-1)` is ES2022; this tsconfig targets lower. Index arithmetic
      // reads the same and compiles.
      acceptedVersion: (() => {
        const sorted = accepted.map((r) => r.doc_version).sort();
        return sorted.length > 0 ? sorted[sorted.length - 1] : null;
      })(),
    });
  }
  return outstanding;
}

/**
 * @spec [student-UI register §9 OQ-26, owner ruling (Karl) 2026-10-02: `hasPassword` on
 *        GET /api/profile; register F-38 (Google-only accounts have no password to change);
 *        Coding Standards §12.1] | @implemented [2026-10-03]
 *
 * plain English: does this account sign in with a password? Answered by `hasPasswordIdentity`,
 * the SAME predicate `POST /api/auth/change-password` (and `/update-password`) refuse with
 * `NO_PASSWORD_IDENTITY`, so Settings hiding "Change password" and the route refusing it cannot
 * disagree. A display hint only; the password routes still enforce.
 *
 * Cost: one GoTrue admin read (`auth.admin.getUserById`) per profile load — the identities are
 * not on the request's user. It is started before the profile's own database reads and awaited
 * at the end, so it overlaps them rather than adding a sequential round trip.
 *
 * Failure: `null`, logged at ERROR with the request id only. NEVER THROWS INTO THE PROFILE
 * RESPONSE: this endpoint is the sign-in hydration path (see `outstandingLegalDocs` for the
 * outage that posture came from), and an unreadable identity list is not a reason to refuse an
 * account. `null` is "unknown", never a guess: `true` would offer a form the route refuses,
 * `false` would hide a working one. Trade-off: the ruling names `boolean`; `null` is the one
 * extra value, and only on a failed read.
 */
async function resolveHasPassword(
  userId: string,
  requestId: string | undefined,
): Promise<boolean | null> {
  try {
    return await hasPasswordIdentity(userId);
  } catch (err: unknown) {
    logger.error(
      "PROFILE",
      "has_password_unavailable",
      "Could not read the account's identities; hasPassword is null",
      undefined,
      {
        requestId,
        reason:
          err instanceof Error && err.message === "identity_read_failed"
            ? "identity_read_failed"
            : "unexpected",
      },
    );
    return null;
  }
}

const profileCompletionSchema = z.object({
  // OQ-28 (UI-58): the one display-name rule, shared with the Settings name save.
  displayName: displayNameSchema,
  role: z.enum(["student", "guardian"]),
  // F-41: a real calendar date, through the shared schema (Brief 8 ruling 6). Not-in-the-future
  // and plausibility need today's date, so `dateOfBirthRefusal` applies them below.
  dateOfBirth: dateOfBirthSchema.optional().nullable(),
  // Guardian final purge, item 3 (owner brief 2026-10-02): `guardianEmail` is gone. It only ever
  // addressed the removed consent email (G2-05); an unknown key is stripped here, never written.
  // Plan R26 / Q5 (the "reset bug", F-54): no default. An omitted field leaves the stored value
  // alone; it is written only when sent, and only through `setMarketingConsent` below.
  marketingOptIn: z.boolean().optional(),
});

/**
 * GET /api/profile
 * Canonical hydration endpoint for authenticated user profile
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    // OQ-26: started now, awaited at the end, so the GoTrue read overlaps the database reads.
    // Never rejects (see `resolveHasPassword`), so an early return below leaves nothing unhandled.
    const hasPasswordRead = resolveHasPassword(user.id, req.requestId);

    const supabase = getSupabaseAdmin();

    // AS-1: opportunistically complete any deferred legal-acceptance recording for this user before
    // we read it. Best-effort + never throws — keeps the durable consent retry moving without a cron.
    await drainLegalAcceptanceOutbox(supabase, user.id);

    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select(
        "id, email, display_name, role, is_under_13, date_of_birth, marketing_opt_in, profile_completed_at, deleted_at, stripe_customer_id",
      )
      .eq("id", user.id)
      .single();

    if (profileError || !profileRow) {
      console.error(
        "[PROFILE] Failed to load canonical profile row:",
        profileError,
      );
      return res.status(500).json({ error: "Failed to load profile" });
    }

    const fallbackUsername = profileRow.email
      ? profileRow.email.split("@")[0]
      : null;
    const normalizedName =
      profileRow.display_name || fallbackUsername || "Student";
    const { data: legalRows, error: legalError } = await supabase
      .from("legal_acceptances")
      .select("doc_key, doc_version")
      .eq("user_id", user.id);

    if (legalError) {
      console.error(
        "[PROFILE] Failed to load legal acceptance status:",
        legalError,
      );
    }

    const legalAcceptances = legalRows ?? [];

    // THE ACCOUNT'S OWN FACTS, not its role. `stripe_customer_id` rode along
    // in the profile select above, so the only added cost on this path is the
    // link read — one query, and one that never throws into the response.
    const legalFacts = await loadLegalAccountFacts(
      user.id,
      profileRow.stripe_customer_id ?? null,
    );
    const outstandingLegal = outstandingLegalDocs(legalAcceptances, legalFacts);

    // UNDER-13 IS NOT A CONSENT GATE. It is the Terms' own condition — a student
    // under 13 cannot use LYCEON until a guardian connects — and it is the basis
    // of the under-13 position. It stays, and it routes to a screen that helps
    // them get connected rather than a wall.
    // G2-05 (R6): "is a guardian connected" is DERIVED from an active link, never read from a
    // stored flag. Interim within the Wave 2 PR: G2-04 gates every request on the same read.
    const guardianConnected = await hasActiveGuardianLink(supabase, user.id);
    const guardianConsentRequired = !!(
      profileRow.is_under_13 && !guardianConnected
    );
    const requiredProfileComplete = !!profileRow.profile_completed_at;

    // @spec [Doc-01_V8 §40 / §40.3] | @implemented 2026-06-21 | plain English: server-authority
    // exposure of (a) whether the V2 account-deletion lifecycle is live and (b) whether THIS user is in
    // the 7-day soft-delete grace. The client must NEVER guess the flag from a client env var — the
    // server is the authority on whether the deletion path is real, so the UI can gate the delete
    // control and route a grace-window user to the pending-deletion screen. Flag OFF or no soft-delete
    // => both inert; the schedule is only queried when the user is actually soft-deleted (not a hot path).
    const lifecycleV2 = isDeletionLifecycleV2Enabled();
    let pendingDeletion: { scheduledHardDeleteAt: string } | null = null;
    if (lifecycleV2 && profileRow.deleted_at) {
      const { data: pendingRow } = await supabase
        .from("account_deletion_requests")
        .select("scheduled_hard_delete_at")
        .eq("profile_id", user.id)
        .eq("status", "pending")
        .maybeSingle();
      if (pendingRow?.scheduled_hard_delete_at) {
        pendingDeletion = {
          scheduledHardDeleteAt: pendingRow.scheduled_hard_delete_at,
        };
      }
    }

    // OQ-29 (owner ruling 2026-10-02): the rail locks and the upgrade-vs-age choice, computed by
    // each gated route's own predicate. A display hint; every route still enforces.
    const featureAccess = await resolveFeatureAccess(user);
    const hasPassword = await hasPasswordRead;

    return res.json({
      authenticated: true,
      featureAccess,
      // Server-authority flags + grace-window state (see the @spec note above).
      featureFlags: {
        accountDeletionLifecycleV2: lifecycleV2,
      },
      pendingDeletion,
      user: {
        id: profileRow.id,
        email: profileRow.email,
        display_name: profileRow.display_name,
        name: normalizedName,
        username: fallbackUsername,
        role: profileRow.role,
        isAdmin: user.isAdmin,
        isGuardian: user.isGuardian,
        is_under_13: profileRow.is_under_13,
        dateOfBirth: profileRow.date_of_birth,
        marketingOptIn: profileRow.marketing_opt_in,
        profileCompletedAt: profileRow.profile_completed_at ?? null,
        requiredProfileComplete,
        guardianConsentRequired,
        // What the blocking re-consent modal renders. Server-derived: which
        // documents this person owes, their current version and title from
        // legal/, and what they last accepted. The client is told, never asked.
        outstandingLegal,
        // OQ-26 (owner ruling 2026-10-02): false for a Google-only account, so Settings hides
        // "Change password"; null only when the identity read failed (see `resolveHasPassword`).
        hasPassword,
      },
    });
  } catch (error: any) {
    console.error("[PROFILE] Error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/profile
 * Complete user profile with additional information
 * Requires authentication and CSRF protection
 */
router.patch("/", async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const userId = user.id;
    const body: unknown = req.body;
    const rawRole: unknown =
      typeof body === "object" && body !== null
        ? (body as { role?: unknown }).role
        : undefined;
    const requestedRole = typeof rawRole === "string" ? rawRole : null;

    // Admin (or any role outside student/guardian) is never self-assigned. Refused before
    // anything is read, so no profile state is needed to say no.
    if (requestedRole !== null && !isSelfAssignableRole(requestedRole)) {
      logger.warn("PROFILE", "role_choice_refused", "Role choice refused", {
        code: NOT_SELF_ASSIGNABLE.code,
        requestId: req.requestId,
      });
      return sendRoleChoiceRefusal(res, NOT_SELF_ASSIGNABLE);
    }

    const supabase = getSupabaseAdmin();

    const { data: existingProfile, error: existingProfileError } =
      await supabase
        .from("profiles")
        .select(
          "id, role, profile_completed_at, date_of_birth",
        )
        .eq("id", userId)
        .single();

    if (existingProfileError || !existingProfile) {
      console.error(
        "[PROFILE] Error loading existing profile:",
        existingProfileError,
      );
      return res.status(500).json({ error: "Failed to load profile state" });
    }

    if (existingProfile.role === "admin") {
      // G-NEW-12: the response keeps its existing shape; the log names the branch.
      logger.warn(
        "PROFILE",
        "admin_onboarding_refused",
        "Admin profile refused on the onboarding endpoint",
        { code: "ADMIN_PROFILE_NOT_ONBOARDABLE", requestId: req.requestId },
      );
      return res.status(403).json({
        error: "Admin profile onboarding is not supported on this endpoint",
      });
    }

    // G1-02 (R1): the one-time role choice. Every account is created as a student, so a
    // parent picking "Guardian" is a CHANGE of role; `decideRoleChoice` allows it once,
    // before completion, on an account with no link and no learning state. The facts are
    // only read when a change is actually requested.
    const isRoleChange =
      requestedRole !== null && requestedRole !== existingProfile.role;
    let facts: RoleChoiceFacts = {
      hasActiveLink: false,
      hasLearningState: false,
    };
    if (
      isRoleChange &&
      existingProfile.profile_completed_at === null &&
      (requestedRole === "student" || requestedRole === "guardian")
    ) {
      facts = await loadRoleChoiceFacts(supabase, userId);
    }
    const roleDecision = decideRoleChoice({
      currentRole: existingProfile.role,
      requestedRole,
      profileCompletedAt: existingProfile.profile_completed_at,
      facts,
      supportEmail: SUPPORT_EMAIL,
    });
    if (!roleDecision.ok) {
      logger.warn("PROFILE", "role_choice_refused", "Role choice refused", {
        code: roleDecision.refusal.code,
        requestId: req.requestId,
      });
      return sendRoleChoiceRefusal(res, roleDecision.refusal);
    }

    // Validate request body
    const validation = profileCompletionSchema.safeParse(req.body);
    if (!validation.success) {
      // F-41: a malformed date of birth is the person's input being wrong, so it gets the coded
      // refusal the onboarding page shows verbatim (AS-3), not the generic "Invalid profile data".
      if (validation.error.issues.some((issue) => issue.path[0] === "dateOfBirth")) {
        return sendRoleChoiceRefusal(res, INVALID_DATE_OF_BIRTH);
      }
      return res.status(400).json({
        error: "Invalid profile data",
        details: validation.error.errors,
      });
    }

    const data = validation.data;

    // G2-03 (R10): once the profile is complete its date of birth is fixed — for students and
    // guardians alike. A different value is refused before anything is written; an omitted or
    // identical one simply keeps the stored date. The one exception, a guardian filling a NULL
    // date, is POST /date-of-birth below, not this route. The database enforces the same rule
    // (trigger profiles_lock_date_of_birth), so no future writer can bypass it.
    const dateOfBirthLocked = existingProfile.profile_completed_at !== null;
    const storedDateOfBirth = toIsoDate(existingProfile.date_of_birth);
    if (
      dateOfBirthLocked &&
      data.dateOfBirth &&
      data.dateOfBirth !== storedDateOfBirth
    ) {
      logger.warn(
        "PROFILE",
        "date_of_birth_locked",
        "Date of birth change refused after completion",
        { requestId: req.requestId },
      );
      return sendRoleChoiceRefusal(res, {
        status: 409,
        code: "DATE_OF_BIRTH_LOCKED",
        message: `Your date of birth can't be changed after your profile is complete. ${supportMessage(SUPPORT_EMAIL)}`,
      });
    }
    const effectiveDateOfBirth = dateOfBirthLocked
      ? storedDateOfBirth
      : (data.dateOfBirth ?? null);

    // F-41: a NEW date of birth must be a plausible past date. A stored (locked) one is not
    // re-judged: it was accepted when it was written, and refusing it now would lock the person
    // out of their own profile. An under-13 date is ACCEPTED here — see `dateOfBirthRefusal`.
    if (!dateOfBirthLocked && effectiveDateOfBirth) {
      const dobRefusal = dateOfBirthRefusal(effectiveDateOfBirth, new Date());
      if (dobRefusal) {
        logger.warn(
          "PROFILE",
          "date_of_birth_refused",
          "Date of birth refused at onboarding",
          { code: dobRefusal.code, requestId: req.requestId },
        );
        return sendRoleChoiceRefusal(res, dobRefusal);
      }
    }

    if (data.role === "student" && !effectiveDateOfBirth) {
      return res.status(400).json({
        error: "Date of birth is required for student accounts",
      });
    }

    // R10: a guardian gives a date of birth through the same field as a student, and must
    // be an adult. Refused before anything is written.
    if (data.role === "guardian") {
      const ageRefusal = guardianAgeRefusal(effectiveDateOfBirth, new Date());
      if (ageRefusal) {
        logger.warn(
          "PROFILE",
          "guardian_age_refused",
          "Guardian age rule refused",
          {
            code: ageRefusal.code,
            requestId: req.requestId,
          },
        );
        return sendRoleChoiceRefusal(res, ageRefusal);
      }
    }

    // Plan R26: never under-13 (and never an unknown age). Refused before anything is written,
    // with the same rule the database trigger applies. The onboarding form only shows the
    // checkbox to guardians and students 13+, so this is reached only by a crafted request.
    if (
      data.marketingOptIn === true &&
      !marketingOptInEligible(effectiveDateOfBirth, new Date())
    ) {
      logger.warn(
        "PROFILE",
        "marketing_opt_in_refused",
        "Marketing opt-in refused: under 13 or no date of birth",
        { code: MARKETING_OPT_IN_INELIGIBLE, requestId: req.requestId },
      );
      return res.status(400).json({
        error: {
          code: MARKETING_OPT_IN_INELIGIBLE,
          message: "Product update emails are for ages 13 and over.",
        },
      });
    }

    const isUnder13 =
      data.role === "student" && effectiveDateOfBirth
        ? calculateAge(effectiveDateOfBirth) < 13
        : false;
    // G2-05 (R6): the email-consent flow is gone. It wrote `guardian_consent_requests` rows (on a
    // column the table never had, so every under-13 completion failed with 500), emailed a link
    // to a page that does not exist, and withheld `profile_completed_at` from under-13 students.
    // An under-13 student now completes the profile like anyone else; what they may reach while
    // no guardian is linked is decided by the guardian-link gate, not by onboarding.

    // Finalize profile fields with server-authoritative role and under-13 state.
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        display_name: data.displayName,
        role: roleDecision.role,
        // G2-03: a locked date of birth is not written at all, and `is_under_13` is never
        // written — the age trigger derives it from the date of birth.
        ...(dateOfBirthLocked ? {} : { date_of_birth: effectiveDateOfBirth }),
        profile_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateError) {
      console.error("[PROFILE] Error updating profile:", updateError);
      return res.status(500).json({ error: "Failed to update profile" });
    }

    // Plan Q5: the opt-in is written only when the body carries it, after the date of birth is
    // stored (the database's age check reads it), and through the one logged writer. Source
    // `signup`: this route is the onboarding step (owner answer 1), and only that form sends the
    // field; the Settings toggle has its own route.
    //
    // NOT ATOMIC with the profile write above, deliberately: the consent check reads the stored
    // date of birth, which that write sets. A refusal here is unreachable in practice (the same
    // rule refused it before anything was written); what remains is a birthday race or an RPC
    // error, which answers 400/500 with the profile saved and no consent recorded. The person is
    // then simply not opted in — the safe side — and a retry of this form writes `signup` again.
    let consentWrite: MarketingConsentWrite | null = null;
    if (data.marketingOptIn !== undefined) {
      consentWrite = await setMarketingConsent(
        supabase,
        userId,
        data.marketingOptIn,
        "signup",
        req.requestId,
      );
      if (!consentWrite.ok) {
        return res.status(400).json({
          error: {
            code: MARKETING_OPT_IN_INELIGIBLE,
            message: "Product update emails are for ages 13 and over.",
          },
        });
      }
    }

    // Fetch updated profile
    const { data: profile, error: fetchError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (fetchError || !profile) {
      console.error("[PROFILE] Error fetching updated profile:", fetchError);
      return res.status(500).json({ error: "Failed to fetch updated profile" });
    }

    const guardianConnected = await hasActiveGuardianLink(supabase, userId);
    const guardianConsentRequired = isUnder13 && !guardianConnected;

    // Doc 07A §6.2 / owner Step 0 decision 2 (2026-10-05): `user_signed_up` fires when onboarding
    // completes — the date of birth, and so the under-13 exclusion, is known only now. The first
    // completion only, and once across concurrent requests: the wrapper emits only from the call
    // that writes the set-once analytics_user_id. Under-13 and refused outcomes are no-ops.
    if (existingProfile.profile_completed_at === null) {
      const parsedSource = signupSourceSchema.safeParse(
        (profile as { signup_source?: unknown }).signup_source,
      );
      const signedUp = await emitEvent(
        userId,
        "user_signed_up",
        { signup_source: parsedSource.success ? parsedSource.data : "unknown" },
        { requireFirstIdentity: true },
      );
      // Owner report 2026-10-05: a first completion that does not emit is said here too, at the
      // call site, with the wrapper's reason. Only an under-13 account is expected to skip it.
      if (!signedUp.ok && signedUp.reason !== "excluded_under_13_or_age_unknown") {
        logger.error(
          "PROFILE",
          "signup_event_missed",
          "user_signed_up was not sent for a first onboarding completion",
          undefined,
          { reason: signedUp.reason, requestId: req.requestId },
        );
      }
    }
    // After user_signed_up, never before: see server/lib/marketing-consent.ts.
    await emitMarketingConsentCaptured(emitEvent, userId, consentWrite);

    return res.json({
      success: true,
      profile: {
        id: profile.id,
        email: profile.email,
        displayName: profile.display_name,
        dateOfBirth: profile.date_of_birth,
        isUnder13: profile.is_under_13,
        marketingOptIn: profile.marketing_opt_in,
        profileCompletedAt: profile.profile_completed_at,
        role: profile.role,
      },
      guardianConsentRequired,
    });
  } catch (error: any) {
    console.error("[PROFILE] Unexpected error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /api/profile/marketing-consent — the Settings toggle for product-update emails.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R26 ("Settings toggle"), row Q5; Doc 10 §9.21
 *        ("must be revocable"); owner Step 0 answer 2 (2026-10-05): its own endpoint, never the
 *        onboarding PATCH] | @implemented [2026-10-05]
 *
 * plain English: `{ granted }` turns the opt-in on or off at any time, for a student or a
 * guardian. Fixed order: auth (the mount) → Zod parse → load the caller's role and date of birth
 * → refuse a grant to an admin, an unknown age or anyone under 13 (400, coded) → write through
 * the one logged writer (source `settings`) → emit `consent_captured` for a grant → 200
 * `{ marketingOptIn }`.
 *
 * Why not the PATCH: that route is onboarding. It requires a role, re-stamps
 * `profile_completed_at` and validates the whole profile, so a toggle sent through it would carry
 * fields it has no business writing (F-54, OQ-28). Turning the opt-in OFF is never refused —
 * revocation must always work, whatever the account's age.
 *
 * Edge cases: writing the value already held answers 200 and logs nothing (the SQL function
 * compares first). A database refusal after the route's own check (a birthday race) is the same
 * coded 400.
 */
// G2-04: not in the owner-approved allowed set, so an unlinked under-13 student is refused by the
// live link gate (they can never be opted in, so there is nothing for them to revoke here).
router.put(
  "/marketing-consent",
  requireGuardianLinkForUnder13,
  async (req: Request, res: Response) => {
    const user = requireRequestUser(req, res);
    if (!user) return;

    const parsed = marketingConsentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid input",
          details: parsed.error.flatten(),
        },
      });
    }

    try {
      const supabase = getSupabaseAdmin();
      const { data: row, error: readError } = await supabase
        .from("profiles")
        .select("role, date_of_birth")
        .eq("id", user.id)
        .single();
      if (readError || !row) {
        logger.error(
          "PROFILE",
          "marketing_consent_profile_read_failed",
          "Could not load the profile for a marketing consent change",
          { requestId: req.requestId },
        );
        return res.status(500).json({
          error: { code: "INTERNAL", message: "Something went wrong." },
        });
      }
      const role = String((row as { role: unknown }).role);
      const dateOfBirth = toIsoDate(
        (row as { date_of_birth: string | null }).date_of_birth,
      );

      if (parsed.data.granted) {
        const eligible =
          (role === "student" || role === "guardian") &&
          marketingOptInEligible(dateOfBirth, new Date());
        if (!eligible) {
          logger.warn(
            "PROFILE",
            "marketing_opt_in_refused",
            "Marketing opt-in refused: role, under 13 or no date of birth",
            { code: MARKETING_OPT_IN_INELIGIBLE, requestId: req.requestId },
          );
          return res.status(400).json({
            error: {
              code: MARKETING_OPT_IN_INELIGIBLE,
              message: "Product update emails are for ages 13 and over.",
            },
          });
        }
      }

      const write = await setMarketingConsent(
        supabase,
        user.id,
        parsed.data.granted,
        "settings",
        req.requestId,
      );
      if (!write.ok) {
        return res.status(400).json({
          error: {
            code: MARKETING_OPT_IN_INELIGIBLE,
            message: "Product update emails are for ages 13 and over.",
          },
        });
      }
      await emitMarketingConsentCaptured(emitEvent, user.id, write);

      return res
        .status(200)
        .json(
          marketingConsentResponseSchema.parse({
            marketingOptIn: write.granted,
          }),
        );
    } catch (error: unknown) {
      logger.error(
        "PROFILE",
        "marketing_consent_failed",
        "Marketing consent change failed",
        {
          requestId: req.requestId,
          reason: error instanceof Error ? error.message : "unknown",
        },
      );
      return res.status(500).json({
        error: { code: "INTERNAL", message: "Something went wrong." },
      });
    }
  },
);

/**
 * PATCH /api/profile/name — Settings → Profile: change your display name, and nothing else.
 *
 * @spec [student-UI register OQ-28 (owner ruling, Karl, 2026-10-02: a narrow name-only save that
 *        leaves `marketingOptIn` alone; "exact shape goes with the Settings migration"); F-54;
 *        UI-58; Coding Standards §8.1 (auth → parse → domain → serialize), §8.2, §12.1]
 *        | @implemented [2026-10-03]
 *
 * plain English: the session's own profile row gets a new `display_name`. The body is the shared
 * `.strict()` schema, `{ displayName }` and no other key, so the onboarding PATCH's defaults
 * (F-54: `marketingOptIn` defaulting to false, `role` required, `profile_completed_at`
 * re-stamped) cannot reach this write: it updates `display_name` and `updated_at` only.
 *
 * Student accounts only, through the canonical `requireStudentAccount` (the student-background
 * routes' gate): the Settings page that calls it is the student's (a guardian's /profile has no
 * name editor, and an admin is never onboarded through this surface), so any other role is
 * refused 403 `ROLE_NOT_PERMITTED` before the body is read; and it ends in the live under-13 link
 * gate, so an under-13 student with no active guardian link is refused 403
 * `GUARDIAN_LINK_REQUIRED` (the route is not in the owner-approved allowed set, G2-04). The row
 * is the session principal's (`req.user.id`); nothing in the body names whose name to change.
 *
 * edge cases: the name is never logged (it is personal data); a missing profile row is a 404,
 * never an insert; a write failure is a 500 carrying the error's code only.
 */
router.patch("/name", requireStudentAccount, async (req: Request, res: Response) => {
  // 1. Auth: the session principal, from the server's own session (requireSupabaseAuth), already
  //    held to a student account by `requireStudentAccount`.
  const user = requireRequestUser(req, res);
  if (!user) return;

  // 2. Parse: the strict shared body. An extra key (marketingOptIn, role …) is a 400.
  const parsed = profileNameUpdateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "INVALID_NAME",
        message: "Enter a name between 1 and 120 characters.",
        details: parsed.error.flatten(),
      },
    });
  }

  // 3. Domain: one column (and its timestamp) on the caller's own row.
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("profiles")
      .update({
        display_name: parsed.data.displayName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id)
      .select("display_name")
      .maybeSingle();

    if (error) {
      logger.error("PROFILE", "name_save_failed", "Name save failed", {
        requestId: req.requestId,
        code: error.code ?? "unknown",
      });
      return res.status(500).json({
        error: { code: "NAME_SAVE_FAILED", message: "Failed to save your name" },
      });
    }
    if (!data || typeof data.display_name !== "string") {
      return res.status(404).json({
        error: { code: "PROFILE_NOT_FOUND", message: "Profile not found" },
      });
    }

    // 4. Serialize: the stored value, nothing else.
    const body: ProfileNameUpdateResponse = { displayName: data.display_name };
    return res.json(body);
  } catch (err: unknown) {
    logger.error("PROFILE", "name_save_exception", "Name save failed", {
      requestId: req.requestId,
      reason: err instanceof Error ? err.message : "unknown",
    });
    return res.status(500).json({
      error: { code: "NAME_SAVE_FAILED", message: "Failed to save your name" },
    });
  }
});

/**
 * POST /api/profile/date-of-birth — the one-time date-of-birth fill for a guardian with none.
 *
 * @spec [Guardian_Closure_Plan G1-02 ("an existing guardian without a date of birth is asked
 *        for it before redeeming a new code"); owner ruling R10] | @implemented [2026-09-29]
 *
 * plain English: guardians created before R10 have no date of birth, and redeem now refuses
 * them. This lets such a guardian add it, once. Expected outcome: an adult date is stored and
 * the next redeem proceeds; an under-18 date is refused and NOTHING is stored; a second fill
 * is 409, because the write is conditional on the column being NULL. Trade-off: this is not
 * the general date-of-birth lock (G2-03 owns that); it only ever writes into an empty field,
 * so it cannot be used to change a date. Edge case: a student is refused here, since a student
 * cannot complete their profile without a date of birth in the first place.
 */
router.post("/date-of-birth", async (req: Request, res: Response) => {
  const user = requireRequestUser(req, res);
  if (!user) return;

  if (user.role !== "guardian") {
    logger.warn(
      "PROFILE",
      "date_of_birth_fill_refused",
      "Date of birth fill refused for a non-guardian",
      { code: NOT_SELF_ASSIGNABLE.code, requestId: req.requestId },
    );
    return sendRoleChoiceRefusal(res, NOT_SELF_ASSIGNABLE);
  }

  const parsed = setDateOfBirthRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return sendRoleChoiceRefusal(res, {
      status: 400,
      code: "DATE_OF_BIRTH_REQUIRED",
      message: "Please enter a valid date of birth.",
    });
  }

  const ageRefusal = guardianAgeRefusal(parsed.data.dateOfBirth, new Date());
  if (ageRefusal) {
    logger.warn(
      "PROFILE",
      "guardian_age_refused",
      "Guardian age rule refused",
      {
        code: ageRefusal.code,
        requestId: req.requestId,
      },
    );
    return sendRoleChoiceRefusal(res, ageRefusal);
  }

  const { data, error } = await getSupabaseAdmin()
    .from("profiles")
    .update({
      date_of_birth: parsed.data.dateOfBirth,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id)
    .is("date_of_birth", null)
    .select("id");

  if (error) {
    logger.error(
      "PROFILE",
      "date_of_birth_fill_failed",
      "Date of birth write failed",
      {
        error: error.message,
        requestId: req.requestId,
      },
    );
    return res.status(500).json({ error: "Internal server error" });
  }

  if (!data || data.length === 0) {
    return sendRoleChoiceRefusal(res, {
      status: 409,
      code: "DATE_OF_BIRTH_ALREADY_SET",
      message: `Your date of birth is already on your account. ${supportMessage(SUPPORT_EMAIL)}`,
    });
  }

  return res.json({ ok: true });
});

export default router;
