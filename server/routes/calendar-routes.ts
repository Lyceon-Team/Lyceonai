/**
 * The §15 calendar API surface — the student's nine routes, and the streak.
 *
 * @spec [Doc-05F_V1.0 §15 (API surface), §15.1 (launch), §16 (entitlement),
 *        §18 (observability, failure modes), §12.1–§12.7;
 *        Doc_05F_formula_sheet.md §8 items 11, 18, 20;
 *        lyceon-coding-standards §8.1 (thin handlers), §8.2, §8.3]
 * | @implemented [2026-09-21]
 *
 * plain English: every handler in this file is auth → role → entitlement → Zod → delegate →
 * map. There is no workflow here. The `calendar/*` services decide what happens; these
 * functions decide what HTTP status says it.
 *
 * WHERE THE ZOD PARSE IS. §8.1 puts it third in the handler and this file does that for
 * params and simple bodies. The profile upsert and the two reads are the exception: their
 * schemas are FACTORIES over `calendar_runtime_config` bounds and the student's local today,
 * which take database reads to obtain, so the parse happens at the service boundary with
 * `unknown` in — which is what §7.1 actually requires. Those services return
 * `{ kind: "invalid", details }` and the handler renders it as the same 400 it would have
 * written itself. Doing the reads here instead would put IO and workflow in the handler.
 *
 * TWO ROUTERS, AND WHY. `/api/me/streak` is served to any tier with NO `calendar_access`
 * check (INV-08-20, sheet item 11) — the streak is platform-wide and not calendar-owned. It
 * is a separate router so it cannot be mounted behind the calendar's entitlement middleware
 * by accident: the gate it must not have is absent by construction rather than by review.
 *
 * THE GUARDIAN CALENDAR IS NOT IN THIS FILE. Sheet item 14 routes it to
 * `GET /api/students/:studentId/calendar`, through the existing `resolveSubject` pattern in
 * `student-resources.ts`. `scripts/ci/subject-resolver-chokepoint-gate.mjs` fails the build
 * if any file registering an `/api/students/:studentId` route so much as mentions the
 * caller's role — and this file is full of role gates, which is exactly why the two cannot
 * share a module.
 *
 * ERRORS (§15): 400 · 401 · 402 shared CTA payload · 404 · 409 past date / already complete ·
 * 429 · 500 with an ERROR log and a correlation id. A policy denial is a DECISION: it gets a
 * structured log and its own status, never a 500 and never a silent one.
 */
import { Router, type Request, type Response } from "express";
import {
  acknowledgeBodySchema,
  blockParamsSchema,
  moveBlockBodySchema,
  type MoveRefusalReason,
  dayEditBodySchema,
  dayParamsSchema,
  idempotentMutationBodySchema,
  launchBodySchema,
} from "@lyceon/shared";
import { logger } from "../logger";
import { sendPaymentRequired } from "../lib/http-errors";
import { singleBucketRateLimit } from "../middleware/rate-limit";
import { EntitlementService } from "../services/entitlement-service";
import { getStudentActivityStreak } from "../services/activity-streak";
import { loadCalendarConfig } from "../services/calendar/config";
import {
  acknowledgeVersion,
  moveBlock,
  doItNow,
  editDay,
  regenerateDay,
  regeneratePlan,
  type PlanFailure,
  type PlanWriteResult,
} from "../services/calendar/plan-service";
import {
  readCalendar,
  type ReadFailure,
} from "../services/calendar/read-service";
import {
  upsertStudyProfile,
  type ProfileFailure,
} from "../services/calendar/profile-service";
import {
  launchBlock,
  type LaunchFailure,
} from "../services/calendar/launch-service";
import { liveLaunchDeps } from "../services/calendar/launch-deps";

export const calendarRouter = Router();
export const streakRouter = Router();

/** §16: the one feature key this surface gates on. Never the entitlement predicate directly. */
export const CALENDAR_FEATURE_KEY = "calendar_access";

/** §7 / §15: the two rate-limited surfaces, seeded by `20260917140000`. */
export const CALENDAR_PLAN_REGENERATE_BUCKET = "calendar_plan_regenerate";
export const CALENDAR_DAY_REGENERATE_BUCKET = "calendar_day_regenerate";

const planRegenerateRateLimit = singleBucketRateLimit(
  CALENDAR_PLAN_REGENERATE_BUCKET,
  "calendar_plan_regenerate",
);
const dayRegenerateRateLimit = singleBucketRateLimit(
  CALENDAR_DAY_REGENERATE_BUCKET,
  "calendar_day_regenerate",
);

// ── The response shapes (§8.2) ──────────────────────────────────────────────

function sendError(
  res: Response,
  status: number,
  message: string,
  code: string,
  requestId: string | undefined,
  details?: unknown,
): Response {
  return res.status(status).json({
    error:
      details === undefined ? { message, code } : { message, code, details },
    requestId,
  });
}

/**
 * The 500. It is the ONLY place this file writes one, so "never a silent 500" is a property
 * of one function rather than a convention across eleven handlers. §15 requires the
 * correlation id, and §18's "never logged" list is why the caught value is classified rather
 * than spread: an error from a write can carry the row that failed.
 */
function sendServerError(
  res: Response,
  operation: string,
  error: unknown,
  requestId: string | undefined,
): Response {
  logger.error(
    "CALENDAR_ROUTES",
    `${operation}_failed`,
    "a calendar route failed",
    {
      operation,
      requestId,
      reason: error instanceof Error ? error.message : "unknown",
    },
  );
  return sendError(
    res,
    500,
    "Something went wrong.",
    "CALENDAR_ERROR",
    requestId,
  );
}

// ── Auth and entitlement (§8.1 steps 1 and 2) ───────────────────────────────

type Caller = { studentId: string; actorId: string; role: string | undefined };

/**
 * The authenticated student. Server-authoritative: the id comes from the verified session,
 * never from a body or a param, so there is no route on this surface that can be pointed at
 * another student's plan.
 */
function callerOf(req: Request, res: Response): Caller | null {
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
  return { studentId: user.id, actorId: user.actor_id, role: user.role };
}

/**
 * §16. Premium: the full surface. Free or lapsed: 402 with the shared CTA payload, and
 * NOTHING is deleted. `canAccessFeature` fails closed on every error path, so a read failure
 * cannot accidentally open the paid surface.
 *
 * A denial is a decision and is logged as one — at INFO, because a free student opening the
 * calendar is normal operation and not a fault.
 */
async function entitled(
  req: Request,
  res: Response,
  studentId: string,
): Promise<boolean> {
  if (
    await EntitlementService.canAccessFeature(studentId, CALENDAR_FEATURE_KEY)
  ) {
    return true;
  }
  logger.info(
    "CALENDAR_ROUTES",
    "entitlement_denied",
    "a caller without calendar_access was shown the upgrade CTA",
    { path: req.path, requestId: req.requestId },
  );
  sendPaymentRequired(res, req.requestId);
  return false;
}

// ── Failure → status (§15's error list) ─────────────────────────────────────

/**
 * §12.2. Three OUTCOMES, not errors, so each carries its own code: the client already
 * mirrors all three, and when the server disagrees the reason is what tells the UI which of
 * its assumptions was stale. 409 rather than 400 — the request was well-formed; the plan's
 * state is what refused it.
 *
 * Its own function rather than a nested switch, so the outer switch has one `return` per arm
 * and cannot fall through — a nested switch whose every arm returns still reads as a
 * fallthrough to both the linter and to the next person editing it.
 */
function sendMoveRefusal(
  res: Response,
  reason: MoveRefusalReason,
  requestId: string | undefined,
): Response {
  switch (reason) {
    case "block_started":
      return sendError(
        res,
        409,
        "You have already started that block, so it stays where it is.",
        "CALENDAR_BLOCK_STARTED",
        requestId,
      );
    case "date_in_past":
      return sendError(
        res,
        409,
        "Work cannot be moved into the past.",
        "CALENDAR_PAST_DATE",
        requestId,
      );
    case "same_date":
      return sendError(
        res,
        409,
        "That block is already on that day.",
        "CALENDAR_SAME_DATE",
        requestId,
      );
  }
}

function sendPlanFailure(
  res: Response,
  failure: PlanFailure,
  requestId: string | undefined,
): Response {
  switch (failure.kind) {
    case "past_date":
      // §12.2: a past date is never owned and never edited. The student's route out is
      // "Do it now", which is a different endpoint, so this is 409 and not 400.
      return sendError(
        res,
        409,
        "A past day cannot be replanned.",
        "CALENDAR_PAST_DATE",
        requestId,
      );
    case "beyond_horizon":
      return sendError(
        res,
        404,
        "That day is not planned yet.",
        "CALENDAR_BEYOND_HORIZON",
        requestId,
      );
    case "no_profile":
      // NOT the pre-setup read state. `GET /api/calendar` answers that with 200
      // `setup_required` (owner ruling on addendum item 26). This arm is a MUTATION —
      // regenerate, edit, do-it-now — against a student who has no study profile at all,
      // which a correct client never issues. Its own code, so the two cannot be conflated.
      return sendError(
        res,
        404,
        "Finish setting up your calendar first.",
        "CALENDAR_NO_PROFILE",
        requestId,
      );
    case "not_found":
      return sendError(
        res,
        404,
        "That block is no longer on your plan.",
        "CALENDAR_NOT_FOUND",
        requestId,
      );
    case "rejected":
      // §18: a `generated` rejection pages and the PRIOR PLAN STANDS. The student is told
      // nothing changed; `plan-service` has already logged the rule ids for the alert.
      return sendError(
        res,
        500,
        "Your plan could not be updated. Your current plan is unchanged.",
        "CALENDAR_PLAN_REJECTED",
        requestId,
      );
    case "move_refused":
      return sendMoveRefusal(res, failure.reason, requestId);
    case "write_failed":
      return sendError(
        res,
        500,
        "Something went wrong.",
        "CALENDAR_ERROR",
        requestId,
      );
  }
}

function sendReadFailure(
  res: Response,
  failure: ReadFailure,
  requestId: string | undefined,
): Response {
  switch (failure.kind) {
    case "invalid_query":
      return sendError(
        res,
        400,
        "Invalid request.",
        "INVALID_QUERY",
        requestId,
        failure.details,
      );
    case "read_failed":
      return sendError(
        res,
        500,
        "Something went wrong.",
        "CALENDAR_ERROR",
        requestId,
      );
  }
}

function sendProfileFailure(
  res: Response,
  failure: ProfileFailure,
  requestId: string | undefined,
): Response {
  switch (failure.kind) {
    case "invalid":
      return sendError(
        res,
        400,
        "Invalid request.",
        "INVALID_BODY",
        requestId,
        failure.details,
      );
    case "incomplete":
      return sendError(
        res,
        400,
        "Your study days and daily time are needed to start.",
        "CALENDAR_SETUP_INCOMPLETE",
        requestId,
        {
          missing: failure.missing,
        },
      );
    case "write_failed":
      return sendError(
        res,
        500,
        "Something went wrong.",
        "CALENDAR_ERROR",
        requestId,
      );
  }
}

function sendLaunchFailure(
  res: Response,
  failure: LaunchFailure,
  requestId: string | undefined,
): Response {
  switch (failure.kind) {
    case "not_found":
      return sendError(
        res,
        404,
        "That block is no longer on your plan.",
        "CALENDAR_NOT_FOUND",
        requestId,
      );
    case "not_today":
      // §15.1 step 1. `when` travels so the client can offer the right control — "Do it
      // now" for a past day, nothing at all for a future one.
      return sendError(
        res,
        409,
        failure.when === "past"
          ? "That day has passed."
          : "That day has not started yet.",
        "CALENDAR_NOT_TODAY",
        requestId,
        { when: failure.when },
      );
    case "already_complete":
      return sendError(
        res,
        409,
        "You have already finished this one.",
        "CALENDAR_ALREADY_COMPLETE",
        requestId,
      );
    case "engine_unavailable":
      // Fail OPEN as data, per §5A. The calendar rendered; this one block cannot start yet.
      return sendError(
        res,
        409,
        "This is not available yet.",
        "CALENDAR_ENGINE_UNAVAILABLE",
        requestId,
        { engine: failure.engine },
      );
    case "engine_error":
      // §18 "Engine create fails | No link; 502 retry; block `scheduled`."
      return sendError(
        res,
        502,
        "Could not start your session. Try again.",
        "CALENDAR_ENGINE_ERROR",
        requestId,
      );
    case "link_failed":
      // §18 "Created but link failed | Retry → same engine key → same session → link." The
      // engine session EXISTS, so this is retryable and the retry is free.
      return sendError(
        res,
        502,
        "Could not start your session. Try again.",
        "CALENDAR_ENGINE_ERROR",
        requestId,
      );
  }
}

/** Every plan write answers `{ version_no }` (§15), so the mapping is written once. */
function sendPlanWrite(
  res: Response,
  result: PlanWriteResult,
  requestId: string | undefined,
): Response {
  if (!result.ok) return sendPlanFailure(res, result.error, requestId);
  return res
    .status(200)
    .json({ version_no: result.value.version_no, requestId });
}

// ── GET /api/calendar ───────────────────────────────────────────────────────

calendarRouter.get("/", async (req: Request, res: Response) => {
  const caller = callerOf(req, res);
  if (caller === null) return;
  if (!(await entitled(req, res, caller.studentId))) return;

  try {
    const result = await readCalendar({
      student_id: caller.studentId,
      query: req.query,
      ...(req.requestId === undefined ? {} : { request_id: req.requestId }),
    });
    if (!result.ok) return sendReadFailure(res, result.error, req.requestId);
    // The service already parsed this against `calendarResponseSchema`'s own shape; the
    // spread here adds `requestId` and nothing else.
    return res.status(200).json({ ...result.value, requestId: req.requestId });
  } catch (error) {
    return sendServerError(res, "calendar_read", error, req.requestId);
  }
});

// ── PUT /api/calendar/profile ───────────────────────────────────────────────

calendarRouter.put("/profile", async (req: Request, res: Response) => {
  const caller = callerOf(req, res);
  if (caller === null) return;
  if (!(await entitled(req, res, caller.studentId))) return;

  try {
    const result = await upsertStudyProfile(
      caller.studentId,
      req.body,
      req.requestId,
    );
    if (!result.ok) return sendProfileFailure(res, result.error, req.requestId);
    return res.status(200).json({ ...result.value, requestId: req.requestId });
  } catch (error) {
    return sendServerError(res, "profile_upsert", error, req.requestId);
  }
});

// ── POST /api/calendar/plan/regenerate ──────────────────────────────────────

calendarRouter.post(
  "/plan/regenerate",
  planRegenerateRateLimit,
  async (req: Request, res: Response) => {
    const caller = callerOf(req, res);
    if (caller === null) return;
    if (!(await entitled(req, res, caller.studentId))) return;

    const body = idempotentMutationBodySchema.safeParse(req.body);
    if (!body.success) {
      return sendError(
        res,
        400,
        "Invalid request.",
        "INVALID_BODY",
        req.requestId,
        body.error.flatten(),
      );
    }

    try {
      const config = await loadCalendarConfig();
      return sendPlanWrite(
        res,
        await regeneratePlan(
          {
            student_id: caller.studentId,
            // §12.1: the student pressing `Refresh plan` is `student_refresh`, not
            // `weekly`. The trigger records WHO asked, and the banner copy is keyed by it.
            trigger: "student_refresh",
            initiated_by: "student",
            generator_version: config.generatorVersion,
            idempotency_key: body.data.idempotency_key,
          },
          req.requestId,
        ),
        req.requestId,
      );
    } catch (error) {
      return sendServerError(res, "plan_regenerate", error, req.requestId);
    }
  },
);

// ── POST /api/calendar/days/:date/regenerate and /reset ─────────────────────

/**
 * §12.1 lists `day_regenerate` and `day_reset` as separate triggers with identical date
 * ownership, so they are one handler taking the trigger as an argument. Two copies of this
 * body would be two chances to get the ownership rule wrong.
 */
function dayRegenerateHandler(trigger: "day_regenerate" | "day_reset") {
  return async (req: Request, res: Response): Promise<Response | undefined> => {
    const caller = callerOf(req, res);
    if (caller === null) return;
    if (!(await entitled(req, res, caller.studentId))) return;

    const params = dayParamsSchema.safeParse(req.params);
    if (!params.success) {
      return sendError(
        res,
        400,
        "Invalid date.",
        "INVALID_DATE",
        req.requestId,
        params.error.flatten(),
      );
    }
    const body = idempotentMutationBodySchema.safeParse(req.body);
    if (!body.success) {
      return sendError(
        res,
        400,
        "Invalid request.",
        "INVALID_BODY",
        req.requestId,
        body.error.flatten(),
      );
    }

    try {
      const config = await loadCalendarConfig();
      return sendPlanWrite(
        res,
        await regenerateDay(
          {
            student_id: caller.studentId,
            date: params.data.date,
            trigger,
            generator_version: config.generatorVersion,
            idempotency_key: body.data.idempotency_key,
          },
          req.requestId,
        ),
        req.requestId,
      );
    } catch (error) {
      return sendServerError(res, trigger, error, req.requestId);
    }
  };
}

calendarRouter.post(
  "/days/:date/regenerate",
  dayRegenerateRateLimit,
  dayRegenerateHandler("day_regenerate"),
);
calendarRouter.post(
  "/days/:date/reset",
  dayRegenerateRateLimit,
  dayRegenerateHandler("day_reset"),
);

// ── PUT /api/calendar/days/:date ────────────────────────────────────────────

calendarRouter.put("/days/:date", async (req: Request, res: Response) => {
  const caller = callerOf(req, res);
  if (caller === null) return;
  if (!(await entitled(req, res, caller.studentId))) return;

  const params = dayParamsSchema.safeParse(req.params);
  if (!params.success) {
    return sendError(
      res,
      400,
      "Invalid date.",
      "INVALID_DATE",
      req.requestId,
      params.error.flatten(),
    );
  }
  const body = dayEditBodySchema.safeParse(req.body);
  if (!body.success) {
    return sendError(
      res,
      400,
      "Invalid request.",
      "INVALID_BODY",
      req.requestId,
      body.error.flatten(),
    );
  }

  try {
    const config = await loadCalendarConfig();
    const written = await editDay(
      {
        student_id: caller.studentId,
        date: params.data.date,
        // §12.4: the FULL desired member list, empty array included. The server injects any
        // started block the client omitted (V-12) — inside the RPC, not here.
        members: body.data.members,
        generator_version: config.generatorVersion,
        idempotency_key: body.data.idempotency_key,
      },
      req.requestId,
    );
    if (!written.ok) return sendPlanFailure(res, written.error, req.requestId);

    // §15 returns `{ version_no, day }`. The day is READ BACK rather than built from the
    // edit: the RPC may have injected a started block the client omitted, and echoing the
    // request would show the student a day the database does not hold.
    const after = await readCalendar({
      student_id: caller.studentId,
      query: { from: params.data.date, to: params.data.date },
      ...(req.requestId === undefined ? {} : { request_id: req.requestId }),
    });
    if (!after.ok) return sendReadFailure(res, after.error, req.requestId);
    // The edit just succeeded, so the student HAS a profile and the read is `ready`. The
    // compiler cannot know that, and narrowing beats casting: if it is somehow
    // `setup_required`, the profile vanished between the write and the read, which is an
    // anomaly worth a 500 and a log rather than a confident `as`.
    if (after.value.status !== "ready") {
      return sendServerError(
        res,
        "day_edit_readback",
        new Error("calendar not ready after edit"),
        req.requestId,
      );
    }
    const day = after.value.days[0];
    if (day === undefined) {
      return sendServerError(
        res,
        "day_edit_readback",
        new Error("no day returned"),
        req.requestId,
      );
    }
    return res.status(200).json({
      version_no: written.value.version_no,
      day,
      requestId: req.requestId,
    });
  } catch (error) {
    return sendServerError(res, "day_edit", error, req.requestId);
  }
});

// ── POST /api/calendar/blocks/:id/launch (§15.1) ────────────────────────────

calendarRouter.post(
  "/blocks/:id/launch",
  async (req: Request, res: Response) => {
    const caller = callerOf(req, res);
    if (caller === null) return;
    if (!(await entitled(req, res, caller.studentId))) return;

    const params = blockParamsSchema.safeParse(req.params);
    if (!params.success) {
      return sendError(
        res,
        404,
        "That block is no longer on your plan.",
        "CALENDAR_NOT_FOUND",
        req.requestId,
      );
    }
    // §15.1: no `idempotency_key` in the body. `CalendarLaunchService` owns the engine key,
    // and a client-supplied one would break INV-08-18.
    const body = launchBodySchema.safeParse(req.body);
    if (!body.success) {
      return sendError(
        res,
        400,
        "Invalid request.",
        "INVALID_BODY",
        req.requestId,
        body.error.flatten(),
      );
    }

    try {
      const result = await launchBlock(
        {
          student_id: caller.studentId,
          actor_id: caller.actorId,
          role: caller.role,
          block_id: params.data.id,
          client_instance_id: body.data.client_instance_id,
          platform: body.data.platform,
        },
        liveLaunchDeps,
      );
      if (!result.ok)
        return sendLaunchFailure(res, result.error, req.requestId);
      return res
        .status(200)
        .json({ ...result.value, requestId: req.requestId });
    } catch (error) {
      return sendServerError(res, "block_launch", error, req.requestId);
    }
  },
);

// ── POST /api/calendar/blocks/:id/do-it-now (§12.6) ─────────────────────────

calendarRouter.post(
  "/blocks/:id/do-it-now",
  async (req: Request, res: Response) => {
    const caller = callerOf(req, res);
    if (caller === null) return;
    if (!(await entitled(req, res, caller.studentId))) return;

    const params = blockParamsSchema.safeParse(req.params);
    if (!params.success) {
      return sendError(
        res,
        404,
        "That block is no longer on your plan.",
        "CALENDAR_NOT_FOUND",
        req.requestId,
      );
    }
    const body = idempotentMutationBodySchema.safeParse(req.body);
    if (!body.success) {
      return sendError(
        res,
        400,
        "Invalid request.",
        "INVALID_BODY",
        req.requestId,
        body.error.flatten(),
      );
    }

    try {
      const config = await loadCalendarConfig();
      const written = await doItNow(
        {
          student_id: caller.studentId,
          block_id: params.data.id,
          generator_version: config.generatorVersion,
          idempotency_key: body.data.idempotency_key,
        },
        req.requestId,
      );
      if (!written.ok)
        return sendPlanFailure(res, written.error, req.requestId);

      // §15 returns `{ version_no, block }` — the block the RPC APPENDED to today, which only
      // a read back can identify: it is the highest-ordinal block on today with
      // `source = 'student'`, and the RPC clamped a review target the client never sent.
      const today = await readCalendar({
        student_id: caller.studentId,
        query: {},
        ...(req.requestId === undefined ? {} : { request_id: req.requestId }),
      });
      if (!today.ok) return sendReadFailure(res, today.error, req.requestId);
      if (today.value.status !== "ready") {
        return sendServerError(
          res,
          "do_it_now_readback",
          new Error("calendar not ready after do-it-now"),
          req.requestId,
        );
      }
      const blocks = today.value.days[0]?.blocks ?? [];
      const appended = [...blocks]
        .reverse()
        .find((entry) => entry.block.source === "student");
      if (appended === undefined) {
        return sendServerError(
          res,
          "do_it_now_readback",
          new Error("no appended block"),
          req.requestId,
        );
      }
      return res.status(200).json({
        version_no: written.value.version_no,
        block: appended.block,
        requestId: req.requestId,
      });
    } catch (error) {
      return sendServerError(res, "do_it_now", error, req.requestId);
    }
  },
);

// ── POST /api/calendar/blocks/:id/move (§12.2, §12.4) ───────────────────────

/**
 * @spec [Doc_05F_Study_Calendar, §12.2 protected state, §12.4 day edit]
 * @implemented [2026-09-23]
 * plain English: moves one block to another date. Expected outcome: 200 `{ version_no }`
 * for the single version that now owns both dates. Trade-offs: rate-limited under the
 * EXISTING `calendar_day_regenerate` bucket rather than a new one — a move is a day-scoped
 * plan write and shares the abuse profile of the other two, and a second bucket would let a
 * caller spend twice the day-scoped budget. Edge cases: a started block, a past date at
 * either end, and a move to the day the block is already on all answer 409 with their own
 * code, because the client needs to tell them apart to say the right thing.
 */
calendarRouter.post(
  "/blocks/:id/move",
  dayRegenerateRateLimit,
  async (req: Request, res: Response) => {
    const caller = callerOf(req, res);
    if (caller === null) return;
    if (!(await entitled(req, res, caller.studentId))) return;

    const params = blockParamsSchema.safeParse(req.params);
    if (!params.success) {
      return sendError(
        res,
        404,
        "That block is no longer on your plan.",
        "CALENDAR_NOT_FOUND",
        req.requestId,
      );
    }
    const body = moveBlockBodySchema.safeParse(req.body);
    if (!body.success) {
      return sendError(
        res,
        400,
        "Invalid request.",
        "INVALID_BODY",
        req.requestId,
        body.error.flatten(),
      );
    }

    try {
      const config = await loadCalendarConfig();
      const written = await moveBlock(
        {
          student_id: caller.studentId,
          block_id: params.data.id,
          to_date: body.data.to_date,
          generator_version: config.generatorVersion,
          idempotency_key: body.data.idempotency_key,
        },
        req.requestId,
      );
      if (!written.ok)
        return sendPlanFailure(res, written.error, req.requestId);
      return res.status(200).json({
        version_no: written.value.version_no,
        requestId: req.requestId,
      });
    } catch (error) {
      return sendServerError(res, "move_block", error, req.requestId);
    }
  },
);

// ── POST /api/calendar/acknowledge (§12.7) ──────────────────────────────────

calendarRouter.post("/acknowledge", async (req: Request, res: Response) => {
  const caller = callerOf(req, res);
  if (caller === null) return;
  if (!(await entitled(req, res, caller.studentId))) return;

  const body = acknowledgeBodySchema.safeParse(req.body);
  if (!body.success) {
    return sendError(
      res,
      400,
      "Invalid request.",
      "INVALID_BODY",
      req.requestId,
      body.error.flatten(),
    );
  }

  try {
    const result = await acknowledgeVersion(
      caller.studentId,
      body.data.version_no,
      req.requestId,
    );
    if (!result.ok) return sendPlanFailure(res, result.error, req.requestId);
    return res.status(200).json({ ok: true, requestId: req.requestId });
  } catch (error) {
    return sendServerError(res, "acknowledge", error, req.requestId);
  }
});

// ── GET /api/me/streak (§15, INV-08-20) ─────────────────────────────────────

/**
 * NO `calendar_access` CHECK. That is the point of this route existing on its own router:
 * §15 serves the streak to a student of ANY tier, and sheet item 11 makes it platform-wide
 * rather than calendar-owned. A free student sees their streak on the practice page.
 *
 * `plants` in Step 7 includes adding an entitlement check here and watching a test go red.
 */
streakRouter.get("/streak", async (req: Request, res: Response) => {
  const caller = callerOf(req, res);
  if (caller === null) return;

  try {
    const streak = await getStudentActivityStreak(
      caller.studentId,
      req.requestId,
    );
    return res.status(200).json({ ...streak, requestId: req.requestId });
  } catch (error) {
    return sendServerError(res, "streak_read", error, req.requestId);
  }
});
