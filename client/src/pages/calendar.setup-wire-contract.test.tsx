// @vitest-environment jsdom
/**
 * THE SETUP WIRE CONTRACT: real popup -> real page wiring -> real mutation -> real schema.
 *
 * @spec [Doc_05F_Study_Calendar §17.5 (setup popup), §8.1 (PUT /api/calendar/profile),
 *        §7.8 idempotency (INV-08-09); lyceon-coding-standards §4.2]
 * @implemented [2026-09-29]
 *
 * plain English: it opens the calendar for a student with no profile, presses straight
 * through the setup popup, takes the body that actually leaves the browser, and parses it
 * with the SAME `makeStudyProfileUpsertSchema` the route parses it with. If the two ever
 * disagree again, this file is where it goes red.
 *
 * WHY THIS FILE EXISTS — the defect it was written for.
 *   Production, 2026-09-28: every new premium student was stopped at their first screen.
 *   `PUT /api/calendar/profile` answered `400 INVALID_BODY` with
 *   `fieldErrors: { idempotency_key: ["Required"] }`, eight consecutive times, on an account
 *   that was premium and active. Zero rows in `student_study_profile`, zero plan versions.
 *   The setup popup did not send `idempotency_key`; the settings sheet did. That is the
 *   whole defect, and it is why an EXISTING student could edit their schedule freely while
 *   a NEW one could never create one — the surface that works is not the surface a new
 *   student meets.
 *
 * WHY NO EXISTING TEST CAUGHT IT, which is the point of this step.
 *   `SetupPopup.test.tsx` captures `onSubmit` into an array (`onSubmit={(a) => submitted
 *   .push(a)}`) and asserts on `SetupAnswers`. `SetupAnswers` is the student's ANSWERS, and
 *   it is correct: a popup has no business knowing what an idempotency key is. The missing
 *   field lived one layer up, in `calendar.tsx`'s `onSubmit: (body) => profile.mutate(body)`
 *   — the seam between the answers and the wire, which that test replaces with a spy and
 *   therefore never runs. `mutations.test.tsx` covers `useStudyProfileMutation`, but it
 *   supplies its own variables through `newIntent`, so it proves the HOOK keeps a key it is
 *   handed and never that a CALLER hands one. And `packages/shared/__tests__` parses
 *   hand-written objects. Three files, each green against something the setup path does not
 *   produce — the fixture-agrees-with-the-bug shape CLAUDE.md names.
 *
 *   So the seam is where the test has to stand: the network is intercepted at `@/lib/csrf`
 *   (the same seam `mutations.test.tsx` uses), and everything between the student's click
 *   and the socket is real — `SetupPopup`, `CalendarPage`, `newIntent`, the mutation hook,
 *   `apiRequest`, `putStudyProfile`. The body asserted on is the body that would be sent.
 *
 * ASSERT PRESENCE BEFORE ABSENCE. `expectValid` proves the parse SUCCEEDED before anything
 * reads a field off it; a `safeParse` whose `success` is never checked is an assertion that
 * passes for the wrong reason.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeStudyProfileUpsertSchema,
  type CalendarSetupDefaults,
  type StudyProfileUpsert,
} from "@lyceon/shared/calendar";

const csrfFetchMock = vi.fn();
vi.mock("@/lib/csrf", () => ({
  csrfFetch: (...args: unknown[]) => csrfFetchMock(...args),
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      display_name: "Sam",
    },
  }),
}));

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/calendar", navigate],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

import CalendarPage from "./calendar";

// ── Fixture ─────────────────────────────────────────────────────────────────

/**
 * The defaults the route actually serves (`calendarSetupDefaultsSchema`). `bounds` for the
 * write schema is the same server-owned object — `daily_minutes_presets`, the min/max and
 * the date horizon — which is why the form can never offer a value the parse then refuses.
 */
const DEFAULTS: CalendarSetupDefaults = {
  timezone: "America/Chicago",
  daily_minutes_presets: [15, 30, 45, 60, 90, 120],
  daily_minutes_min: 15,
  daily_minutes_max: 180,
  target_exam_date_max_days: 365,
  default_full_length_interval_weeks: 2,
  default_full_length_weekday: 6,
  final_exam_lead_days: 7,
};

const SETUP_REQUIRED = {
  status: "setup_required" as const,
  defaults: DEFAULTS,
  entitled: true,
};

/** The profile a successful upsert returns, in the route's own envelope. */
const SAVED_PROFILE = {
  profile: {
    timezone: DEFAULTS.timezone,
    target_exam_date: null,
    target_score: null,
    study_days_mask: 62,
    daily_minutes: 60,
    full_length_weekday: null,
    full_length_interval_weeks: null,
    planner_mode: "auto" as const,
    setup_completed_at: "2026-09-29T12:00:00Z",
  },
  version_no: 1,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Sent = { url: string; method: string; body: unknown };

const sent: Sent[] = [];

function profilePuts(): Sent[] {
  return sent.filter(
    (call) =>
      call.method === "PUT" && call.url.includes("/api/calendar/profile"),
  );
}

beforeEach(() => {
  sent.length = 0;
  navigate.mockClear();
  csrfFetchMock.mockReset();
  csrfFetchMock.mockImplementation(
    async (url: string, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? "GET").toUpperCase();
      const raw = typeof init?.body === "string" ? init.body : null;
      sent.push({
        url,
        method,
        body: raw === null ? null : (JSON.parse(raw) as unknown),
      });
      if (method === "GET" && url.includes("/api/calendar?")) {
        return jsonResponse({ ...SETUP_REQUIRED, requestId: "req-read" });
      }
      if (method === "PUT" && url.includes("/api/calendar/profile")) {
        return jsonResponse({ ...SAVED_PROFILE, requestId: "req-write" });
      }
      // The page also asks for the streak. Answering it keeps that query out of the way of
      // what this file is about, rather than leaving an unhandled call to time out.
      return jsonResponse({
        current: 0,
        longest: null,
        history_complete: true,
      });
    },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCalendar(): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <CalendarPage />
    </QueryClientProvider>,
  );
}

/** Press straight through: continue past the targets panel, then save. */
async function pressStraightThrough(): Promise<void> {
  renderCalendar();
  await screen.findByTestId("calendar-setup-popup");
  fireEvent.click(screen.getByTestId("calendar-setup-continue"));
  fireEvent.click(screen.getByTestId("calendar-setup-done"));
  await waitFor(() => expect(profilePuts()).toHaveLength(1));
}

/**
 * The REAL write schema, bound to the REAL served bounds and the student's local today —
 * the same two inputs `profile-service.ts` binds it to before parsing `req.body`.
 */
function parseAsTheRouteWould(body: unknown): StudyProfileUpsert {
  const schema = makeStudyProfileUpsertSchema({
    bounds: {
      daily_minutes_min: DEFAULTS.daily_minutes_min,
      daily_minutes_max: DEFAULTS.daily_minutes_max,
      daily_minutes_presets: DEFAULTS.daily_minutes_presets,
      target_exam_date_max_days: DEFAULTS.target_exam_date_max_days,
    },
    // The popup derives its dates from the device clock, so the schema is bound to the
    // same day rather than to a frozen literal that a midnight run would disagree with.
    localToday: new Date().toISOString().slice(0, 10),
  });
  const parsed = schema.safeParse(body);
  // Presence before absence: prove it parsed, and say WHICH field failed if it did not —
  // a bare `toBe(true)` here would reproduce the original defect's unreadable 400.
  expect(
    parsed.success
      ? []
      : Object.keys(parsed.error.flatten().fieldErrors).concat(
          parsed.error.flatten().formErrors,
        ),
  ).toEqual([]);
  if (!parsed.success) throw new Error("unreachable: asserted above");
  return parsed.data;
}

// ── The contract ────────────────────────────────────────────────────────────

describe("setup save — the real payload against the real schema", () => {
  it("a student who answers nothing sends a body the route ACCEPTS", async () => {
    await pressStraightThrough();

    const put = profilePuts()[0]!;
    // Presence first: there is a body, and it is an object with fields in it. An assertion
    // over an empty payload would pass for the wrong reason.
    expect(put.body).toBeTypeOf("object");
    expect(Object.keys(put.body as object).length).toBeGreaterThan(1);

    const parsed = parseAsTheRouteWould(put.body);

    // THE FIELD THE 400 NAMED. Not "is present" — is a UUID, which is what
    // `idempotencyKeySchema` requires and what the parse above has now proved.
    expect(parsed.idempotency_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    // ...and the answers still travel. A key with nothing beside it would satisfy the
    // schema's key rule and fail its "must change at least one field" rule, so this is the
    // half the parse already proved — asserted anyway, because the payload being non-trivial
    // is what makes every other assertion in this file mean something.
    expect(parsed.study_days_mask).toBeGreaterThan(0);
    expect(parsed.daily_minutes).toBe(60);
    expect(parsed.timezone).toBeTypeOf("string");
    // R-08-27: pressing through books no recurring exam. Both halves null together, which
    // is the only way `full_length_pair` and the Step 2 refinement accept "no exams".
    expect(parsed.full_length_weekday).toBeNull();
    expect(parsed.full_length_interval_weeks).toBeNull();
  });

  it("the key is one per intent — a second press is a DIFFERENT key", async () => {
    await pressStraightThrough();
    const first = parseAsTheRouteWould(profilePuts()[0]!.body);

    cleanup();
    sent.length = 0;
    await pressStraightThrough();
    const second = parseAsTheRouteWould(profilePuts()[0]!.body);

    // §7.8 wants one key per user INTENT. Two presses are two intents; reusing the key
    // across them would make the second save a no-op replay of the first, which is the
    // opposite failure to the one this file was written for and just as silent.
    expect(second.idempotency_key).not.toBe(first.idempotency_key);
  });

  it("a RETRY of one press replays the SAME key — one profile, not two", async () => {
    // The retry path is what the key is for. `useStudyProfileMutation` sets `retry: 1`, so a
    // dropped connection re-invokes `mutationFn` — and because the key lives in the mutation
    // VARIABLES, TanStack hands back the same object. If a future edit ever mints the key
    // inside `mutationFn` instead, this goes red: two attempts, two keys, two profiles.
    let attempt = 0;
    csrfFetchMock.mockImplementation(
      async (url: string, init?: RequestInit): Promise<Response> => {
        const method = (init?.method ?? "GET").toUpperCase();
        const raw = typeof init?.body === "string" ? init.body : null;
        sent.push({
          url,
          method,
          body: raw === null ? null : (JSON.parse(raw) as unknown),
        });
        if (method === "GET" && url.includes("/api/calendar?")) {
          return jsonResponse({ ...SETUP_REQUIRED, requestId: "req-read" });
        }
        if (method === "PUT" && url.includes("/api/calendar/profile")) {
          attempt += 1;
          // First attempt dies the way a dropped connection does.
          if (attempt === 1) {
            return jsonResponse(
              { error: { message: "upstream failed", code: "UPSTREAM" } },
              502,
            );
          }
          return jsonResponse({ ...SAVED_PROFILE, requestId: "req-write" });
        }
        return jsonResponse({
          current: 0,
          longest: null,
          history_complete: true,
        });
      },
    );

    renderCalendar();
    await screen.findByTestId("calendar-setup-popup");
    fireEvent.click(screen.getByTestId("calendar-setup-continue"));
    fireEvent.click(screen.getByTestId("calendar-setup-done"));
    // TanStack's default `retryDelay` is ~1s for the first retry, which is longer than
    // `waitFor`'s default 1s timeout. The wait is widened rather than the delay shortened:
    // the retry policy under test is the app's, not one this file configured.
    await waitFor(() => expect(profilePuts()).toHaveLength(2), {
      timeout: 5_000,
    });

    const [first, second] = profilePuts().map((call) =>
      parseAsTheRouteWould(call.body),
    );
    expect(first!.idempotency_key).toBe(second!.idempotency_key);
  });
});
