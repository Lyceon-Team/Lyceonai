import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getSupabaseAdmin, requireRequestUser } from '../middleware/supabase-auth';
import { SUPPORT_EMAIL } from '../lib/support-contact';
import { LEGAL_DOCS } from '../../shared/legal-consent.js';
import crypto from 'crypto';
import { sendEmail } from '../lib/email.js';

const router = Router();

const REQUIRED_LEGAL_DOCS = [LEGAL_DOCS.studentTerms, LEGAL_DOCS.privacyPolicy] as const;

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

function hasAllCurrentLegalAcceptances(
  legalRows: Array<{ doc_key: string; doc_version: string }>,
): boolean {
  return REQUIRED_LEGAL_DOCS.every((doc) =>
    legalRows.some((row) => row.doc_key === doc.docKey && row.doc_version === doc.docVersion),
  );
}

const profileCompletionSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(['student', 'guardian']),
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
    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select(
        "id, email, display_name, role, is_under_13, guardian_consent, guardian_email, student_link_code, date_of_birth, marketing_opt_in, profile_completed_at",
      )
      .eq("id", user.id)
      .single();

    if (profileError || !profileRow) {
      console.error("[PROFILE] Failed to load canonical profile row:", profileError);
      return res.status(500).json({ error: "Failed to load profile" });
    }

    const fallbackUsername = profileRow.email ? profileRow.email.split("@")[0] : null;
    const normalizedName = profileRow.display_name || fallbackUsername || "Student";
    const { data: legalRows, error: legalError } = await supabase
      .from('legal_acceptances')
      .select('doc_key, doc_version')
      .eq('user_id', user.id);

    if (legalError) {
      console.error('[PROFILE] Failed to load legal acceptance status:', legalError);
    }

    const legalAcceptances = legalRows ?? [];
    const requiredLegalAccepted = hasAllCurrentLegalAcceptances(legalAcceptances);
    const guardianConsentRequired = !!(profileRow.is_under_13 && !profileRow.guardian_consent);
    const requiredConsentsComplete = requiredLegalAccepted && !guardianConsentRequired;
    const requiredProfileComplete = !!profileRow.profile_completed_at;

    return res.json({
      authenticated: true,
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
        requiredConsentsComplete,
        requiredProfileComplete,
        guardianConsentRequired,
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
router.patch('/', async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const userId = user.id;
    const supabase = getSupabaseAdmin();

    // Validate request body
    const validation = profileCompletionSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid profile data',
        details: validation.error.errors
      });
    }

    const data = validation.data;

    const { data: existingProfile, error: existingProfileError } = await supabase
      .from('profiles')
      .select('id, role, profile_completed_at, guardian_consent, guardian_email')
      .eq('id', userId)
      .single();

    if (existingProfileError || !existingProfile) {
      console.error('[PROFILE] Error loading existing profile:', existingProfileError);
      return res.status(500).json({ error: 'Failed to load profile state' });
    }

    if (existingProfile.role === "admin") {
      return res.status(403).json({
        error: "Admin profile onboarding is not supported on this endpoint",
      });
    }

    if (
      existingProfile.profile_completed_at &&
      data.role !== existingProfile.role
    ) {
      return res.status(403).json({
        error: 'Role changes are support-mediated only',
        message: `Email ${SUPPORT_EMAIL} to request a role review.`,
        supportEmail: SUPPORT_EMAIL,
      });
    }

    if (data.role === 'student' && !data.dateOfBirth) {
      return res.status(400).json({
        error: 'Date of birth is required for student accounts',
      });
    }

    const isUnder13 = data.role === 'student' && data.dateOfBirth
      ? calculateAge(data.dateOfBirth) < 13
      : false;
    const guardianEmail = data.guardianEmail ?? existingProfile.guardian_email ?? null;

    if (isUnder13 && !guardianEmail) {
      return res.status(400).json({
        error: 'Guardian email is required for users under 13',
      });
    }

    let guardianConsentRequestId: string | null = null;
    let guardianConsentRequired = false;

    if (isUnder13 && !existingProfile.guardian_consent) {
      guardianConsentRequired = true;
      const expiresThreshold = new Date().toISOString();
      const { data: existingRequest, error: existingRequestError } = await supabase
        .from('guardian_consent_requests')
        .select('id, guardian_email, expires_at, status')
        .eq('child_id', userId)
        .eq('status', 'pending')
        .gt('expires_at', expiresThreshold)
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingRequestError) {
        console.error("[PROFILE] Failed to query existing guardian consent request:", existingRequestError);
        return res.status(500).json({ error: "Failed to load guardian consent state" });
      }

      if (existingRequest && existingRequest.guardian_email === guardianEmail) {
        guardianConsentRequestId = existingRequest.id;
      } else {
        const requestId = crypto.randomUUID();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 14);

        const { error: requestError } = await supabase
          .from('guardian_consent_requests')
          .insert({
            id: requestId,
            child_id: userId,
            guardian_email: guardianEmail!,
            status: 'pending',
            expires_at: expiresAt.toISOString(),
          });

        if (requestError) {
          console.error('[PROFILE] Failed to create guardian consent request:', requestError);
          return res.status(500).json({ error: 'Failed to start guardian verification flow' });
        }

        guardianConsentRequestId = requestId;
      }

      const siteUrl = process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get('host')}`;
      const verificationLink = `${siteUrl}/guardian/verify-consent?requestId=${guardianConsentRequestId}`;

      await sendEmail({
        to: guardianEmail!,
        subject: `Guardian consent required for ${data.displayName}`,
        html: `
          <h1>Guardian Consent Required</h1>
          <p>${data.displayName} has entered profile details on Lyceon.</p>
          <p>To continue, complete verified guardian consent at:</p>
          <p><a href="${verificationLink}">${verificationLink}</a></p>
          <p>This link expires in 14 days.</p>
        `,
      });
    }

    // Finalize profile fields with server-authoritative role and under-13 state.
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        display_name: data.displayName,
        role: data.role,
        date_of_birth: data.dateOfBirth || null,
        guardian_email: guardianEmail,
        is_under_13: isUnder13,
        guardian_consent: guardianConsentRequired ? false : existingProfile.guardian_consent,
        marketing_opt_in: data.marketingOptIn,
        profile_completed_at: guardianConsentRequired ? null : new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('[PROFILE] Error updating profile:', updateError);
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    // Fetch updated profile
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (fetchError || !profile) {
      console.error('[PROFILE] Error fetching updated profile:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch updated profile' });
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
        role: profile.role
      },
      guardianConsentRequired,
      guardianConsentRequestId,
    });
  } catch (error: any) {
    console.error('[PROFILE] Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
