import { NextFunction, Request, Response } from 'express';
import { requireRequestUser, sendForbidden } from './supabase-auth';

type GuardianRoleOptions = {
  message?: string;
};

/**
 * Canonical guardian-role gate: admits `role = 'guardian'` and nobody else.
 *
 * @spec [Guardian_Closure_Plan G2-01; audit G-AUD-05; owner ruling R5 (2026-09-27); SCL-078]
 * | @implemented [2026-09-29]
 *
 * plain English: an admin was admitted here too, which let an admin redeem a student's code
 * and become that child's "guardian". The only admin UI (crisis review) calls no guardian
 * route, so nothing depends on the old admission. Route-specific denial messaging is kept.
 */
export function requireGuardianRole(options?: GuardianRoleOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    if (user.role !== 'guardian') {
      return sendForbidden(res, {
        error: 'Guardian role required',
        message: options?.message ?? 'You do not have permission to access guardian resources',
        requestId: req.requestId,
      });
    }

    next();
  };
}
