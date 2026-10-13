/**
 * The "Getting started" checklist on the student's Home.
 *
 * @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
 *       brief v2, Karl, 2026-10-13) §3 completion rules, §8 server; Coding Standards §8.1 (thin
 *       handler: auth → parse → domain → serialize)] | @implemented [2026-10-13]
 *
 * plain English: mounted behind `requireStudentAccount`, so guardians and admins get 403 before
 * any of this runs.
 *   GET  /            the checklist: observe (latches steps reached for the first time), then
 *                     derive the steps this student sees for their plan.
 *   POST /not-sure    "Not sure yet" for the SAT date and/or target score. Idempotent.
 *   POST /skip-email  "Not now" on the email step. Idempotent.
 *   POST /dismiss     refused (409) until every visible step is done or skipped; then
 *                     idempotent and stored.
 * The plan is the dashboard's own rule (calendar and mastery both granted = Pro), read through
 * the one feature-access resolver; LISA is unavailable when its lock is the age lock. Logs carry
 * the request id and the step outcome only.
 */
import { Router, type Request, type Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  requireRequestUser,
  type SupabaseUser,
} from "../middleware/supabase-auth";
import { resolveFeatureAccess } from "../lib/feature-access";
import { logger } from "../logger";
import { singleBucketRateLimit } from "../middleware/rate-limit";
import {
  deriveGettingStarted,
  gettingStartedNotSureRequestSchema,
  gettingStartedObservationSchema,
  gettingStartedResponseSchema,
  type GettingStartedAudience,
  type GettingStartedResponse,
} from "../../packages/shared/src/getting-started-schema";

const COMPONENT = "GETTING_STARTED";

/**
 * Karl, 2026-10-13 on #1230: the three POSTs share one per-profile RateLimitLedger bucket,
 * seeded in `bucket_definitions` by 20261102000000_home_getting_started.sql (30 / hour). The GET
 * is Home's own read and is not limited, as `GET /api/qotd/today` is limited by its own bucket.
 */
export const ACTION_BUCKET = "getting_started_action";

type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;

export type GettingStartedRouteDeps = {
  rpc: Rpc;
  audience: (user: SupabaseUser) => Promise<GettingStartedAudience>;
};

export async function defaultAudience(
  user: SupabaseUser,
): Promise<GettingStartedAudience> {
  const access = await resolveFeatureAccess(user);
  const granted = (key: "calendar_access" | "mastery_detail"): boolean =>
    access?.[key].access === "granted";
  const tutor = access?.tutor_access;
  return {
    plan:
      granted("calendar_access") && granted("mastery_detail") ? "pro" : "free",
    lisaAvailable: !(tutor?.access === "locked" && tutor.reason === "age"),
  };
}

const defaultDeps: GettingStartedRouteDeps = {
  rpc: (fn, args) => supabaseServer.rpc(fn, args),
  audience: defaultAudience,
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

export function createGettingStartedRouter(
  deps: GettingStartedRouteDeps = defaultDeps,
): Router {
  const router = Router();

  function fail(
    req: Request,
    res: Response,
    op: string,
    code?: string,
  ): Response {
    logger.error(
      COMPONENT,
      `${op}_failed`,
      "A getting-started route failed",
      undefined,
      {
        requestId: req.requestId,
        code,
      },
    );
    return sendError(res, 500, "INTERNAL", "Something went wrong.");
  }

  async function snapshot(
    user: SupabaseUser,
  ): Promise<
    { ok: true; value: GettingStartedResponse } | { ok: false; code?: string }
  > {
    const { data, error } = await deps.rpc("getting_started_observe", {
      p_profile_id: user.id,
    });
    if (error) return { ok: false, code: error.code };
    const obs = gettingStartedObservationSchema.safeParse(data);
    if (!obs.success) return { ok: false, code: "shape" };
    const view = deriveGettingStarted(obs.data, await deps.audience(user));
    return { ok: true, value: gettingStartedResponseSchema.parse(view) };
  }

  router.get("/", async (req: Request, res: Response) => {
    const user = requireRequestUser(req, res);
    if (!user) return;
    try {
      const view = await snapshot(user);
      if (!view.ok) return fail(req, res, "read", view.code);
      return res.status(200).json({ data: view.value });
    } catch {
      return fail(req, res, "read");
    }
  });

  router.post(
    "/not-sure",
    singleBucketRateLimit(ACTION_BUCKET, COMPONENT),
    async (req: Request, res: Response) => {
      const user = requireRequestUser(req, res);
      if (!user) return;
      const parsed = gettingStartedNotSureRequestSchema.safeParse(req.body);
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
        const { error } = await deps.rpc("getting_started_record_not_sure", {
          p_profile_id: user.id,
          p_test_date: parsed.data.test_date === true,
          p_target_score: parsed.data.target_score === true,
        });
        if (error) return fail(req, res, "not_sure", error.code);
        const view = await snapshot(user);
        if (!view.ok) return fail(req, res, "not_sure", view.code);
        return res.status(200).json({ data: view.value });
      } catch {
        return fail(req, res, "not_sure");
      }
    },
  );

  router.post(
    "/skip-email",
    singleBucketRateLimit(ACTION_BUCKET, COMPONENT),
    async (req: Request, res: Response) => {
      const user = requireRequestUser(req, res);
      if (!user) return;
      try {
        const { error } = await deps.rpc("getting_started_skip_email", {
          p_profile_id: user.id,
        });
        if (error) return fail(req, res, "skip_email", error.code);
        const view = await snapshot(user);
        if (!view.ok) return fail(req, res, "skip_email", view.code);
        return res.status(200).json({ data: view.value });
      } catch {
        return fail(req, res, "skip_email");
      }
    },
  );

  router.post(
    "/dismiss",
    singleBucketRateLimit(ACTION_BUCKET, COMPONENT),
    async (req: Request, res: Response) => {
      const user = requireRequestUser(req, res);
      if (!user) return;
      try {
        const before = await snapshot(user);
        if (!before.ok) return fail(req, res, "dismiss", before.code);
        if (!before.value.complete) {
          logger.info(
            COMPONENT,
            "dismiss_refused",
            "Dismiss refused: steps still open",
            {
              requestId: req.requestId,
              open: before.value.steps.filter((s) => s.status === "open")
                .length,
            },
          );
          return sendError(
            res,
            409,
            "GETTING_STARTED_INCOMPLETE",
            "Finish the open steps first.",
          );
        }
        const { error } = await deps.rpc("getting_started_dismiss", {
          p_profile_id: user.id,
        });
        if (error) return fail(req, res, "dismiss", error.code);
        return res
          .status(200)
          .json({ data: { ...before.value, dismissed: true } });
      } catch {
        return fail(req, res, "dismiss");
      }
    },
  );

  return router;
}

export default createGettingStartedRouter();
