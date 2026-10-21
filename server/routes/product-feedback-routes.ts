/**
 * /api/feedback — the review prompt, in-app reviews and private feedback.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R28 (one neutral prompt; in-app review 13+,
 *       bucketed; Trustpilot guardians + 18+; private feedback), R29 (reviews anonymous), R30
 *       (cadence), row Q6; owner Step 0 answers 3, 4, 6, 8 (2026-10-05); owner brief "Review
 *       ask" and Karl's Step 0 decisions 3, 4, 8 (2026-10-20: usage trigger, 2 asks, 30-day
 *       snooze, counts-only PostHog events); Coding Standards §8.1 (auth → entitlement → parse →
 *       domain → serialize), §8.2 ({ data } / { error }), §4.2 (idempotent mutations)]
 *       | @implemented [2026-10-05; review ask 2026-10-20]
 *
 * plain English:
 *   GET  /prompt?moment=…      { data: { show:false } | { show:true, trustpilot_eligible } }.
 *                              Moments: home (student), guardian_home (guardian), email_return
 *                              (either, after the follow-up email). A counted yes is also the
 *                              record that the ask was made.
 *   POST /prompt/respond       204. { response: snoozed | dismissed } — "Not now" or the close
 *                              button, both a 30-day snooze. Once per ask.
 *   POST /prompt/trustpilot    204, or 403 for anyone under 18. Counts as reviewed.
 *   POST /reviews              201 created / 200 replay / 409 a different review exists / 403.
 *   POST /feedback             201 created / 200 replay (same idempotency_key) / 403 / 429.
 *                              Carries the type, reply-OK, the route pattern and the app version
 *                              (final brief, Karl 2026-10-20); a new row posts one line to Slack
 *                              #social (feedback-slack.ts) and counts `feedback_submitted`.
 *
 * The caller's role and date of birth are read from their profile here, never taken from the
 * request; the audience bucket is derived from them. No entitlement gate: reviews and feedback
 * are not a paid feature, and the prompt's moments each apply the entitlement of the surface
 * they come from.
 *
 * Privacy: review and feedback text is never logged; logs carry outcomes and the request id.
 *
 * Analytics (Karl's decision 8, 2026-10-20): counts only, through the canonical emitter (which
 * refuses under-13s): `review_ask_shown` (a counted ask), `review_ask_clicked` (Trustpilot, an
 * in-app review created, or private feedback sent from the ask) and `review_ask_snoozed`. Each
 * carries the audience and an age band, never a rating, text or date of birth.
 */
import { Router, type Request, type Response } from "express";
import {
  getSupabaseAdmin,
  requireRequestUser,
} from "../middleware/supabase-auth";
import { singleBucketRateLimit } from "../middleware/rate-limit";
import { toIsoDate } from "../lib/role-choice";
import { emitEvent } from "../lib/analytics/emit-event";
import { postFeedbackToSlack } from "../lib/feedback-slack";
import { logger } from "../logger";
import {
  markTrustpilot,
  respondToPrompt,
  reviewPromptFor,
  submitFeedback,
  submitReview,
  type FeedbackCaller,
  type FeedbackDeps,
  type MomentChecks,
} from "../services/product-feedback/product-feedback-service";
import { liveMomentChecks } from "../services/product-feedback/moments";
import {
  feedbackAgeBand,
  feedbackSubmitSchema,
  reviewAskAnalytics,
  reviewPromptQuerySchema,
  reviewPromptRespondSchema,
  reviewPromptResponseSchema,
  reviewSubmitSchema,
  submitAckSchema,
  trustpilotEligible,
} from "../../packages/shared/src/product-feedback-schema";

const COMPONENT = "PRODUCT_FEEDBACK";

export type ProductFeedbackRouteDeps = {
  /** The admin client; injected so the contract test can stand in for it. */
  db: () => ReturnType<typeof getSupabaseAdmin>;
  moments: (requestId: string | undefined) => MomentChecks;
  now: () => Date;
};

const defaultDeps: ProductFeedbackRouteDeps = {
  db: getSupabaseAdmin,
  moments: liveMomentChecks,
  now: () => new Date(),
};

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

export function createProductFeedbackRouter(
  deps: ProductFeedbackRouteDeps = defaultDeps,
): Router {
  const router = Router();

  /** The authenticated caller's role and date of birth, from their own profile row. */
  async function loadCaller(
    req: Request,
    res: Response,
  ): Promise<FeedbackCaller | null> {
    const user = requireRequestUser(req, res);
    if (!user) return null;
    const { data, error } = await deps
      .db()
      .from("profiles")
      .select("role, date_of_birth, is_under_13")
      .eq("id", user.id)
      .single();
    if (error || !data) {
      logger.error(
        COMPONENT,
        "caller_read_failed",
        "Could not load the caller",
        {
          requestId: req.requestId,
        },
      );
      sendError(res, 500, "INTERNAL", "Something went wrong.");
      return null;
    }
    const row = data as {
      role: unknown;
      date_of_birth: unknown;
      is_under_13: unknown;
    };
    return {
      profileId: user.id,
      role: String(row.role),
      dateOfBirth: toIsoDate(row.date_of_birth),
      // Unknown counts as under 13 (fail closed), as the emitter and feature access treat it.
      isUnder13: row.is_under_13 !== false,
    };
  }

  /** Analytics never fail a request; the emitter logs its own refusals. */
  async function emitSafely(
    emission: Promise<unknown>,
    requestId: string | undefined,
  ): Promise<void> {
    try {
      await emission;
    } catch (error) {
      logger.warn(
        COMPONENT,
        "analytics_emit_failed",
        "Review analytics failed",
        {
          requestId,
          reason: error instanceof Error ? error.message : "unknown",
        },
      );
    }
  }

  function serviceDeps(req: Request): FeedbackDeps {
    return {
      client: deps.db(),
      moments: deps.moments(req.requestId),
      now: deps.now,
    };
  }

  function fail(
    req: Request,
    res: Response,
    op: string,
    error: unknown,
  ): Response {
    logger.error(COMPONENT, `${op}_failed`, "A feedback route failed", {
      requestId: req.requestId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return sendError(res, 500, "INTERNAL", "Something went wrong.");
  }

  router.get("/prompt", async (req: Request, res: Response) => {
    try {
      const caller = await loadCaller(req, res);
      if (!caller) return;
      const parsed = reviewPromptQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendError(
          res,
          400,
          "INVALID_REQUEST",
          "Invalid input",
          parsed.error.flatten(),
        );
      }
      const answer = await reviewPromptFor(
        serviceDeps(req),
        caller,
        parsed.data,
      );
      if (answer.response.show) {
        logger.info(COMPONENT, "prompt_shown", "Review prompt shown", {
          moment: parsed.data.moment,
          askNumber: answer.askNumber,
          requestId: req.requestId,
        });
      }
      const bucket = reviewAskAnalytics(
        caller.role,
        caller.dateOfBirth,
        deps.now(),
      );
      if (answer.askNumber !== null && bucket !== null) {
        await emitSafely(
          emitEvent(caller.profileId, "review_ask_shown", {
            ...bucket,
            ask_number: answer.askNumber,
          }),
          req.requestId,
        );
      }
      // Never cached: a yes is a one-time claim.
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        data: reviewPromptResponseSchema.parse(answer.response),
      });
    } catch (error) {
      return fail(req, res, "prompt", error);
    }
  });

  router.post("/prompt/respond", async (req: Request, res: Response) => {
    try {
      const caller = await loadCaller(req, res);
      if (!caller) return;
      const parsed = reviewPromptRespondSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(
          res,
          400,
          "INVALID_REQUEST",
          "Invalid input",
          parsed.error.flatten(),
        );
      }
      const recorded = await respondToPrompt(
        serviceDeps(req),
        caller,
        parsed.data,
      );
      const bucket = reviewAskAnalytics(
        caller.role,
        caller.dateOfBirth,
        deps.now(),
      );
      if (recorded && bucket !== null) {
        await emitSafely(
          emitEvent(caller.profileId, "review_ask_snoozed", {
            ...bucket,
            via: parsed.data.response === "snoozed" ? "not_now" : "close",
          }),
          req.requestId,
        );
      }
      return res.status(204).end();
    } catch (error) {
      return fail(req, res, "respond", error);
    }
  });

  router.post("/prompt/trustpilot", async (req: Request, res: Response) => {
    try {
      const caller = await loadCaller(req, res);
      if (!caller) return;
      if (!trustpilotEligible(caller.role, caller.dateOfBirth, deps.now())) {
        return sendError(
          res,
          403,
          "NOT_ELIGIBLE",
          "Not available for this account.",
        );
      }
      await markTrustpilot(serviceDeps(req), caller);
      const bucket = reviewAskAnalytics(
        caller.role,
        caller.dateOfBirth,
        deps.now(),
      );
      if (bucket !== null) {
        await emitSafely(
          emitEvent(caller.profileId, "review_ask_clicked", {
            ...bucket,
            destination: "trustpilot",
          }),
          req.requestId,
        );
      }
      return res.status(204).end();
    } catch (error) {
      return fail(req, res, "trustpilot", error);
    }
  });

  router.post("/reviews", async (req: Request, res: Response) => {
    try {
      const caller = await loadCaller(req, res);
      if (!caller) return;
      const parsed = reviewSubmitSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(
          res,
          400,
          "INVALID_REQUEST",
          "Invalid input",
          parsed.error.flatten(),
        );
      }
      const result = await submitReview(serviceDeps(req), caller, parsed.data);
      if (!result.ok) {
        if (result.reason === "already_reviewed") {
          return sendError(
            res,
            409,
            "ALREADY_REVIEWED",
            "You've already left a review.",
          );
        }
        return sendError(
          res,
          403,
          "NOT_ELIGIBLE",
          "Not available for this account.",
        );
      }
      logger.info(COMPONENT, "review_stored", "Review stored", {
        outcome: result.outcome,
        requestId: req.requestId,
      });
      const bucket = reviewAskAnalytics(
        caller.role,
        caller.dateOfBirth,
        deps.now(),
      );
      if (result.outcome === "created" && bucket !== null) {
        await emitSafely(
          emitEvent(caller.profileId, "review_ask_clicked", {
            ...bucket,
            destination: "in_app_review",
          }),
          req.requestId,
        );
      }
      return res
        .status(result.outcome === "created" ? 201 : 200)
        .json({ data: submitAckSchema.parse({ outcome: result.outcome }) });
    } catch (error) {
      return fail(req, res, "review", error);
    }
  });

  router.post(
    "/feedback",
    singleBucketRateLimit("product_feedback", COMPONENT),
    async (req: Request, res: Response) => {
      try {
        const caller = await loadCaller(req, res);
        if (!caller) return;
        const parsed = feedbackSubmitSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            "INVALID_REQUEST",
            "Invalid input",
            parsed.error.flatten(),
          );
        }
        const result = await submitFeedback(
          serviceDeps(req),
          caller,
          parsed.data,
        );
        if (!result.ok) {
          if (result.reason === "reply_not_allowed") {
            return sendError(
              res,
              403,
              "REPLY_NOT_ALLOWED",
              "We can't reply by email to this account.",
            );
          }
          return sendError(
            res,
            403,
            "NOT_ELIGIBLE",
            "Not available for this account.",
          );
        }
        logger.info(COMPONENT, "feedback_stored", "Feedback stored", {
          outcome: result.outcome,
          source: parsed.data.source,
          type: parsed.data.type,
          requestId: req.requestId,
        });
        if (
          result.outcome === "created" &&
          (caller.role === "student" || caller.role === "guardian")
        ) {
          // Final brief §5 (Karl, 2026-10-20; SCL-237): one line to #social. Never blocks or fails
          // the submission: postFeedbackToSlack never throws and logs no content.
          await postFeedbackToSlack(
            {
              type: parsed.data.type,
              routePattern: parsed.data.route_pattern,
              role: caller.role,
              ageBand: feedbackAgeBand(caller.dateOfBirth, deps.now()),
              replyOk: parsed.data.reply_ok,
              body: parsed.data.body,
            },
            { requestId: req.requestId },
          );
          // Final brief §6: counts only — the type and the role.
          await emitSafely(
            emitEvent(caller.profileId, "feedback_submitted", {
              type: parsed.data.type,
              role: caller.role,
            }),
            req.requestId,
          );
        }
        const bucket = reviewAskAnalytics(
          caller.role,
          caller.dateOfBirth,
          deps.now(),
        );
        if (
          result.outcome === "created" &&
          parsed.data.source === "prompt" &&
          bucket !== null
        ) {
          await emitSafely(
            emitEvent(caller.profileId, "review_ask_clicked", {
              ...bucket,
              destination: "private_feedback",
            }),
            req.requestId,
          );
        }
        return res
          .status(result.outcome === "created" ? 201 : 200)
          .json({ data: submitAckSchema.parse({ outcome: result.outcome }) });
      } catch (error) {
        return fail(req, res, "feedback", error);
      }
    },
  );

  return router;
}

export default createProductFeedbackRouter();
