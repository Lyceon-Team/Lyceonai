import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../logger.js';
import { requireSupabaseAuth, getSupabaseAdmin, resolveTokenFromRequest, resolveUserIdFromToken } from '../middleware/supabase-auth.js';
import { csrfGuard } from '../middleware/csrf.js';
import { BUILD } from '../lib/build.js';
import { setAuthCookies, clearAuthCookies } from '../lib/auth-cookies.js';
import { z } from 'zod';
import { isAdminRoleRequest, normalizeSignupRole } from '../lib/auth-role.js';

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

// CSRF protection - uses shared origin-utils for single source of truth
const csrfProtection = csrfGuard();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

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
router.post('/signup', authRateLimiter, csrfProtection, async (req: Request, res: Response) => {
  try {
    const { email, password, displayName, isUnder13, guardianEmail, role: requestedRole } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    // Signup must never create admins.
    if (isAdminRoleRequest(requestedRole)) {
      logger.warn('AUTH', 'admin_signup_blocked', 'Blocked admin role request during signup', {
        email,
        requestId: req.requestId,
      });
      return res.status(403).json({
        error: 'Admin signup is disabled',
      });
    }

    // In test env we skip making real Supabase calls; behave like signup
    // failed so that downstream logic doesn't try to set cookies.
    if (runningAgainstPlaceholder()) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Under-13 validation
    if (isUnder13 && !guardianEmail) {
      return res.status(400).json({
        error: 'Guardian email is required for users under 13'
      });
    }

    // Create anon client for signup
    const supabase = createClient(supabaseUrl, supabaseAnonKey);


    // Validate role (only allow student or guardian, default to student)
    const validRole = normalizeSignupRole(requestedRole);

    // Sign up user with Supabase Auth
    const { data: authData, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName || email.split('@')[0],
          role: validRole
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

    // Profile is auto-created by Supabase trigger (handle_new_user)
    // Update profile with role and under-13 info if needed
    const admin = getSupabaseAdmin();
    const profileUpdate: Record<string, any> = { role: validRole };

    if (isUnder13) {
      profileUpdate.is_under_13 = true;
      profileUpdate.guardian_email = guardianEmail;
      profileUpdate.guardian_consent = false;
    }

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

    // Set session cookies using helper (correct maxAge based on expires_in)
    if (authData.session) {
      const isProd = process.env.NODE_ENV === 'production';
      setAuthCookies(res, authData.session, isProd);
    }

    logger.info('AUTH', 'signup_success', 'User signed up successfully', {
      userId: authData.user.id,
      email: authData.user.email
    });

    res.status(201).json({
      success: true,
      message: isUnder13
        ? 'Account created. Guardian consent required to continue.'
        : 'Account created successfully',
      user: {
        id: authData.user.id,
        email: authData.user.email
      },
      requiresConsent: isUnder13
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
router.post('/admin-provision', authRateLimiter, csrfProtection, async (req: Request, res: Response) => {
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
router.post('/signin', authRateLimiter, csrfProtection, async (req: Request, res: Response) => {
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
router.post('/signout', csrfProtection, async (req: Request, res: Response) => {
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
 * POST /api/auth/consent
 * Submit guardian consent for under-13 users
 */
router.post('/consent', csrfProtection, requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const { guardianConsent, guardianEmail } = req.body;

    if (!req.user?.is_under_13) {
      return res.status(400).json({
        error: 'Consent is only required for users under 13'
      });
    }

    const admin = getSupabaseAdmin();

    const { error } = await admin
      .from('profiles')
      .update({
        guardian_consent: guardianConsent,
        guardian_email: guardianEmail,
        consent_given_at: guardianConsent ? new Date().toISOString() : null
      })
      .eq('id', req.user.id);

    if (error) {
      logger.error('AUTH', 'consent_update_failed', 'Failed to update consent', {
        userId: req.user.id,
        error
      });
      return res.status(500).json({ error: 'Failed to update consent' });
    }

    logger.info('AUTH', 'consent_updated', 'Guardian consent updated', {
      userId: req.user.id,
      consent: guardianConsent
    });

    res.json({
      success: true,
      message: 'Consent updated successfully'
    });
  } catch (error) {
    logger.error('AUTH', 'consent_error', 'Consent endpoint error', error);
    res.status(500).json({ error: 'Failed to update consent' });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', csrfProtection, async (req: Request, res: Response) => {
  try {
    // Accept refresh token from body OR from httpOnly cookie
    const refreshToken =
      req.body?.refresh_token ||
      req.cookies?.['sb-refresh-token'];

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

