import { Request, Response, NextFunction } from 'express';
import { checkUsageLimit, incrementUsage, FREE_TIER_LIMITS, getAccountIdForUser, ensureAccountForUser } from '../lib/account';
import { getSupabaseAdmin } from './supabase-auth';
import { logger } from '../logger';

export function createUsageLimitMiddleware(limitType: 'practice' | 'ai_chat', opts?: { increment?: boolean }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.requestId;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!userId) {
      return next();
    }

    try {
      let accountId = await getAccountIdForUser(userId);
      
      if (!accountId && userRole && (userRole === 'student' || userRole === 'guardian')) {
        const supabaseAdmin = getSupabaseAdmin();
        accountId = await ensureAccountForUser(supabaseAdmin, userId, userRole);
      }

      if (!accountId) {
        logger.warn('USAGE', 'no_account', 'No account found for user', { userId, requestId });
        return next();
      }

      const check = await checkUsageLimit(accountId, limitType);

      if (!check.allowed) {
        logger.warn('USAGE', 'limit_reached', `${limitType} limit reached`, {
          userId,
          accountId,
          current: check.current,
          limit: check.limit,
          resetAt: check.resetAt,
          requestId,
        });

        return res.status(402).json({
          error: 'Usage limit reached',
          code: 'LIMIT_REACHED',
          limitType,
          current: check.current,
          limit: check.limit,
          resetAt: check.resetAt,
          message: `You've reached your daily ${limitType === 'practice' ? 'practice question' : 'AI chat'} limit. Upgrade to unlock unlimited access.`,
          requestId,
        });
      }

      if (opts?.increment !== false) {
        await incrementUsage(accountId, limitType);
      }

      next();
    } catch (err: any) {
      logger.error('USAGE', 'limit_check', 'Failed to check usage limit', { 
        err: err.message, 
        userId, 
        limitType,
        requestId 
      });
      next();
    }
  };
}

export function checkPracticeLimit(opts?: { increment?: boolean }) {
  return createUsageLimitMiddleware('practice', opts);
}

export function checkAiChatLimit(opts?: { increment?: boolean }) {
  return createUsageLimitMiddleware('ai_chat', opts);
}

export { FREE_TIER_LIMITS };
