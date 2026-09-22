/**
 * @spec [Doc_05F_Study_Calendar, §15 API surface, §17.7 "no raw fetch in components"]
 * @implemented [2026-09-23]
 *
 * plain English: every calendar HTTP call in the app, in one module, each one parsing its
 * response through the SHARED Zod schema before the value reaches a hook. Expected outcome:
 * a component can never see a shape the server did not promise. Trade-off: a malformed 200
 * becomes a rejected promise and an error state rather than a defaulted empty object —
 * §17.5 has an error state and no "silently empty" state, and the two are different answers.
 *
 * edge cases: the routes spread `requestId` into every success body for correlation, and
 * every shared response schema is `.strict()`. The transport key is stripped here, once,
 * rather than loosening fourteen schemas — `requestId` is correlation metadata, not part of
 * the domain payload, and a schema that tolerates unknown keys is a schema that cannot tell
 * you the server changed.
 */
import {
  acknowledgeResponseSchema,
  calendarResponseSchema,
  dayEditResponseSchema,
  doItNowResponseSchema,
  guardianCalendarResponseSchema,
  launchResponseSchema,
  profileUpsertResponseSchema,
  streakSummarySchema,
  versionResponseSchema,
  type AcknowledgeBody,
  type CalendarResponse,
  type DayEditBody,
  type DayEditResponse,
  type DoItNowResponse,
  type GuardianCalendarResponse,
  type LaunchBody,
  type LaunchResponse,
  type MoveBlockBody,
  type PlanMember,
  type ProfileUpsertResponse,
  type StreakSummary,
  type VersionResponse,
} from "@lyceon/shared/calendar";
import { studentResourceUrl } from "@lyceon/shared/student-resources";
import { apiRequest } from "@/lib/queryClient";

export const CALENDAR_ROOT = "/api/calendar" as const;
export const STREAK_PATH = "/api/me/streak" as const;

/**
 * Parses a response body against a shared schema. A failure THROWS, and the thrown message
 * names the resource so the ERROR that reaches the console and the error state the student
 * sees are traceable to one route.
 *
 * The client has no structured logger (`client/src/lib/` has `authLogger` and nothing
 * general), so this reports through `console.error` — the one place in this feature that
 * does. It carries the resource name and the Zod issue paths ONLY: never the body, which on
 * this surface contains a student's plan.
 */
async function parsed<T>(
  response: Response,
  schema: {
    safeParse: (value: unknown) =>
      | { success: true; data: T }
      | {
          success: false;
          error: { issues: readonly { path: readonly (string | number)[] }[] };
        };
  },
  resource: string,
): Promise<T> {
  // A 200 whose body is not JSON at all — a proxy or CDN error page, the classic
  // "Unexpected token <" — must take the SAME path as a body that parses but does not
  // match. Letting `response.json()` throw raw would skip the curated message and the one
  // ERROR log this feature has, for the failure mode most likely to hit it in production.
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // eslint-disable-next-line no-console -- the only client-side ERROR channel; see above.
    console.error(`[CALENDAR] ${resource}: response body was not JSON.`);
    throw new Error(
      `${resource}: the server returned a body this client cannot read. This is a contract mismatch, not an empty result.`,
    );
  }
  const payload = stripRequestId(body);
  const result = schema.safeParse(payload);
  if (!result.success) {
    const paths = result.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    // eslint-disable-next-line no-console -- the only client-side ERROR channel; see above.
    console.error(
      `[CALENDAR] ${resource}: response failed schema validation at [${paths}]. This is a contract mismatch, not an empty result.`,
    );
    throw new Error(
      `${resource}: the server returned a body this client cannot read. This is a contract mismatch, not an empty result.`,
    );
  }
  return result.data;
}

/** See the module note: `requestId` is transport correlation, not payload. */
function stripRequestId(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return body;
  if (!("requestId" in body)) return body;
  const { requestId: _requestId, ...rest } = body as Record<string, unknown>;
  return rest;
}

function jsonBody(value: unknown): {
  method: string;
  headers: Record<string, string>;
  body: string;
} {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * §15 GET /api/calendar. `device_timezone` travels on every read: without it the server
 * cannot populate §17.3's mismatch prompt, and the pre-setup `defaults.timezone` falls back
 * to `America/Chicago` instead of the zone the student is actually in.
 */
export async function fetchCalendar(
  from: string,
  to: string,
  deviceTimezone: string,
): Promise<CalendarResponse> {
  const query = new URLSearchParams({
    from,
    to,
    device_timezone: deviceTimezone,
  });
  const response = await apiRequest(`${CALENDAR_ROOT}?${query.toString()}`);
  return parsed(response, calendarResponseSchema, "GET /api/calendar");
}

/** §15 GET /api/me/streak — INV-08-20, served without a `calendar_access` check. */
export async function fetchStreak(): Promise<StreakSummary> {
  const response = await apiRequest(STREAK_PATH);
  return parsed(response, streakSummarySchema, "GET /api/me/streak");
}

/**
 * Formula sheet item 14: the guardian read is `/api/students/:studentId/calendar`, built
 * from the SHARED `studentResourceUrl` rather than a second template literal — the path
 * lives in `packages/shared/student-resources.ts` and has exactly one spelling.
 */
export async function fetchGuardianCalendar(
  studentId: string,
  from: string,
  to: string,
): Promise<GuardianCalendarResponse> {
  const query = new URLSearchParams({ from, to });
  const url = `${studentResourceUrl(studentId, "calendar")}?${query.toString()}`;
  const response = await apiRequest(url);
  return parsed(
    response,
    guardianCalendarResponseSchema,
    "GET /api/students/:id/calendar",
  );
}

// ── Mutations ───────────────────────────────────────────────────────────────

/** §15 PUT /api/calendar/profile. The body shape is bounds-dependent and parsed server-side. */
export async function putStudyProfile(
  body: Record<string, unknown>,
): Promise<ProfileUpsertResponse> {
  const response = await apiRequest(`${CALENDAR_ROOT}/profile`, {
    ...jsonBody(body),
    method: "PUT",
  });
  return parsed(
    response,
    profileUpsertResponseSchema,
    "PUT /api/calendar/profile",
  );
}

/** §15 PUT /api/calendar/days/:date — the FULL desired member list for the date (§12.4). */
export async function putDay(
  date: string,
  body: DayEditBody,
): Promise<DayEditResponse> {
  const response = await apiRequest(
    `${CALENDAR_ROOT}/days/${encodeURIComponent(date)}`,
    {
      ...jsonBody(body),
      method: "PUT",
    },
  );
  return parsed(
    response,
    dayEditResponseSchema,
    "PUT /api/calendar/days/:date",
  );
}

export type DayMembers = readonly PlanMember[];

/** §12.2/§12.4 POST /api/calendar/blocks/:id/move. */
export async function postMoveBlock(
  blockId: string,
  body: MoveBlockBody,
): Promise<VersionResponse> {
  const response = await apiRequest(
    `${CALENDAR_ROOT}/blocks/${encodeURIComponent(blockId)}/move`,
    jsonBody(body),
  );
  return parsed(
    response,
    versionResponseSchema,
    "POST /api/calendar/blocks/:id/move",
  );
}

/** §15 POST /api/calendar/plan/regenerate — the student's own `Refresh plan`. */
export async function postRegeneratePlan(
  idempotencyKey: string,
): Promise<VersionResponse> {
  const response = await apiRequest(
    `${CALENDAR_ROOT}/plan/regenerate`,
    jsonBody({ idempotency_key: idempotencyKey }),
  );
  return parsed(
    response,
    versionResponseSchema,
    "POST /api/calendar/plan/regenerate",
  );
}

/** §15 POST /api/calendar/days/:date/regenerate. */
export async function postRegenerateDay(
  date: string,
  idempotencyKey: string,
): Promise<VersionResponse> {
  const response = await apiRequest(
    `${CALENDAR_ROOT}/days/${encodeURIComponent(date)}/regenerate`,
    jsonBody({ idempotency_key: idempotencyKey }),
  );
  return parsed(
    response,
    versionResponseSchema,
    "POST /api/calendar/days/:date/regenerate",
  );
}

/** §15 POST /api/calendar/days/:date/reset — back to auto. */
export async function postResetDay(
  date: string,
  idempotencyKey: string,
): Promise<VersionResponse> {
  const response = await apiRequest(
    `${CALENDAR_ROOT}/days/${encodeURIComponent(date)}/reset`,
    jsonBody({ idempotency_key: idempotencyKey }),
  );
  return parsed(
    response,
    versionResponseSchema,
    "POST /api/calendar/days/:date/reset",
  );
}

/** §12.6 POST /api/calendar/blocks/:id/do-it-now. */
export async function postDoItNow(
  blockId: string,
  idempotencyKey: string,
): Promise<DoItNowResponse> {
  const response = await apiRequest(
    `${CALENDAR_ROOT}/blocks/${encodeURIComponent(blockId)}/do-it-now`,
    jsonBody({ idempotency_key: idempotencyKey }),
  );
  return parsed(
    response,
    doItNowResponseSchema,
    "POST /api/calendar/blocks/:id/do-it-now",
  );
}

/**
 * §15.1 POST /api/calendar/blocks/:id/launch. NO `idempotency_key` in the body, deliberately:
 * `CalendarLaunchService` owns the engine key and derives it as
 * `calendar:block:<block_id>:<seq>`, which is what makes two concurrent first launches one
 * engine session (INV-08-18). A client-supplied key would break that.
 */
export async function postLaunch(
  blockId: string,
  body: LaunchBody,
): Promise<LaunchResponse> {
  const response = await apiRequest(
    `${CALENDAR_ROOT}/blocks/${encodeURIComponent(blockId)}/launch`,
    jsonBody(body),
  );
  return parsed(
    response,
    launchResponseSchema,
    "POST /api/calendar/blocks/:id/launch",
  );
}

/** §12.7 POST /api/calendar/acknowledge — monotonic, so no idempotency key (§15). */
export async function postAcknowledge(
  body: AcknowledgeBody,
): Promise<{ ok: true }> {
  const response = await apiRequest(
    `${CALENDAR_ROOT}/acknowledge`,
    jsonBody(body),
  );
  return parsed(
    response,
    acknowledgeResponseSchema,
    "POST /api/calendar/acknowledge",
  );
}
