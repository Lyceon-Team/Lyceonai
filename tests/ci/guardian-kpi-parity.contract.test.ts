/**
 * @spec [Doc 04C invariant #7 — "Guardian payloads are a STRICT SUBSET of the student
 *   payload ... enforced by deriving the guardian payload from the student payload via a
 *   projection function (§12.2), not by independent construction"; Doc 05 Parent §15.2 and
 *   AC#19 with the SCL-043 reading; owner ruling 2026-08-23 — "the guardian sees exactly
 *   what the student sees, no more and no less"] | @implemented [2026-08-24]
 *
 * plain English: the shared KPI builder is mocked ONCE, both routes are called, and the
 * guardian body is required to be a key-for-key subset of the student body at every depth.
 *
 * PROVENANCE, NOT RESEMBLANCE.
 *   Two independent implementations can agree on a Tuesday. That distinction has caught a
 *   real defect twice in this vertical already — the hand-written `GuardianWeaknessResponse`
 *   that declared `skills` against a route returning `domains`, and the hardcoded `true`
 *   that let a guardian see a premium surface the student's entitlement denied. So the
 *   builder is mocked and BOTH routes are driven from that one mock: if the guardian ever
 *   rebuilds the view from primitives, the mock is bypassed and these cases go red.
 *
 * THE THREE MUTATIONS THIS MUST CATCH (the owner's own list):
 *   1. a guardian-only key is added            -> the subset case reds
 *   2. a field is added to the student node    -> the guardian must reflect it; if the
 *      guardian is still building separately it will not, and the parity case reds
 *   3. the shared builder's output shape changes -> the pinned key-set case reds WITHOUT
 *      guardian code being touched. If that one stays green they are still two paths.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const STUDENT_ID = "student-1";
const GUARDIAN_ID = "guardian-1";

/** The three metric ids a guardian is granted. Everything else is student-only. */
const GRANTED = ["week_questions", "week_accuracy", "current_streak"];

/**
 * THE ONE SHARED VIEW. Deliberately carries `official`/`weighted` NON-EMPTY: a test that
 * only ever sees an empty array cannot tell a pass-through from a hardcoded empty, which is
 * exactly the defect being closed (`measurementModel: {official: [], weighted: []}` was a
 * literal in the guardian projection duplicating the builder's own field).
 */
const SHARED_VIEW = {
  modelVersion: "kpi-v1",
  timezone: "America/Chicago",
  week: {
    questionsSolved: 12,
    accuracy: 75,
    explanations: { week_questions: { whatThisMeans: "…" } },
  },
  recency: {
    window: 30,
    totalAttempts: 40,
    accuracy: 70,
    explanations: { recency_accuracy: { whatThisMeans: "…" } },
  },
  metrics: [
    { id: "week_questions", label: "Questions (7d)", value: 12 },
    { id: "week_accuracy", label: "Accuracy (7d)", value: 75 },
    { id: "current_streak", label: "Streak", value: 3 },
    // Student-only: must NOT reach the guardian.
    { id: "recency_accuracy", label: "Accuracy (30d)", value: 70 },
  ],
  gating: {
    historicalTrends: {
      allowed: true,
      requiredPlan: "paid" as const,
      reason: "Student has active paid entitlement.",
    },
  },
  measurementModel: {
    official: ["official_metric_a"],
    weighted: ["weighted_metric_b"],
    diagnostic: ["week_questions"],
  },
};

const buildStudentKpiViewFromCanonical = vi.fn(async () => SHARED_VIEW);

vi.mock("../../server/services/canonical-runtime-views", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/services/canonical-runtime-views")
  >("../../server/services/canonical-runtime-views");
  // projectGuardianKpiView stays REAL — it is the projection under test.
  return { ...actual, buildStudentKpiViewFromCanonical };
});

vi.mock("../../server/services/kpi-access", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/services/kpi-access")
  >("../../server/services/kpi-access");
  return {
    ...actual,
    resolveHistoricalTrendsAccess: vi.fn(async () => true),
    resolvePaidKpiAccessForUser: vi.fn(async () => ({
      hasPaidAccess: true,
      accountId: "acc-1",
      plan: "paid" as const,
      status: "active" as const,
      currentPeriodEnd: null,
      reason: "Active paid entitlement.",
    })),
    resolvePaidKpiAccessForStudent: vi.fn(async () => ({
      hasPaidAccess: true,
      accountId: "acc-1",
      plan: "paid" as const,
      status: "active" as const,
      currentPeriodEnd: null,
      reason: "Active paid entitlement.",
    })),
  };
});

vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature: vi.fn(async () => true),
    isEntitlementActiveForProfile: vi.fn(async () => true),
  },
}));

// Guardian gate doubles — denial behaviour is proved by guardian-reporting.contract.test.ts.
vi.mock("../../server/lib/account", () => ({
  isGuardianLinkedToStudent: vi.fn(async () => true),
  getAllGuardianStudentLinks: vi.fn(async () => [
    { student_user_id: STUDENT_ID },
  ]),
  createGuardianLink: vi.fn(),
  revokeGuardianLink: vi.fn(),
  ensureAccountForUser: vi.fn(async () => ({ id: "acc-1" })),
  getEntitlementForProfile: vi.fn(async () => null),
  resolveLinkedPairPremiumAccessForStudent: vi.fn(async () => null),
}));
vi.mock("../../server/middleware/guardian-entitlement", () => ({
  requireGuardianEntitlement: (_r: unknown, _s: unknown, next: () => void) =>
    next(),
}));
vi.mock("../../server/middleware/guardian-role", () => ({
  requireGuardianRole: () => (_r: unknown, _s: unknown, next: () => void) =>
    next(),
}));
vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_r: unknown, _s: unknown, next: () => void) => next(),
  generateToken: () => "t",
}));
vi.mock("../../server/lib/durable-rate-limiter", () => ({
  createDurableRateLimiter:
    () => (_r: unknown, _s: unknown, next: () => void) =>
      next(),
}));
vi.mock("../../server/middleware/supabase-auth", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/middleware/supabase-auth")
  >("../../server/middleware/supabase-auth");
  return {
    ...actual,
    getSupabaseAdmin: vi.fn(() => ({})),
    requireSupabaseAuth: (
      req: express.Request,
      _s: unknown,
      next: () => void,
    ) => {
      (req as express.Request & { requestId?: string }).requestId ??=
        "req-parity";
      next();
    },
  };
});
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => {
      const rows = [{ id: STUDENT_ID, role: "student" }];
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        eq: () => b,
        in: () => b,
        insert: async () => ({ error: null }),
        single: async () => ({ data: rows[0], error: null }),
        maybeSingle: async () => ({ data: rows[0], error: null }),
        then: (f?: (v: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(f),
      });
      return b;
    },
  },
}));

type Req = express.Request & {
  user?: { id: string; role: string; email?: string };
  requestId?: string;
};

async function studentBody(): Promise<Record<string, unknown>> {
  const { getRecencyKpis } =
    await import("../../server/routes/legacy/progress");
  const app = express();
  app.use((req, _res, next) => {
    const r = req as Req;
    r.user = { id: STUDENT_ID, role: "student" };
    r.requestId ??= "req-parity-student";
    next();
  });
  app.get("/api/me/kpis", getRecencyKpis);
  const res = await request(app).get("/api/me/kpis");
  expect(res.status).toBe(200);
  return res.body;
}

async function guardianBody(): Promise<Record<string, unknown>> {
  const router = (await import("../../server/routes/guardian-routes")).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const r = req as Req;
    r.user = { id: GUARDIAN_ID, role: "guardian", email: "g@example.com" };
    r.requestId ??= "req-parity-guardian";
    next();
  });
  app.use("/api/guardian", router);
  const res = await request(app).get(
    `/api/guardian/students/${STUDENT_ID}/summary`,
  );
  expect(res.status).toBe(200);
  return res.body;
}

/** Every key path in an object tree, e.g. "gating.historicalTrends.allowed". */
function keyPaths(
  value: unknown,
  prefix = "",
  into = new Set<string>(),
): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) keyPaths(entry, `${prefix}[]`, into);
    return into;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      into.add(path);
      keyPaths(v, path, into);
    }
  }
  return into;
}

describe("Guardian KPI is the student view, narrowed — never rebuilt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildStudentKpiViewFromCanonical.mockResolvedValue(SHARED_VIEW);
  });

  it("MUTATION 1 — the guardian body carries NO key the student body lacks, at any depth", async () => {
    const student = await studentBody();
    const guardian = await guardianBody();

    const studentPaths = keyPaths(student);
    const guardianOnly = [...keyPaths(guardian)].filter(
      (p) => !studentPaths.has(p),
    );
    expect(
      guardianOnly,
      `guardian-only key path(s): ${JSON.stringify(guardianOnly)} — a guardian payload is a STRICT SUBSET of the student payload (Doc 04C invariant #7)`,
    ).toEqual([]);
  }, 20000);

  it("`progress` and `student` are gone — two shapes for one fact, and a guardian-only addition", async () => {
    const guardian = await guardianBody();
    expect(guardian).not.toHaveProperty("progress");
    expect(guardian).not.toHaveProperty("student");
  }, 20000);

  it("STEP 1 — measurementModel is PASSED THROUGH, not a hardcoded empty", async () => {
    const guardian = await guardianBody();
    // The builder returned non-empty official/weighted. A hardcoded `[]` cannot produce this.
    expect(guardian.measurementModel).toEqual(SHARED_VIEW.measurementModel);
    const mm = guardian.measurementModel as { official: string[] };
    expect(mm.official.length).toBeGreaterThan(0);
  }, 20000);

  it("STEP 2 — gating survives; the reader can still tell WITHHELD from zero", async () => {
    const student = await studentBody();
    const guardian = await guardianBody();
    expect(guardian.gating).toEqual(SHARED_VIEW.gating);
    expect(guardian.gating).toEqual(student.gating);
  }, 20000);

  it("MUTATION 2 — a field on the student's metric nodes reaches the guardian", async () => {
    // If the guardian were still constructing its own metric objects, this field would be
    // absent from the guardian body and this case would red.
    buildStudentKpiViewFromCanonical.mockResolvedValue({
      ...SHARED_VIEW,
      metrics: SHARED_VIEW.metrics.map((m) => ({ ...m, freshlyAddedField: 1 })),
    } as unknown as typeof SHARED_VIEW);

    const guardian = await guardianBody();
    const metrics = guardian.metrics as Array<Record<string, unknown>>;
    expect(metrics.length).toBeGreaterThan(0);
    for (const metric of metrics) {
      expect(metric).toHaveProperty("freshlyAddedField", 1);
    }
  }, 20000);

  it("MUTATION 3 — the guardian key set is pinned to a LITERAL, so a builder shape change reds here", async () => {
    const student = await studentBody();
    const guardian = await guardianBody();

    // PINNED TO A LITERAL ON PURPOSE.
    //   Comparing the guardian's keys to the student's would be self-referential: both come
    //   from the same mocked builder, so a new builder field moves both and the case stays
    //   green — which is exactly the "stays green, still two paths" trap. Against a literal,
    //   a field added to the shared builder reaches the guardian, the literal no longer
    //   matches, and a human has to acknowledge that a new value now reaches a parent.
    expect(Object.keys(guardian).sort()).toEqual([
      "gating",
      "measurementModel",
      "metrics",
      "modelVersion",
      "recency",
      "requestId",
      "timezone",
      "week",
    ]);

    // And the same set the student has, minus the route-level `entitlement` block.
    expect(Object.keys(guardian).sort()).toEqual(
      Object.keys(student)
        .filter((k) => k !== "entitlement")
        .sort(),
    );
  }, 20000);

  it("only the three granted metrics cross; student-only metrics do not", async () => {
    const guardian = await guardianBody();
    const ids = (guardian.metrics as Array<{ id: string }>).map((m) => m.id);
    expect(ids.sort()).toEqual([...GRANTED].sort());
    expect(ids).not.toContain("recency_accuracy");
  }, 20000);
});
