import { Request, Response, Router } from 'express';
import { requireSupabaseAuth } from '../middleware/supabase-auth';
import {
  getAllAccountsForUser,
  getOrCreateEntitlement,
  getDailyUsage,
} from '../lib/account';
import { logger } from '../logger';

const router = Router();

router.get('/status', requireSupabaseAuth, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  const userId = req.user!.id;

  try {
    const accounts = await getAllAccountsForUser(userId);

    if (accounts.length === 0) {
      return res.json({
        hasAccount: false,
        accounts: [],
        selectedAccountId: null,
        entitlement: null,
        usage: null,
        accountSelectionEnabled: false,
        requestId,
      });
    }

    // Locked model: runtime account switching is disabled.
    const selectedAccountId = accounts[0].accountId;

    const entitlement = await getOrCreateEntitlement(selectedAccountId);
    const usage = await getDailyUsage(selectedAccountId);

    logger.info('ACCOUNT', 'status', 'Account status retrieved', {
      userId,
      selectedAccountId,
      accountCount: accounts.length,
      requestId,
    });

    res.json({
      hasAccount: true,
      accounts,
      selectedAccountId,
      entitlement: {
        plan: entitlement.plan,
        status: entitlement.status,
        currentPeriodEnd: entitlement.current_period_end,
      },
      usage: {
        practiceQuestionsUsed: usage?.practice_questions_used || 0,
        aiMessagesUsed: usage?.ai_messages_used || 0,
        day: new Date().toISOString().split('T')[0],
      },
      accountSelectionEnabled: false,
      requestId,
    });
  } catch (err: any) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error('ACCOUNT', 'status', 'Failed to get account status', {
      userId,
      error: errorMessage,
      requestId,
    });

    res.status(500).json({
      error: 'Failed to get account status',
      requestId,
      debug: {
        userId,
        message: errorMessage,
      },
    });
  }
});

router.post('/select', requireSupabaseAuth, async (req: Request, res: Response) => {
  const requestId = req.requestId;

  logger.warn('ACCOUNT', 'select_blocked', 'Account switching is disabled by runtime guardian model', {
    userId: req.user?.id,
    requestId,
  });

  return res.status(409).json({
    error: 'Account switching is disabled in the current guardian model',
    code: 'ACCOUNT_SELECTION_DISABLED',
    requestId,
  });
});

export default router;
