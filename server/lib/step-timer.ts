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
import type { VideoMethod } from "../../packages/shared/src/video-methods";
import { logger } from "../logger";

/**
 * The routes the brief names. A closed union: a new route is a reviewed addition.
 * `tutor.message` (POST /api/tutor/messages, LISA's reply path) was added by the owner's approval
 * of H1 (Karl, 2026-10-21, rulings on #1277, ruling 6): observability only, fixed literal step
 * names, and the same guarantee as every other route here, that no prompt, reply or student
 * content can reach the line.
 */
export type RouteTimingName =
  | "practice.session_start"
  | "practice.answer_submit"
  | "review.session_start"
  | "calendar.read"
  | "tutor.message";

type StepRecord = { step: string; ms: number | null; at_ms: number };

type RouteTimer = {
  route: RouteTimingName;
  startedAt: number;
  steps: StepRecord[];
  dropped: number;
  emitted: boolean;
  /** Record each Supabase round trip as its own step (see `timedFetch`). */
  databaseTrips: boolean;
  /** Step 13d's outcome on `tutor.message` (see `recordVideoRetrieval`). */
  videoRetrieval?: VideoRetrievalTiming;
};

/**
 * @spec [owner brief "Video retrieval: method tags", Karl 2026-10-27 (build 3: "a
 *        `video_retrieval` timing sub-field recording the detected method and the result count;
 *        counts and codes only, never message text"; Step 0 ruling: also the offered video ids
 *        and the index LISA recommended, so the closing proof is checkable)] | @implemented [2026-10-27]
 * plain English: what Step 13d decided, on the turn's one `route_timing` line. A closed shape:
 * the method is a vocabulary code (or null: none detected), the map version a number, the
 * offered ids YouTube ids (11 characters, already validated by the retrieval's schema; the
 * public catalogue id, never a student value), the recommendation a 1-based index or null.
 * Nothing from the student's message is recorded: not the matched phrase, not its position.
 */
export type VideoRetrievalTiming = {
  method: VideoMethod | null;
  map_version: number | null;
  results: number;
  video_ids: string[];
  recommended_index: number | null;
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** Step 13d's outcome, recorded once per turn. Outside a timed request this does nothing. */
export function recordVideoRetrieval(
  detail: Omit<VideoRetrievalTiming, "recommended_index">,
): void {
  const timer = store.getStore();
  if (timer === undefined || timer.emitted) return;
  timer.videoRetrieval = {
    method: detail.method,
    map_version: detail.map_version,
    results: detail.results,
    video_ids: detail.video_ids.filter((id) => YOUTUBE_ID.test(id)).slice(0, 3),
    recommended_index: null,
  };
}

/** The index of the offered video LISA recommended (1-based), once the reply is resolved. */
export function recordVideoRecommendation(index: number | null): void {
  const timer = store.getStore();
  if (timer?.videoRetrieval === undefined || timer.emitted) return;
  timer.videoRetrieval.recommended_index =
    index !== null && Number.isInteger(index) && index >= 1 && index <= 3
      ? index
      : null;
}

/**
 * LISA's reply path makes ~37 database round trips plus its coarse steps and their sub-steps
 * (Step 0 report, 2026-10-23), so 64 was too small to carry one turn; 128 still bounds the line.
 */
const MAX_STEPS = 128;

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

// ── Database round trips ──────────────────────────────────────────────────────

/**
 * @spec [owner brief "P2 Revised: Cut the Wait Without Streaming" (Karl, 2026-10-23) §2 H1:
 *        "Extend route_timing across the whole reply path: every model call, every safety check,
 *        every database round trip, time-to-first-visible-text, total ... No message content in
 *        logs"; Coding Standards §12.1] | @implemented [2026-10-23]
 *
 * plain English: wraps the `fetch` the server's Supabase client uses. Inside a timed request whose
 * route opted in (`timedRoute(..., { databaseTrips: true })`), every PostgREST call becomes one
 * step named `db.<op>.<target>`:
 *   op      read (GET/HEAD) | insert (POST) | update (PATCH) | delete (DELETE) | rpc (POST /rpc/x)
 *           | auth (the Auth server) | other
 *   target  the table or function name from the URL path — a schema identifier from the code,
 *           never a value. Anything that is not a plain lowercase identifier is recorded as
 *           `other`, so a query string, a filter value or an id can never become a step name.
 * Only the URL's PATH is read, and only its table/function segment; the query string (where
 * filter values live), headers and bodies are never looked at. Outside an opted-in timed request
 * this is the plain `fetch`, so every other caller of the shared client is unchanged.
 */
const DB_TARGET = /^[a-z][a-z0-9_]{0,62}$/;

export function databaseTripStepName(url: string, method: string): string {
  if (!URL.canParse(url)) return "db.other.other";
  const path = new URL(url).pathname;
  const verb = method.toUpperCase();
  const rest = /^\/rest\/v1\/(rpc\/)?([^/]+)\/?$/.exec(path);
  if (rest) {
    const target = DB_TARGET.test(rest[2] ?? "") ? rest[2] : "other";
    if (rest[1]) return `db.rpc.${target}`;
    const op =
      verb === "GET" || verb === "HEAD"
        ? "read"
        : verb === "POST"
          ? "insert"
          : verb === "PATCH"
            ? "update"
            : verb === "DELETE"
              ? "delete"
              : "other";
    return `db.${op}.${target}`;
  }
  if (path.startsWith("/auth/v1/")) return "db.auth.other";
  return "db.other.other";
}

// `globalThis.Response`: this module's `Response` is Express's (imported for `timedRoute`).
type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<globalThis.Response>;

export function timedFetch(base: FetchLike): FetchLike {
  return (input, init) => {
    const timer = store.getStore();
    if (timer === undefined || !timer.databaseTrips) return base(input, init);
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    return timedStep(databaseTripStepName(url, method), () =>
      base(input, init),
    );
  };
}

// ── Steps measured elsewhere ──────────────────────────────────────────────────

/**
 * @spec [owner brief "P2 Revised: Cut the Wait Without Streaming" (Karl, 2026-10-23) §2 H1 ("every
 *        model call ... total")] | @implemented [2026-10-23]
 *
 * plain English: LISA's model calls run in the orchestrator worker (Cloud Run), whose logs are
 * not the BFF's. The worker returns its own timings as numbers (`orchestration_meta.timing`), and
 * this records them into the current request's one line so a turn reads end to end in one place.
 * `anchor` is the `performance.now()` at which the BFF sent the request the timings belong to;
 * each step's `at_ms` is an offset from the worker's own start. The two clocks are different
 * machines, so the steps are placed as if the worker started the moment the request was sent:
 * the gap between the enclosing `worker_request` step and `worker_handler` is the network,
 * Cloud Run's ingress and the response read, not time inside the worker.
 *
 * Step names are literals from the caller; the values are numbers parsed by the wire schema.
 * Outside a timed request this does nothing. The step cap applies as for every other step.
 */
export function recordMeasuredSteps(
  anchor: number,
  steps: readonly { step: string; at_ms: number; ms: number }[],
): void {
  const timer = store.getStore();
  if (timer === undefined || timer.emitted) return;
  for (const { step, at_ms, ms } of steps) {
    if (timer.steps.length >= MAX_STEPS) {
      timer.dropped += 1;
      continue;
    }
    timer.steps.push({
      step,
      ms: round(ms),
      at_ms: round(anchor - timer.startedAt + at_ms),
    });
  }
}

// ── Pre-handler steps ─────────────────────────────────────────────────────────

/**
 * @spec [owner brief (Karl) 2026-10-15 "next perf PR" item 1 ("Add per-step timing to the shared
 *        middleware chain in front of these routes ... emitted through the existing
 *        step-timer/route_timing line (fixed literal step names, no content, no tokens/cookies/ids
 *        beyond what route_timing already carries)"); Doc-01A_V1.0 §10] | @implemented [2026-10-15]
 *
 * plain English: the middleware in front of a timed route runs BEFORE `timedRoute` opens its
 * timer, so its cost showed only as one number, `pre_handler_ms`. Each middleware step that does
 * I/O now records itself on the request (`req.preHandlerSteps`) with a fixed name, its duration
 * and its start offset from the first middleware (`requestStartedAt`), and the route's one
 * `route_timing` line carries them as `pre_steps`. What `pre_handler_ms` holds beyond the sum of
 * `pre_steps` is synchronous middleware (headers, CORS, cookies, body parsing, CSRF's HMAC, the
 * in-memory rate limiter) — no network.
 *
 * WHAT IT CAN CARRY. Names are this closed union; durations and offsets are numbers. Nothing from
 * the request, the session or the database is read into a record.
 *
 *   auth_session          `supabase.auth.getUser()` — the Auth server, one call
 *   auth_session_refresh  the same step when the session was refreshed during it (the SSR client
 *                         wrote new auth cookies): a token refresh call plus the user call
 *   auth_profile          the `profiles` read behind `req.user`. When the session cookie claims
 *                         an id it opens beside `auth_session` (ruling 1 on #1257, 2026-10-19);
 *                         a discarded claim's re-read is inside the same step
 *   deletion_lock         the account-deletion lock's reads (flag-gated; absent when dormant).
 *                         With `deleted_at` from the auth step (ruling Q2 on #1271, 2026-10-20)
 *                         one read: the completed-request one
 *   under13_link          the under-13 guardian-link read (under-13 students only)
 *   answer_rate_limit     practice's answer limiter: its config read (30 s cache) and the bucket.
 *                         On POST /api/practice/answer it opens when the config read starts,
 *                         alongside `deletion_lock` (ruling B on #1257, 2026-10-20), and closes
 *                         where the limiter admits the request
 */
export const PRE_HANDLER_STEPS = [
  "auth_session",
  "auth_session_refresh",
  "auth_profile",
  "deletion_lock",
  "under13_link",
  "answer_rate_limit",
] as const;
export type PreHandlerStepName = (typeof PRE_HANDLER_STEPS)[number];

export type PreHandlerStepRecord = {
  step: PreHandlerStepName;
  ms: number | null;
  /** Start offset from the first middleware (`requestStartedAt`). */
  at_ms: number;
};

/** A request runs each middleware once; a bound keeps a misuse from growing the line. */
const MAX_PRE_STEPS = 16;

/**
 * Open a pre-handler step on this request. Returns the function that closes it; the closer may
 * RENAME the step to another member of the union (for `auth_session` → `auth_session_refresh`,
 * which is only known at the end). Without `requestStartedAt` (a request that did not pass
 * `requestIdMiddleware`, e.g. a unit test) nothing is recorded.
 */
export function beginPreHandlerStep(
  req: Request,
  step: PreHandlerStepName,
): (finalName?: PreHandlerStepName) => void {
  const requestStartedAt = req.requestStartedAt;
  if (typeof requestStartedAt !== "number") return () => undefined;
  const steps = (req.preHandlerSteps ??= []);
  if (steps.length >= MAX_PRE_STEPS) return () => undefined;
  const start = performance.now();
  const record: PreHandlerStepRecord = {
    step,
    ms: null,
    at_ms: round(start - requestStartedAt),
  };
  steps.push(record);
  return (finalName?: PreHandlerStepName) => {
    if (record.ms !== null) return;
    record.ms = round(performance.now() - start);
    if (finalName !== undefined) record.step = finalName;
  };
}

/** The fields of the one `route_timing` line. Exported so the redaction test asserts on it. */
export type RouteTimingLine = {
  route: RouteTimingName;
  status: number;
  total_ms: number;
  pre_handler_ms: number | null;
  /** The middleware steps that ran before the handler, in start order (see above). */
  pre_steps: PreHandlerStepRecord[];
  step_count: number;
  steps_dropped: number;
  steps: StepRecord[];
  /** Present on `tutor.message` turns that reached Step 13d. */
  video_retrieval?: VideoRetrievalTiming;
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
    pre_steps: (req.preHandlerSteps ?? []).map((s) => ({ ...s })),
    step_count: timer.steps.length,
    steps_dropped: timer.dropped,
    // Sorted by start (stable, so a no-op for steps recorded live, which are pushed in start
    // order); places steps recorded afterwards by `recordMeasuredSteps` where they ran.
    steps: timer.steps.map((s) => ({ ...s })).sort((a, b) => a.at_ms - b.at_ms),
    ...(timer.videoRetrieval === undefined
      ? {}
      : {
          video_retrieval: {
            ...timer.videoRetrieval,
            video_ids: [...timer.videoRetrieval.video_ids],
          },
        }),
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
export function timedRoute(
  route: RouteTimingName,
  handler: Handler,
  options: { databaseTrips?: boolean } = {},
): Handler {
  return (req: Request, res: Response): unknown => {
    const timer: RouteTimer = {
      route,
      startedAt: performance.now(),
      steps: [],
      dropped: 0,
      emitted: false,
      databaseTrips: options.databaseTrips === true,
    };
    const done = (): void => emit(timer, req, res);
    res.once("finish", done);
    res.once("close", done);
    return store.run(timer, () => handler(req, res));
  };
}
