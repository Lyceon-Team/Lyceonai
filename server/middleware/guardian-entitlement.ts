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

  // @spec [guardian-rebuild-design-spec §1.5 R5 — "no admin bypass, and the non-goal that keeps
  //   it deleted"; owner ruling 2026-08-28 "R5 reaches all four bypasses"]
  //   | @implemented [2026-08-28]
  //
  // THE ADMIN BYPASS WAS HERE, AND IS DELETED. It read `if (userRole === 'admin') return next()`,
  // skipping BOTH the link check and the entitlement check, and cited "Doc 01 V6 §543" — a
  // document version no longer in the corpus. An operator does not read a student's mastery,
  // KPI, projections, exam history or calendar through a guardian-gated route.
  //
  // RECORDED AS A NON-GOAL so it is not reinvented under pressure: if support later needs
  // per-student visibility, it is a student-or-guardian-initiated, time-boxed, audited GRANT —
  // a row with an expiry that the subject can revoke — never a role bypass. A bypass is
  // unrevocable, unlimited in scope, and invisible to the family it concerns.
  //
  // The audit log this branch emitted (`admin_surface_access`) goes with it: there is no admin
  // access here left to record. Admin now falls through to the `!== 'guardian'` denial below,
  // which is the correct answer and not a special case.
  //
  // SCOPE. This reaches READS only. Admin WRITES to the link lifecycle (Doc 01 §16 "Guardian
  // linking: Admin ✓", §36.1 `initiated_by='admin'`, §36.3 admin revocation via support
  // escalation) are a separate, still-open owner question and are NOT touched here — those four
  // routes never carried this middleware.
  //
  // DIVERGENCE FROM THE LOCKED SPEC, recorded rather than hidden: Doc 01 V8 §16 still grants
  // Admin `✓` on "Linked student profile read" where Guardian gets "Aggregate only". This
  // implementation denies it. The owner ruling is the stricter posture and wins; §16 owes an
  // amendment. See SCL-078.
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

