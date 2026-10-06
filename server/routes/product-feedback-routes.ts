/**
 * /api/feedback — the review prompt, in-app reviews and private feedback.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R28 (one neutral prompt; in-app review 13+,
 *       bucketed; Trustpilot guardians + 18+; private feedback), R29 (reviews anonymous), R30
 *       (cadence), row Q6; owner Step 0 answers 3, 4, 6, 8 (2026-10-05); Coding Standards §8.1
 *       (auth → entitlement → parse → domain → serialize), §8.2 ({ data } / { error }), §4.2
 *       (idempotent mutations)] | @implemented [2026-10-05]
 *
 * plain English:
 *   GET  /prompt?moment=…      { data: { show:false } | { show:true, trustpilot_eligible } }.
 *                              Moments: exam_report (+session_id), study_week, guardian_week
 *                              (+student_id). A yes is also the record that it was shown.
 *   POST /prompt/dismiss       204. Counts once per showing.
 *   POST /prompt/trustpilot    204, or 403 for anyone under 18. Counts as reviewed.
 *   POST /reviews              201 created / 200 replay / 409 a different review exists / 403.
 *   POST /feedback             201 created / 200 replay (same idempotency_key) / 403 / 429.
 *
 * The caller's role and date of birth are read from their profile here, never taken from the
 * request; the audience bucket is derived from them. No entitlement gate: reviews and feedback
 * are not a paid feature, and the prompt's moments each apply the entitlement of the surface
 * they come from.
 *
 * Privacy: review and feedback text is never logged; logs carry outcomes and the request id.
 */
import { Router, type Request, type Response } from "express";
import {
  getSupabaseAdmin,
  requireRequestUser,
} from "../middleware/supabase-auth";
import { singleBucketRateLimit } from "../middleware/rate-limit";
import { toIsoDate } from "../lib/role-choice";
import { logger } from "../logger";
import {
  dismissPrompt,
  markTrustpilot,
  reviewPromptFor,
  submitFeedback,
  submitReview,
  type FeedbackCaller,
  type FeedbackDeps,
  type MomentChecks,
} from "../services/product-feedback/product-feedback-service";
import { liveMomentChecks } from "../services/product-feedback/moments";
import {
  feedbackSubmitSchema,
  reviewPromptQuerySchema,
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
      .select("role, date_of_birth")
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
    const row = data as { role: unknown; date_of_birth: unknown };
    return {
      profileId: user.id,
      role: String(row.role),
      dateOfBirth: toIsoDate(row.date_of_birth),
    };
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
      if (answer.show) {
        logger.info(COMPONENT, "prompt_shown", "Review prompt shown", {
          moment: parsed.data.moment,
          requestId: req.requestId,
        });
      }
      // Never cached: a yes is a one-time claim.
      res.setHeader("Cache-Control", "no-store");
      return res.json({ data: reviewPromptResponseSchema.parse(answer) });
    } catch (error) {
      return fail(req, res, "prompt", error);
    }
  });

  router.post("/prompt/dismiss", async (req: Request, res: Response) => {
    try {
      const caller = await loadCaller(req, res);
      if (!caller) return;
      await dismissPrompt(serviceDeps(req), caller);
      return res.status(204).end();
    } catch (error) {
      return fail(req, res, "dismiss", error);
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
          requestId: req.requestId,
        });
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
