import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../logger.js';
import { requireSupabaseAuth, getSupabaseAdmin, resolveTokenFromRequest, resolveUserIdFromToken } from '../middleware/supabase-auth.js';
import { csrfGuard } from '../middleware/csrf.js';
import { BUILD } from '../lib/build.js';
import { clearAuthCookies } from '../lib/auth-cookies.js';

const router = Router();

// CSRF protection - uses shared origin-utils for single source of truth
const csrfProtection = csrfGuard();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

/**
 * Shared cookie helpers - CRITICAL: Always use path: '/' to ensure cookies
 * are sent to all routes, not just the route that set them.
 */
function setAuthCookies(res: any, session: any, isProd: boolean) {
  clearAuthCookies(res, isProd);
  const accessMaxAgeMs =
    typeof session?.expires_in === 'number'
      ? session.expires_in * 1000
      : 60 * 60 * 1000; // fallback 1h (JWT default)

  const refreshMaxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days

  const base = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/', // CRITICAL - ensures cookies sent to all routes
    ...(isProd && { domain: '.lyceon.ai' })
  };

  res.cookie('sb-access-token', session.access_token, {
    ...base,
    maxAge: accessMaxAgeMs,
  });

  res.cookie('sb-refresh-token', session.refresh_token, {
    ...base,
    maxAge: refreshMaxAgeMs,
  });
}


/**
 * LEGACY COOKIE CLEANUP - Delete any stale auth cookies that might interfere
 * This middleware runs on auth routes to ensure clean state
 * 
 * ALLOWED COOKIES: sb-access-token, sb-refresh-token, sidebar:state, google_oauth_state
 * All other auth-like cookies are deleted
 * 
 * KEEP THIS FOR 7 DAYS AFTER DEPLOY TO FLUSH LEGACY COOKIES
 */
const ALLOWED_COOKIES = new Set([
  'sb-access-token',
  'sb-refresh-token', 
  'sidebar:state',      // UI state, not auth
  'google_oauth_state', // OAuth flow, temporary
  'csrf-token',         // CSRF protection, must not be deleted!
]);

const LEGACY_AUTH_PATTERNS = [
  'access-token',
  'auth-token', 
  'session',
  'token',
  'guardian',
  'role',
  'user',
];

function clearLegacyCookies(req: any, res: any, isProd: boolean) {
  const cookies = req.cookies || {};
  const cookieNames = Object.keys(cookies);
  
  for (const name of cookieNames) {
    // Special-case: allow current sb-* cookies, but always clear any legacy '/api' path variants
    // without touching the canonical '/' cookie.
    if (name === 'sb-access-token' || name === 'sb-refresh-token') {
      const deleteApiPathOptions: any[] = [
        { path: '/api', httpOnly: true, secure: isProd, sameSite: 'lax' as const },
      ];

      if (isProd) {
        deleteApiPathOptions.push(
          { path: '/api', httpOnly: true, secure: true, sameSite: 'lax' as const, domain: 'lyceon.ai' } as any,
          { path: '/api', httpOnly: true, secure: true, sameSite: 'lax' as const, domain: '.lyceon.ai' } as any,
        );
      }

      for (const opts of deleteApiPathOptions) {
        res.clearCookie(name, opts);
      }

      // Continue normal loop; do NOT delete the canonical '/' cookie here.
      continue;
    }

    // Skip allowed cookies
    if (ALLOWED_COOKIES.has(name)) continue;
    
    // Check if cookie name matches legacy auth patterns
    const lowerName = name.toLowerCase();
    const isLegacyAuth = LEGACY_AUTH_PATTERNS.some(pattern => 
      lowerName.includes(pattern)
    );
    
    // Also delete any sb-* cookies that aren't our exact allowed ones
    const isUnknownSbCookie = lowerName.startsWith('sb-') && !ALLOWED_COOKIES.has(name);
    
    if (isLegacyAuth || isUnknownSbCookie) {
      // Delete with multiple path/domain combinations to ensure cleanup
      const deleteOptions = [
        { path: '/', httpOnly: true, secure: isProd, sameSite: 'lax' as const },
        { path: '/api', httpOnly: true, secure: isProd, sameSite: 'lax' as const },
      ];
      
      // In production, also delete from both domain variants
      if (isProd) {
        deleteOptions.push(
          { path: '/', httpOnly: true, secure: true, sameSite: 'lax' as const, domain: 'lyceon.ai' } as any,
          { path: '/', httpOnly: true, secure: true, sameSite: 'lax' as const, domain: '.lyceon.ai' } as any,
        );
      }
      
      for (const opts of deleteOptions) {
        res.clearCookie(name, opts);
      }
      
      logger.info('AUTH', 'legacy_cookie_cleared', `Cleared legacy cookie: ${name}`, {});
    }
  }
}

/**
 * POST /api/auth/signup
 * Sign up with email and password
 */
router.post('/signup', csrfProtection, async (req: Request, res: Response) => {
  try {
    const { email, password, displayName, isUnder13, guardianEmail, role: requestedRole } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required' 
      });
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
    const validRole = requestedRole === 'guardian' ? 'guardian' : 'student';

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

/**
 * POST /api/auth/signin
 * Sign in with email and password
 */
router.post('/signin', csrfProtection, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required' 
      });
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
      userId: req.user?.id
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
 * GET /api/auth/user
 * Get current authenticated user
 * Returns 200 with {user: null} for anonymous requests
 */
router.get('/user', async (req: Request, res: Response) => {
  const isProd = process.env.NODE_ENV === 'production';
  
  // PHASE 1: Clean up any legacy cookies on every /user request
  clearLegacyCookies(req, res, isProd);
  
  try {
    const token = req.cookies['sb-access-token'];

    if (!token) {
      // Return 200 with null user for anonymous requests
      return res.status(200).json({ user: null });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      // Try to refresh if we have a refresh token
      const refreshToken = req.cookies?.['sb-refresh-token'];
      const hint = (authError as any)?.message || '';
      
      const shouldTryRefresh =
        refreshToken &&
        (hint.includes('JWT expired') ||
         hint.toLowerCase().includes('invalid') ||
         hint.toLowerCase().includes('expired'));

      if (shouldTryRefresh) {
        logger.info('AUTH', 'auto_refresh', 'Attempting automatic token refresh', {});
        
        const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession({
          refresh_token: refreshToken,
        });

        if (!refreshErr && refreshed?.session) {
          setAuthCookies(res, refreshed.session, isProd);

          const { data: userAgain, error: userAgainErr } = await supabase.auth.getUser(
            refreshed.session.access_token
          );

          if (!userAgainErr && userAgain?.user) {
            logger.info('AUTH', 'auto_refresh_success', 'Token refreshed successfully', { userId: userAgain.user.id });
            
            // Continue with the refreshed user - fall through to profile fetch below
            // by reassigning to a mutable binding
            return handleUserFetch(req, res, userAgain.user, refreshed.session.access_token, isProd);
          }
        }

        // Refresh failed - clear cookies and return 401
        logger.warn('AUTH', 'auto_refresh_failed', 'Token refresh failed', {});
        clearAuthCookies(res, isProd);
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      // No refresh token available - clear and return 401
      clearAuthCookies(res, isProd);
      const requestId = crypto.randomUUID().slice(0, 8);
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        requestId,
        hint: 'Access token invalid and no refresh token available.'
      });
    }
    
    return handleUserFetch(req, res, user, token, isProd);
  } catch (error) {
    logger.error('AUTH', 'get_user_error', 'Get user endpoint error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function handleUserFetch(req: Request, res: Response, user: any, token: string, isProd: boolean) {
  try {

    // Fetch profile using anon client with user's JWT (RLS enforced)
    // Create client with user's token so RLS policies can see auth.uid()
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });
    
    let { data: profile, error: profileError } = await userSupabase
      .from('profiles')
      .select('id, email, display_name, role, is_under_13, guardian_consent, student_link_code, first_name, last_name, profile_completed_at')
      .eq('id', user.id)
      .single();

    if (profileError) {
      logger.error('AUTH', 'profile_fetch', 'Failed to fetch user profile', { 
        userId: user.id, 
        error: profileError 
      });
    }

    // Handle missing profile gracefully - auto-create if needed
    if (!profile) {
      logger.warn('AUTH', 'profile_missing', 'User has no profile row - creating one', { userId: user.id });
      
      // Auto-create profile (should have been created by trigger, but handle edge case)
      const admin = getSupabaseAdmin();
      const { data: newProfile, error: createError } = await admin
        .from('profiles')
        .insert({
          id: user.id,
          email: user.email,
          display_name: user.user_metadata?.display_name || user.email!.split('@')[0],
          role: user.user_metadata?.role || 'student'
        })
        .select('id, email, display_name, role, is_under_13, guardian_consent, student_link_code, first_name, last_name, profile_completed_at')
        .single();
      
      if (createError || !newProfile) {
        logger.error('AUTH', 'profile_creation_failed', 'Failed to auto-create profile', { 
          userId: user.id, 
          error: createError 
        });
        return res.status(500).json({ error: 'Profile initialization failed' });
      }
      
      profile = newProfile;
    }

    const rawDisplayName = profile.display_name;
    const fallbackUsername = profile.email ? profile.email.split('@')[0] : null;
    
    const normalizedName = rawDisplayName || fallbackUsername || 'Student';
    const normalizedUsername = fallbackUsername || null;

    res.json({
      authenticated: true,
      user: {
        id: profile.id,
        email: profile.email,
        display_name: profile.display_name,
        name: normalizedName,
        username: normalizedUsername,
        firstName: profile.first_name || null,
        lastName: profile.last_name || null,
        profileCompletedAt: profile.profile_completed_at || null,
        lastLoginAt: null,
        role: profile.role,
        isAdmin: profile.role === 'admin',
        isGuardian: profile.role === 'guardian',
        is_under_13: profile.is_under_13,
        guardian_consent: profile.guardian_consent,
        student_link_code: profile.student_link_code
      }
    });
  } catch (error) {
    logger.error('AUTH', 'handleUserFetch_error', 'Handle user fetch error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

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
 * POST /api/auth/exchange-session
 * Exchange tokens for a session (set httpOnly cookies)
 * CSRF_EXEMPT_REASON: Programmatic token exchange for mobile/API clients - uses Bearer tokens not cookies
 */
router.post('/exchange-session', async (req: Request, res: Response) => {
  try {
    const { access_token, refresh_token } = req.body;

    if (!access_token || !refresh_token) {
      return res.status(400).json({ error: 'Missing access_token or refresh_token' });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    // Verify the access token is valid
    const { data: { user }, error: authError } = await supabase.auth.getUser(access_token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid tokens' });
    }

    const isProd = process.env.NODE_ENV === 'production';
    
    // Set session cookies
    setAuthCookies(res, {
      access_token,
      refresh_token,
      expires_in: 3600 // Default to 1 hour
    }, isProd);

    res.json({
      success: true,
      message: 'Session established successfully'
    });
  } catch (error) {
    logger.error('AUTH', 'exchange_session_error', 'Session exchange error', error);
    res.status(500).json({ error: 'Failed to exchange session' });
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

export default router;
