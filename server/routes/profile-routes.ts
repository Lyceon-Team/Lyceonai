import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  getSupabaseAdmin,
  requireRequestUser,
} from "../middleware/supabase-auth";
import { isDeletionLifecycleV2Enabled } from "../lib/account-deletion-execute";
import { drainLegalAcceptanceOutbox } from "../lib/legal-acceptance";
import { SUPPORT_EMAIL } from "../lib/support-contact";
import {
  requiredLegalDocsForUse,
  type OutstandingLegalDoc,
} from "../../shared/legal-consent.js";
import { resolveLegalVersion } from "../lib/legal-registry.js";
import type { ResolvedLegalVersion } from "../lib/legal-registry-types.js";
import { logger } from "../logger";
import crypto from "crypto";
import { sendGuardianConsentRequestEmail } from "../lib/notifications/direct-sends";

const router = Router();

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
 * The required SET is a function of context, not a fixed list: Parent Terms
 * applies to a guardian who actually holds a link, and to nobody else.
 */
function outstandingLegalDocs(
  legalRows: Array<{ doc_key: string; doc_version: string }>,
): OutstandingLegalDoc[] {
  const outstanding: OutstandingLegalDoc[] = [];
  for (const doc of requiredLegalDocsForUse()) {
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

const profileCompletionSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(["student", "guardian"]),
  dateOfBirth: z.string().optional().nullable(),
  guardianEmail: z.string().email().optional().nullable(),
  marketingOptIn: z.boolean().optional().default(false),
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

    const supabase = getSupabaseAdmin();

    // AS-1: opportunistically complete any deferred legal-acceptance recording for this user before
    // we read it. Best-effort + never throws — keeps the durable consent retry moving without a cron.
    await drainLegalAcceptanceOutbox(supabase, user.id);

    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select(
        "id, email, display_name, role, is_under_13, guardian_consent, guardian_email, student_link_code, date_of_birth, marketing_opt_in, profile_completed_at, deleted_at",
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

    // The guardian_links count that used to be read here is gone with the
    // role-aware required-document logic: every account owes Student Terms and
    // Privacy Policy and nothing else, so a link changes nothing. One fewer
    // query on the hottest authenticated path.
    const outstandingLegal = outstandingLegalDocs(legalAcceptances);

    // UNDER-13 IS NOT A CONSENT GATE. It is the Terms' own condition — a student
    // under 13 cannot use LYCEON until a guardian connects — and it is the basis
    // of the under-13 position. It stays, and it routes to a screen that helps
    // them get connected rather than a wall.
    const guardianConsentRequired = !!(
      profileRow.is_under_13 && !profileRow.guardian_consent
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

    return res.json({
      authenticated: true,
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
        guardian_consent: profileRow.guardian_consent,
        guardianEmail: profileRow.guardian_email,
        dateOfBirth: profileRow.date_of_birth,
        marketingOptIn: profileRow.marketing_opt_in,
        studentLinkCode: profileRow.student_link_code,
        student_link_code: profileRow.student_link_code,
        profileCompletedAt: profileRow.profile_completed_at ?? null,
        requiredProfileComplete,
        guardianConsentRequired,
        // What the blocking re-consent modal renders. Server-derived: which
        // documents this person owes, their current version and title from
        // legal/, and what they last accepted. The client is told, never asked.
        outstandingLegal,
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
    const requestedRole =
      typeof (req.body as any)?.role === "string"
        ? (req.body as any).role
        : null;

    if (requestedRole && requestedRole !== user.role) {
      return res.status(403).json({
        error: "Role changes are support-mediated only",
        message: `Email ${SUPPORT_EMAIL} to request a role review.`,
        supportEmail: SUPPORT_EMAIL,
      });
    }

    const supabase = getSupabaseAdmin();

    const { data: existingProfile, error: existingProfileError } =
      await supabase
        .from("profiles")
        .select(
          "id, role, profile_completed_at, guardian_consent, guardian_email",
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
      return res.status(403).json({
        error: "Admin profile onboarding is not supported on this endpoint",
      });
    }

    if (
      existingProfile.profile_completed_at &&
      requestedRole &&
      requestedRole !== existingProfile.role
    ) {
      return res.status(403).json({
        error: "Role changes are support-mediated only",
        message: `Email ${SUPPORT_EMAIL} to request a role review.`,
        supportEmail: SUPPORT_EMAIL,
      });
    }

    // Validate request body
    const validation = profileCompletionSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: "Invalid profile data",
        details: validation.error.errors,
      });
    }

    const data = validation.data;

    if (data.role === "student" && !data.dateOfBirth) {
      return res.status(400).json({
        error: "Date of birth is required for student accounts",
      });
    }

    const isUnder13 =
      data.role === "student" && data.dateOfBirth
        ? calculateAge(data.dateOfBirth) < 13
        : false;
    const guardianEmail =
      data.guardianEmail ?? existingProfile.guardian_email ?? null;

    if (isUnder13 && !guardianEmail) {
      return res.status(400).json({
        error: "Guardian email is required for users under 13",
      });
    }

    let guardianConsentRequestId: string | null = null;
    let guardianConsentRequired = false;

    if (isUnder13 && !existingProfile.guardian_consent) {
      guardianConsentRequired = true;
      const expiresThreshold = new Date().toISOString();
      const { data: existingRequest, error: existingRequestError } =
        await supabase
          .from("guardian_consent_requests")
          .select("id, guardian_email, expires_at, status")
          .eq("child_id", userId)
          .eq("status", "pending")
          .gt("expires_at", expiresThreshold)
          .order("expires_at", { ascending: false })
          .limit(1)
          .maybeSingle();

      if (existingRequestError) {
        console.error(
          "[PROFILE] Failed to query existing guardian consent request:",
          existingRequestError,
        );
        return res
          .status(500)
          .json({ error: "Failed to load guardian consent state" });
      }

      if (existingRequest && existingRequest.guardian_email === guardianEmail) {
        guardianConsentRequestId = existingRequest.id;
      } else {
        const requestId = crypto.randomUUID();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 14);

        const { error: requestError } = await supabase
          .from("guardian_consent_requests")
          .insert({
            id: requestId,
            child_id: userId,
            guardian_email: guardianEmail!,
            status: "pending",
            expires_at: expiresAt.toISOString(),
          });

        if (requestError) {
          console.error(
            "[PROFILE] Failed to create guardian consent request:",
            requestError,
          );
          return res
            .status(500)
            .json({ error: "Failed to start guardian verification flow" });
        }

        guardianConsentRequestId = requestId;
      }

      // Doc 01 §37.2 steps 1–3 / ruling R7+R9: the request row is the durable record; the
      // email is a direct send keyed by that row's id, so a repeated PATCH cannot mail twice.
      // Best-effort: a mail failure is logged inside the sender and never fails the profile
      // update — the guardian can be re-mailed from the same row.
      const consentRequestId: string | null = guardianConsentRequestId;
      if (consentRequestId) {
        await sendGuardianConsentRequestEmail({
          consentRequestId,
          guardianEmail: guardianEmail!,
          studentDisplayName: data.displayName,
          requestId: req.requestId,
        });
      }
    }

    // Finalize profile fields with server-authoritative role and under-13 state.
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        display_name: data.displayName,
        role: data.role,
        date_of_birth: data.dateOfBirth || null,
        guardian_email: guardianEmail,
        is_under_13: isUnder13,
        guardian_consent: guardianConsentRequired
          ? false
          : existingProfile.guardian_consent,
        marketing_opt_in: data.marketingOptIn,
        profile_completed_at: guardianConsentRequired
          ? null
          : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateError) {
      console.error("[PROFILE] Error updating profile:", updateError);
      return res.status(500).json({ error: "Failed to update profile" });
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

    return res.json({
      success: true,
      profile: {
        id: profile.id,
        email: profile.email,
        displayName: profile.display_name,
        dateOfBirth: profile.date_of_birth,
        guardianEmail: profile.guardian_email,
        isUnder13: profile.is_under_13,
        guardianConsent: profile.guardian_consent,
        marketingOptIn: profile.marketing_opt_in,
        profileCompletedAt: profile.profile_completed_at,
        studentLinkCode: profile.student_link_code,
        role: profile.role,
      },
      guardianConsentRequired,
      guardianConsentRequestId,
    });
  } catch (error: any) {
    console.error("[PROFILE] Unexpected error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
