/**
 * @spec [owner standing rule 2026-08-21 — "every mastery and KPI path a guardian sees is a
 *   direct read of the student path, gated by authorization. There is exactly one
 *   derivation, one query, one DTO, one shape."; Doc 05 Parent AC#19 + owner ruling
 *   2026-08-20 RULE 7 — guardians get domain grain only, no skill drill-down]
 * | @implemented [2026-08-21]
 *
 * plain English: proves the guardian domain-mastery response is PRODUCED BY the same
 * function as the student's, not merely shaped to look like it.
 *
 * WHY SHAPE EQUALITY ALONE IS NOT ENOUGH.
 *   Two independent implementations can agree on a Tuesday. The failure this gate exists to
 *   catch is drift — one path changes and the other does not — and two paths that happen to
 *   match today will pass a shape comparison today. So the first case asserts PROVENANCE:
 *   `readDomainMasteryView` is mocked, and the guardian body must be exactly what that mock
 *   returned. If the guardian route ever rebuilds the view from primitives again, the mock
 *   is bypassed and the case goes red immediately.
 *
 *   The second case then asserts the two routes emit identical `domains`, so a change made
 *   in the shared function reaches both.
 *
 * THE MUTATION THIS MUST CATCH (owner's own words: "change the student path's shape — the
 * guardian test must go red"):
 *   - guardian route re-derives the view from loadMasteryLevels/fetchDomainMasteryRows/
 *     buildDomainLevelView instead of calling the shared read  → case 1 red
 *   - a field is added to the student node only                 → case 2 red
 *   - guardian gains a skill drill-down                         → case 4 red
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const readDomainMasteryView = vi.fn();
const parseSectionFilterSpy = vi.fn();

vi.mock("../../apps/api/src/services/mastery-view", async () => {
  const actual = await vi.importActual<
    typeof import("../../apps/api/src/services/mastery-view")
  >("../../apps/api/src/services/mastery-view");
  return {
    ...actual,
    readDomainMasteryView,
    parseSectionFilter: (value: unknown) => {
      parseSectionFilterSpy(value);
      return actual.parseSectionFilter(value);
    },
  };
});

vi.mock("../../server/services/kpi-access", () => ({
  resolvePaidKpiAccessForUser: vi.fn(async () => ({
    hasPaidAccess: true,
    accountId: "acc-paid",
    plan: "paid",
    status: "active",
    currentPeriodEnd: null,
    reason: "Active paid entitlement.",
  })),
}));

// ---------------------------------------------------------------------------
// Guardian gate doubles. The GATE is the only guardian-specific logic the rule
// permits, so it is stubbed open here — its denial behaviour is proved by
// tests/ci/guardian-reporting.contract.test.ts, not by this file.
// ---------------------------------------------------------------------------

vi.mock("../../server/lib/account", () => ({
  isGuardianLinkedToStudent: vi.fn(async () => true),
  createGuardianLink: vi.fn(),
  revokeGuardianLink: vi.fn(),
  getAllGuardianStudentLinks: vi.fn(async () => []),
  ensureAccountForUser: vi.fn(async () => ({ id: "acc-1" })),
}));

vi.mock("../../server/middleware/guardian-entitlement", () => ({
  requireGuardianEntitlement: (
    _req: unknown,
    _res: unknown,
    next: () => void,
  ) => next(),
}));

// requireGuardianRole is a FACTORY — it returns the middleware. Stubbing it as the
// middleware itself made every case fail with "next is not a function", which is the
// double lying about the shape of the thing it replaces.
vi.mock("../../server/middleware/guardian-role", () => ({
  requireGuardianRole: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

vi.mock("../../server/lib/durable-rate-limiter", () => ({
  createDurableRateLimiter:
    () => (_req: unknown, _res: unknown, next: () => void) =>
      next(),
}));

const STUDENT_ID = "11111111-1111-4111-8111-111111111111";

/** What the ONE shared read returns. Both routes must serialise exactly this. */
const SHARED_VIEW = {
  domains: [
    {
      section: "M" as const,
      domain: "Algebra",
      levelKey: "L2" as const,
      level: 2,
      displayName: "Developing",
    },
    {
      section: "RW" as const,
      domain: "Craft and Structure",
      levelKey: "unmeasured" as const,
      level: null,
      displayName: "Not enough answers yet",
    },
  ],
};

type TestRequest = express.Request & {
  user?: { id: string; role: string; email?: string };
  requestId?: string;
};

async function buildStudentApp() {
  const { masteryRouter } = await import("../../apps/api/src/routes/mastery");
  const app = express();
  app.use((req, _res, next) => {
    const r = req as TestRequest;
    r.user = { id: STUDENT_ID, role: "student" };
    r.requestId ??= "req-parity-student";
    next();
  });
  app.use("/api/me/mastery", masteryRouter);
  return app;
}

async function buildGuardianApp() {
  const router = (await import("../../server/routes/guardian-routes")).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const r = req as TestRequest;
    r.user = {
      id: "22222222-2222-4222-8222-222222222222",
      role: "guardian",
      email: "guardian@example.com",
    };
    r.requestId ??= "req-parity-guardian";
    next();
  });
  app.use("/api/guardian", router);
  return app;
}

describe("Guardian mastery is the student read plus a gate (standing rule 2026-08-21)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readDomainMasteryView.mockResolvedValue(SHARED_VIEW);
  });

  it("the guardian body is produced BY the shared read, called with the linked student's id", async () => {
    const app = await buildGuardianApp();
    const res = await request(app).get(
      `/api/guardian/weaknesses/${STUDENT_ID}`,
    );

    expect(res.status).toBe(200);
    // Provenance, not resemblance: the route did not build this, the shared function did.
    expect(readDomainMasteryView).toHaveBeenCalledTimes(1);
    expect(readDomainMasteryView).toHaveBeenCalledWith({
      studentId: STUDENT_ID,
      section: undefined,
    });
    expect(res.body.domains).toEqual(SHARED_VIEW.domains);
  }, 15000);

  it("student and guardian emit an IDENTICAL domains payload for the same student", async () => {
    const studentRes = await request(await buildStudentApp()).get(
      "/api/me/mastery/domains",
    );
    const guardianRes = await request(await buildGuardianApp()).get(
      `/api/guardian/weaknesses/${STUDENT_ID}`,
    );

    expect(studentRes.status).toBe(200);
    expect(guardianRes.status).toBe(200);
    expect(guardianRes.body.domains).toEqual(studentRes.body.domains);

    // One DTO: the same key set on both, node for node.
    const keys = (body: { domains: Array<Record<string, unknown>> }) =>
      body.domains.map((d) => Object.keys(d).sort());
    expect(keys(guardianRes.body)).toEqual(keys(studentRes.body));
  }, 15000);

  it("the guardian envelope adds only requestId — no second shape of the same fact", async () => {
    const guardianRes = await request(await buildGuardianApp()).get(
      `/api/guardian/weaknesses/${STUDENT_ID}`,
    );

    expect(Object.keys(guardianRes.body).sort()).toEqual([
      "domains",
      "ok",
      "requestId",
    ]);
    // `count` was `domains.length` in a second field. It is also the field the broken
    // client branched on, which is what hid the crash.
    expect(guardianRes.body).not.toHaveProperty("count");
  }, 15000);

  it("no guardian skill drill-down exists to call (AC#19 / RULE 7)", async () => {
    const app = await buildGuardianApp();

    for (const path of [
      `/api/guardian/weaknesses/${STUDENT_ID}/skills`,
      `/api/guardian/students/${STUDENT_ID}/mastery/domains/M/Algebra/skills`,
      `/api/guardian/domains/M/Algebra/skills`,
    ]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
    }
  }, 15000);

  it("the section filter is parsed by the shared parser on the guardian path too", async () => {
    const app = await buildGuardianApp();
    const res = await request(app).get(
      `/api/guardian/weaknesses/${STUDENT_ID}?section=M`,
    );

    expect(res.status).toBe(200);
    expect(parseSectionFilterSpy).toHaveBeenCalledWith("M");
    expect(readDomainMasteryView).toHaveBeenCalledWith({
      studentId: STUDENT_ID,
      section: "M",
    });
  }, 15000);

  it("an invalid section is rejected identically on both paths", async () => {
    const studentRes = await request(await buildStudentApp()).get(
      "/api/me/mastery/domains?section=math",
    );
    const guardianRes = await request(await buildGuardianApp()).get(
      `/api/guardian/weaknesses/${STUDENT_ID}?section=math`,
    );

    expect(studentRes.status).toBe(400);
    expect(guardianRes.status).toBe(400);
    expect(guardianRes.body.error.code).toBe(studentRes.body.error.code);
    // A bad filter must not reach the read on either path.
    expect(readDomainMasteryView).not.toHaveBeenCalled();
  }, 15000);
});
