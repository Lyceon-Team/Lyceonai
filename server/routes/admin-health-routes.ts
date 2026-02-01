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
}

interface StripeCheck {
  secretKeyConfigured: boolean;
  webhookConfigured: boolean;
}

interface SecurityCheck {
  cookieOnlyAuth: boolean;
  bearerRejected: boolean;
  csrfProduction: boolean;
  canonicalHost: string;
}

interface HealthResponse {
  ok: boolean;
  serverTime: string;
  uptimeSec: number;
  env: string;
  version: {
    sha: string;
  };
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
  const commitSha = process.env.GIT_COMMIT_SHA || process.env.REPLIT_DEPLOYMENT_ID || 'unknown';

  // Initialize response
  const response: HealthResponse = {
    ok: true,
    serverTime: now.toISOString(),
    uptimeSec,
    env,
    version: {
      sha: commitSha,
    },
    checks: {
      db: { ok: false, detail: 'not checked' },
      supabase: { ok: false, detail: 'not checked' },
      stripe: {
        secretKeyConfigured: false,
        webhookConfigured: false,
      },
      security: {
        cookieOnlyAuth: true,
        bearerRejected: true,
        csrfProduction: env === 'production',
        canonicalHost: 'unknown',
      },
    },
  };

  try {
    // 1. Database health check
    try {
      const dbOk = await testSupabaseHttpConnection();
      response.checks.db = {
        ok: dbOk,
        detail: dbOk ? 'connected' : 'connection failed',
      };
      if (!dbOk) {
        response.ok = false;
      }
    } catch (dbError: any) {
      logger.error('ADMIN_HEALTH', 'db_check', 'Database health check failed', dbError);
      response.checks.db = {
        ok: false,
        detail: 'error during check',
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
          detail: 'credentials not configured',
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
            detail: 'query failed',
          };
          response.ok = false;
        } else {
          response.checks.supabase = {
            ok: true,
            detail: 'reachable',
          };
        }
      }
    } catch (supabaseError: any) {
      logger.error('ADMIN_HEALTH', 'supabase_check', 'Supabase health check failed', supabaseError);
      response.checks.supabase = {
        ok: false,
        detail: 'error during check',
      };
      response.ok = false;
    }

    // 3. Stripe configuration check (presence only, no values)
    response.checks.stripe = {
      secretKeyConfigured: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.length > 0),
      webhookConfigured: !!(process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_WEBHOOK_SECRET.length > 0),
    };

    // 4. Security posture snapshot
    // These are architectural facts about the server configuration
    response.checks.security = {
      // Cookie-only auth is enforced in middleware (resolveTokenFromRequest rejects Bearer)
      cookieOnlyAuth: true,
      // Bearer tokens are rejected for user routes (architectural decision)
      bearerRejected: true,
      // CSRF is enabled in production (csrfGuard middleware)
      csrfProduction: env === 'production',
      // Canonical host enforcement (check if PUBLIC_SITE_URL is set)
      canonicalHost: process.env.PUBLIC_SITE_URL ? new URL(process.env.PUBLIC_SITE_URL).hostname : 'PUBLIC_SITE_URL not set',
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
