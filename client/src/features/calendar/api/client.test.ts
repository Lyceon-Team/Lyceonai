/**
 * @spec [Doc_05F_Study_Calendar, §15 API surface, §16 guardian read;
 *        lyceon-coding-standards §7.1 parse at every boundary, §8.2 response shape]
 * @implemented [2026-09-22]
 *
 * plain English: `client.ts` is the calendar's only boundary with the network, so these
 * assert the two things a boundary owes its callers — the URL it builds, and the refusal of
 * a body the shared schema does not accept.
 *
 * THE REFUSAL IS THE POINT. §17.5 has an error state and no "silently empty" state, and the
 * two are different answers. A malformed 200 that defaulted to `{ days: [] }` would render a
 * student's plan as an empty week and tell them nothing was scheduled — a contract mismatch
 * reported as a fact about their studying. These tests hold the module to rejecting instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarDay, DayEditBody, PlanBlock } from "@lyceon/shared";
import {
  CALENDAR_ROOT,
  STREAK_PATH,
  fetchCalendar,
  fetchGuardianCalendar,
  fetchStreak,
  postAcknowledge,
  postLaunch,
  postMoveBlock,
  putDay,
} from "./client";

const csrfFetchMock = vi.fn();

vi.mock("@/lib/csrf", () => ({
  csrfFetch: (...args: unknown[]) => csrfFetchMock(...args),
}));

// ── Fixture ─────────────────────────────────────────────────────────────────

const FROM = "2026-09-21";
const TO = "2026-09-23";
const TZ = "America/Los_Angeles";
const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "6f1d2f5a-9f8a-4a1e-8f4c-0b2f1d3e4a5b";
const KEY = "4b3f1a9c-2d5e-4c7b-9a1f-8e6d5c4b3a21";

const BLOCK: PlanBlock = {
  block_id: BLOCK_ID,
  scheduled_date: FROM,
  block_type: "practice",
  section: "M",
  scope: {
    level: "domain",
    mix: [{ domain: "Algebra", count: 20, explanation_key: "weak" }],
  },
  target_count: 20,
  source: "auto",
  derived_from_block_id: null,
  explanation_key: "weighted",
  display_ordinal: 1,
  membership_type: "created",
};

const DAY: CalendarDay = {
  local_date: FROM,
  timezone: TZ,
  is_user_override: false,
  is_study_day: true,
  version_no: 7,
  status: "partial",
  blocks: [{ block: BLOCK, actual: 12, progress: 0.6, status: "partial" }],
  extra_work: [],
  planned_count: 20,
  actual_count: 12,
  extra_count: 0,
};

const FACTS = {
  blocks_total: 1,
  blocks_completed: 0,
  blocks_partial: 1,
  blocks_missed: 0,
  blocks_in_progress: 0,
  blocks_scheduled: 0,
  questions_completed: 12,
  full_lengths_completed: 0,
  extra_questions: 0,
};

const STREAK = { current: 4, longest: null, history_complete: false };

/** §17.1's "~N min" constants. On BOTH payloads by the owner ruling of 2026-09-22. */
const ESTIMATES = {
  practice_seconds_per_unit: 90,
  review_seconds_per_unit: 120,
};

/** A body exactly as the §15 route serves it — minus the `requestId` the routes spread in. */
const READY_BODY = {
  status: "ready",
  profile: {
    timezone: TZ,
    target_exam_date: "2026-11-07",
    target_score: 1400,
    study_days_mask: 62,
    daily_minutes: 45,
    full_length_weekday: 6,
    planner_mode: "auto",
    setup_completed_at: "2026-09-01T18:00:00Z",
  },
  estimates: { practice_seconds_per_unit: 90, review_seconds_per_unit: 120 },
  days: [DAY],
  facts: FACTS,
  streak: STREAK,
  latest_unacknowledged_nonstudent_change: null,
  diagnostic_state: "baseline_ready",
};

const GUARDIAN_BODY = {
  status: "ready",
  // Owner ruling 2026-09-22: the guardian payload carries the same estimates.
  estimates: ESTIMATES,
  days: [],
  facts: FACTS,
  streak: STREAK,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestedUrl(index = 0): URL {
  const raw = String(csrfFetchMock.mock.calls[index]?.[0] ?? "");
  return new URL(raw, "https://lyceon.test");
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

// ── URL construction (§15, §16) ─────────────────────────────────────────────

describe("the URLs `client.ts` builds", () => {
  it("GET /api/calendar carries from, to AND device_timezone — §17.3's mismatch cannot be derived without it", async () => {
    csrfFetchMock.mockResolvedValueOnce(jsonResponse(READY_BODY));

    await fetchCalendar(FROM, TO, TZ);

    const url = requestedUrl();
    expect(url.pathname).toBe(CALENDAR_ROOT);
    expect(url.searchParams.get("from")).toBe(FROM);
    expect(url.searchParams.get("to")).toBe(TO);
    expect(url.searchParams.get("device_timezone")).toBe(TZ);
  });

  it("GET /api/me/streak is a bare path — INV-08-20 serves it without a calendar_access check", async () => {
    csrfFetchMock.mockResolvedValueOnce(jsonResponse(STREAK));

    const result = await fetchStreak();

    expect(String(csrfFetchMock.mock.calls[0]?.[0])).toBe(STREAK_PATH);
    expect(result).toEqual(STREAK);
  });

  it("the GUARDIAN read is /api/students/:id/calendar (formula sheet item 14), never an /api/guardian/ path", async () => {
    csrfFetchMock.mockResolvedValueOnce(jsonResponse(GUARDIAN_BODY));

    await fetchGuardianCalendar(STUDENT_ID, FROM, TO);

    const url = requestedUrl();
    expect(url.pathname).toBe(`/api/students/${STUDENT_ID}/calendar`);
    expect(url.searchParams.get("from")).toBe(FROM);
    expect(url.searchParams.get("to")).toBe(TO);
    // §16 gives a guardian no device-zone prompt, so the param is absent, not empty.
    expect(url.searchParams.has("device_timezone")).toBe(false);
  });

  it("PUT /api/calendar/days/:date encodes the date into the path and sends the member list (§12.4)", async () => {
    csrfFetchMock.mockResolvedValueOnce(
      jsonResponse({ version_no: 8, day: DAY }),
    );

    const body: DayEditBody = {
      members: [{ kind: "carried", block_id: BLOCK_ID }],
      idempotency_key: KEY,
    };
    await putDay(FROM, body);

    const init = csrfFetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(requestedUrl().pathname).toBe(`${CALENDAR_ROOT}/days/${FROM}`);
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });

  it("POST /api/calendar/blocks/:id/move encodes the block id into the path", async () => {
    csrfFetchMock.mockResolvedValueOnce(jsonResponse({ version_no: 8 }));

    await postMoveBlock(BLOCK_ID, { to_date: TO, idempotency_key: KEY });

    expect(requestedUrl().pathname).toBe(
      `${CALENDAR_ROOT}/blocks/${BLOCK_ID}/move`,
    );
  });

  it("POST /api/calendar/blocks/:id/launch sends NO idempotency_key — the service owns the engine key (§15.1, INV-08-18)", async () => {
    csrfFetchMock.mockResolvedValueOnce(
      jsonResponse({
        engine: "practice",
        session_id: SESSION_ID,
        next: `/practice/session/${SESSION_ID}`,
        resumed: false,
      }),
    );

    await postLaunch(BLOCK_ID, {
      client_instance_id: "cid-1",
      platform: "web",
    });

    const init = csrfFetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(requestedUrl().pathname).toBe(
      `${CALENDAR_ROOT}/blocks/${BLOCK_ID}/launch`,
    );
    expect(sent).toEqual({ client_instance_id: "cid-1", platform: "web" });
    expect(sent.idempotency_key).toBeUndefined();
  });

  it("POST /api/calendar/acknowledge sends only the version (§12.7, monotonic)", async () => {
    csrfFetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await postAcknowledge({ version_no: 7 });

    expect(requestedUrl().pathname).toBe(`${CALENDAR_ROOT}/acknowledge`);
    expect(result).toEqual({ ok: true });
  });
});

// ── `requestId` (the reason `stripRequestId` exists) ────────────────────────

describe("transport correlation is stripped, not tolerated", () => {
  it("a body carrying the routes' extra `requestId` key still parses against the .strict() schema", async () => {
    // The routes spread `requestId` into every success body. Every shared response schema is
    // `.strict()`, so without the strip this ordinary body would be a contract mismatch.
    csrfFetchMock.mockResolvedValueOnce(
      jsonResponse({ ...READY_BODY, requestId: "abc" }),
    );

    const result = await fetchCalendar(FROM, TO, TZ);

    expect(result.status).toBe("ready");
    // And the correlation id does not ride into the domain payload.
    expect(Object.keys(result)).not.toContain("requestId");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("strips `requestId` on the streak and guardian reads too", async () => {
    csrfFetchMock
      .mockResolvedValueOnce(jsonResponse({ ...STREAK, requestId: "abc" }))
      .mockResolvedValueOnce(
        jsonResponse({ ...GUARDIAN_BODY, requestId: "def" }),
      );

    await expect(fetchStreak()).resolves.toEqual(STREAK);
    await expect(fetchGuardianCalendar(STUDENT_ID, FROM, TO)).resolves.toEqual(
      GUARDIAN_BODY,
    );
  });
});

// ── The refusal (§7.1, §17.5) ───────────────────────────────────────────────

describe("a malformed 200 is REFUSED, never defaulted", () => {
  it("rejects with a message naming the mismatch, rather than returning an empty calendar", async () => {
    csrfFetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "ready", estimates: ESTIMATES, days: [] }),
    );

    await expect(fetchCalendar(FROM, TO, TZ)).rejects.toThrow(
      /contract mismatch, not an empty result/,
    );
  });

  it("names the failing resource in the thrown message, so the error state is traceable to one route", async () => {
    csrfFetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "ready", estimates: ESTIMATES, days: [] }),
    );

    await expect(fetchCalendar(FROM, TO, TZ)).rejects.toThrow(
      /GET \/api\/calendar/,
    );
  });

  it("reports through console.error with the issue PATHS only — never the body, which holds the plan", async () => {
    csrfFetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "ready", estimates: ESTIMATES, days: [] }),
    );

    await expect(fetchCalendar(FROM, TO, TZ)).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0]?.[0]);
    expect(logged).toContain("[CALENDAR] GET /api/calendar");
    expect(logged).toContain("contract mismatch");
    // Privacy (Coding Standards §12.1): no student content in the log line.
    expect(logged).not.toContain("Algebra");
    expect(logged).not.toContain("target_score");
  });

  it("refuses a guardian body that arrived in the STUDENT shape", async () => {
    // §16's payload is its own `.strict()` union; a wider body is a contract mismatch here
    // rather than a guardian quietly receiving plan machinery.
    csrfFetchMock.mockResolvedValueOnce(jsonResponse(READY_BODY));

    await expect(fetchGuardianCalendar(STUDENT_ID, FROM, TO)).rejects.toThrow(
      /GET \/api\/students\/:id\/calendar/,
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("refuses a launch response missing `next`, rather than navigating nowhere", async () => {
    csrfFetchMock.mockResolvedValueOnce(
      jsonResponse({
        engine: "practice",
        session_id: SESSION_ID,
        resumed: false,
      }),
    );

    await expect(
      postLaunch(BLOCK_ID, { client_instance_id: "cid-1", platform: "web" }),
    ).rejects.toThrow(/contract mismatch/);
  });

  it("a non-2xx never reaches the parser — it becomes an HttpApiError first", async () => {
    csrfFetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { message: "premium required", code: "PREMIUM_REQUIRED" } },
        402,
      ),
    );

    await expect(fetchCalendar(FROM, TO, TZ)).rejects.toMatchObject({
      status: 402,
      code: "PREMIUM_REQUIRED",
    });
    // No schema complaint: an entitlement denial is an answer (§17.5), not a mismatch.
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
