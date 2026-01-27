import { Request, Response, NextFunction } from 'express';
import { getAccountIdForUser, getEntitlement, getPrimaryGuardianLink, ensureAccountForUser, getGuardianLinkForStudent } from '../lib/account';
import { getSupabaseAdmin } from './supabase-auth';
import { logger } from '../logger';

export async function requireGuardianEntitlement(
  req: Request, 
  res: Response, 
  next: NextFunction
): Promise<void> {
  const requestId = req.requestId;
  
  if (!req.user) {
    res.status(401).json({ 
      error: 'Authentication required',
      code: 'UNAUTHENTICATED',
      requestId 
    });
    return;
  }

  const userId = req.user.id;
  const userRole = req.user.role;

  if (userRole === 'admin') {
    return next();
  }

  if (userRole !== 'guardian') {
    res.status(403).json({ 
      error: 'Guardian role required',
      code: 'FORBIDDEN',
      requestId 
    });
    return;
  }

  try {
    let link;
    let studentId = req.params?.studentId;
    if (studentId) {
      // Check guardian is linked to this studentId
      link = await getGuardianLinkForStudent(userId, studentId);
      if (!link) {
        res.status(403).json({
          error: 'Guardian not linked to requested student',
          code: 'NO_LINKED_STUDENT',
          requestId
        });
        return;
      }
    } else {
      link = await getPrimaryGuardianLink(userId);
      if (!link?.student_user_id) {
        res.status(403).json({
          error: 'Guardian has no linked student',
          code: 'NO_LINKED_STUDENT',
          requestId
        });
        return;
      }
      studentId = link.student_user_id;
    }

    const supabaseAdmin = getSupabaseAdmin();
    const studentAccountId = await ensureAccountForUser(supabaseAdmin, studentId, 'student');
    if (!studentAccountId) {
      logger.warn('GUARDIAN_ENTITLEMENT', 'no_account', 'Guardian linked student has no account', { userId, studentId, requestId });
      res.status(402).json({
        error: 'Subscription required',
        code: 'PAYMENT_REQUIRED',
        message: 'A subscription is required to access this feature.',
        redirectTo: '/guardian',
        requestId,
      });
      return;
    }

    const accountId = studentAccountId;

    const entitlement = await getEntitlement(accountId);
    
    if (!entitlement) {
      logger.warn('GUARDIAN_ENTITLEMENT', 'no_entitlement', 'Guardian has no entitlement record for student account', { userId, accountId, studentId: link.student_user_id, requestId });
      res.status(402).json({
        error: 'Subscription required',
        code: 'PAYMENT_REQUIRED',
        message: 'A subscription is required to access this feature.',
        redirectTo: '/guardian',
        requestId,
      });
      return;
    }

    const isActive = entitlement.plan === 'paid' && 
      (entitlement.status === 'active' || entitlement.status === 'trialing');

    let periodExpired = false;
    if (entitlement.current_period_end) {
      periodExpired = new Date(entitlement.current_period_end) < new Date();
    }

    const hasAccess = isActive && !periodExpired;

    if (!hasAccess) {
      const reason = periodExpired 
        ? 'subscription_expired' 
        : entitlement.status === 'past_due' 
          ? 'payment_past_due'
          : entitlement.status === 'canceled'
            ? 'subscription_canceled'
            : 'no_active_subscription';

      logger.info('GUARDIAN_ENTITLEMENT', 'access_denied', 'Guardian lacks paid access', { 
        userId, 
        accountId, 
        plan: entitlement.plan,
        status: entitlement.status,
        periodExpired,
        reason,
        requestId 
      });

      res.status(402).json({
        error: 'Subscription required',
        code: 'PAYMENT_REQUIRED',
        reason,
        message: periodExpired 
          ? 'Your subscription has expired. Please renew to continue.'
          : entitlement.status === 'past_due'
            ? 'Your payment is past due. Please update your payment method.'
            : 'A subscription is required to access this feature.',
        redirectTo: '/guardian',
        requestId,
      });
      return;
    }

    (req as any).guardianAccountId = accountId;
    (req as any).guardianEntitlement = entitlement;

    logger.info('GUARDIAN_ENTITLEMENT', 'access_granted', 'Guardian has active subscription', { 
      userId, 
      accountId, 
      plan: entitlement.plan,
      status: entitlement.status,
      requestId 
    });

    next();
  } catch (err: any) {
    logger.error('GUARDIAN_ENTITLEMENT', 'check_failed', 'Failed to check entitlement', { 
      userId, 
      error: err.message,
      requestId 
    });
    res.status(500).json({ 
      error: 'Failed to verify subscription status',
      requestId 
    });
  }
}
