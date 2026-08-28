import { Request, Response, NextFunction } from "express";
import { resolveLinkedPairPremiumAccessForGuardian } from "../lib/account";
import { logger } from "../logger";
import { classifyError } from "../lib/redact";

/**
 * @spec [Doc 01 V8 §31.3 guardian derived access; Coding Standards §3.2 no `any`]
 * @implemented [2026-08-28]
 *
 * plain English: declares what this middleware attaches to the request, so
 * downstream handlers read a typed field instead of an `any` cast. Expected
 * outcome: the two `(req as any)` writes Codex flagged (M-3) become checked
 * assignments. Trade-off: a global augmentation is module-scoped only by
 * convention — it widens `Request` process-wide — which is the same trade the
 * existing `requestId` and `user` augmentations already make, so this follows
 * the established pattern rather than inventing a second one.
 */
type GuardianEntitlementContext = {
  premiumSource: Awaited<
    ReturnType<typeof resolveLinkedPairPremiumAccessForGuardian>
  >["premiumSource"];
  studentEntitlementStatus: Awaited<
    ReturnType<typeof resolveLinkedPairPremiumAccessForGuardian>
  >["studentEntitlementStatus"];
  guardianEntitlementStatus: Awaited<
    ReturnType<typeof resolveLinkedPairPremiumAccessForGuardian>
  >["guardianEntitlementStatus"];
};

declare global {
  namespace Express {
    interface Request {
      guardianAccountId?: string | null;
      guardianEntitlement?: GuardianEntitlementContext;
    }
  }
}

function resolveSubscriptionDenyReason(
  access: Awaited<ReturnType<typeof resolveLinkedPairPremiumAccessForGuardian>>,
):
  | "subscription_expired"
  | "payment_past_due"
  | "subscription_canceled"
  | "no_active_subscription" {
  if (access.studentEntitlementExpired) {
    return "subscription_expired";
  }

  if (access.studentEntitlementStatus === "past_due") {
    return "payment_past_due";
  }

  if (access.studentEntitlementStatus === "canceled") {
    return "subscription_canceled";
  }

  return "no_active_subscription";
}

export async function requireGuardianEntitlement(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const requestId = req.requestId;

  if (!req.user) {
    res.status(401).json({
      error: "Authentication required",
      code: "UNAUTHENTICATED",
      requestId,
    });
    return;
  }

  const userId = req.user.id;
  const userRole = req.user.role;

  // @spec [Doc 01 V6 §543 Permission Matrix (Admin ✓ linked-student read / Admin surfaces);
  //   §1229 admin student-data access is support-purpose only; §272/§561 all admin actions audited]
  //   | @implemented 2026-06-06
  // Admin bypasses the guardian link + entitlement checks here (per §543 Admin ✓). This gateway
  // does NOT itself content-scope: the aggregate-only nature of guardian surfaces and the
  // support-purpose limit (§1229) are enforced downstream (RLS + the guardian route handlers,
  // which already exclude question-level data). This middleware's obligation is the audit trail
  // (§272/§561): every admin access is logged with access-metadata only — no student content (§12.1).
  if (userRole === "admin") {
    logger.info(
      "GUARDIAN",
      "admin_surface_access",
      "Admin accessed a guardian/student surface",
      {
        studentId: req.params?.studentId ?? null,
        path: req.path,
        method: req.method,
      },
      { userId, requestId },
    );
    return next();
  }

  if (userRole !== "guardian") {
    res.status(403).json({
      error: "Guardian role required",
      code: "FORBIDDEN",
      requestId,
    });
    return;
  }

  try {
    const requestedStudentId = req.params?.studentId;
    const access = await resolveLinkedPairPremiumAccessForGuardian(
      userId,
      requestedStudentId,
    );

    if (!access.hasActiveLink) {
      res.status(403).json({
        error: requestedStudentId
          ? "Guardian not linked to requested student"
          : "Guardian has no linked student",
        code: "NO_LINKED_STUDENT",
        requestId,
      });
      return;
    }

    if (!access.hasPremiumAccess) {
      const reason = resolveSubscriptionDenyReason(access);

      logger.info(
        "GUARDIAN_ENTITLEMENT",
        "access_denied",
        "Guardian lacks linked student entitlement access",
        {
          userId,
          guardianUserId: access.guardianUserId,
          studentUserId: access.studentUserId,
          guardianAccountId: access.guardianAccountId,
          studentAccountId: access.studentAccountId,
          premiumSource: access.premiumSource,
          reason,
          requestId,
        },
      );

      res.status(402).json({
        error: "Subscription required",
        code: "PAYMENT_REQUIRED",
        reason,
        message:
          reason === "subscription_expired"
            ? "Your subscription has expired. Please renew to continue."
            : reason === "payment_past_due"
              ? "The linked student subscription payment is past due. Please update the payment method."
              : "A subscription is required to access this feature.",
        redirectTo: "/guardian",
        requestId,
      });
      return;
    }

    req.guardianAccountId = access.studentAccountId ?? access.guardianAccountId;
    req.guardianEntitlement = {
      premiumSource: access.premiumSource,
      studentEntitlementStatus: access.studentEntitlementStatus,
      guardianEntitlementStatus: access.guardianEntitlementStatus,
    };

    logger.info(
      "GUARDIAN_ENTITLEMENT",
      "access_granted",
      "Guardian has linked student entitlement access",
      {
        userId,
        guardianUserId: access.guardianUserId,
        studentUserId: access.studentUserId,
        guardianAccountId: access.guardianAccountId,
        studentAccountId: access.studentAccountId,
        premiumSource: access.premiumSource,
        requestId,
      },
    );

    next();
  } catch (err: unknown) {
    // Codex HIGH-6 / M-3: `err.message` is free text written by a third party —
    // it can quote a row or a constraint containing an identifier. Log the
    // allow-listed CLASS instead. `userId` is additionally digested by the
    // logger boundary, so this line cannot emit a raw identifier even if a
    // future edit re-adds one.
    logger.error(
      "GUARDIAN_ENTITLEMENT",
      "check_failed",
      "Failed to check entitlement",
      {
        userId,
        ...classifyError(err),
        requestId,
      },
    );
    res.status(500).json({
      error: "Failed to verify subscription status",
      requestId,
    });
  }
}
