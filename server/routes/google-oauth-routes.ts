/**
 * Google OAuth Routes - Direct OAuth flow via Supabase signInWithIdToken
 * 
 * Required environment variables:
 *   - PUBLIC_SITE_URL: Main app URL (e.g., https://lyceon.ai) - SINGLE SOURCE OF TRUTH
 *   - GOOGLE_CLIENT_ID: Google OAuth client ID
 *   - GOOGLE_CLIENT_SECRET: Google OAuth client secret
 *   - SUPABASE_URL: Supabase project URL
 *   - SUPABASE_ANON_KEY: Supabase anon/public key
 * 
 * Flow:
 *   1. User clicks "Sign in with Google" on lyceon.ai
 *   2. Browser calls /api/auth/google/start (same origin)
 *   3. Server redirects to Google with state cookie
 *   4. Google redirects back to /auth/google/callback
 *   5. Server exchanges code for id_token, signs into Supabase
 *   6. Server sets session cookies and redirects to /dashboard
 * 
 * Google Console must have this exact redirect URI:
 *   https://lyceon.ai/auth/google/callback
 */

import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { logger } from '../logger.js';
import { BUILD } from '../lib/build.js';
import { setAuthCookies } from '../lib/auth-cookies.js';
import { getSupabaseAdmin } from '../middleware/supabase-auth.js';
import { ensureProfileForAuthUser } from '../lib/profile-bootstrap.js';

const router = Router();


/**
 * Detect if running in test environment
 */
function isTestEnvironment(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

// Lazy validation wrapper for required env vars
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value && !isTestEnvironment()) {
    throw new Error(`${key} must be set in production/development`);
  }
  return value || '';
}

// Google OAuth credentials - empty strings allowed in test env only
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

// Supabase credentials - lazy validation on first use
let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';

function getSupabaseUrl(): string {
  if (!SUPABASE_URL) {
    SUPABASE_URL = requireEnv('SUPABASE_URL');
  }
  return SUPABASE_URL;
}

function getSupabaseAnonKey(): string {
  if (!SUPABASE_ANON_KEY) {
    SUPABASE_ANON_KEY = requireEnv('SUPABASE_ANON_KEY');
  }
  return SUPABASE_ANON_KEY;
}

const isProduction = process.env.NODE_ENV === 'production';

function getSiteUrl(): string {
  const raw = process.env.PUBLIC_SITE_URL || '';
  return raw.replace(/\/$/, '');
}

function getRedirectUri(): string {
  const siteUrl = getSiteUrl();
  return `${siteUrl}/auth/google/callback`;
}

const STATE_COOKIE_NAME = 'google_oauth_state';
const STATE_COOKIE_MAX_AGE = 10 * 60 * 1000; // 10 minutes


function clientIdFingerprint(id: string) {
  // format: <numeric-prefix>-<alphanumeric-hash>.apps.googleusercontent.com
  const [prefix = "", rest = ""] = id.split("-", 2);
  const middle = rest.split(".apps.googleusercontent.com")[0] || rest;
  return {
    clientIdPrefix: prefix.slice(0, 6) + "…" + prefix.slice(-4),
    clientIdMiddle: middle.slice(0, 6) + "…" + middle.slice(-6),
  };
}

router.get("/debug", (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  res.setHeader("Cache-Control", "no-store");
  const siteUrl = getSiteUrl();
  const redirectUri = getRedirectUri();
  const fp = clientIdFingerprint(GOOGLE_CLIENT_ID);
  
  if (!siteUrl) {
    return res.status(500).json({
      error: 'PUBLIC_SITE_URL is missing or empty',
      build: BUILD,
      siteUrl: '',
      redirectUri: '',
      ...fp,
      clientSecretSet: false,
      supabaseUrlSet: false,
      nodeEnv: process.env.NODE_ENV || 'undefined'
    });
  }
  
  res.json({
    build: BUILD,
    siteUrl,
    redirectUri,
    ...fp,
    clientSecretSet: !!GOOGLE_CLIENT_SECRET,
    supabaseUrlSet: !!process.env.SUPABASE_URL,
    nodeEnv: process.env.NODE_ENV || 'undefined'
  });
});

router.get('/start', (req: Request, res: Response) => {
  const siteUrl = getSiteUrl();
  const redirectUri = getRedirectUri();
  
  const clientIdSuffix = GOOGLE_CLIENT_ID ? GOOGLE_CLIENT_ID.slice(-6) : 'missing';
  console.log(`[google-oauth] build=${BUILD} redirect_uri=${redirectUri} client_id_suffix=${clientIdSuffix}`);
  logger.info('GOOGLE_OAUTH', 'start', 'Starting Google OAuth flow', { redirectUri });
  
  if (!siteUrl) {
    logger.error('GOOGLE_OAUTH', 'config_missing', 'PUBLIC_SITE_URL is missing');
    return res.status(500).send('Server configuration error: PUBLIC_SITE_URL is missing');
  }
  
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    logger.error('GOOGLE_OAUTH', 'config_missing', 'Google OAuth credentials not configured');
    return res.redirect(`${siteUrl}/login?error=oauth_not_configured`);
  }

  const state = crypto.randomBytes(32).toString('hex');

  res.cookie(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    ...(isProduction && { domain: '.lyceon.ai' }),
    maxAge: STATE_COOKIE_MAX_AGE,
  });


  const params = new URLSearchParams({
    response_type: 'code',
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true'
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  
  res.redirect(302, googleAuthUrl);
});

export async function googleCallbackHandler(req: Request, res: Response) {
  const siteUrl = getSiteUrl();
  const redirectUri = getRedirectUri();
  const { code, state, error: oauthError } = req.query;
  const storedState = req.cookies[STATE_COOKIE_NAME];

  // Clear both host-only and domain-scoped variants to avoid stale state issues across www/apex
  res.clearCookie(STATE_COOKIE_NAME, { path: '/' });
  if (isProduction) {
    res.clearCookie(STATE_COOKIE_NAME, { path: '/', domain: '.lyceon.ai' } as any);
    res.clearCookie(STATE_COOKIE_NAME, { path: '/', domain: 'lyceon.ai' } as any);
  }


  if (!siteUrl) {
    return res.status(500).send('Server configuration error: PUBLIC_SITE_URL is missing');
  }

  if (oauthError) {
    logger.error('GOOGLE_OAUTH', 'callback_error', 'OAuth error from Google', { 
      error: oauthError 
    });
    return res.redirect(`${siteUrl}/login?error=google_oauth_failed`);
  }

  if (!code || typeof code !== 'string') {
    logger.error('GOOGLE_OAUTH', 'no_code', 'No authorization code received');
    return res.redirect(`${siteUrl}/login?error=google_oauth_failed`);
  }

  if (!state || state !== storedState) {
    logger.error('GOOGLE_OAUTH', 'state_mismatch', 'OAuth state mismatch', {
      hasState: !!state,
      hasStoredState: !!storedState
    });
    return res.redirect(`${siteUrl}/login?error=oauth_state`);
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      logger.error('GOOGLE_OAUTH', 'token_exchange_failed', 'Failed to exchange code for tokens', { 
        status: tokenResponse.status,
        error: errorText
      });
      return res.redirect(`${siteUrl}/login?error=google_oauth_failed`);
    }

    const tokenData = await tokenResponse.json() as {
      id_token?: string;
      access_token?: string;
      refresh_token?: string;
    };

    if (!tokenData.id_token) {
      logger.error('GOOGLE_OAUTH', 'no_id_token', 'No id_token in token response');
      return res.redirect(`${siteUrl}/login?error=google_oauth_failed`);
    }

    const supabase = createClient(getSupabaseUrl(), getSupabaseAnonKey());
    
    const { data, error: supabaseError } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: tokenData.id_token
    });

    if (supabaseError || !data.session || !data.user) {
      logger.error('GOOGLE_OAUTH', 'supabase_signin_failed', 'Failed to sign in with Supabase', { 
        error: supabaseError?.message 
      });
      return res.redirect(`${siteUrl}/login?error=supabase_id_token`);
    }

    setAuthCookies(res, data.session, isProduction);

    const userId = data.user.id;
    const userEmail = data.user.email || userId;
    
    let redirectPath = '/dashboard';
    
    try {
      const profile = await ensureProfileForAuthUser(getSupabaseAdmin(), data.user, {
        source: 'google_oauth_callback',
        requestId: req.requestId,
      });

      if (profile.role === 'guardian') {
        redirectPath = '/guardian';
        logger.info('GOOGLE_OAUTH', 'role_detected', 'Guardian role detected, redirecting to /guardian', { userId });
      } else {
        logger.info('GOOGLE_OAUTH', 'role_detected', 'Student/default role, redirecting to /dashboard', { userId, role: profile.role });
      }
    } catch (profileErr) {
      logger.warn('GOOGLE_OAUTH', 'profile_fetch_failed', 'Could not bootstrap profile for role, defaulting to /dashboard', {
        userId,
        error: profileErr,
      });
    }
    
    console.log(`[GOOGLE OAUTH] success user=${userEmail} redirecting to ${redirectPath}`);
    logger.info('GOOGLE_OAUTH', 'success', 'Google OAuth successful', { 
      user: userEmail,
      redirectPath
    });

    res.redirect(`${siteUrl}${redirectPath}`);
  } catch (err) {
    logger.error('GOOGLE_OAUTH', 'callback_exception', 'Exception in OAuth callback', err);
    return res.redirect(`${siteUrl}/login?error=google_oauth_failed`);
  }
}

export default router;

