import { supabaseServer } from '../../apps/api/src/lib/supabase-server';
import { logger } from '../logger';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export async function checkRateLimit(
  key: string,
  maxAttempts: number = 10,
  windowMs: number = 15 * 60 * 1000,
  requestId?: string
): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - windowMs);
  
  try {
    const { count, error } = await supabaseServer
      .from('guardian_link_audit')
      .select('*', { count: 'exact', head: true })
      .eq('guardian_profile_id', key)
      .gte('occurred_at', windowStart.toISOString());
    
    if (error) {
      logger.error('RATE_LIMIT', 'check', 'Failed to check rate limit - table may be missing, failing closed', { 
        error, 
        key,
        request_id: requestId 
      });
      throw new Error(`Rate limit check failed: ${error.message}. Ensure guardian_link_audit table exists.`);
    }
    
    const currentCount = count || 0;
    const allowed = currentCount < maxAttempts;
    const remaining = Math.max(0, maxAttempts - currentCount);
    const resetAt = new Date(Date.now() + windowMs);
    
    if (!allowed) {
      logger.warn('RATE_LIMIT', 'exceeded', 'Rate limit exceeded for guardian', {
        key,
        currentCount,
        maxAttempts,
        request_id: requestId
      });
      
      const { error: insertError } = await supabaseServer.from('guardian_link_audit').insert({
        guardian_profile_id: key,
        student_profile_id: null,
        action: 'link_attempt',
        outcome: 'rate_limited',
        student_code_prefix: null,
        request_id: requestId || null,
        metadata: {
          source: 'durable-rate-limiter',
          windowStart: windowStart.toISOString(),
          windowMs,
          maxAttempts,
          currentCount,
        },
      });
      
      if (insertError) {
        logger.error('RATE_LIMIT', 'audit_insert', 'Failed to insert rate limit audit - failing closed', {
          error: insertError,
          key,
          request_id: requestId,
        });
        throw new Error(`Rate limit audit insert failed: ${insertError.message}`);
      }
    }
    
    return { allowed, remaining, resetAt };
  } catch (err) {
    logger.error('RATE_LIMIT', 'error', 'Rate limit check failed - failing closed', { 
      err, 
      key,
      request_id: requestId 
    });
    throw err;
  }
}

export function createDurableRateLimiter(maxAttempts: number = 10, windowMs: number = 15 * 60 * 1000) {
  return async function durableRateLimiterMiddleware(
    req: any,
    res: any,
    next: any
  ) {
    const key = req.user?.id;
    
    if (!key) {
      return next();
    }
    
    const requestId = req.requestId || req.headers['x-request-id'];
    
    try {
      const result = await checkRateLimit(key, maxAttempts, windowMs, requestId);
      
      res.setHeader('X-RateLimit-Limit', maxAttempts);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', result.resetAt.toISOString());
      
      if (!result.allowed) {
        return res.status(429).json({
          error: 'Too many link attempts. Please try again later.',
          retryAfter: Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
          requestId
        });
      }
      
      next();
    } catch (err) {
      logger.error('RATE_LIMIT', 'middleware', 'Rate limit infrastructure failure - blocking request', {
        err,
        key,
        request_id: requestId
      });
      return res.status(500).json({
        error: 'Rate limit check failed. Please contact support if this persists.',
        requestId
      });
    }
  };
}
