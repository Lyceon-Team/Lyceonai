import { Request, Response, Router } from 'express';
import { requireSupabaseAuth } from '../middleware/supabase-auth';
import {
  getAllAccountsForUser,
  getOrCreateEntitlement,
  getDailyUsage,
} from '../lib/account';
import { logger } from '../logger';
<<<<<<< HEAD

const router = Router();
=======
import { z } from 'zod';

const router = Router();

router.get('/bootstrap', requireSupabaseAuth, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  const userId = req.user!.id;
  let userRole: string = req.user!.role;

  try {
    if (userRole === 'parent') {
      userRole = 'guardian';
    }

    if (userRole !== 'student' && userRole !== 'guardian') {
      return res.status(400).json({ 
        error: 'Unsupported role for bootstrap',
        role: req.user!.role,
        requestId 
      });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const accountId = await ensureAccountForUser(supabaseAdmin, userId, userRole as 'student' | 'guardian');

    logger.info('ACCOUNT', 'bootstrap', 'Account bootstrapped via API', {
      userId,
      role: userRole,
      accountId,
      requestId
    });

    res.json({ accountId, userId, role: userRole, requestId });
  } catch (err: any) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    
    logger.error('ACCOUNT', 'bootstrap', 'Failed to bootstrap account', {
      userId,
      role: userRole,
      error: errorMessage,
      stack: errorStack,
      requestId
    });
    
    res.status(500).json({ 
      error: 'Failed to bootstrap account', 
      requestId,
      debug: {
        userId,
        role: req.user!.role,
        message: errorMessage
      }
    });
  }
});
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b

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

<<<<<<< HEAD
=======
const selectAccountSchema = z.object({
  accountId: z.string().uuid('Invalid account ID'),
});

>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
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
