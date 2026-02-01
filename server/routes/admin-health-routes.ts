/**
 * Admin Health Routes - Production Readiness Health Checks
 * 
 * Provides a consolidated health check endpoint for admin dashboard
 * Shows system health, database connectivity, Supabase status, Stripe config, and security posture
 * 
 * SECURITY: Admin-only endpoint, no secrets in responses
 */

import { Router, Request, Response } from 'express';
import { testSupabaseHttpConnection, supabaseServer } from '../../apps/api/src/lib/supabase-server';
import { logger } from '../logger.js';

const router = Router();

// Server start time for uptime calculation
const serverStartTime = Date.now();

interface HealthCheck {
  ok: boolean;
  detail?: string;
  status?: 'OK' | 'FAIL' | 'UNKNOWN';
  reason?: string;
}

interface StripeCheck {
  secretKeyConfigured: boolean;
  webhookConfigured: boolean;
}

interface SecurityCheck {
  cookieOnlyAuth: boolean;
  bearerRejected: boolean;
  csrfProduction: boolean;
  canonicalHost: string | { status: 'UNKNOWN'; reason: string };
}

interface VersionInfo {
  sha: string | { status: 'UNKNOWN'; reason: string };
}

interface HealthResponse {
  ok: boolean;
  serverTime: string;
  uptimeSec: number;
  env: string;
  version: VersionInfo;
  checks: {
    db: HealthCheck;
    supabase: HealthCheck;
    stripe: StripeCheck;
    security: SecurityCheck;
  };
}

/**
 * GET /api/admin/health
 * Consolidated health check for production readiness
 * 
 * Returns system health, database connectivity, Supabase status, Stripe config, and security posture
 * Admin-only endpoint, no secrets leaked
 */
router.get('/health', async (req: Request, res: Response) => {
  const now = new Date();
  const uptimeSec = Math.floor((Date.now() - serverStartTime) / 1000);

  // Get environment and version info
  const env = process.env.NODE_ENV || 'development';
  
  // Commit SHA: Try GIT_COMMIT_SHA first (CI/CD standard), then REPLIT_DEPLOYMENT_ID (Replit platform)
  // If neither is available, return structured UNKNOWN status
  const commitSha = process.env.GIT_COMMIT_SHA || process.env.REPLIT_DEPLOYMENT_ID;
  const versionInfo: VersionInfo = commitSha 
    ? { sha: commitSha }
    : { sha: { status: 'UNKNOWN', reason: 'GIT_COMMIT_SHA and REPLIT_DEPLOYMENT_ID not set in environment' } };

  // Canonical host: Extract from PUBLIC_SITE_URL or return structured UNKNOWN
  const canonicalHost: string | { status: 'UNKNOWN'; reason: string } = process.env.PUBLIC_SITE_URL 
    ? new URL(process.env.PUBLIC_SITE_URL).hostname 
    : { status: 'UNKNOWN', reason: 'PUBLIC_SITE_URL not configured' };

  // Initialize response
  const response: HealthResponse = {
    ok: true,
    serverTime: now.toISOString(),
    uptimeSec,
    env,
    version: versionInfo,
    checks: {
      db: { ok: false, status: 'UNKNOWN', detail: 'check not yet performed', reason: 'Health check in progress' },
      supabase: { ok: false, status: 'UNKNOWN', detail: 'check not yet performed', reason: 'Health check in progress' },
      stripe: {
        secretKeyConfigured: false,
        webhookConfigured: false,
      },
      security: {
        // These are architectural invariants enforced by middleware
        // If implementation changes, these must be updated
        cookieOnlyAuth: true,  // Enforced in resolveTokenFromRequest (server/middleware/supabase-auth.ts)
        bearerRejected: true,  // Bearer tokens rejected for user auth routes
        csrfProduction: env === 'production',  // CSRF enabled in production via csrfGuard middleware
        canonicalHost,
      },
    },
  };

  try {
    // 1. Database health check
    try {
      const dbOk = await testSupabaseHttpConnection();
      response.checks.db = {
        ok: dbOk,
        status: dbOk ? 'OK' : 'FAIL',
        detail: dbOk ? 'connected' : 'connection failed',
      };
      if (!dbOk) {
        response.ok = false;
      }
    } catch (dbError: any) {
      logger.error('ADMIN_HEALTH', 'db_check', 'Database health check failed', dbError);
      response.checks.db = {
        ok: false,
        status: 'FAIL',
        detail: 'error during check',
        reason: dbError?.message || 'Unknown error during database connectivity test',
      };
      response.ok = false;
    }

    // 2. Supabase health check
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !supabaseServiceKey) {
        response.checks.supabase = {
          ok: false,
          status: 'UNKNOWN',
          detail: 'credentials not configured',
          reason: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in environment',
        };
        response.ok = false;
      } else {
        // Try a simple query to verify connectivity
        const { error } = await supabaseServer
          .from('questions')
          .select('id', { count: 'exact', head: true })
          .limit(0);

        if (error) {
          response.checks.supabase = {
            ok: false,
            status: 'FAIL',
            detail: 'query failed',
            reason: error.message || 'Failed to query Supabase questions table',
          };
          response.ok = false;
        } else {
          response.checks.supabase = {
            ok: true,
            status: 'OK',
            detail: 'reachable',
          };
        }
      }
    } catch (supabaseError: any) {
      logger.error('ADMIN_HEALTH', 'supabase_check', 'Supabase health check failed', supabaseError);
      response.checks.supabase = {
        ok: false,
        status: 'FAIL',
        detail: 'error during check',
        reason: supabaseError?.message || 'Unknown error during Supabase connectivity test',
      };
      response.ok = false;
    }

    // 3. Stripe configuration check (presence only, no values)
    // These are real checks of environment variables, not derived or placeholder
    response.checks.stripe = {
      secretKeyConfigured: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.length > 0),
      webhookConfigured: !!(process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_WEBHOOK_SECRET.length > 0),
    };

    // 4. Security posture snapshot
    // Note: cookieOnlyAuth and bearerRejected are architectural invariants
    // They are enforced by middleware code, not configuration
    // If middleware implementation changes, these must be updated
    response.checks.security = {
      // Cookie-only auth is enforced in middleware (resolveTokenFromRequest rejects Bearer)
      cookieOnlyAuth: true,
      // Bearer tokens are rejected for user routes (architectural decision in middleware)
      bearerRejected: true,
      // CSRF is enabled in production (csrfGuard middleware)
      csrfProduction: env === 'production',
      // Canonical host enforcement (check if PUBLIC_SITE_URL is set)
      canonicalHost,
    };

    res.json(response);
  } catch (error: any) {
    logger.error('ADMIN_HEALTH', 'health_check', 'Health check failed', error);
    res.status(500).json({
      ...response,
      ok: false,
      error: 'Health check encountered an error',
    });
  }
});

export default router;
