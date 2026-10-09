/**
 * /api/qotd — the Question of the Day on the student's Home.
 *
 * @spec [owner brief "Question of the Day on Home, daily streak, email, SAT dates in onboarding"
 *       (Karl, decisions 2026-10-08/09) Part B "API" and "Analytics"; SCL-224; SCL-225; Coding
 *       Standards §8.1 (auth → entitlement → parse → domain → serialize), §8.2 ({ data } /
 *       { error }), §5.2 (no answer or explanation before submit), §4.2 (idempotent)]
 *       | @implemented [2026-10-09]
 *
 * plain English:
 *   GET  /today          { data: HomeQotdTodayResponse }. state none | unanswered | answered.
 *   POST /answer         { data: HomeQotdAnswerResponse }: 201 first answer, 200 replay of the
 *                        same idempotency_key, 409 a second different answer the same day (or the
 *                        day changed under the client), 400 not one of today's options.
 *   POST /email-consent  { data: { consented, show_email_prompt:false } }: 403 under-13 or not
 *                        eligible; 409 "never" before it is offered (3rd ask).
 *
 * Mounted behind requireSupabaseAuth → doubleCsrfProtection → requireStudentAccount (students
 * only; an under-13 without an active guardian link is refused like every student surface). No
 * entitlement gate: the QOTD and the streak are free for everyone (brief, Part B). Each route has
 * its own RateLimitLedger bucket.
 *
 * Analytics go through the canonical server emitter (`emitEvent`), which already refuses under-13
 * and not-onboarded accounts; the payloads carry no question, choice or answer.
 *
 * Privacy: logs carry outcomes and the request id only.
 */
import { Router, type Request, type Response } from "express";
import { requireRequestUser } from "../middleware/supabase-auth";
import { singleBucketRateLimit } from "../middleware/rate-limit";
import { emitEvent } from "../lib/analytics/emit-event";
import { logger } from "../logger";
import {
  answerHomeQotd,
  decideHomeQotdEmail,
  getHomeQotdToday,
  type HomeQotdSignals,
} from "../services/qotd/home-qotd-service";
import {
  homeQotdAnswerRequestSchema,
  homeQotdEmailConsentRequestSchema,
  homeQotdEmailConsentResponseSchema,
} from "../../packages/shared/src/home-qotd-schema";

const COMPONENT = "HOME_QOTD";

export type HomeQotdRouteDeps = { now: () => Date };

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return res.status(status).json({
    error:
      details === undefined ? { code, message } : { code, message, details },
  });
}

/** Analytics never fail a request; a refusal or error is logged by the emitter itself. */
async function emitSafely(
  studentId: string,
  event: string,
  payload: Record<string, unknown>,
  requestId: string | undefined,
): Promise<void> {
  try {
    await emitEvent(studentId, event, payload);
  } catch (error) {
    logger.warn(COMPONENT, "analytics_emit_failed", "QOTD analytics failed", {
      requestId,
      event,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

async function emitAnswerSignals(
  studentId: string,
  signals: HomeQotdSignals,
  requestId: string | undefined,
): Promise<void> {
  if (
    signals.answeredNow &&
    signals.isCorrect !== null &&
    signals.sectionCode
  ) {
    await emitSafely(
      studentId,
      "qotd_answered",
      { is_correct: signals.isCorrect, section_code: signals.sectionCode },
      requestId,
    );
  }
  if (signals.streakExtendedTo !== null) {
    await emitSafely(
      studentId,
      "streak_extended",
      { streak_current: signals.streakExtendedTo },
      requestId,
    );
  }
  if (signals.promptShownAsk !== null) {
    await emitSafely(
      studentId,
      "qotd_email_prompt_shown",
      { ask_number: signals.promptShownAsk },
      requestId,
    );
  }
}

export function createHomeQotdRouter(
  deps: HomeQotdRouteDeps = { now: () => new Date() },
): Router {
  const router = Router();

  function fail(
    req: Request,
    res: Response,
    op: string,
    error: unknown,
  ): Response {
    logger.error(COMPONENT, `${op}_failed`, "A home QOTD route failed", {
      requestId: req.requestId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return sendError(res, 500, "INTERNAL", "Something went wrong.");
  }

  router.get(
    "/today",
    singleBucketRateLimit("qotd_student_read", COMPONENT),
    async (req: Request, res: Response) => {
      const user = requireRequestUser(req, res);
      if (!user) return;
      try {
        const data = await getHomeQotdToday(
          { id: user.id, actorId: user.actor_id },
          deps.now(),
        );
        if (data.state !== "none") {
          await emitSafely(
            user.id,
            "qotd_viewed",
            { qotd_state: data.state },
            req.requestId,
          );
        }
        return res.status(200).json({ data });
      } catch (error) {
        return fail(req, res, "today", error);
      }
    },
  );

  router.post(
    "/answer",
    singleBucketRateLimit("qotd_student_answer", COMPONENT),
    async (req: Request, res: Response) => {
      const user = requireRequestUser(req, res);
      if (!user) return;
      const parsed = homeQotdAnswerRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(
          res,
          400,
          "INVALID_REQUEST",
          "Invalid input",
          parsed.error.flatten(),
        );
      }
      try {
        const result = await answerHomeQotd(
          { id: user.id, actorId: user.actor_id },
          parsed.data,
          req.requestId,
          deps.now(),
        );
        if (!result.ok) {
          return sendError(
            res,
            result.error.status,
            result.error.code,
            result.error.message,
          );
        }
        const { response, signals } = result.value;
        await emitAnswerSignals(user.id, signals, req.requestId);
        return res
          .status(signals.answeredNow ? 201 : 200)
          .json({ data: response });
      } catch (error) {
        return fail(req, res, "answer", error);
      }
    },
  );

  router.post(
    "/email-consent",
    singleBucketRateLimit("qotd_email_consent", COMPONENT),
    async (req: Request, res: Response) => {
      const user = requireRequestUser(req, res);
      if (!user) return;
      const parsed = homeQotdEmailConsentRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(
          res,
          400,
          "INVALID_REQUEST",
          "Invalid input",
          parsed.error.flatten(),
        );
      }
      try {
        const result = await decideHomeQotdEmail(
          user.id,
          parsed.data.decision,
          parsed.data.consent_version,
          deps.now(),
        );
        if (!result.ok) {
          return sendError(
            res,
            result.error.status,
            result.error.code,
            result.error.message,
          );
        }
        await emitSafely(
          user.id,
          "qotd_email_consent",
          { decision: parsed.data.decision },
          req.requestId,
        );
        logger.info(COMPONENT, "qotd_email_decision", "QOTD email decision", {
          requestId: req.requestId,
          decision: parsed.data.decision,
        });
        return res.status(200).json({
          data: homeQotdEmailConsentResponseSchema.parse({
            consented: result.value.consented,
            show_email_prompt: false,
          }),
        });
      } catch (error) {
        return fail(req, res, "email_consent", error);
      }
    },
  );

  return router;
}

export default createHomeQotdRouter();
