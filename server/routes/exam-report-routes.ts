/**
 * Full-length exam score report — /api/tests/sessions/:session_id/report[/status]
 *
 * @spec [Doc-04C_V1.0, §11.1, §16.1 (student endpoints), §16.5 (precondition chain),
 *        §16.6 (anti-enumeration: missing and foreign sessions are one bare 403),
 *        §16.7 (codes), §16.8 (envelope {data, meta}); §5.3 (revoked access is a
 *        200 `unavailable` payload, not a 403)]
 *       [Coding Standards §8.1 (thin handlers), §8.2]
 * @implemented [2026-09-25]
 *
 * plain English: the two 04C student reads, on their own router (the 04A runtime
 * router stays report-free). Order, per 04C §16.5 rather than the generic
 * auth -> entitlement -> Zod order: auth (401) -> Zod params (400) -> ownership in
 * SQL (403, no body detail) -> entitlement, which for an OWNED session classifies
 * as `revoked` and answers 200 `unavailable` -> derive -> one serializer per state.
 * Entitlement is only consulted after ownership, so a probe for someone else's
 * session learns nothing about entitlements either.
 *
 * trade-offs: no 04D audit event is emitted (§16.5 step 8): 04D does not exist; the
 * structured log below is the observability until it does (non-blocking, no
 * payload content).
 */
import { Router, type Request, type Response } from "express";
import {
  requireProfileComplete,
  requireConsentCompliance,
} from "../middleware/supabase-auth.js";
import { logger } from "../logger";
import { EntitlementService } from "../services/entitlement-service";
import {
  ReportIntegrityError,
  readExamReport,
} from "../services/exam-report-service";
import { examSessionParamsSchema } from "../../packages/shared/src/exam-runtime-schema";
import {
  examReportStatusSchema,
  type ExamReportPayload,
} from "../../packages/shared/src/exam-report-schema";
import { EXAM_FEATURE_KEY } from "./exam-runtime-routes";

const COMPONENT = "EXAM_REPORT";
const router = Router();

function meta(req: Request): { request_id: string; served_at: string } {
  return {
    request_id: req.requestId ?? "",
    served_at: new Date().toISOString(),
  };
}

function sendError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
): Response {
  return res.status(status).json({ error: { code, message }, meta: meta(req) });
}

/** §16.5 steps 1-7 for one session; null after an error response was sent. */
async function reportFor(
  req: Request,
  res: Response,
  operation: string,
): Promise<ExamReportPayload | null> {
  const user = req.user;
  if (user === undefined) {
    sendError(req, res, 401, "unauthenticated", "Sign in to continue.");
    return null;
  }
  const parsed = examSessionParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: "invalid_request",
        message: "Invalid input",
        details: parsed.error.flatten(),
      },
      meta: meta(req),
    });
    return null;
  }
  try {
    const read = await readExamReport(user.id, parsed.data.session_id, () =>
      EntitlementService.canAccessFeature(user.id, EXAM_FEATURE_KEY),
    );
    if (read.kind === "forbidden") {
      sendError(req, res, 403, "forbidden", "Report not available.");
      return null;
    }
    logger.info(COMPONENT, operation, "exam report served", {
      requestId: req.requestId,
      reportState: read.state,
    });
    return read.payload;
  } catch (error) {
    if (error instanceof ReportIntegrityError) {
      logger.error(
        COMPONENT,
        "report_data_integrity_violation",
        "report invariant violated",
        {
          operation,
          requestId: req.requestId,
          reason: error.message,
        },
      );
      sendError(
        req,
        res,
        500,
        "report_data_integrity_violation",
        "This report can't be shown right now.",
      );
      return null;
    }
    logger.error(
      COMPONENT,
      `${operation}_failed`,
      "an exam report route failed",
      {
        operation,
        requestId: req.requestId,
        reason: error instanceof Error ? error.message : "unknown",
      },
    );
    sendError(req, res, 500, "internal_error", "Something went wrong.");
    return null;
  }
}

const studentGuards = [requireProfileComplete, requireConsentCompliance];

router.get(
  "/sessions/:session_id/report",
  ...studentGuards,
  async (req: Request, res: Response) => {
    const payload = await reportFor(req, res, "report");
    if (payload === null) return;
    return res.status(200).json({ data: payload, meta: meta(req) });
  },
);

router.get(
  "/sessions/:session_id/report/status",
  ...studentGuards,
  async (req: Request, res: Response) => {
    const payload = await reportFor(req, res, "report_status");
    if (payload === null) return;
    const status = examReportStatusSchema.parse({
      report_state: payload.report_state,
      review_unlocked: payload.review_unlocked,
      ...(payload.report_state === "scoring_pending"
        ? { estimated_ready_at: payload.estimated_ready_at }
        : {}),
    });
    return res.status(200).json({ data: status, meta: meta(req) });
  },
);

export default router;
