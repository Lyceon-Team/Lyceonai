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
import { requireSupabaseAuth } from "../middleware/supabase-auth";
import { csrfGuard } from "../middleware/csrf";
import * as fullLengthExamService from "../../apps/api/src/services/fullLengthExam";
import { z } from "zod";

const router = Router();
const csrfProtection = csrfGuard();

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const submitAnswerSchema = z.object({
  questionId: z.string().uuid(),
  selectedAnswer: z.string().optional(),
  freeResponseAnswer: z.string().optional(),
});

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
    if (!req.user?.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const session = await fullLengthExamService.createExamSession({
      userId: req.user.id,
    });

    return res.status(201).json({ session });
  } catch (error: any) {
    console.error("[FULL-LENGTH] Create session error:", error);
    return res.status(500).json({ 
      error: "Failed to create exam session",
      message: error.message 
    });
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
    if (!req.user?.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId query parameter required" });
    }

    const result = await fullLengthExamService.getCurrentSession(sessionId, req.user.id);

    return res.json(result);
  } catch (error: any) {
    console.error("[FULL-LENGTH] Get current session error:", error);
    
    if (error.message.includes("not found") || error.message.includes("access denied")) {
      return res.status(404).json({ error: "Session not found" });
    }
    
    return res.status(500).json({ 
      error: "Failed to fetch current session",
      message: error.message 
    });
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
    if (!req.user?.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId required" });
    }

    await fullLengthExamService.startExam(sessionId, req.user.id);

    return res.json({ success: true });
  } catch (error: any) {
    console.error("[FULL-LENGTH] Start exam error:", error);
    
    if (error.message.includes("not found") || error.message.includes("access denied")) {
      return res.status(404).json({ error: "Session not found" });
    }
    
    if (error.message.includes("already started")) {
      return res.status(400).json({ error: "Exam already started" });
    }
    
    return res.status(500).json({ 
      error: "Failed to start exam",
      message: error.message 
    });
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
    if (!req.user?.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId required" });
    }

    const parsed = submitAnswerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        error: "Invalid request body",
        details: parsed.error.errors 
      });
    }

    await fullLengthExamService.submitAnswer({
      sessionId,
      userId: req.user.id,
      questionId: parsed.data.questionId,
      selectedAnswer: parsed.data.selectedAnswer,
      freeResponseAnswer: parsed.data.freeResponseAnswer,
    });

    return res.json({ success: true });
  } catch (error: any) {
    console.error("[FULL-LENGTH] Submit answer error:", error);
    
    if (error.message.includes("not found") || error.message.includes("access denied")) {
      return res.status(404).json({ error: "Session not found" });
    }
    
    if (error.message.includes("not in progress")) {
      return res.status(400).json({ error: "Session is not in progress" });
    }
    
    if (error.message.includes("time has expired")) {
      return res.status(400).json({ error: "Module time has expired" });
    }
    
    if (error.message.includes("not found in current module")) {
      return res.status(400).json({ error: "Question not found in current module" });
    }
    
    return res.status(500).json({ 
      error: "Failed to submit answer",
      message: error.message 
    });
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
    if (!req.user?.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId required" });
    }

    const result = await fullLengthExamService.submitModule({
      sessionId,
      userId: req.user.id,
    });

    return res.json(result);
  } catch (error: any) {
    console.error("[FULL-LENGTH] Submit module error:", error);
    
    if (error.message.includes("not found") || error.message.includes("access denied")) {
      return res.status(404).json({ error: "Session not found" });
    }
    
    if (error.message.includes("not in progress")) {
      return res.status(400).json({ error: "Session is not in progress" });
    }
    
    if (error.message.includes("already submitted")) {
      return res.status(400).json({ error: "Module already submitted" });
    }
    
    return res.status(500).json({ 
      error: "Failed to submit module",
      message: error.message 
    });
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
    if (!req.user?.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId required" });
    }

    await fullLengthExamService.continueFromBreak(sessionId, req.user.id);

    return res.json({ success: true });
  } catch (error: any) {
    console.error("[FULL-LENGTH] Continue from break error:", error);
    
    if (error.message.includes("not found") || error.message.includes("access denied")) {
      return res.status(404).json({ error: "Session not found" });
    }
    
    if (error.message.includes("Not on break")) {
      return res.status(400).json({ error: "Not on break" });
    }
    
    return res.status(500).json({ 
      error: "Failed to continue from break",
      message: error.message 
    });
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
    if (!req.user?.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId required" });
    }

    const result = await fullLengthExamService.completeExam({
      sessionId,
      userId: req.user.id,
    });

    return res.json(result);
  } catch (error: any) {
    console.error("[FULL-LENGTH] Complete exam error:", error);
    
    if (error.message.includes("not found") || error.message.includes("access denied")) {
      return res.status(404).json({ error: "Session not found" });
    }
    
    if (error.message.includes("already completed")) {
      return res.status(400).json({ error: "Exam already completed" });
    }
    
    return res.status(500).json({ 
      error: "Failed to complete exam",
      message: error.message 
    });
  }
});

export default router;
