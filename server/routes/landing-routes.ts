/**
 * Smart landing routes: POST /api/landing/open, /escape and /more.
 *
 * @spec [owner brief "Smart landing" (Karl, 2026-10-26); Karl's rulings on Step 0 (A–E);
 *        lyceon-coding-standards §8.1 (thin handler: auth → parse → domain → serialize)]
 *        | @implemented [2026-10-26]
 *
 * plain English: mounted behind auth, CSRF and `requireStudentAccount` (students only, the live
 * under-13 link gate), so a guardian or admin never reaches the service; the service checks the
 * role and age again. Each body is parsed against the shared schema; the caller is the
 * authenticated user, never a value from the body. A failure is logged with its code only and
 * answered with "no landing" for `open` (the student simply sees Home) and a 500 for the others.
 */
import { Router, type Request, type Response } from "express";
import { requireRequestUser } from "../middleware/supabase-auth";
import { singleBucketRateLimit } from "../middleware/rate-limit";
import { logger } from "../logger";
import {
  landingEscapeRequestSchema,
  landingMoreRequestSchema,
  landingMoreResponseSchema,
  landingOpenRequestSchema,
  landingOpenResponseSchema,
} from "../../packages/shared/src/smart-landing-schema";
import {
  NO_LANDING,
  openLanding,
  recordLandingEscape,
  startLandingMore,
  type LandingCaller,
  type LandingDeps,
} from "../services/landing/landing-service";
import { liveLandingDeps } from "../services/landing/landing-deps";

const COMPONENT = "LANDING";

function sendBadRequest(res: Response, details: unknown): Response {
  return res.status(400).json({
    error: { code: "INVALID_BODY", message: "Invalid request.", details },
  });
}

export function createLandingRouter(
  deps: LandingDeps = liveLandingDeps,
): Router {
  const router = Router();
  const limit = singleBucketRateLimit("landing_student", COMPONENT);

  function callerOf(req: Request, res: Response): LandingCaller | null {
    const user = requireRequestUser(req, res);
    if (!user) return null;
    return {
      id: user.id,
      actorId: user.actor_id,
      role: user.role,
      isUnder13: user.is_under_13,
    };
  }

  router.post("/open", limit, async (req: Request, res: Response) => {
    const caller = callerOf(req, res);
    if (!caller) return;
    const body = landingOpenRequestSchema.safeParse(req.body);
    if (!body.success) return sendBadRequest(res, body.error.flatten());
    try {
      const data = await openLanding(deps, caller, {
        deviceClass: body.data.device_class,
        clientInstanceId: body.data.client_instance_id,
      });
      return res
        .status(200)
        .json({ data: landingOpenResponseSchema.parse(data) });
    } catch (error: unknown) {
      logger.error(
        COMPONENT,
        "open_failed",
        "Landing open failed; Home shown",
        undefined,
        {
          error: error instanceof Error ? error.name : "unknown",
        },
        { requestId: req.requestId },
      );
      return res.status(200).json({ data: NO_LANDING });
    }
  });

  router.post("/escape", limit, async (req: Request, res: Response) => {
    const caller = callerOf(req, res);
    if (!caller) return;
    const body = landingEscapeRequestSchema.safeParse(req.body);
    if (!body.success) return sendBadRequest(res, body.error.flatten());
    try {
      const recorded = await recordLandingEscape(
        deps,
        caller,
        body.data.show_id,
      );
      return res.status(200).json({ data: { recorded } });
    } catch (error: unknown) {
      logger.error(
        COMPONENT,
        "escape_failed",
        "Landing escape could not be recorded",
        undefined,
        {
          error: error instanceof Error ? error.name : "unknown",
        },
        { requestId: req.requestId },
      );
      return res.status(500).json({
        error: { code: "INTERNAL", message: "Something went wrong." },
      });
    }
  });

  router.post("/more", limit, async (req: Request, res: Response) => {
    const caller = callerOf(req, res);
    if (!caller) return;
    const body = landingMoreRequestSchema.safeParse(req.body);
    if (!body.success) return sendBadRequest(res, body.error.flatten());
    try {
      const data = await startLandingMore(
        deps,
        caller,
        body.data.client_instance_id,
      );
      return res
        .status(200)
        .json({ data: landingMoreResponseSchema.parse(data) });
    } catch (error: unknown) {
      logger.error(
        COMPONENT,
        "more_failed",
        "Landing '5 more' could not start",
        undefined,
        {
          error: error instanceof Error ? error.name : "unknown",
        },
        { requestId: req.requestId },
      );
      return res.status(500).json({
        error: { code: "INTERNAL", message: "Something went wrong." },
      });
    }
  });

  return router;
}

export const landingRoutes = createLandingRouter();
