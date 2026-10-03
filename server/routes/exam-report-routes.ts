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
 * router stays report-free), plus the OQ-30 scored-sessions list at the bottom of this
 * file (its own order and gate — see its annotation). The two per-session reads run
 * in 04C §16.5's order rather than the generic auth -> entitlement -> Zod order: auth (401) -> Zod params (400) -> ownership in
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
  requireGuardianLinkForUnder13,
} from "../middleware/supabase-auth.js";
import { logger } from "../logger";
import { EntitlementService } from "../services/entitlement-service";
import {
  ReportIntegrityError,
  listScoredSessions,
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
import {
  EXAM_ENTITLEMENT_DENIED_MESSAGE,
  EXAM_FEATURE_KEY,
} from "./exam-runtime-routes";
import {
  EXAM_SCORED_SESSIONS_LIMIT,
  examScoredSessionsQuerySchema,
  type ExamScoredSessionsPayload,
} from "../../packages/shared/src/exam-scored-sessions-schema";
import { ENTITLEMENT_REQUIRED_CODE } from "../../packages/shared/src/entitlement-denial";
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

const studentGuards = [requireProfileComplete, requireGuardianLinkForUnder13];

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

/**
 * OQ-30 — the student's scored full-length sessions (score history).
 *
 * @spec [Doc-04C_V1.0 §16.3 (multi-session listing; brought into V1.0 by SCL-207, owner
 *        ruling (Karl) 2026-10-03, register OQ-40), §15.1 (disclosure on every scaled score), §16.7 (codes), §16.8
 *        (envelope {data, meta})]
 *       [Doc-04A_V2.2 §16.1 step 2, §16.2; SCL-185 (UI-01): the exam entitlement denial]
 *       [Owner ruling (Karl) 2026-10-02, student-ui register §9 OQ-30: "approved. A read of the
 *        student's completed full-length results (date, total, sections)."; OQ-31]
 * @implemented [2026-10-03]
 *
 * plain English: GET /api/tests/sessions?state=scored. Coding Standards §8.1 order, which is
 * NOT the per-session §16.5 order above: there is no session id to classify, so nothing can
 * be enumerated and the `revoked` → 200 `unavailable` branch has no subject. The gate is the
 * exam runtime's: auth (401) -> canAccessFeature(exam_full_length), refused with the UI-01
 * body (403, `entitlement_required`, `details.feature: "exam_full_length"`) -> Zod query (400;
 * only `state=scored`) -> one SQL read restricted to the caller's own sessions -> the strict
 * wire schema -> {data, meta}.
 *
 * trade-offs / edge cases:
 *  - A lapsed student gets the 403, not a list of `unavailable` rows: the entitlement denial is
 *    the exam surface's (UI-01) and the owner's gate for this read; their per-session reports
 *    still answer 200 `unavailable` (§11.5b).
 *  - No cursor (§16.3 gives no rule): at most EXAM_SCORED_SESSIONS_LIMIT newest rows. Hitting
 *    the cap is logged (`truncated`), never signalled by an extra payload field.
 *  - Logs carry the request id, the row count and the truncation flag — never a score.
 */
router.get(
  "/sessions",
  ...studentGuards,
  async (req: Request, res: Response) => {
    const user = req.user;
    if (user === undefined) {
      return sendError(
        req,
        res,
        401,
        "unauthenticated",
        "Sign in to continue.",
      );
    }
    try {
      if (
        !(await EntitlementService.canAccessFeature(user.id, EXAM_FEATURE_KEY))
      ) {
        logger.info(
          COMPONENT,
          "entitlement_denied",
          "a caller without exam_full_length was refused",
          { path: req.path, requestId: req.requestId },
        );
        return sendError(
          req,
          res,
          403,
          ENTITLEMENT_REQUIRED_CODE,
          EXAM_ENTITLEMENT_DENIED_MESSAGE,
          { feature: EXAM_FEATURE_KEY },
        );
      }
      const query = examScoredSessionsQuerySchema.safeParse(req.query);
      if (!query.success) {
        return sendError(
          req,
          res,
          400,
          "invalid_request",
          "Invalid input",
          query.error.flatten(),
        );
      }
      const read = await listScoredSessions(user.id);
      const data: ExamScoredSessionsPayload = read.payload;
      logger.info(COMPONENT, "scored_sessions", "scored sessions served", {
        requestId: req.requestId,
        count: data.sessions.length,
        truncated: read.truncated,
        limit: EXAM_SCORED_SESSIONS_LIMIT,
      });
      return res.status(200).json({ data, meta: meta(req) });
    } catch (error) {
      if (error instanceof ReportIntegrityError) {
        logger.error(
          COMPONENT,
          "report_data_integrity_violation",
          "report invariant violated",
          {
            operation: "scored_sessions",
            requestId: req.requestId,
            reason: error.message,
          },
        );
        return sendError(
          req,
          res,
          500,
          "report_data_integrity_violation",
          "This report can't be shown right now.",
        );
      }
      logger.error(
        COMPONENT,
        "scored_sessions_failed",
        "an exam report route failed",
        {
          operation: "scored_sessions",
          requestId: req.requestId,
          reason: error instanceof Error ? error.message : "unknown",
        },
      );
      return sendError(
        req,
        res,
        500,
        "internal_error",
        "Something went wrong.",
      );
    }
  },
);

export default router;
