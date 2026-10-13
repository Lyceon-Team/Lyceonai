/**
 * Per-request step timings — one structured log line per timed request.
 *
 * @spec [owner brief 2026-10-13 "first-run activation fixes" item 2 ("per-step server timings
 *        (structured logs) for practice session start, answer submit, review session start and
 *        the calendar read ... ONE structured log line per request (route, ordered step names
 *        with ms, total ms, requestId) through the existing logger. No content, no ids beyond
 *        requestId"); Doc-01A_V1.0 §10 (structured logging), §13 (levels); Coding Standards
 *        §12.1 (never log answers or content)]
 * | @implemented [2026-10-13]
 *
 * plain English: `timedRoute(route, handler)` wraps an Express handler. While the handler runs,
 * any code beneath it — the route, a service it calls, a helper three layers down — can wrap a
 * database call in `timedStep("name", () => ...)`, and the step's duration is recorded against
 * THIS request without a timer being threaded through every signature (AsyncLocalStorage
 * carries it). When the response finishes (or the connection closes first), exactly one INFO
 * line is emitted: event `route_timing`, component `PERF`, with
 *   { route, status, total_ms, pre_handler_ms, step_count, steps: [{ step, ms, at_ms }] }
 * and the requestId in the logger's own `request_id` field.
 *
 * WHAT IT CAN CARRY, BY CONSTRUCTION. Route and step names are string literals from the code
 * (`RouteTimingName` is a closed union; step names are literals at each call site), durations
 * and offsets are numbers, `status` is the HTTP status code. Nothing from the request, the
 * response or the database is read into the line — not a body, not a parameter, not a user id —
 * so there is no field through which content could reach it. The logger's redaction still runs
 * over it as it does over every line.
 *
 * `at_ms` is the step's start offset from the handler's start, so steps that ran in parallel
 * (a `Promise.all`) are visible as overlapping rather than being read as a sequence.
 * `pre_handler_ms` is the time from the request-id middleware (the first middleware) to the
 * handler: the auth session lookup and profile read happen there, so a slow request whose
 * steps are all fast is attributable.
 *
 * VOLUME — owner ruling (Karl) 2026-10-13 on #1232, item 4: the line is emitted on EVERY
 * request to the four timed routes, at INFO, unsampled. Do not add sampling without a new
 * ruling.
 *
 * trade-offs: outside a timed route `timedStep` is a plain call (no store, no cost beyond one
 * lookup), so the shared services it wraps behave identically for every other caller. Steps are
 * capped at MAX_STEPS per request so a loop cannot grow one line without bound; the overflow is
 * counted, not dropped silently (`steps_dropped`).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response } from "express";
import { logger } from "../logger";

/** The routes the brief names. A closed union: a new route is a reviewed addition. */
export type RouteTimingName =
  | "practice.session_start"
  | "practice.answer_submit"
  | "review.session_start"
  | "calendar.read";

type StepRecord = { step: string; ms: number | null; at_ms: number };

type RouteTimer = {
  route: RouteTimingName;
  startedAt: number;
  steps: StepRecord[];
  dropped: number;
  emitted: boolean;
};

const MAX_STEPS = 64;

const store = new AsyncLocalStorage<RouteTimer>();

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/**
 * Time one step of the current timed request. Outside a timed request this simply runs `fn`.
 * Steps are listed in the order they STARTED. A step that throws is still recorded (its
 * duration is real) and the error is rethrown. A step still running when the response
 * finished (a read started in parallel whose result a short-circuit branch never needed)
 * carries `ms: null` rather than a made-up number.
 */
export async function timedStep<T>(
  step: string,
  fn: () => PromiseLike<T> | T,
): Promise<T> {
  const end = beginStep(step);
  try {
    return await fn();
  } finally {
    end();
  }
}

/**
 * The same record as `timedStep`, opened and closed by hand: `const end = beginStep("x"); …;
 * end();`. For a block that cannot be wrapped in a callback without re-indenting code other
 * gates anchor on (the answer route's mastery emission block). Outside a timed request it
 * returns a no-op. Calling the returned function more than once records only the first.
 */
export function beginStep(step: string): () => void {
  const timer = store.getStore();
  if (timer === undefined) return () => undefined;
  const start = performance.now();
  if (timer.steps.length >= MAX_STEPS) {
    timer.dropped += 1;
    return () => undefined;
  }
  const record: StepRecord = {
    step,
    ms: null,
    at_ms: round(start - timer.startedAt),
  };
  timer.steps.push(record);
  return () => {
    if (record.ms === null && !timer.emitted) {
      record.ms = round(performance.now() - start);
    }
  };
}

/** The fields of the one `route_timing` line. Exported so the redaction test asserts on it. */
export type RouteTimingLine = {
  route: RouteTimingName;
  status: number;
  total_ms: number;
  pre_handler_ms: number | null;
  step_count: number;
  steps_dropped: number;
  steps: StepRecord[];
};

function emit(timer: RouteTimer, req: Request, res: Response): void {
  if (timer.emitted) return;
  timer.emitted = true;
  const requestStartedAt = req.requestStartedAt;
  const line: RouteTimingLine = {
    route: timer.route,
    status: res.statusCode,
    total_ms: round(performance.now() - timer.startedAt),
    pre_handler_ms:
      typeof requestStartedAt === "number"
        ? round(timer.startedAt - requestStartedAt)
        : null,
    step_count: timer.steps.length,
    steps_dropped: timer.dropped,
    steps: timer.steps.map((s) => ({ ...s })),
  };
  logger.info("PERF", "route_timing", "route step timings", line, {
    requestId: req.requestId,
  });
}

type Handler = (req: Request, res: Response) => unknown;

/**
 * Wrap a route handler so its request is timed. The handler's own return value and errors pass
 * through untouched; only the line is added.
 */
export function timedRoute(route: RouteTimingName, handler: Handler): Handler {
  return (req: Request, res: Response): unknown => {
    const timer: RouteTimer = {
      route,
      startedAt: performance.now(),
      steps: [],
      dropped: 0,
      emitted: false,
    };
    const done = (): void => emit(timer, req, res);
    res.once("finish", done);
    res.once("close", done);
    return store.run(timer, () => handler(req, res));
  };
}
