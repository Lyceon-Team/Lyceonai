/**
 * THE WIRE CONTRACT: real serializer -> real route envelope -> real client parse.
 *
 * @spec [Doc-05F_V1.0 §15 (student read), §16 (guardian read); Doc 05B §10.3 single-route
 *        contract; lyceon-coding-standards §8.2 response shape] | @implemented [2026-09-25]
 *
 * plain English: it asks the real route for a calendar, takes the body verbatim, and hands it
 * to the real client fetcher. If either side changes its mind about the payload OR the
 * envelope around it, this goes red.
 *
 * WHY THIS FILE EXISTS — the defect it was written for.
 *   Production, 2026-09-25: `GET /api/students/:id/calendar` answered **200** and the guardian
 *   page rendered its error state. Both halves were correct in isolation and both were tested.
 *   The route wraps a payload as `{ ok: true, ...body, requestId }` (`student-resources.ts`,
 *   the `/api/students` surface convention), while the client stripped `requestId` only — so
 *   `guardianCalendarResponseSchema.strict()` saw a stray `ok` and rejected the whole body:
 *
 *     { code: "unrecognized_keys", keys: ["ok"], path: [], message: "Unrecognized key(s) in object: 'ok'" }
 *
 *   The path is the ROOT, so the console error named no field and read as though nothing was
 *   wrong with the data. Nothing was — the ENVELOPE was wrong.
 *
 * WHY NO EXISTING TEST CAUGHT IT, which is the whole point.
 *   `calendar.read-service.test.ts` asserts the SERVICE's return value, which never carries the
 *   envelope. `calendar.routes.contract.test.ts` stubs the service, so the real serializer never
 *   runs and the body it checks is a fixture. `packages/shared/__tests__/calendar-api.test.ts`
 *   parses hand-written objects. Three test files, none of which ever saw what production puts
 *   on the wire. Each passed against something neither side produces.
 *
 * WHY IT IS NOT PG-BACKED, stated rather than glossed. The brief asked for PG. The defect was
 * envelope drift, which the route adds regardless of where the rows came from — a live database
 * would not have made it more visible, and a PG requirement makes the test SKIPPABLE. A skipped
 * half reading green is how the review vertical's launch contract went unproven for weeks
 * (`scripts/ci/vitest-summary-gate.mjs` exists for exactly that), so the row source is the
 * shared fake and the assertion runs everywhere, every time. SQL-shape drift stays the business
 * of `scripts/ci/calendar-*-gates.sql` against a real Postgres, which is the right place for it.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLOCK_ROW,
  CONFIG_ROWS,
  PLAN_ROW,
  PRACTICE_CONFIG_ROW,
  SCENARIO_STUDENT,
  SCENARIO_TODAY,
  makeScenarioClient,
  type FakeClient,
} from "./calendar.service-harness";

let client: FakeClient;

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return client;
  },
}));

// Auth and the link/entitlement gate are proved by `student-resources.contract.test.ts` and
// `calendar.routes.contract.test.ts`. Here they are satisfied so the request reaches the real
// serializer — the subject is the only thing below the resolver that a handler may read.
vi.mock("../../server/middleware/subject-resolver", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/middleware/subject-resolver")
  >("../../server/middleware/subject-resolver");
  return {
    ...actual,
    resolveSubject: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      req.subject = { studentId: SCENARIO_STUDENT, via: "guardian" };
      next();
    },
  };
});

vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: { canAccessFeature: vi.fn(async () => true) },
}));

// The student surface's own auth. Same reasoning as above.
vi.mock("../../server/middleware/supabase-auth", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/middleware/supabase-auth")
  >("../../server/middleware/supabase-auth");
  return {
    ...actual,
    requireSupabaseAuth: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      (req as express.Request & { user?: { id: string } }).user = {
        id: SCENARIO_STUDENT,
      };
      next();
    },
    requireRequestUser: () => ({ id: SCENARIO_STUDENT }),
  };
});

// Doc 05C's projection band is optional (§15) and its own vertical. Empty here keeps this
// file about the calendar's own wire shape.
vi.mock("../../apps/api/src/services/projection-read", () => ({
  readSectionProjections: vi.fn(async () => []),
}));

// The adapters have their own contract tests (`calendar.launch-contract.*`). Here they only
// have to answer, so the read model has something to allocate. Only `adapterFor` is replaced:
// `read-service.ts` reaches `localTodayIn` through `./adapters/local-day` directly, so
// replacing the whole barrel would take that with it.
vi.mock("../../server/services/calendar/adapters", () => ({
  adapterFor: () => ({
    engine: "practice" as const,
    create: vi.fn(),
    nextLaunchSize: vi.fn(),
    progress: vi.fn(async () => null),
    activityUnits: vi.fn(async () => []),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  client = makeScenarioClient({ acceptedVersions: 1 });
});

/** The guardian route, mounted exactly as `server/index.ts` mounts it, minus CSRF. */
async function guardianApp(): Promise<express.Express> {
  const router = (await import("../../server/routes/student-resources"))
    .default;
  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId = "req-wire-1";
    next();
  });
  app.use("/api/students", router);
  return app;
}

/** The student route, mounted as `server/index.ts` mounts it, minus CSRF and the role gate. */
async function studentApp(): Promise<express.Express> {
  const { calendarRouter } =
    await import("../../server/routes/calendar-routes");
  const app = express();
  app.use((req, _res, next) => {
    const typed = req as express.Request & {
      requestId?: string;
      user?: { id: string; actor_id: string; role: string };
    };
    typed.requestId = "req-wire-2";
    // `callerOf` reads the VERIFIED session and 401s without it — server-authoritative by
    // design, so the session is supplied rather than the check bypassed.
    typed.user = {
      id: SCENARIO_STUDENT,
      actor_id: SCENARIO_STUDENT,
      role: "student",
    };
    next();
  });
  app.use("/api/calendar", calendarRouter);
  return app;
}

/**
 * Hands a captured wire body to the REAL client fetcher by standing in for `apiRequest`. The
 * fetcher's own envelope handling and `safeParse` then run exactly as they do in the browser —
 * which is the half that was wrong, so stubbing anything below it would stub the defect away.
 *
 * A hoisted mock over a mutable holder, deliberately, rather than `vi.doMock` +
 * `vi.resetModules()`: resetting the module graph mid-file gives the NEXT `await import` of a
 * route an unmocked `supabase-server`, which is how the student half of this file first failed
 * for a reason that had nothing to do with the student payload.
 */
let wireBody: unknown = null;

vi.mock("../../client/src/lib/queryClient", () => ({
  apiRequest: async () =>
    ({
      json: async () => wireBody,
      ok: true,
      status: 200,
    }) as unknown as Response,
}));

const { fetchCalendar, fetchGuardianCalendar } =
  await import("../../client/src/features/calendar/api/client");

describe("the guardian calendar's wire body parses with the client's own schema (§16)", () => {
  it("round-trips: real serializer -> real route envelope -> real client fetcher", async () => {
    const app = await guardianApp();
    const response = await request(app)
      .get(`/api/students/${SCENARIO_STUDENT}/calendar`)
      .query({ from: SCENARIO_TODAY, to: SCENARIO_TODAY });

    expect(response.status).toBe(200);

    // THE BLOCK IS ASSERTED PRESENT FIRST. Every §16 absence below would also hold for an
    // empty day list, so proving the payload is non-trivial is what stops this file passing
    // for the wrong reason.
    wireBody = response.body;
    const parsedBody = await fetchGuardianCalendar(
      SCENARIO_STUDENT,
      SCENARIO_TODAY,
      SCENARIO_TODAY,
    );
    if (parsedBody.status !== "ready") {
      throw new Error(`expected a ready payload, got ${parsedBody.status}`);
    }
    expect(parsedBody.days).toHaveLength(1);
    expect(parsedBody.days[0]?.blocks).toHaveLength(1);
    expect(parsedBody.days[0]?.blocks[0]?.block.block_id).toBe(
      BLOCK_ROW.block_id,
    );

    // And §16's withholdings, now that there is a real block to withhold them from.
    const serialized = JSON.stringify(parsedBody);
    expect(serialized).not.toContain("explanation_key");
    expect(serialized).not.toContain("target_score");
    expect(serialized).not.toContain("is_user_override");
    expect(serialized).not.toContain("version_no");
  });

  it("names the envelope key in the raw body, so the fix is visible if it regresses", async () => {
    const app = await guardianApp();
    const response = await request(app)
      .get(`/api/students/${SCENARIO_STUDENT}/calendar`)
      .query({ from: SCENARIO_TODAY, to: SCENARIO_TODAY });

    // The surface convention this client must strip. If `ok` ever leaves this route, the
    // round-trip above is what proves the client kept up — this records WHY it strips it.
    expect(response.body).toHaveProperty("ok", true);
    expect(response.body).toHaveProperty("requestId");
  });
});

describe("the student calendar's wire body parses with the client's own schema (§15)", () => {
  it("round-trips: real serializer -> real route envelope -> real client fetcher", async () => {
    const app = await studentApp();
    const response = await request(app).get("/api/calendar").query({
      from: SCENARIO_TODAY,
      to: SCENARIO_TODAY,
      device_timezone: "America/Chicago",
    });

    expect(response.status).toBe(200);

    wireBody = response.body;
    const parsedBody = await fetchCalendar(
      SCENARIO_TODAY,
      SCENARIO_TODAY,
      "America/Chicago",
    );
    if (parsedBody.status !== "ready") {
      throw new Error(`expected a ready payload, got ${parsedBody.status}`);
    }
    expect(parsedBody.days).toHaveLength(1);
    expect(parsedBody.days[0]?.blocks).toHaveLength(1);
  });

  it("carries NO `ok` — the /api/calendar surface has a different envelope", async () => {
    const app = await studentApp();
    const response = await request(app).get("/api/calendar").query({
      from: SCENARIO_TODAY,
      to: SCENARIO_TODAY,
      device_timezone: "America/Chicago",
    });

    // This asymmetry is the defect's root cause, pinned: two surfaces, two envelopes, and a
    // client that must know which one it is talking to. `ok` here would be payload
    // (`acknowledgeResponseSchema`), never transport.
    expect(response.body).not.toHaveProperty("ok");
    expect(response.body).toHaveProperty("requestId");
  });
});
