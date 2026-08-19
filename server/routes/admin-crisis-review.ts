/**
 * @spec [Doc-03_V3 §21.3, SCL-025, CR-03C-V3-01 §3.4]
 * @implemented 2026-08-13
 *
 * plain English: Admin safety review surface for crisis-flagged conversations.
 * SEPARATE from /api/tutor/* per SCL-025 — §3.1 stands unchanged (student-only
 * on /api/tutor/*). This surface is at /api/admin/crisis-review/*.
 *
 * expected outcome:
 *   - GET  /api/admin/crisis-review/cases       → list cases (paginated, filterable by status)
 *   - GET  /api/admin/crisis-review/cases/:id    → get case detail (with audit log)
 *   - POST /api/admin/crisis-review/cases/:id/claim      → claim case for review
 *   - POST /api/admin/crisis-review/cases/:id/disposition → set disposition + resolve
 *   - GET  /api/admin/crisis-review/sla-breaches → list cases past SLA deadline
 *
 * trade-offs:
 *   - Not routed through canAccessFeature — different authorization axis per SCL-025.
 *   - Every read logged append-only per SCL-025.
 *   - Write scope limited to classification outcome and review disposition per SCL-025.
 *   - Uses requireSupabaseAdmin middleware — sufficient for V1. SCL-025 notes that
 *     at V2 scale (5,000+ users) the admin role may be too broad for standing read
 *     access to minors' crisis conversations. Tracked as open, not resolved.
 *
 * edge cases:
 *   - Non-admin request: 403 from requireSupabaseAdmin (no information leakage).
 *   - Case not found: 404 with no case details.
 *   - Audit log write failure: blocks the read (SCL-025 mandate).
 */
import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  requireSupabaseAuth,
  requireSupabaseAdmin,
} from "../middleware/supabase-auth";
import {
  listCrisisReviewCases,
  getCrisisReviewCaseById,
  updateCaseDisposition,
  claimCaseForReview,
  getBreachedCases,
  getCaseAuditLog,
  writeAuditLogEntry,
} from "../services/crisis-review-queue";
import { logger } from "../logger";

// ── Zod Schemas ───────────────────────────────────────────────────────

const listCasesQuerySchema = z.object({
  status: z.enum(["open", "in_review", "resolved"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

const dispositionBodySchema = z.object({
  disposition: z.enum(["true_positive", "false_positive"]),
  notes: z.string().max(5000).nullable().default(null),
});

// ── Router ────────────────────────────────────────────────────────────

export const adminCrisisReviewRouter = Router();

// All routes require auth + admin role
adminCrisisReviewRouter.use(requireSupabaseAuth);
adminCrisisReviewRouter.use(requireSupabaseAdmin);

/**
 * GET /api/admin/crisis-review/cases
 * List crisis review cases (paginated, filterable by status).
 * Every call is audit-logged per SCL-025.
 *
 * @spec [Doc-03_V3 §21.3, SCL-025]
 */
adminCrisisReviewRouter.get("/cases", async (req: Request, res: Response) => {
  const parsed = listCasesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        message: "Invalid query parameters",
        details: parsed.error.flatten(),
      },
    });
  }

  const { status, limit, offset } = parsed.data;

  try {
    const result = await listCrisisReviewCases({
      reviewerId: req.user!.id,
      status,
      limit,
      offset,
      ip: req.ip ?? req.socket?.remoteAddress ?? "unknown",
      requestId: req.requestId,
    });

    // Durable audit write now happens inside listCrisisReviewCases
    // per SCL-025 (writeAuditLogEntry, not logger.adminAction).

    return res.status(200).json({
      data: {
        cases: result.cases,
        total: result.total,
        limit,
        offset,
      },
    });
  } catch (err: unknown) {
    logger.error(
      "ADMIN_CRISIS_REVIEW",
      "list_cases_error",
      "failed to list crisis review cases",
      err instanceof Error ? err : undefined,
    );
    return res.status(500).json({
      error: { message: "Failed to list crisis review cases" },
    });
  }
});

/**
 * GET /api/admin/crisis-review/cases/:id
 * Get a single crisis review case with audit trail.
 * Writes a 'viewed' audit log entry per SCL-025.
 *
 * @spec [Doc-03_V3 §21.3, SCL-025]
 */
adminCrisisReviewRouter.get(
  "/cases/:id",
  async (req: Request, res: Response) => {
    const caseId = req.params.id;
    if (!caseId) {
      return res.status(400).json({
        error: { message: "Case ID is required" },
      });
    }

    try {
      const reviewCase = await getCrisisReviewCaseById({
        caseId,
        reviewerId: req.user!.id,
        ip: req.ip ?? req.socket?.remoteAddress ?? "unknown",
        requestId: req.requestId,
      });

      if (!reviewCase) {
        return res.status(404).json({
          error: { message: "Crisis review case not found" },
        });
      }

      // Also fetch audit trail for this case
      const auditLog = await getCaseAuditLog({
        caseId,
        reviewerId: req.user!.id,
        ip: req.ip ?? req.socket?.remoteAddress ?? "unknown",
        requestId: req.requestId,
      });

      return res.status(200).json({
        data: {
          case: reviewCase,
          audit_log: auditLog,
        },
      });
    } catch (err: unknown) {
      logger.error(
        "ADMIN_CRISIS_REVIEW",
        "get_case_error",
        "failed to get crisis review case",
        err instanceof Error ? err : undefined,
        { caseId },
      );
      return res.status(500).json({
        error: { message: "Failed to get crisis review case" },
      });
    }
  },
);

/**
 * POST /api/admin/crisis-review/cases/:id/claim
 * Claim a case for review (transitions open → in_review).
 *
 * @spec [Doc-03_V3 §21.3]
 */
adminCrisisReviewRouter.post(
  "/cases/:id/claim",
  async (req: Request, res: Response) => {
    const caseId = req.params.id;
    if (!caseId) {
      return res.status(400).json({
        error: { message: "Case ID is required" },
      });
    }

    try {
      const reviewCase = await claimCaseForReview({
        caseId,
        reviewerId: req.user!.id,
        ip: req.ip ?? req.socket?.remoteAddress ?? "unknown",
        requestId: req.requestId,
      });

      logger.adminAction(
        "claim_crisis_review_case",
        "crisis_review_cases",
        req.user!.id,
        req.requestId,
        req.ip ?? req.socket?.remoteAddress ?? "unknown",
        { caseId, newStatus: "in_review" },
      );

      return res.status(200).json({ data: reviewCase });
    } catch (err: unknown) {
      logger.error(
        "ADMIN_CRISIS_REVIEW",
        "claim_case_error",
        "failed to claim crisis review case",
        err instanceof Error ? err : undefined,
        { caseId },
      );
      return res.status(409).json({
        error: {
          message: "Failed to claim case — may already be claimed or resolved",
        },
      });
    }
  },
);

/**
 * POST /api/admin/crisis-review/cases/:id/disposition
 * Set disposition (true_positive / false_positive), resolve the case.
 * Write scope limited to classification outcome and review disposition per SCL-025.
 *
 * @spec [Doc-03_V3 §21.3, SCL-025]
 */
adminCrisisReviewRouter.post(
  "/cases/:id/disposition",
  async (req: Request, res: Response) => {
    const caseId = req.params.id;
    if (!caseId) {
      return res.status(400).json({
        error: { message: "Case ID is required" },
      });
    }

    const parsed = dispositionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          message: "Invalid request body",
          details: parsed.error.flatten(),
        },
      });
    }

    try {
      const reviewCase = await updateCaseDisposition({
        caseId,
        reviewerId: req.user!.id,
        disposition: parsed.data.disposition,
        notes: parsed.data.notes,
        ip: req.ip ?? req.socket?.remoteAddress ?? "unknown",
        requestId: req.requestId,
      });

      logger.adminAction(
        "set_crisis_disposition",
        "crisis_review_cases",
        req.user!.id,
        req.requestId,
        req.ip ?? req.socket?.remoteAddress ?? "unknown",
        {
          caseId,
          disposition: parsed.data.disposition,
          newStatus: "resolved",
        },
      );

      return res.status(200).json({ data: reviewCase });
    } catch (err: unknown) {
      logger.error(
        "ADMIN_CRISIS_REVIEW",
        "set_disposition_error",
        "failed to set crisis review case disposition",
        err instanceof Error ? err : undefined,
        { caseId },
      );
      return res.status(500).json({
        error: { message: "Failed to set disposition" },
      });
    }
  },
);

/**
 * GET /api/admin/crisis-review/sla-breaches
 * List open cases past their SLA deadline (48h).
 * Used by the Cloud Scheduler SLA sweep and the admin review surface.
 *
 * @spec [Doc-03_V3 §21.3]
 */
adminCrisisReviewRouter.get(
  "/sla-breaches",
  async (req: Request, res: Response) => {
    try {
      const breachedCases = await getBreachedCases({
        reviewerId: req.user!.id,
        ip: req.ip ?? req.socket?.remoteAddress ?? "unknown",
        requestId: req.requestId,
      });

      return res.status(200).json({
        data: {
          cases: breachedCases,
          total: breachedCases.length,
        },
      });
    } catch (err: unknown) {
      logger.error(
        "ADMIN_CRISIS_REVIEW",
        "sla_breach_error",
        "failed to query SLA breaches",
        err instanceof Error ? err : undefined,
      );
      return res.status(500).json({
        error: { message: "Failed to query SLA breaches" },
      });
    }
  },
);
