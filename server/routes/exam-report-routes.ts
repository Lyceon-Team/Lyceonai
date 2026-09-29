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
 * STUDENT PROJECTION (SCL-180 amended 2026-09-29, owner ruling 7; Doc 04C §8.1/§9.1;
 * @implemented [2026-09-29]): /report sends `toStudentExamReport` of the server-side
 * report — seven segments per domain, never correct/total. The projection runs inside
 * `reportFor`'s try, so a payload the strict student schema refuses is a logged 500, not a
 * leak.
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
  type ExamReportStatus,
} from "../../packages/shared/src/exam-report-schema";
import {
  toStudentExamReport,
  type ExamStudentReportPayload,
} from "../../packages/shared/src/exam-student-report-schema";
import { EXAM_FEATURE_KEY } from "./exam-runtime-routes";
import { logRejectedRequest, routeOf } from "../lib/validation-log";

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
  details?: unknown,
): Response {
  if (status === 400) {
    logRejectedRequest("EXAM_REPORT", details, {
      code,
      requestId: req.requestId,
      ...routeOf(res),
    });
  }
  return res.status(status).json({
    error:
      details === undefined ? { code, message } : { code, message, details },
    meta: meta(req),
  });
}

/**
 * §16.5 steps 1-7 for one session, then `project` (the serialize step) inside the same
 * error handling; null after an error response was sent.
 */
async function reportFor<T>(
  req: Request,
  res: Response,
  operation: string,
  project: (payload: ExamReportPayload) => T,
): Promise<T | null> {
  const user = req.user;
  if (user === undefined) {
    sendError(req, res, 401, "unauthenticated", "Sign in to continue.");
    return null;
  }
  const parsed = examSessionParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    // THROUGH THE HELPER, which this branch used to step around. `sendError` wrote every
    // other refusal on this router (401, 403, 500) and this one wrote its own response
    // inline — so the one refusal that had field names to report was the one that did not
    // go past the place they would be logged.
    sendError(
      req,
      res,
      400,
      "invalid_request",
      "Invalid input",
      parsed.error.flatten(),
    );
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
    const projected = project(read.payload);
    logger.info(COMPONENT, operation, "exam report served", {
      requestId: req.requestId,
      reportState: read.state,
    });
    return projected;
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

function toStatus(payload: ExamReportPayload): ExamReportStatus {
  return examReportStatusSchema.parse({
    report_state: payload.report_state,
    review_unlocked: payload.review_unlocked,
    ...(payload.report_state === "scoring_pending"
      ? { estimated_ready_at: payload.estimated_ready_at }
      : {}),
  });
}

const studentGuards = [requireProfileComplete, requireConsentCompliance];

router.get(
  "/sessions/:session_id/report",
  ...studentGuards,
  async (req: Request, res: Response) => {
    const payload: ExamStudentReportPayload | null = await reportFor(
      req,
      res,
      "report",
      toStudentExamReport,
    );
    if (payload === null) return;
    return res.status(200).json({ data: payload, meta: meta(req) });
  },
);

router.get(
  "/sessions/:session_id/report/status",
  ...studentGuards,
  async (req: Request, res: Response) => {
    const status = await reportFor(req, res, "report_status", toStatus);
    if (status === null) return;
    return res.status(200).json({ data: status, meta: meta(req) });
  },
);

export default router;
