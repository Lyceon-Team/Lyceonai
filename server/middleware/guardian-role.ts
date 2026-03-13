import { NextFunction, Request, Response } from 'express';
import { requireRequestUser, sendForbidden } from './supabase-auth';

type GuardianRoleOptions = {
  message?: string;
};

/**
 * Canonical guardian-role gate:
 * - Allows guardian and admin users
 * - Preserves route-specific denial messaging via options
 */
export function requireGuardianRole(options?: GuardianRoleOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    if (user.role !== 'guardian' && user.role !== 'admin') {
      return sendForbidden(res, {
        error: 'Guardian role required',
        message: options?.message ?? 'You do not have permission to access guardian resources',
        requestId: req.requestId,
      });
    }

    next();
  };
}
