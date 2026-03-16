import { Request, Response, NextFunction } from 'express';
import { resolveLinkedPairPremiumAccessForGuardian } from '../lib/account';
import { logger } from '../logger';

function resolveSubscriptionDenyReason(access: Awaited<ReturnType<typeof resolveLinkedPairPremiumAccessForGuardian>>): 'subscription_expired' | 'payment_past_due' | 'subscription_canceled' | 'no_active_subscription' {
  if (access.studentEntitlementExpired) {
    return 'subscription_expired';
  }

  if (access.studentEntitlementStatus === 'past_due') {
    return 'payment_past_due';
  }

  if (access.studentEntitlementStatus === 'canceled') {
    return 'subscription_canceled';
  }

  return 'no_active_subscription';
}

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
    const requestedStudentId = req.params?.studentId;
    const access = await resolveLinkedPairPremiumAccessForGuardian(userId, requestedStudentId);

    if (!access.hasActiveLink) {
      res.status(403).json({
        error: requestedStudentId ? 'Guardian not linked to requested student' : 'Guardian has no linked student',
        code: 'NO_LINKED_STUDENT',
        requestId
      });
      return;
    }

    if (!access.hasPremiumAccess) {
      const reason = resolveSubscriptionDenyReason(access);

      logger.info('GUARDIAN_ENTITLEMENT', 'access_denied', 'Guardian lacks linked student entitlement access', {
        userId,
        guardianUserId: access.guardianUserId,
        studentUserId: access.studentUserId,
        guardianAccountId: access.guardianAccountId,
        studentAccountId: access.studentAccountId,
        premiumSource: access.premiumSource,
        reason,
        requestId,
      });

      res.status(402).json({
        error: 'Subscription required',
        code: 'PAYMENT_REQUIRED',
        reason,
        message: reason === 'subscription_expired'
          ? 'Your subscription has expired. Please renew to continue.'
          : reason === 'payment_past_due'
            ? 'The linked student subscription payment is past due. Please update the payment method.'
            : 'A subscription is required to access this feature.',
        redirectTo: '/guardian',
        requestId,
      });
      return;
    }

    (req as any).guardianAccountId = access.studentAccountId ?? access.guardianAccountId;
    (req as any).guardianEntitlement = {
      premiumSource: access.premiumSource,
      studentEntitlementStatus: access.studentEntitlementStatus,
      guardianEntitlementStatus: access.guardianEntitlementStatus,
    };

    logger.info('GUARDIAN_ENTITLEMENT', 'access_granted', 'Guardian has linked student entitlement access', {
      userId,
      guardianUserId: access.guardianUserId,
      studentUserId: access.studentUserId,
      guardianAccountId: access.guardianAccountId,
      studentAccountId: access.studentAccountId,
      premiumSource: access.premiumSource,
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

