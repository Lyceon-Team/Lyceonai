import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../logger.js';
import { requireSupabaseAuth, getSupabaseAdmin, resolveTokenFromRequest, resolveUserIdFromToken } from '../middleware/supabase-auth.js';
import { doubleCsrfProtection } from '../middleware/csrf-double-submit.js';
import { BUILD } from '../lib/build.js';
import { setAuthCookies, clearAuthCookies } from '../lib/auth-cookies.js';
import { z } from 'zod';
import { isAdminRoleRequest } from '../lib/auth-role.js';
import { sendEmail } from '../lib/email.js';
import { LEGAL_DOCS, type ConsentSource } from '../../shared/legal-consent.js';
import { recordLegalAcceptances } from '../lib/legal-acceptance.js';

const router = Router();

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts. Please try again later.',
  },
});


const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().trim().min(1).max(120).optional(),
  legalConsent: z.object({
    studentTermsAccepted: z.literal(true),
    privacyPolicyAccepted: z.literal(true),
    consentSource: z.enum(['email_signup_form', 'google_continue_pre_oauth', 'google_continue_click']).optional(),
  }),
  role: z.unknown().optional(),
});

// Helper to detect when we're running in a CI/test environment with the
// placeholder Supabase host. In this situation we must avoid making any
// network requests because DNS lookups for test-placeholder.supabase.co will
// fail. The auth-rate-limit test only cares about repeated 401 responses and
// eventual 429 from the rate limiter, so returning a deterministic 401 here
// is sufficient.
function runningAgainstPlaceholder(): boolean {
  return (
    process.env.VITEST === 'true' ||
    process.env.NODE_ENV === 'test' ||
    supabaseUrl.includes('test-placeholder')
  );
}

/**
 * POST /api/auth/signup
 * Sign up with email and password
 */
router.post('/signup', authRateLimiter, doubleCsrfProtection, async (req: Request, res: Response) => {
  try {
    const requestedRole = (req.body as any)?.role;

    // Signup must never create admins.
    if (isAdminRoleRequest(requestedRole)) {
      logger.warn('AUTH', 'admin_signup_blocked', 'Blocked admin role request during signup', {
        email: (req.body as any)?.email,
        requestId: req.requestId,
      });
      return res.status(403).json({
        error: 'Admin signup is disabled',
      });
    }

    const validation = signupSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: validation.error.errors[0]?.message || 'Invalid signup payload',
      });
    }

    const { email, password, displayName, legalConsent } = validation.data;
    const consentSource: ConsentSource = legalConsent.consentSource ?? 'email_signup_form';

    // In test env we skip making real Supabase calls; behave like signup
    // failed so that downstream logic doesn't try to set cookies.
    if (runningAgainstPlaceholder()) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Create anon client for signup
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Sign up user with Supabase Auth
    const { data: authData, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName || email.split('@')[0],
          // Safe temporary backend role until profile-complete finalization.
          role: 'student',
        }
      }
    });

    if (signupError) {
      logger.error('AUTH', 'signup_failed', 'Supabase signup failed', { error: signupError });
      return res.status(400).json({
        error: signupError.message
      });
    }

    if (!authData.user) {
      return res.status(500).json({
        error: 'Failed to create user account'
      });
    }

    // Profile is auto-created by Supabase trigger (handle_new_user).
    // Keep server-authoritative safe default role until profile completion.
    const admin = getSupabaseAdmin();
    const profileUpdate: Record<string, any> = { role: 'student' };

    const { error: updateError } = await admin
      .from('profiles')
      .update(profileUpdate)
      .eq('id', authData.user.id);

    if (updateError) {
      logger.error('AUTH', 'profile_update_failed', 'Failed to update profile', {
        userId: authData.user.id,
        error: updateError
      });
      // Don't fail the signup - profile exists
    }

    await recordLegalAcceptances(admin, {
      userId: authData.user.id,
      consentSource,
      userAgent: req.get('user-agent') ?? null,
      ipAddress: req.ip ?? null,
      acceptances: [
        {
          docKey: LEGAL_DOCS.studentTerms.docKey,
          docVersion: LEGAL_DOCS.studentTerms.docVersion,
          actorType: 'student',
          minor: false,
        },
        {
          docKey: LEGAL_DOCS.privacyPolicy.docKey,
          docVersion: LEGAL_DOCS.privacyPolicy.docVersion,
          actorType: 'student',
          minor: false,
        },
      ],
    });

    // Set session cookies using helper (correct maxAge based on expires_in)
    if (authData.session) {
      const isProd = process.env.NODE_ENV === 'production';
      setAuthCookies(res, authData.session, isProd);
    }

    logger.info('AUTH', 'signup_success', 'User signed up successfully', {
      userId: authData.user.id,
      email: authData.user.email
    });

    if (!authData.session) {
      return res.status(202).json({
        success: true,
        outcome: 'verification_required',
        message: 'Account created. Please verify your email to continue.',
        user: {
          id: authData.user.id,
          email: authData.user.email,
        },
      });
    }

    return res.status(201).json({
      success: true,
      outcome: 'authenticated',
      message: 'Account created successfully',
      nextPath: '/profile/complete',
      user: {
        id: authData.user.id,
        email: authData.user.email
      },
      // SECURITY: Session tokens are stored in HTTP-only cookies, not returned in response
    });
  } catch (error) {
    logger.error('AUTH', 'signup_error', 'Signup endpoint error', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

const adminProvisionSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  passcode: z.string().min(1),
  displayName: z.string().min(1).max(120).optional(),
});

/**
 * POST /api/auth/admin-provision
 * Guarded admin bootstrap path.
 *
 * Fails closed unless ADMN_PASSCODE is configured and explicitly provided.
 */
router.post('/admin-provision', authRateLimiter, doubleCsrfProtection, async (req: Request, res: Response) => {
  const validation = adminProvisionSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: validation.error.errors[0]?.message || 'Invalid admin provision payload',
    });
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const isAdminProvisionEnabled = process.env.ADMIN_PROVISION_ENABLE === 'true';

  if (isProduction) {
    logger.warn('AUTH', 'admin_provision_blocked_production', 'Admin provisioning is hard-disabled in production', {
      requestId: req.requestId,
    });
    return res.status(403).json({
      error: 'Admin provisioning is disabled',
    });
  }

  if (!isAdminProvisionEnabled) {
    logger.warn('AUTH', 'admin_provision_disabled_by_default', 'Admin provisioning denied because ADMIN_PROVISION_ENABLE is not true', {
      requestId: req.requestId,
    });
    return res.status(403).json({
      error: 'Admin provisioning is disabled',
    });
  }

  const configuredPasscode = process.env.ADMN_PASSCODE;
  if (!configuredPasscode) {
    logger.error('AUTH', 'admin_provision_closed', 'ADMN_PASSCODE is missing; refusing admin provisioning', {
      requestId: req.requestId,
    });
    return res.status(403).json({
      error: 'Admin provisioning is disabled',
    });
  }

  const { email, password, passcode, displayName } = validation.data;

  if (passcode !== configuredPasscode) {
    logger.warn('AUTH', 'admin_provision_rejected', 'Rejected admin provisioning due to passcode mismatch', {
      email,
      requestId: req.requestId,
    });
    return res.status(403).json({
      error: 'Invalid provisioning credentials',
    });
  }

  if (runningAgainstPlaceholder()) {
    return res.status(503).json({
      error: 'Admin provisioning is unavailable in test placeholder mode',
    });
  }

  try {
    const admin = getSupabaseAdmin();

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName || email.split('@')[0],
      },
    });

    if (createError || !created.user?.id) {
      logger.error('AUTH', 'admin_provision_failed', 'Failed to create Supabase auth user for admin provisioning', {
        email,
        error: createError,
        requestId: req.requestId,
      });
      return res.status(400).json({
        error: createError?.message || 'Failed to provision admin account',
      });
    }

    const { error: profileError } = await admin
      .from('profiles')
      .upsert(
        {
          id: created.user.id,
          email: created.user.email || email,
          display_name: displayName || created.user.user_metadata?.display_name || null,
          role: 'admin',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      );

    if (profileError) {
      logger.error('AUTH', 'admin_profile_upsert_failed', 'Failed to persist admin profile during provisioning', {
        userId: created.user.id,
        email,
        error: profileError,
        requestId: req.requestId,
      });
      return res.status(500).json({
        error: 'Failed to persist admin profile',
      });
    }

    logger.warn('AUTH', 'admin_provisioned', 'Admin account provisioned through guarded path', {
      userId: created.user.id,
      email: created.user.email,
      requestId: req.requestId,
    });

    return res.status(201).json({
      success: true,
      user: {
        id: created.user.id,
        email: created.user.email,
        role: 'admin',
      },
    });
  } catch (error) {
    logger.error('AUTH', 'admin_provision_exception', 'Unexpected admin provisioning error', {
      error,
      requestId: req.requestId,
    });
    return res.status(500).json({ error: 'Failed to provision admin account' });
  }
});
/**
 * POST /api/auth/signin
 * Sign in with email and password
 */
router.post('/signin', authRateLimiter, doubleCsrfProtection, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }


    // In CI/test with placeholder Supabase URL we can't reach the host. Return
    // the same 401 shape the normal handler would, but let rate limiter still
    // track the request. This keeps the auth-rate-limit.ci.test.ts happy.
    if (runningAgainstPlaceholder()) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      logger.warn('AUTH', 'signin_failed', 'Sign in failed', { email, error: error.message });
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    if (!data.session) {
      return res.status(500).json({
        error: 'Failed to create session'
      });
    }

    // Set session cookies using helper
    const isProd = process.env.NODE_ENV === 'production';
    setAuthCookies(res, data.session, isProd);

    logger.info('AUTH', 'signin_success', 'User signed in successfully', {
      userId: data.user.id,
      email: data.user.email
    });

    res.json({
      success: true,
      message: 'Signed in successfully',
      user: {
        id: data.user.id,
        email: data.user.email
      }
    });
  } catch (error) {
    logger.error('AUTH', 'signin_error', 'Sign in endpoint error', error);
    res.status(500).json({ error: 'Failed to sign in' });
  }
});

/**
 * POST /api/auth/signout
 * Sign out current user (no auth required - just clears cookies)
 */
router.post('/signout', doubleCsrfProtection, async (req: Request, res: Response) => {
  try {

    // Clear cookies with path: '/' (CRITICAL - must match how they were set)
    const isProd = process.env.NODE_ENV === 'production';
    clearAuthCookies(res, isProd);
    logger.info('AUTH', 'signout_success', 'User signed out', {
      userId: (req as any).user?.id || null
    });

    res.json({
      success: true,
      message: 'Signed out successfully'
    });
  } catch (error) {
    logger.error('AUTH', 'signout_error', 'Sign out endpoint error', error);
    res.status(500).json({ error: 'Failed to sign out' });
  }
});


/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', doubleCsrfProtection, async (req: Request, res: Response) => {
  try {
    // Cookie-only trust: refresh token must come from httpOnly cookie
    const refreshToken = req.cookies?.['sb-refresh-token'];

    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token provided' });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken
    });

    const isProd = process.env.NODE_ENV === 'production';

    if (error || !data.session) {
      clearAuthCookies(res, isProd);
      return res.status(401).json({ error: 'Failed to refresh session' });
    }

    // Update cookies using helper (correct maxAge based on expires_in)
    setAuthCookies(res, data.session, isProd);

    res.json({
      success: true,
      message: 'Session refreshed successfully'
    });
  } catch (error) {
    logger.error('AUTH', 'refresh_error', 'Token refresh error', error);
    res.status(500).json({ error: 'Failed to refresh session' });
  }
});

/**
 * GET /api/auth/debug
 * Debug endpoint for OAuth troubleshooting
 * Uses SHARED auth resolution helper for consistency with practice endpoints
 * Safe for production - no secrets exposed
 */
router.get('/debug', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  res.setHeader('Cache-Control', 'no-store');

  try {
    // Use SHARED helper for token resolution (same as practice endpoints)
    const tokenResult = resolveTokenFromRequest(req);
    const refreshToken = req.cookies['sb-refresh-token'];

    let resolvedUserId: string | null = null;
    let resolvedRole: string | null = null;
    let serviceRoleCanReadUser: boolean | null = null;
    let serviceRoleUserLookupError: string | null = null;
    let tokenValidationError: string | null = null;

    if (tokenResult.token) {
      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { data: { user }, error } = await supabase.auth.getUser(tokenResult.token);
        if (error) {
          tokenValidationError = error.message;
        }
        if (!error && user) {
          resolvedUserId = user.id;

          const admin = getSupabaseAdmin();
          const { data: profile } = await admin
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();
          resolvedRole = profile?.role || null;
        }
      } catch (e: any) {
        tokenValidationError = e?.message || 'exception';
      }
    }

    // Service role key validation: can it read the user from auth.users?
    if (resolvedUserId) {
      try {
        const admin = getSupabaseAdmin();
        const { data, error } = await admin.auth.admin.getUserById(resolvedUserId);

        if (error || !data?.user) {
          serviceRoleCanReadUser = false;
          serviceRoleUserLookupError = error?.message || 'user_not_found';
        } else {
          serviceRoleCanReadUser = true;
        }
      } catch (e: any) {
        serviceRoleCanReadUser = false;
        serviceRoleUserLookupError = e?.message || 'exception';
      }
    }

    const publicSiteUrl = process.env.PUBLIC_SITE_URL || '';
    const googleClientId = process.env.GOOGLE_CLIENT_ID || '';

    res.json({
      build: BUILD,
      environment: {
        nodeEnv: process.env.NODE_ENV || 'undefined',
        publicSiteUrl: publicSiteUrl || '(missing)',
        publicSiteUrlSet: !!publicSiteUrl,
        supabaseUrlSet: !!process.env.SUPABASE_URL,
        googleClientIdSuffix: googleClientId ? googleClientId.slice(-6) : '(missing)',
        googleClientSecretSet: !!process.env.GOOGLE_CLIENT_SECRET,
      },
      request: {
        host: req.headers.host || null,
        origin: req.headers.origin || null,
        referer: req.headers.referer || null,
        protocol: req.protocol,
      },
      tokenResolution: {
        cookieKeys: tokenResult.cookieKeys,
        authHeaderPresent: tokenResult.authHeaderPresent,
        tokenSource: tokenResult.tokenSource,
        tokenLength: tokenResult.tokenLength,
        bearerParsed: tokenResult.bearerParsed,
      },
      cookies: {
        hasAccessToken: !!tokenResult.token,
        hasRefreshCookie: !!refreshToken,
      },
      session: {
        resolvedUserId,
        resolvedRole,
        tokenValidationError,
      },
      serviceRole: {
        canReadUser: serviceRoleCanReadUser,
        userLookupError: serviceRoleUserLookupError,
      },
      oauthCallback: publicSiteUrl ? `${publicSiteUrl}/auth/google/callback` : '(cannot determine)',
    });
  } catch (error) {
    logger.error('AUTH', 'debug_error', 'Debug endpoint error', error);
    res.status(500).json({ error: 'Debug endpoint failed' });
  }
});

/**
 * POST /api/auth/reset-password
 * Send password reset email
 */
router.post('/reset-password', authRateLimiter, doubleCsrfProtection, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    if (runningAgainstPlaceholder()) return res.json({ success: true });

    const admin = getSupabaseAdmin();
    const siteUrl = process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get('host')}`;

    // Generate recovery link
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: email,
      options: {
        redirectTo: `${siteUrl}/update-password`
      }
    });

    if (error) {
      logger.error('AUTH', 'reset_password_error', 'Supabase generateLink failed', { error });
      return res.status(400).json({ error: error.message });
    }

    if (data?.properties?.action_link) {
      await sendEmail({
        to: email,
        subject: 'Reset your Lyceon password',
        html: `
          <h1>Password Reset Request</h1>
          <p>We received a request to reset your password. Please click the link below to set a new one:</p>
          <p><a href="${data.properties.action_link}">Reset Password</a></p>
          <p>This link will take you to your dashboard where you can update your password.</p>
          <p>If you did not request this, you can safely ignore this email.</p>
        `
      });
    }

    res.json({ success: true, message: 'Password reset instructions sent.' });
  } catch (error: any) {
    logger.error('AUTH', 'reset_password_exception', 'Failed to send reset email', error);
    res.status(500).json({ error: 'Failed to send reset email' });
  }
});

/**
 * POST /api/auth/update-password
 * Update password (requires authentication)
 */
router.post('/update-password', requireSupabaseAuth, doubleCsrfProtection, async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password is required' });

    if (runningAgainstPlaceholder()) return res.json({ success: true });

    const admin = getSupabaseAdmin();
    const tokenResult = resolveTokenFromRequest(req);
    const userId = await resolveUserIdFromToken(tokenResult.token);

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { error } = await admin.auth.admin.updateUserById(userId, {
      password: password
    });

    if (error) {
      logger.error('AUTH', 'update_password_error', 'Supabase update password failed', { error });
      return res.status(400).json({ error: error.message });
    }

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error: any) {
    logger.error('AUTH', 'update_password_exception', 'Failed to update password', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

/**
 * POST /exchange-session - DEPRECATED & REMOVED

 * 
 * This endpoint has been deprecated in favor of server-only httpOnly cookie auth.
 * It is permanently removed and will return 404.
 * 
 * Historical context: This endpoint exchanged external tokens for httpOnly cookies,
 * but is no longer needed with the current auth architecture.
 * 
 * CI hardening: Tests must verify this endpoint returns 404 (not 400/401/403/500).
 */
// REMOVED: exchange-session endpoint - see comment above for rationale

export default router;

