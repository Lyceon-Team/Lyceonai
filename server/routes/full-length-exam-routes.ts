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

import { Router, Request, Response } from "express";
import { requireRequestUser, requireSupabaseAuth } from "../middleware/supabase-auth";
import { csrfGuard } from "../middleware/csrf";
// Intentional cross-boundary import: server runtime route delegates exam scoring/state logic to shared apps/api service.
import * as fullLengthExamService from "../../apps/api/src/services/fullLengthExam";
import { resolvePaidKpiAccessForUser } from "../services/kpi-access";
import { buildFullTestKpis, fullTestMeasurementModel } from "../services/kpi-truth-layer";
import { z } from "zod";

const router = Router();
const csrfProtection = csrfGuard();

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const submitAnswerSchema = z.object({
  questionId: z.string().uuid(),
  selectedAnswer: z.string().optional(),
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
router.post("/sessions", csrfProtection, requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const session = await fullLengthExamService.createExamSession({
      userId: user.id,
    });

    return res.status(201).json({ session });
  } catch (error: unknown) {
    console.error("[FULL-LENGTH] Create session error:", error);
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
router.get("/sessions/current", requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      return sendRouteError(req, res, 400, "sessionId query parameter required");
    }

    const result = await fullLengthExamService.getCurrentSession(sessionId, user.id);

    return res.json(result);
  } catch (error: unknown) {
    console.error("[FULL-LENGTH] Get current session error:", error);
    const message = error instanceof Error ? error.message : "";
    
    if (message.includes("not found") || message.includes("access denied")) {
      return sendRouteError(req, res, 404, "Session not found");
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
router.post("/sessions/:sessionId/start", csrfProtection, requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return sendRouteError(req, res, 400, "sessionId required");
    }

    await fullLengthExamService.startExam(sessionId, user.id);

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
router.post("/sessions/:sessionId/answer", csrfProtection, requireSupabaseAuth, async (req: Request, res: Response) => {
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
    });

    return res.json({ success: true });
  } catch (error: unknown) {
    console.error("[FULL-LENGTH] Submit answer error:", error);
    const message = error instanceof Error ? error.message : "";
    
    if (message.includes("not found") || message.includes("access denied")) {
      return sendRouteError(req, res, 404, "Session not found");
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
    
    return sendRouteError(req, res, 500, "Internal error");
  }
});

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
router.post("/sessions/:sessionId/module/submit", csrfProtection, requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return sendRouteError(req, res, 400, "sessionId required");
    }

    const result = await fullLengthExamService.submitModule({
      sessionId,
      userId: user.id,
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
router.post("/sessions/:sessionId/break/continue", csrfProtection, requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return sendRouteError(req, res, 400, "sessionId required");
    }

    await fullLengthExamService.continueFromBreak(sessionId, user.id);

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
router.post("/sessions/:sessionId/complete", csrfProtection, requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return sendRouteError(req, res, 400, "sessionId required");
    }

    const result = await fullLengthExamService.completeExam({
      sessionId,
      userId: user.id,
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

    const { sessionId } = req.params;
    if (!sessionId) {
      return sendRouteError(req, res, 400, "sessionId required");
    }

    const access = await resolvePaidKpiAccessForUser(user.id, user.role);
    if (!access.hasPaidAccess) {
      return res.status(402).json({
        error: "Premium KPI feature required",
        code: "PREMIUM_KPI_REQUIRED",
        feature: "full_test_analytics",
        message: "Upgrade to an active paid plan to unlock full-test analytics.",
        reason: access.reason,
        requestId: req.requestId,
      });
    }

    const result = await fullLengthExamService.getExamReport({
      sessionId,
      userId: user.id,
    });

    const kpis = buildFullTestKpis({
      scaledTotal: result.scaledScore.total,
      scaledRw: result.scaledScore.rw,
      scaledMath: result.scaledScore.math,
      totalCorrect: result.rawScore.total.correct,
      totalQuestions: result.rawScore.total.total,
    });

    return res.json({
      ...result,
      kpis,
      measurementModel: fullTestMeasurementModel(),
    });
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



