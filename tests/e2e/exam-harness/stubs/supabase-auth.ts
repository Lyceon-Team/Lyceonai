// E7b harness stub (see ../hooks.mjs). The routers' profile/consent guards pass;
// req.user is set by the harness server to its one fixed student.
import type { NextFunction, Request, Response } from "express";

const pass = (_req: Request, _res: Response, next: NextFunction): void => next();
export const requireSupabaseAuth = pass;
export const requireStudentOrAdmin = pass;
export const requireProfileComplete = pass;
export const requireConsentCompliance = pass;
export const supabaseAuthMiddleware = pass;
