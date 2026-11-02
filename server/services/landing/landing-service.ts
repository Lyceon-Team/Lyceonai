/**
 * Smart landing: what happens when a student opens the app at the default entry, goes Home after
 * a landing, or asks for "5 more" after today's question; and the nightly summary.
 *
 * @spec [owner brief "Smart landing: within-student rotating landing test" (Karl, 2026-10-26),
 *        "Assignment" (48-hour UTC windows; deterministic pick from the eligible arms at window
 *        start; students only; precedence: deep links win → an in-progress session resumes → the
 *        arm) and "Data" (the four events, all carrying `window_index`, `arm`, `device_class`);
 *        Karl's rulings on Step 0 the same day: A (the first open of the America/Chicago day within
 *        the window, at the default entry), B (an arm that cannot be served shows Home and records
 *        `fallback_reason`; an open landing set from earlier in the window resumes instead of a new
 *        one), C (round 1 arms; dashboard 1/3), D (math first 5+5; the full-screen QOTD route,
 *        straight to "5 more?" if answered; a nightly `landing_session_summary`; under-13 and
 *        unknown age always get dashboard with no row), E (behind the runtime-config kill switch)]
 *       | @implemented [2026-10-26]
 * @spec [owner change "Smart landing: replacing the multi-section sets" (Karl, 2026-10-26, later the
 *        same day): `set_math_5` (5 Math, first 2 easy or medium, already on Q1) replaces
 *        `set_mixed` and `set_math_first`; "5 more?" is 5 Math, same rules] | @implemented
 *        [2026-10-26]. Ruling D's "math first 5+5" above is superseded by it.
 * @spec [owner brief "Smart landing: new students land on Home; capture sign-up channel" (Karl,
 *        2026-10-28) item 1: no rotation until the student's first QOTD day after the day they
 *        onboarded has started; nothing recorded in `landing_windows` before then]
 *       | @implemented [2026-10-28]
 *
 * plain English, `openLanding` in order (each step that ends the landing returns `NO_LANDING`, so
 * the student simply stays on Home):
 *   1. Students only; 13+ only (an unknown age is not 13+); the kill switch must be on.
 *   1b. A new student lands on Home (the Getting Started checklist) until their first QOTD day
 *      after the day they onboarded has started (`landing_rotation_open`, the database's own
 *      QOTD day). Nothing else runs before then: no resume, no window, no show, no event.
 *   2. An in-progress session (a practice or review session touched since this window began)
 *      resumes: the route is its runner. No show is claimed, so a later open the same day can
 *      still land. A landing set from earlier in the window is such a session (ruling B).
 *   3. The window's arm: the stored one if the window already has a row, else drawn now from the
 *      eligibility read now (and frozen with it). `landing_claim_open` stores the window once and
 *      claims a show only for the first open of this Chicago day in the window.
 *   4. The arm is served. One that cannot be (no quota, no question today, no block today, an
 *      arm retired since the window was assigned, ...) shows Home and records why. `landing_assigned` (first open of the window) and
 *      `landing_shown` (every show) are sent.
 * The client tells the server only its device class and instance id; the decision, the clock and
 * the role are the server's.
 *
 * trade-offs: every dependency is injected (`LandingDeps`), so the tests drive this exact code
 * against real Postgres with a recording emitter.
 * edge cases: a racing second open in the same moment gets no row from the claim and stays Home;
 * an arm that falls back still counts as shown (with `fallback_reason`), because the analysis must
 * see the attempt.
 */
import {
  LANDING_ESCAPE_SECONDS,
  LANDING_MORE_SIZE,
  LANDING_RUNNER_QUERY,
  LANDING_SET_SIZE,
  LANDING_WINDOW_EPOCH_MS,
  LANDING_WINDOW_MS,
  landingWindowIndex,
  type DeviceClass,
  isRetiredLandingArm,
  type LandingConfig,
  type LandingEligibilityFacts,
  type LandingFallbackReason,
  type LandingOpenResponse,
  type StoredLandingArm,
} from "../../../packages/shared/src/smart-landing-schema";
import { emitEventWith, type EmitDeps } from "../../lib/analytics/emit-event";
import { logger } from "../../logger";
import { landingArmFor } from "./assignment";

const COMPONENT = "LANDING";

/** The authenticated caller, as the route resolved it. Never a client claim. */
export type LandingCaller = {
  id: string;
  actorId: string;
  role: "student" | "admin" | "guardian";
  isUnder13: boolean | undefined;
};

export type ClaimedShow = {
  show_id: string;
  arm: StoredLandingArm;
  eligible_arms: StoredLandingArm[];
  first_in_window: boolean;
};

export type SetOutcome =
  | { ok: true; sessionId: string }
  | { ok: false; reason: LandingFallbackReason };

export type ServeOutcome =
  | { ok: true; path: string | null }
  | { ok: false; reason: LandingFallbackReason };

export type LandingDeps = {
  now: () => Date;
  emit: EmitDeps;
  loadConfig: () => Promise<LandingConfig>;
  readWindowArm: (
    profileId: string,
    windowIndex: number,
  ) => Promise<{
    arm: StoredLandingArm;
    eligible_arms: StoredLandingArm[];
  } | null>;
  readFacts: (profileId: string) => Promise<LandingEligibilityFacts>;
  /** The rotation applies: the first QOTD day after the day the student onboarded has started. */
  rotationOpen: (profileId: string, now: Date) => Promise<boolean>;
  /** The runner of the student's most recent practice/review session active since `since`. */
  resumePath: (profileId: string, since: Date) => Promise<string | null>;
  claimOpen: (args: {
    profileId: string;
    windowIndex: number;
    arm: StoredLandingArm;
    eligibleArms: StoredLandingArm[];
    deviceClass: DeviceClass;
    now: Date;
  }) => Promise<ClaimedShow | null>;
  setFallback: (showId: string, reason: LandingFallbackReason) => Promise<void>;
  /** Today's question exists (any state). */
  qotdAvailable: (caller: LandingCaller, now: Date) => Promise<boolean>;
  /** A free student still has practice quota today (always true for an entitled one). */
  quotaAllows: (caller: LandingCaller) => Promise<boolean>;
  /** A Math-only landing set (`LANDING_SET_SECTIONS`) with the easy/medium lead. */
  startSet: (args: {
    caller: LandingCaller;
    size: number;
    idempotencyKey: string;
    clientInstanceId: string;
  }) => Promise<SetOutcome>;
  /** Launch today's first unfinished practice block with the easy/medium lead. */
  launchToday: (args: {
    caller: LandingCaller;
    clientInstanceId: string;
    now: Date;
  }) => Promise<ServeOutcome>;
  /** Today's show (this window, this Chicago day), if any. */
  readTodayShow: (
    profileId: string,
    windowIndex: number,
    chicagoDay: string,
  ) => Promise<{ show_id: string; arm: StoredLandingArm } | null>;
  recordEscape: (args: {
    showId: string;
    profileId: string;
    now: Date;
    maxSeconds: number;
  }) => Promise<{
    window_index: number;
    arm: StoredLandingArm;
    device_class: DeviceClass;
  } | null>;
  claimSummaries: (
    now: Date,
    limit: number,
  ) => Promise<
    {
      show_id: string;
      profile_id: string;
      window_index: number;
      arm: StoredLandingArm;
      device_class: DeviceClass;
      questions_answered: number;
    }[]
  >;
  releaseSummary: (showId: string) => Promise<void>;
};

export const NO_LANDING: LandingOpenResponse = {
  path: null,
  show_id: null,
  arm: null,
};

/** The runner path for a landing-opened session: its back link reads "Home". */
export function landingRunnerPath(sessionId: string): string {
  return `/practice/session/${sessionId}?${LANDING_RUNNER_QUERY}`;
}

function windowStart(windowIndex: number): Date {
  return new Date(LANDING_WINDOW_EPOCH_MS + windowIndex * LANDING_WINDOW_MS);
}

/** Chicago calendar date (YYYY-MM-DD) of `now`: the SQL `chicago_day`, for keys and lookups. */
export function chicagoDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

async function serveArm(
  deps: LandingDeps,
  caller: LandingCaller,
  arm: StoredLandingArm,
  windowIndex: number,
  clientInstanceId: string,
  now: Date,
): Promise<ServeOutcome> {
  if (isRetiredLandingArm(arm)) return { ok: false, reason: "arm_retired" };
  switch (arm) {
    case "dashboard":
      return { ok: true, path: null };
    case "qotd_then_more": {
      if (!(await deps.qotdAvailable(caller, now))) {
        return { ok: false, reason: "qotd_unavailable" };
      }
      if (!(await deps.quotaAllows(caller))) {
        return { ok: false, reason: "quota_exhausted" };
      }
      return { ok: true, path: `/qotd?${LANDING_RUNNER_QUERY}` };
    }
    case "set_math_5": {
      const set = await deps.startSet({
        caller,
        size: LANDING_SET_SIZE,
        idempotencyKey: `landing:${windowIndex}:${chicagoDate(now)}:${arm}`,
        clientInstanceId,
      });
      return set.ok
        ? { ok: true, path: landingRunnerPath(set.sessionId) }
        : { ok: false, reason: set.reason };
    }
    case "session_today":
      return deps.launchToday({ caller, clientInstanceId, now });
    case "plan_builder":
      return { ok: true, path: "/calendar" };
    case "calendar_today":
      // Held for round 2 (ruling C): weighted 0, so never assigned. Served as Home if it were.
      return { ok: true, path: null };
  }
}

export async function openLanding(
  deps: LandingDeps,
  caller: LandingCaller,
  request: { deviceClass: DeviceClass; clientInstanceId: string },
): Promise<LandingOpenResponse> {
  // 1. Students only; 13+ only (unknown age included in the exclusion); the kill switch.
  if (caller.role !== "student") return NO_LANDING;
  if (caller.isUnder13 !== false) return NO_LANDING;
  const config = await deps.loadConfig();
  if (!config.enabled) return NO_LANDING;

  const now = deps.now();
  const windowIndex = landingWindowIndex(now);
  if (windowIndex < 0) return NO_LANDING;

  // 1b. A new student lands on Home until their first QOTD day after onboarding (Karl,
  // 2026-10-28): before any read or write of the rotation, so the period records nothing.
  if (!(await deps.rotationOpen(caller.id, now))) return NO_LANDING;

  // 2. Precedence: an in-progress session resumes (ruling B covers a landing set).
  const resume = await deps.resumePath(caller.id, windowStart(windowIndex));
  if (resume !== null) return { path: resume, show_id: null, arm: null };

  // 3. The window's arm: stored, or drawn now from eligibility read now (frozen with it).
  const stored = await deps.readWindowArm(caller.id, windowIndex);
  const drawn =
    stored === null
      ? landingArmFor(
          caller.id,
          windowIndex,
          await deps.readFacts(caller.id),
          config,
        )
      : { arm: stored.arm, eligibleArms: stored.eligible_arms };
  const show = await deps.claimOpen({
    profileId: caller.id,
    windowIndex,
    arm: drawn.arm,
    eligibleArms: drawn.eligibleArms,
    deviceClass: request.deviceClass,
    now,
  });
  if (show === null) return NO_LANDING; // not the first open of this Chicago day in the window

  if (show.first_in_window) {
    await emitEventWith(deps.emit, caller.id, "landing_assigned", {
      window_index: windowIndex,
      arm: show.arm,
      device_class: request.deviceClass,
    });
  }

  // 4. Serve the arm; one that cannot be served shows Home and records why.
  let served: ServeOutcome;
  try {
    served = await serveArm(
      deps,
      caller,
      show.arm,
      windowIndex,
      request.clientInstanceId,
      now,
    );
  } catch (error: unknown) {
    logger.error(
      COMPONENT,
      "serve_failed",
      "A landing could not be served; Home shown",
      undefined,
      {
        arm: show.arm,
        error: error instanceof Error ? error.name : "unknown",
      },
    );
    served = { ok: false, reason: "error" };
  }
  const fallbackReason = served.ok ? null : served.reason;
  if (fallbackReason !== null)
    await deps.setFallback(show.show_id, fallbackReason);

  await emitEventWith(deps.emit, caller.id, "landing_shown", {
    window_index: windowIndex,
    arm: show.arm,
    device_class: request.deviceClass,
    fallback_reason: fallbackReason,
  });

  return {
    path: served.ok ? served.path : null,
    show_id: show.show_id,
    arm: show.arm,
  };
}

/** POST /api/landing/escape: the student reached Home; counted only within 30 s, server clock. */
export async function recordLandingEscape(
  deps: LandingDeps,
  caller: LandingCaller,
  showId: string,
): Promise<boolean> {
  const escaped = await deps.recordEscape({
    showId,
    profileId: caller.id,
    now: deps.now(),
    maxSeconds: LANDING_ESCAPE_SECONDS,
  });
  if (escaped === null) return false;
  await emitEventWith(deps.emit, caller.id, "landing_escaped", {
    window_index: escaped.window_index,
    arm: escaped.arm,
    device_class: escaped.device_class,
  });
  return true;
}

/**
 * POST /api/landing/more: "5 more?" after today's question, only when today's show is a
 * `qotd_then_more` one. A 5-question Math set with the easy/medium lead (Karl, 2026-10-26);
 * replayed, not doubled.
 */
export async function startLandingMore(
  deps: LandingDeps,
  caller: LandingCaller,
  clientInstanceId: string,
): Promise<{ path: string | null }> {
  if (caller.role !== "student" || caller.isUnder13 !== false)
    return { path: null };
  const now = deps.now();
  const show = await deps.readTodayShow(
    caller.id,
    landingWindowIndex(now),
    chicagoDate(now),
  );
  if (show === null || show.arm !== "qotd_then_more") return { path: null };
  const set = await deps.startSet({
    caller,
    size: LANDING_MORE_SIZE,
    idempotencyKey: `landing-more:${show.show_id}`,
    clientInstanceId,
  });
  return { path: set.ok ? landingRunnerPath(set.sessionId) : null };
}

export type LandingSummaryRun = {
  claimed: number;
  sent: number;
  released: number;
};

/** The policy refusals that keep a summary claimed (never re-tried), as the funnel events do. */
const KEEP_SUMMARY_ON = new Set([
  "excluded_under_13_or_age_unknown",
  "account_not_onboarded",
]);

/**
 * The nightly job: every show whose Chicago day is over gets one `landing_session_summary` with
 * the questions answered from that show until the next show or the end of its day. A send that
 * fails for a transient reason releases the claim so the next night retries it.
 */
export async function runLandingSummaries(
  deps: LandingDeps,
  batchSize = 500,
  maxBatches = 20,
): Promise<LandingSummaryRun> {
  const run: LandingSummaryRun = { claimed: 0, sent: 0, released: 0 };
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const rows = await deps.claimSummaries(deps.now(), batchSize);
    run.claimed += rows.length;
    for (const row of rows) {
      const result = await emitEventWith(
        deps.emit,
        row.profile_id,
        "landing_session_summary",
        {
          window_index: row.window_index,
          arm: row.arm,
          device_class: row.device_class,
          questions_answered: row.questions_answered,
        },
      );
      if (result.ok || KEEP_SUMMARY_ON.has(result.reason)) {
        if (result.ok) run.sent += 1;
        continue;
      }
      await deps.releaseSummary(row.show_id);
      run.released += 1;
    }
    if (rows.length < batchSize) break;
  }
  return run;
}
