/**
 * Full-Length SAT Exam API Routes
 * 
 * Implements server-authoritative exam flow with:
 * - Cookie-only auth (no Bearer tokens)
 * - CSRF protection on all POST endpoints
 * - IDOR prevention (user_id from auth only)
 * - Anti-leak (no answers/explanations before submit)
 * - Server-authoritative timing
 */

import { Router, Request, Response, type NextFunction } from "express";
import { requireRequestUser, requireSupabaseAuth } from "../middleware/supabase-auth";
import { doubleCsrfProtection } from "../middleware/csrf-double-submit";
import { buildAllowedOrigins, normalizeOrigin } from "../middleware/origin-utils";
// Intentional cross-boundary import: server runtime route delegates exam scoring/state logic to shared apps/api service.
import * as fullLengthExamService from "../../apps/api/src/services/fullLengthExam";
import { resolvePaidKpiAccessForUser } from "../services/kpi-access";
import { buildStudentFullLengthReportView } from "../services/canonical-runtime-views";
import { z } from "zod";

const router = Router();
const fullLengthMutatingGetAllowedOrigins = buildAllowedOrigins({
  nodeEnv: process.env.NODE_ENV,
  corsOriginsCsv: process.env.CORS_ORIGINS,
  csrfOriginsCsv: process.env.CSRF_ALLOWED_ORIGINS,
}).normalized;

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const createSessionSchema = z.object({
  test_form_id: z.string().uuid().optional(),
  client_instance_id: z.string().uuid().optional(),
});

const clientInstanceSchema = z.object({
  client_instance_id: z.string().uuid().optional(),
});

const submitAnswerSchema = z.object({
  questionId: z.string().uuid(),
  selectedAnswer: z.string().optional(),
  client_instance_id: z.string().uuid().optional(),
  client_attempt_id: z.string().uuid().optional(),
});

const calculatorStateSchema = z.object({
  calculator_state: z.unknown().nullable().optional(),
  client_instance_id: z.string().uuid().optional(),
});

function sendRouteError(
  req: Request,
  res: Response,
  status: number,
  error: string,
  extra: Record<string, unknown> = {}
) {
  return res.status(status).json({
    error,
    ...extra,
    requestId: req.requestId,
  });
}

function sendPremiumRequired(
  req: Request,
  res: Response,
  feature: string,
  access: { reason: string; plan: string; status: string; currentPeriodEnd?: string | null },
) {
  return res.status(402).json({
    error: "Premium feature required",
    code: "PREMIUM_REQUIRED",
    feature,
    message: "Upgrade to an active paid plan to unlock this feature.",
    reason: access.reason,
    entitlement: {
      plan: access.plan,
      status: access.status,
      currentPeriodEnd: access.currentPeriodEnd ?? null,
    },
    requestId: req.requestId,
  });
}

async function ensureFullLengthPremium(
  req: Request,
  res: Response,
  user: { id: string; role: string },
  feature = "full_length",
): Promise<boolean> {
  const access = await resolvePaidKpiAccessForUser(user.id, user.role as "student" | "guardian" | "admin");
  if (!access.hasPaidAccess) {
    sendPremiumRequired(req, res, feature, {
      reason: access.reason,
      plan: access.plan,
      status: access.status,
      currentPeriodEnd: access.currentPeriodEnd,
    });
    return false;
  }
  return true;
}

function sendClientInstanceConflict(req: Request, res: Response, clientInstanceId: string | null) {
  return res.status(409).json({
    error: "client_instance_conflict",
    code: "CLIENT_INSTANCE_CONFLICT",
    message: "Session client instance conflict",
    client_instance_id: clientInstanceId ?? null,
    requestId: req.requestId,
  });
}

function isClientInstanceConflict(message: string): boolean {
  return message.includes("client instance conflict") || message.includes("client_instance") || message.includes("Session client instance conflict");
}

function getClientInstanceIdFromError(error: unknown): string | null {
  const candidate = (error as any)?.clientInstanceId;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate;
  }
  return null;
}

function enforceMutatingGetCsrf(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin ? String(req.headers.origin) : "";
  const referer = req.headers.referer ? String(req.headers.referer) : "";

  if (!origin && !referer) {
    return sendRouteError(req, res, 403, "csrf_blocked", {
      message: "Cross-site request blocked by CSRF protection",
    });
  }

  const originNorm = origin ? normalizeOrigin(origin) : "";
  const refererNorm = referer ? normalizeOrigin(referer) : "";
  const allowed =
    (originNorm && fullLengthMutatingGetAllowedOrigins.has(originNorm)) ||
    (refererNorm && fullLengthMutatingGetAllowedOrigins.has(refererNorm));

  if (allowed) {
    return next();
  }

  return sendRouteError(req, res, 403, "csrf_blocked", {
    message: "Cross-site request blocked by CSRF protection",
    origin: origin || null,
  });
}
// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /api/full-length/sessions
 * Create a new full-length exam session
 * 
 * Security:
 * - Requires auth
 * - CSRF protected
 * - User ID from auth only
 */
router.post("/sessions", requireSupabaseAuth, doubleCsrfProtection, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }
    if (!(await ensureFullLengthPremium(req, res, user, "full_length"))) {
      return;
    }

    const parsed = createSessionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendRouteError(req, res, 400, "Invalid request body", { details: parsed.error.errors });
    }

    const session = await fullLengthExamService.createExamSession({
      userId: user.id,
      testFormId: parsed.data.test_form_id,
      clientInstanceId: parsed.data.client_instance_id,
      role: user.role,
    });

    return res.status(201).json({ session });
  } catch (error: unknown) {
    console.error("[FULL-LENGTH] Create session error:", error);
    const message = error instanceof Error ? error.message : "";

    if (message.includes("Test form not found")) {
      return sendRouteError(req, res, 404, "Test form not found");
    }

    if (message.includes("Test form is not published")) {
      return sendRouteError(req, res, 400, "Test form is not published");
    }

    if (message.includes("Test form has") || message.includes("Test form is structurally incomplete") || message.includes("Active session exists for a different test form")) {
      return sendRouteError(req, res, 409, message);
    }

    if (isClientInstanceConflict(message)) {
      return sendClientInstanceConflict(req, res, getClientInstanceIdFromError(error));
    }

    const rateLimitCode = (error as any)?.code as string | undefined;
    if (rateLimitCode === "FULL_LENGTH_QUOTA_EXCEEDED") {
      const gate = (error as any)?.rateLimit as any;
      return res.status(402).json({
        error: "Full-length quota reached",
        code: "FULL_LENGTH_QUOTA_EXCEEDED",
        limitType: "full_length",
        current: gate?.current ?? null,
        limit: gate?.limit ?? 2,
        resetAt: gate?.resetAt ?? null,
        message: gate?.message ?? "You have reached the full-length start limit.",
        requestId: req.requestId,
      });
    }

    if (rateLimitCode === "RATE_LIMIT_DB_UNAVAILABLE") {
      return res.status(503).json({
        error: "Rate-limit check unavailable",
        code: "RATE_LIMIT_DB_UNAVAILABLE",
        message: "Unable to verify full-length quota right now. Please retry shortly.",
        requestId: req.requestId,
      });
    }

    return sendRouteError(req, res, 500, "Internal error");
  }
});

/**
 * GET /api/full-length/sessions
 * List user's full-length sessions for history/report navigation.
 */
router.get("/sessions", requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }
    if (!(await ensureFullLengthPremium(req, res, user, "full_length"))) {
      return;
    }

    const rawLimit = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(Math.trunc(rawLimit), 50)) : 20;
    const includeIncompleteRaw = String(req.query.include_incomplete ?? "").toLowerCase();
    const includeIncomplete = includeIncompleteRaw === "1" || includeIncompleteRaw === "true";

    const sessions = await fullLengthExamService.listExamSessions({
      userId: user.id,
      limit,
      includeIncomplete,
    });
    const access = await resolvePaidKpiAccessForUser(user.id, user.role);

    return res.json({
      sessions: sessions.map((session) => ({
        ...session,
        reportAvailable: session.status === "completed" && access.hasPaidAccess,
        reviewAvailable: session.status === "completed",
      })),
      reportAccess: {
        hasPaidAccess: access.hasPaidAccess,
        reason: access.reason,
      },
      requestId: req.requestId,
    });
  } catch (error: unknown) {
    console.error("[FULL-LENGTH] List sessions error:", error);
    return sendRouteError(req, res, 500, "Internal error");
  }
});

/**
 * GET /api/full-length/sessions/current
 * Get current session state with current question
 * 
 * Security:
 * - Requires auth
 * - Returns only user's own sessions
 * - No answers/explanations in response (anti-leak)
 */
router.get("/sessions/current", requireSupabaseAuth, enforceMutatingGetCsrf, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      return sendRouteError(req, res, 400, "sessionId query parameter required");
    }

    const clientInstanceId = typeof req.query.client_instance_id === "string" ? req.query.client_instance_id : undefined;
    const result = await fullLengthExamService.getCurrentSession(sessionId, user.id, clientInstanceId);

    return res.json(result);
  } catch (error: unknown) {
    console.error("[FULL-LENGTH] Get current session error:", error);
    const message = error instanceof Error ? error.message : "";
    
    if (message.includes("not found") || message.includes("access denied")) {
      return sendRouteError(req, res, 404, "Session not found");
    }

    if (isClientInstanceConflict(message)) {
      return sendClientInstanceConflict(req, res, getClientInstanceIdFromError(error));
    }
    
    return sendRouteError(req, res, 500, "Internal error");
  }
});

/**
 * POST /api/full-length/sessions/:sessionId/start
 * Start the exam
 * 
 * Security:
 * - Requires auth
 * - CSRF protected
 * - User ID from auth only
 */
router.post("/sessions/:sessionId/start", requireSupabaseAuth, doubleCsrfProtection, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return sendRouteError(req, res, 400, "sessionId required");
    }

    const parsed = clientInstanceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendRouteError(req, res, 400, "Invalid request body", { details: parsed.error.errors });
    }

    await fullLengthExamService.startExam(sessionId, user.id, parsed.data.client_instance_id);

    return res.json({ success: true });
  } catch (error: unknown) {
    console.error("[FULL-LENGTH] Start exam error:", error);
    const message = error instanceof Error ? error.message : "";
    
    if (message.includes("not found") || message.includes("access denied")) {
      return sendRouteError(req, res, 404, "Session not found");
    }
    
    if (message.includes("already started")) {
      return sendRouteError(req, res, 400, "Invalid exam state");
    }

    if (isClientInstanceConflict(message)) {
      return sendClientInstanceConflict(req, res, getClientInstanceIdFromError(error));
    }
    
    return sendRouteError(req, res, 500, "Internal error");
  }
});

/**
 * POST /api/full-length/sessions/:sessionId/answer
 * Submit an answer to a question
 * 
 * Security:
 * - Requires auth
 * - CSRF protected
 * - User ID from auth only
 * - Idempotent
 * - Validates question belongs to current module
 */
router.post("/sessions/:sessionId/answer", requireSupabaseAuth, doubleCsrfProtection, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return sendRouteError(req, res, 400, "sessionId required");
    }

    const parsed = submitAnswerSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendRouteError(req, res, 400, "Invalid request body", { details: parsed.error.errors });
    }

    await fullLengthExamService.submitAnswer({
      sessionId,
      userId: user.id,
      questionId: parsed.data.questionId,
      selectedAnswer: parsed.data.selectedAnswer,
      clientInstanceId: parsed.data.client_instance_id,
      clientAttemptId: parsed.data.client_attempt_id,
    });

    return res.json({ success: true });
  } catch (error: unknown) {
    console.error("[FULL-LENGTH] Submit answer error:", error);
    const message = error instanceof Error ? error.message : "";
    
    if (message.includes("not found") || message.includes("access denied")) {
      return sendRouteError(req, res, 404, "Session not found");
    }

    if (message.includes("already submitted with different selection")) {
      return sendRouteError(req, res, 409, "Duplicate answer submission");
    }
    
    if (message.includes("not in progress")) {
      return sendRouteError(req, res, 400, "Invalid exam state");
    }
    
    if (message.includes("time has expired")) {
      return sendRouteError(req, res, 400, "Invalid exam state");
    }
    
    if (message.includes("not found in current module")) {
      return sendRouteError(req, res, 400, "Invalid exam state");
    }

    if (isClientInstanceConflict(message)) {
      return sendClientInstanceConflict(req, res, getClientInstanceIdFromError(error));
    }
    
    return sendRouteError(req, res, 500, "Internal error");
  }
});

/**
 * POST /api/full-length/sessions/:sessionId/modules/:moduleId/calculator-state
 * Persist module-scoped calculator state for math modules.
 */
router.post(
  "/sessions/:sessionId/modules/:moduleId/calculator-state",
  requireSupabaseAuth,
  doubleCsrfProtection,
  async (req: Request, res: Response) => {
    try {
      const user = requireRequestUser(req, res);
      if (!user) {
        return;
      }

      const { sessionId, moduleId } = req.params;
      if (!sessionId || !moduleId) {
        return sendRouteError(req, res, 400, "sessionId and moduleId required");
      }

      const parsed = calculatorStateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return sendRouteError(req, res, 400, "Invalid request body", { details: parsed.error.errors });
      }

      await fullLengthExamService.persistModuleCalculatorState({
        sessionId,
        moduleId,
        userId: user.id,
        calculatorState: parsed.data.calculator_state ?? null,
        clientInstanceId: parsed.data.client_instance_id,
      });

      return res.json({ success: true });
    } catch (error: unknown) {
      console.error("[FULL-LENGTH] Persist calculator state error:", error);
      const message = error instanceof Error ? error.message : "";

      if (message.includes("not found") || message.includes("access denied")) {
        return sendRouteError(req, res, 404, "Session not found");
      }

      if (message.includes("only available for math modules")) {
        return sendRouteError(req, res, 400, "Invalid module state");
      }

      if (message.includes("Invalid calculator state payload")) {
        return sendRouteError(req, res, 400, "Invalid request body");
      }

      if (message.includes("Session is not active")) {
        return sendRouteError(req, res, 400, "Invalid exam state");
      }

      if (isClientInstanceConflict(message)) {
        return sendClientInstanceConflict(req, res, getClientInstanceIdFromError(error));
      }

      return sendRouteError(req, res, 500, "Internal error");
    }
  }
);

/**
 * POST /api/full-length/sessions/:sessionId/module/submit
 * Submit the current module (end module, compute performance)
 * 
 * Security:
 * - Requires auth
 * - CSRF protected
 * - User ID from auth only
 * - Computes Module 2 difficulty deterministically
 */
router.post("/sessions/:sessionId/module/submit", requireSupabaseAuth, doubleCsrfProtection, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return sendRouteError(req, res, 400, "sessionId required");
    }

    const parsed = clientInstanceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendRouteError(req, res, 400, "Invalid request body", { details: parsed.error.errors });
    }

    const result = await fullLengthExamService.submitModule({
      sessionId,
      userId: user.id,
      clientInstanceId: parsed.data.client_instance_id,
    });

    return res.json(result);
  } catch (error: unknown) {
    console.error("[FULL-LENGTH] Submit module error:", error);
    const message = error instanceof Error ? error.message : "";
    
    if (message.includes("not found") || message.includes("access denied")) {
      return sendRouteError(req, res, 404, "Session not found");
    }
    
    if (message.includes("not in progress")) {
      return sendRouteError(req, res, 400, "Invalid exam state");
    }
    
    if (message.includes("already submitted")) {
      return sendRouteError(req, res, 400, "Invalid exam state");
    }

    if (isClientInstanceConflict(message)) {
      return sendClientInstanceConflict(req, res, getClientInstanceIdFromError(error));
    }
    
    return sendRouteError(req, res, 500, "Internal error");
  }
});

/**
 * POST /api/full-length/sessions/:sessionId/break/continue
 * Continue from break to Math Module 1
 * 
 * Security:
 * - Requires auth
 * - CSRF protected
 * - User ID from auth only
 */
router.post("/sessions/:sessionId/break/continue", requireSupabaseAuth, doubleCsrfProtection, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return sendRouteError(req, res, 400, "sessionId required");
    }

    const parsed = clientInstanceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendRouteError(req, res, 400, "Invalid request body", { details: parsed.error.errors });
    }

    await fullLengthExamService.continueFromBreak(sessionId, user.id, parsed.data.client_instance_id);

    return res.json({ success: true });
  } catch (error: unknown) {
    console.error("[FULL-LENGTH] Continue from break error:", error);
    const message = error instanceof Error ? error.message : "";
    
    if (message.includes("not found") || message.includes("access denied")) {
      return sendRouteError(req, res, 404, "Session not found");
    }
    
    if (message.includes("Not on break")) {
      return sendRouteError(req, res, 400, "Invalid exam state");
    }

    if (isClientInstanceConflict(message)) {
      return sendClientInstanceConflict(req, res, getClientInstanceIdFromError(error));
    }
    
    return sendRouteError(req, res, 500, "Internal error");
  }
});

/**
 * POST /api/full-length/sessions/:sessionId/complete
 * Complete the exam and get final results
 * 
 * Security:
 * - Requires auth
 * - CSRF protected
 * - User ID from auth only
 * - Returns answers/explanations only after completion
 */
router.post("/sessions/:sessionId/complete", requireSupabaseAuth, doubleCsrfProtection, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return sendRouteError(req, res, 400, "sessionId required");
    }

    const parsed = clientInstanceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendRouteError(req, res, 400, "Invalid request body", { details: parsed.error.errors });
    }

    const result = await fullLengthExamService.completeExam({
      sessionId,
      userId: user.id,
      clientInstanceId: parsed.data.client_instance_id,
    });

    return res.json(result);
  } catch (error: unknown) {
    console.error("[FULL-LENGTH] Complete exam error:", error);
    const message = error instanceof Error ? error.message : "";
    
    if (message.includes("not found") || message.includes("access denied")) {
      return sendRouteError(req, res, 404, "Session not found");
    }
    
    if (message.includes("Invalid exam state")) {
      return sendRouteError(req, res, 400, "Invalid exam state");
    }

    if (isClientInstanceConflict(message)) {
      return sendClientInstanceConflict(req, res, getClientInstanceIdFromError(error));
    }
    
    return sendRouteError(req, res, 500, "Internal error");
  }
});


/**
 * GET /api/full-length/sessions/:sessionId/report
 * Get full score report (raw/scaled/domain/skill) after completion.
 */
router.get("/sessions/:sessionId/report", requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }
    if (!(await ensureFullLengthPremium(req, res, user, "full_test_analytics"))) {
      return;
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return sendRouteError(req, res, 400, "sessionId required");
    }

    const result = await fullLengthExamService.getExamReport({
      sessionId,
      userId: user.id,
    });

    return res.json(buildStudentFullLengthReportView(result));
  } catch (error: unknown) {
    console.error("[FULL-LENGTH] Get report error:", error);
    const message = error instanceof Error ? error.message : "";

    if (message.includes("not found") || message.includes("access denied")) {
      return sendRouteError(req, res, 404, "Session not found");
    }

    if (message.includes("Results locked until completion")) {
      return sendRouteError(req, res, 423, "Results locked until completion");
    }

    return sendRouteError(req, res, 500, "Internal error");
  }
});
/**
 * GET /api/full-length/sessions/:sessionId/review
 * Review unlocks only after exam completion.
 */
router.get("/sessions/:sessionId/review", requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return sendRouteError(req, res, 400, "sessionId required");
    }

    const review = await fullLengthExamService.getExamReviewAfterCompletion({
      sessionId,
      userId: user.id,
    });

    return res.json(review);
  } catch (error: unknown) {
    console.error("[FULL-LENGTH] Get review error:", error);
    const message = error instanceof Error ? error.message : "";

    if (message.includes("not found") || message.includes("access denied")) {
      return sendRouteError(req, res, 404, "Session not found");
    }

    if (message.includes("Review locked until completion")) {
      return sendRouteError(req, res, 423, "Review locked until completion");
    }

    return sendRouteError(req, res, 500, "Internal error");
  }
});
export default router;

