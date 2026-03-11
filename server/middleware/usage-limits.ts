import { Request, Response, NextFunction } from 'express';
import { checkUsageLimit, incrementUsage, FREE_TIER_LIMITS, getAccountIdForUser, ensureAccountForUser } from '../lib/account';
import { getSupabaseAdmin } from './supabase-auth';
import { logger } from '../logger';

type UsageIncrementStrategy = 'immediate' | 'on_success';

type UsageLimitOptions = {
  increment?: boolean;
  incrementStrategy?: UsageIncrementStrategy;
};

export function createUsageLimitMiddleware(limitType: 'practice' | 'ai_chat', opts?: UsageLimitOptions) {
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

      const shouldIncrement = opts?.increment !== false;
      const incrementStrategy = opts?.incrementStrategy ?? 'immediate';

      if (shouldIncrement && incrementStrategy === 'immediate') {
        await incrementUsage(accountId, limitType);
      } else if (shouldIncrement && incrementStrategy === 'on_success') {
        res.once('finish', () => {
          // Count usage only when the downstream request succeeds.
          if (res.statusCode >= 200 && res.statusCode < 400) {
            void incrementUsage(accountId, limitType).catch((incrementErr: any) => {
              logger.error('USAGE', 'increment_on_success_failed', 'Failed to increment usage after successful response', {
                err: incrementErr?.message || 'Unknown error',
                userId,
                accountId,
                limitType,
                statusCode: res.statusCode,
                requestId,
              });
            });
          }
        });
      }

      return next();
    } catch (err: any) {
      logger.error('USAGE', 'limit_check', 'Failed to check usage limit', {
        err: err.message,
        userId,
        limitType,
        requestId,
      });

      return res.status(503).json({
        error: 'Usage check unavailable',
        code: 'USAGE_CHECK_UNAVAILABLE',
        message: 'Unable to verify usage limits at this time. Please retry shortly.',
        requestId,
      });
    }
  };
}

export function checkPracticeLimit(opts?: UsageLimitOptions) {
  return createUsageLimitMiddleware('practice', opts);
}

export function checkAiChatLimit(opts?: UsageLimitOptions) {
  return createUsageLimitMiddleware('ai_chat', opts);
}

export { FREE_TIER_LIMITS };
