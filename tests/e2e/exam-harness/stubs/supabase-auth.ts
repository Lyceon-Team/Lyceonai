// E7b harness stub (see ../hooks.mjs). The routers' profile/consent guards pass;
// req.user is set by the harness server to its one fixed student.
import type { NextFunction, Request, Response } from "express";

const pass = (_req: Request, _res: Response, next: NextFunction): void => next();
export const requireSupabaseAuth = pass;
export const requireStudentOrAdmin = pass;
export const requireProfileComplete = pass;
export const requireGuardianLinkForUnder13 = pass;
export const supabaseAuthMiddleware = pass;

/** G2: the subject resolver reads the caller through this; the harness server set req.user. */
export function requireRequestUser(
  req: Request & { user?: { id: string } },
  res: Response,
): { id: string } | null {
  if (!req.user?.id) {
    res.status(401).json({ error: "Unauthenticated" });
    return null;
  }
  return req.user;
}

/**
 * Guardian final purge, item 9: the real /api/guardian router's role guard
 * (`server/middleware/guardian-role.ts`) refuses through this. Same body shape as the real
 * `sendForbidden` (`sendDenial`: error, message, requestId).
 */
export function sendForbidden(
  res: Response,
  options: { error: string; message: string; requestId?: string },
): Response {
  return res.status(403).json({
    error: options.error,
    message: options.message,
    requestId: options.requestId,
  });
}
