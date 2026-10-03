// E7b harness stub (see ../hooks.mjs). The routers' profile/consent guards pass;
// req.user is set by the harness server to its one fixed student.
//
// @implemented [2026-10-03] (student screenshot harness, tests/e2e/student-harness): the same
// stub serves a harness that mounts more of the real routers (profile, practice, review,
// progress, notifications, billing), so it exports every name those routers import. A request
// the harness server left without `req.user` (the signed-out persona) is refused 401 by every
// guard, with the real `sendUnauthenticated` body; the exam harness always sets `req.user`, so
// nothing changes for it.
import type { NextFunction, Request, Response } from "express";
import { harnessSupabase } from "../pg";

type HarnessUser = { id: string; is_under_13?: boolean };
type HarnessRequest = Request & { user?: HarnessUser; requestId?: string };

/** Same body shape as the real `sendUnauthenticated` (`sendDenial` 401). */
export function sendUnauthenticated(
  res: Response,
  requestId?: string,
): Response {
  return res.status(401).json({
    error: "Authentication required",
    message: "You must be signed in to access this resource",
    requestId,
  });
}

export function sendNoUser(req: HarnessRequest, res: Response): Response {
  return sendUnauthenticated(res, req.requestId);
}

/** Same body shape as the real `sendRoleUnrecognized`. Never reached: personas carry a role. */
export function sendRoleUnrecognized(
  res: Response,
  requestId?: string,
): Response {
  return res.status(403).json({
    error: "Account unavailable",
    message: "This account can't be opened. Please contact support.",
    requestId,
    code: "ROLE_UNRECOGNIZED",
  });
}

const signedIn = (
  req: HarnessRequest,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.user) {
    sendNoUser(req, res);
    return;
  }
  next();
};
const pass = (_req: Request, _res: Response, next: NextFunction): void =>
  next();

export const requireSupabaseAuth = signedIn;
export const requireStudentOrAdmin = signedIn;
export const requireStudentOnly = signedIn;
export const requireStudentAccount = signedIn;
export const requireProfileComplete = signedIn;
export const requireGuardianLinkForUnder13 = signedIn;
export const requireSupabaseAdmin = signedIn;
export const supabaseAuthMiddleware = pass;
export const enforceDeletionLock = pass;

/** The CSRF middleware's session key: the harness has no session token (same shape as the real one). */
export function resolveTokenFromRequest(_req: Request): {
  token: string | null;
  tokenSource: null;
  tokenLength: number | null;
  bearerParsed: boolean;
  authHeaderPresent: boolean;
  cookieKeys: string[];
} {
  return {
    token: null,
    tokenSource: null,
    tokenLength: null,
    bearerParsed: false,
    authHeaderPresent: false,
    cookieKeys: [],
  };
}

/** The real rule (Doc 03 §12.5 / INV-03-07): LISA needs a known age of 13 or over. */
export function passesTutorAgeGate(user: { is_under_13?: boolean }): boolean {
  return user.is_under_13 === false;
}

/** The service-role client the real module hands out, backed by the harness Postgres. */
export function getSupabaseAdmin() {
  return harnessSupabase();
}

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
