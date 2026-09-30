/**
 * The post-exam score report and retake answer — three thin handlers.
 *
 * @spec [Doc-01_V8 §36.4, §928, §955; SCL-191;
 *        lyceon-coding-standards §8.1 (thin handlers, fixed order), §8.2 (response shape),
 *        §8.3 (status codes)]
 * | @implemented [2026-09-30]
 *
 * plain English: every handler here is auth → Zod (inside the service, with `unknown` in) →
 * delegate → map. There is no workflow in this file. `server/services/exam-score-renewal/service.ts`
 * decides what happens; these functions decide what HTTP status says it.
 *
 * NO ENTITLEMENT GATE, and it is a decision rather than an omission. This surface is not a paid
 * feature — it is a question we asked, and the AUTHORISATION IS THE PROMPT: a caller with no
 * post-exam `notification_events` row gets 404, so nobody can answer an occasion we never raised.
 * A student whose entitlement lapsed between the prompt and the answer can still answer, which is
 * the only humane reading: refusing to let somebody tell us they have stopped studying would be
 * perverse, and it is the direction that keeps charging them.
 *
 * THE STUDENT'S OWN ID COMES FROM THE VERIFIED SESSION, never from a body or a param, so there is
 * no route here that can be pointed at another student's occasion. A paying guardian has no write
 * route on this surface at all: Doc 01 §928 already gives them the Customer Portal, and adding a
 * second cancellation path over a student's occasion would fork the one this product has chosen.
 *
 * ERRORS: 400 invalid body · 401 unauthenticated · 404 no prompt (and for an occasion that is not
 * the one we asked about — a mismatch is not a distinguishable resource) · 502 Stripe refused ·
 * 500 with an ERROR log. A refusal is a DECISION and gets its own status, never a 500.
 */
import { Router, type Request, type Response } from "express";
import { logger } from "../logger";
import {
  readScoreReportSurface,
  submitRenewalDecision,
  submitScoreReport,
  type ScoreRenewalFailure,
} from "../services/exam-score-renewal/service";

export const scoreReportRouter = Router();

function sendError(
  res: Response,
  status: number,
  message: string,
  code: string,
  requestId: string | undefined,
  details?: unknown,
): void {
  res.status(status).json({
    error: {
      message,
      code,
      ...(details === undefined ? {} : { details }),
      ...(requestId === undefined ? {} : { requestId }),
    },
  });
}

/**
 * The authenticated caller's own profile id.
 *
 * `req.user` is the canonical `SupabaseUser` the auth middleware attached; nothing here
 * re-declares its shape, because a hand-rolled `{ id: string }` would hide every other field from
 * the next reader and invite the nearest thing that compiles (SCL-151).
 */
function callerId(req: Request, res: Response): string | null {
  const user = req.user;
  if (user === undefined) {
    sendError(
      res,
      401,
      "Sign in to continue.",
      "UNAUTHENTICATED",
      req.requestId,
    );
    return null;
  }
  return user.id;
}

/**
 * One mapping from service failure to status, used by all three handlers, so a new failure kind
 * cannot acquire a different status depending on which route met it first.
 *
 * `occasion_mismatch` is a 404 and not a 409: a body naming a date we never asked about is not a
 * conflict with the current state, it is a reference to a resource that does not exist. Answering
 * 409 would tell the caller that some other occasion does exist, which is more than they asked.
 */
function sendFailure(
  res: Response,
  failure: ScoreRenewalFailure,
  requestId: string | undefined,
  operation: string,
): void {
  switch (failure.kind) {
    case "no_prompt":
    case "occasion_mismatch":
      sendError(
        res,
        404,
        "There is nothing to answer right now.",
        "NO_PENDING_PROMPT",
        requestId,
      );
      return;
    case "invalid":
      sendError(
        res,
        400,
        "That does not look like a Digital SAT score.",
        "INVALID_SCORE_REPORT",
        requestId,
        failure.details,
      );
      return;
    case "stripe_failed":
      sendError(
        res,
        502,
        "We could not reach the billing provider. Nothing has changed — please try again.",
        "BILLING_PROVIDER_UNAVAILABLE",
        requestId,
      );
      return;
    case "read_failed":
    case "write_failed":
      logger.error(
        "BILLING",
        operation,
        "the score report surface failed on a database read or write",
        { requestId, failure: failure.kind },
      );
      sendError(
        res,
        500,
        "Something went wrong. Please try again.",
        "SCORE_REPORT_UNAVAILABLE",
        requestId,
      );
      return;
  }
}

/**
 * GET /api/score-report — what the student is being asked, and what they have already answered.
 */
scoreReportRouter.get(
  "/",
  async (req: Request, res: Response): Promise<void> => {
    const studentId = callerId(req, res);
    if (studentId === null) return;

    const result = await readScoreReportSurface(studentId, req.requestId);
    if (!result.ok) {
      sendFailure(res, result.error, req.requestId, "score_report_read");
      return;
    }
    res.json({ data: result.value });
  },
);

/**
 * POST /api/score-report — the reported total and section scores.
 *
 * 201, because every submission creates a row: both versions are retained and the latest wins
 * (owner ruling 2026-09-30 #4), so a correction is a new resource and not an update to an old one.
 */
scoreReportRouter.post(
  "/",
  async (req: Request, res: Response): Promise<void> => {
    const studentId = callerId(req, res);
    if (studentId === null) return;

    const result = await submitScoreReport(studentId, req.body, req.requestId);
    if (!result.ok) {
      sendFailure(res, result.error, req.requestId, "score_report_submit");
      return;
    }
    res.status(201).json({ data: { reportId: result.value.reportId } });
  },
);

/**
 * POST /api/score-report/renewal — the retake answer.
 *
 * 200 and the action taken, so the client can say what happened rather than guessing: a self-paid
 * student sees `cancel_at_period_end`, and a student on a guardian-funded subscription sees `none`
 * and the copy that explains why (their guardian is the one being charged).
 */
scoreReportRouter.post(
  "/renewal",
  async (req: Request, res: Response): Promise<void> => {
    const studentId = callerId(req, res);
    if (studentId === null) return;

    const result = await submitRenewalDecision(
      studentId,
      req.body,
      req.requestId,
    );
    if (!result.ok) {
      sendFailure(res, result.error, req.requestId, "renewal_decision_submit");
      return;
    }
    res.json({
      data: { decision: result.value.decision, action: result.value.action },
    });
  },
);

export default scoreReportRouter;
