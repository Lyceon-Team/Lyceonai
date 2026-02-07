import { Request, Response, Router } from 'express';
import { requireSupabaseAuth, getSupabaseAdmin } from '../middleware/supabase-auth';
import { 
  ensureAccountForUser, 
  getAccountIdForUser, 
  getAllAccountsForUser,
  getGuardianSelectedAccount,
  setGuardianSelectedAccount,
  getOrCreateEntitlement, 
  getDailyUsage 
} from '../lib/account';
import { logger } from '../logger';
import { z } from 'zod';
import { csrfGuard } from '../middleware/csrf';

const router = Router();
const csrfProtection = csrfGuard();

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

router.get('/status', requireSupabaseAuth, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  const userId = req.user!.id;
  const rawRole = req.user!.role as string;
  const userRole = rawRole === 'parent' ? 'guardian' : rawRole;

  try {
    const accounts = await getAllAccountsForUser(userId);
    
    if (accounts.length === 0) {
      return res.json({ 
        hasAccount: false, 
        accounts: [],
        selectedAccountId: null,
        entitlement: null,
        usage: null,
        requestId 
      });
    }

    let selectedAccountId: string | null = null;
    
    if (userRole === 'guardian') {
      selectedAccountId = await getGuardianSelectedAccount(userId);
      if (!selectedAccountId || !accounts.find(a => a.accountId === selectedAccountId)) {
        selectedAccountId = accounts[0].accountId;
      }
    } else {
      selectedAccountId = accounts[0].accountId;
    }

    const entitlement = await getOrCreateEntitlement(selectedAccountId);
    const usage = await getDailyUsage(selectedAccountId);

    logger.info('ACCOUNT', 'status', 'Account status retrieved', {
      userId,
      selectedAccountId,
      accountCount: accounts.length,
      requestId
    });

    res.json({
      hasAccount: true,
      accounts,
      selectedAccountId,
      entitlement: {
        plan: entitlement.plan,
        status: entitlement.status,
        currentPeriodEnd: entitlement.current_period_end
      },
      usage: {
        practiceQuestionsUsed: usage?.practice_questions_used || 0,
        aiMessagesUsed: usage?.ai_messages_used || 0,
        day: new Date().toISOString().split('T')[0]
      },
      requestId
    });
  } catch (err: any) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    logger.error('ACCOUNT', 'status', 'Failed to get account status', {
      userId,
      error: errorMessage,
      requestId
    });
    
    res.status(500).json({ 
      error: 'Failed to get account status', 
      requestId,
      debug: {
        userId,
        message: errorMessage
      }
    });
  }
});

const selectAccountSchema = z.object({
  accountId: z.string().uuid('Invalid account ID'),
});

router.post('/select', requireSupabaseAuth, csrfProtection, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  const userId = req.user!.id;
  const rawRole = req.user!.role as string;
  const userRole = rawRole === 'parent' ? 'guardian' : rawRole;

  if (userRole !== 'guardian') {
    return res.status(403).json({ 
      error: 'Only guardians can select accounts',
      requestId 
    });
  }

  try {
    const validation = selectAccountSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: validation.error.errors[0]?.message || 'Invalid request',
        requestId 
      });
    }

    const { accountId } = validation.data;

    const accounts = await getAllAccountsForUser(userId);
    const validAccount = accounts.find(a => a.accountId === accountId);
    
    if (!validAccount) {
      return res.status(403).json({ 
        error: 'Account not accessible',
        requestId 
      });
    }

    await setGuardianSelectedAccount(userId, accountId);

    logger.info('ACCOUNT', 'select', 'Guardian selected account', {
      userId,
      accountId,
      requestId
    });

    res.json({ 
      success: true, 
      selectedAccountId: accountId,
      requestId 
    });
  } catch (err: any) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    logger.error('ACCOUNT', 'select', 'Failed to select account', {
      userId,
      error: errorMessage,
      requestId
    });
    
    res.status(500).json({ 
      error: 'Failed to select account', 
      requestId,
      debug: {
        userId,
        message: errorMessage
      }
    });
  }
});

export default router;
