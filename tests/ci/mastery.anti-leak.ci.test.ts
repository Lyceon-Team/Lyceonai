/**
 * @spec [Doc 05A §7.4 + AC#20 + INV-05A-12 — no mastery_score/mastery_pct/percent on any
 *   student/guardian mastery surface; AC#19 — no per-skill rows on guardian surfaces;
 *   owner ruling 2026-08-20 RULE 4 — nine columns never exposed at ANY layer,
 *   "including API responses nothing renders"]
 * | @implemented [2026-08-20]
 *
 * plain English: committed CI gate asserting the mastery anti-leak invariants. Every
 * student and guardian mastery surface returns a LEVEL and the NAME of that level, and
 * nothing about how the level was reached.
 *
 * WHY THE SERVICE MOCKS RETURN THE FORBIDDEN COLUMNS.
 *   A gate that feeds the route clean rows can only prove the route did not INVENT a
 *   leak. The rows below carry all nine RULE-4 columns, exactly as the real tables do,
 *   so the assertion proves the route strips them. The mutation this is built to catch
 *   is a one-character one: `...row` instead of naming the fields.
 *
 * WHY THE WALK IS RECURSIVE.
 *   The MA-07 leak (#419) was `mastery_score` riding into a response one layer down, via
 *   a spread of a context object. A top-level key check would have passed it. This walks
 *   every object at every depth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { masteryLevelLabelsFixture } from "../utils/mastery-levels-fixture";

// ---------------------------------------------------------------------------
// Mocks — mastery-read service layer
// ---------------------------------------------------------------------------

const fetchSkillMasteryRows = vi.fn();
const fetchDomainMasteryRows = vi.fn();
const buildMasterySummaryFromRows = vi.fn();
const fetchWeakestSkills = vi.fn();
const fetchSkillsForDomain = vi.fn();

vi.mock("../../apps/api/src/services/mastery-read", async () => {
  const actual = await vi.importActual<
    typeof import("../../apps/api/src/services/mastery-read")
  >("../../apps/api/src/services/mastery-read");
  return {
    buildDomainLevelView: actual.buildDomainLevelView,
    buildSkillLevelView: actual.buildSkillLevelView,
    fetchSkillMasteryRows,
    fetchDomainMasteryRows,
    buildMasterySummaryFromRows,
    fetchWeakestSkills,
  };
});

vi.mock("../../apps/api/src/services/mastery-levels-read", () => ({
  loadMasteryLevels: vi.fn(async () => masteryLevelLabelsFixture()),
  resetMasteryLevelsCache: vi.fn(),
}));

vi.mock("../../apps/api/src/services/skill-catalog-read", async () => {
  const actual = await vi.importActual<
    typeof import("../../apps/api/src/services/skill-catalog-read")
  >("../../apps/api/src/services/skill-catalog-read");
  return {
    fetchSkillsForDomain,
    fetchSkillCatalog: vi.fn(async () => []),
    canonicalDomainPairs: actual.canonicalDomainPairs,
  };
});

vi.mock("../../packages/shared/src/mastery", async () => {
  return {
    masteryTierFromLevel: (level: number | null) => {
      if (level === null) return "not_started";
      if (level >= 3) return "proficient";
      if (level === 2) return "improving";
      return "weak";
    },
    masteryTierSchema: {
      enum: ["not_started", "weak", "improving", "proficient"],
    },
    masteryLevelSchema: {},
    skillMasteryNodeSchema: {},
    domainMasteryNodeSchema: {},
    sectionMasteryNodeSchema: {},
    masteryTreeResponseSchema: {},
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

/** The two fields the auth middleware would have attached. No `any` (Standards §3.2). */
type TestRequest = express.Request & {
  user?: {
    id: string;
    role: string;
    isGuardian: boolean;
    isAdmin: boolean;
  };
  requestId?: string;
};

async function buildApp() {
  const { masteryRouter } = await import("../../apps/api/src/routes/mastery");
  const app = express();
  app.use((req, _res, next) => {
    const testReq = req as TestRequest;
    testReq.user = {
      id: "student-1",
      role: "student",
      isGuardian: false,
      isAdmin: false,
    };
    testReq.requestId ??= "req-anti-leak";
    next();
  });
  app.use("/api/me/mastery", masteryRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures — canonical DB values, carrying every column the route must strip
// ---------------------------------------------------------------------------

/** The nine columns of owner ruling 2026-08-20 RULE 4, plus RULE 9's confidence float. */
const FORBIDDEN_KEYS = [
  "mastery_score",
  "mastery_pct",
  "acc_test",
  "acc_practice",
  "acc_review",
  "event_count_total",
  "constants_snapshot_hash",
  "mastery_model_version",
  "last_event_id",
  "confidence",
  // Retained from the pre-RULE-4 gate: same class, already closed, still asserted.
  "accuracyPercent",
  "avgMastery",
  "accuracy",
  "overallAccuracy",
] as const;

/** Every RULE-4 column, as the real tables carry them. Never serialised. */
const INTERNAL_COLUMNS = {
  mastery_score: 0.42,
  mastery_pct: 42,
  acc_test: 0.4,
  acc_practice: 0.44,
  acc_review: 0.41,
  event_count_total: 17,
  constants_snapshot_hash: "deadbeef",
  mastery_model_version: "v1",
  last_event_id: "11111111-1111-4111-8111-111111111111",
};

const TIER_ONLY_SUMMARY = [
  {
    section: "M",
    domains: [{ domain: "Algebra", tier: "improving", masteryLevel: 2 }],
  },
];

const SERVICE_WEAKNESS_ROWS = [
  {
    section: "M",
    domain: "Algebra",
    skill: "Linear Equations in One Variable",
    mastery_score: 0.25,
    mastery_level: 1,
    accuracy: 0.25,
  },
];

// ---------------------------------------------------------------------------
// Anti-leak assertions
// ---------------------------------------------------------------------------

function collectKeys(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectKeys(entry, into);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      into.add(key);
      collectKeys(child, into);
    }
  }
}

function assertNoLeakedKeys(body: unknown, surface: string): void {
  const keys = new Set<string>();
  collectKeys(body, keys);
  for (const forbidden of FORBIDDEN_KEYS) {
    if (keys.has(forbidden)) {
      throw new Error(
        `${surface}: response carries forbidden key "${forbidden}" at some depth`,
      );
    }
  }
  const percentPattern = /\d+%/;
  const bodyKeys = Object.keys(
    typeof body === "object" && body !== null ? body : {},
  );
  for (const k of bodyKeys) {
    if (k === "ok" || k === "error") continue;
    const val = (body as Record<string, unknown>)[k];
    if (typeof val === "string" && percentPattern.test(val)) {
      throw new Error(
        `${surface}: field "${k}" contains a percent string "${val}"`,
      );
    }
  }
}

describe("Mastery Anti-Leak CI Gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSkillMasteryRows.mockResolvedValue([
      {
        section: "M",
        domain: "Algebra",
        skill: "Linear Equations in One Variable",
        mastery_level: 3,
        computed_at: "2026-06-23T00:00:00Z",
        ...INTERNAL_COLUMNS,
      },
    ]);
    fetchDomainMasteryRows.mockResolvedValue([
      {
        section: "M",
        domain: "Algebra",
        mastery_level: 3,
        ...INTERNAL_COLUMNS,
      },
    ]);
    fetchSkillsForDomain.mockResolvedValue([
      "Linear Equations in One Variable",
      "Linear Functions",
    ]);
    buildMasterySummaryFromRows.mockReturnValue(TIER_ONLY_SUMMARY);
    fetchWeakestSkills.mockResolvedValue(SERVICE_WEAKNESS_ROWS);
  });

  it("/mastery/domains carries no RULE-4 column at any depth, even though the source rows do", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/me/mastery/domains");

    expect(res.status).toBe(200);
    assertNoLeakedKeys(res.body, "/mastery/domains");
    expect(res.body.domains).toHaveLength(8);
    for (const node of res.body.domains) {
      expect(Object.keys(node).sort()).toEqual([
        "displayName",
        "domain",
        "level",
        "levelKey",
        "section",
      ]);
    }
  }, 15000);

  it("/mastery/domains/:section/:domain/skills carries no RULE-4 column at any depth", async () => {
    const app = await buildApp();
    const res = await request(app).get(
      "/api/me/mastery/domains/M/Algebra/skills",
    );

    expect(res.status).toBe(200);
    assertNoLeakedKeys(res.body, "/mastery/domains/:section/:domain/skills");
    expect(res.body.skills).toHaveLength(2);
    for (const node of res.body.skills) {
      expect(Object.keys(node).sort()).toEqual([
        "displayName",
        "level",
        "levelKey",
        "skill",
      ]);
    }
  }, 15000);

  it("/mastery/summary response contains NO mastery_score, mastery_pct, accuracy, or percent", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/me/mastery/summary");

    expect(res.status).toBe(200);
    assertNoLeakedKeys(res.body, "/mastery/summary");
    expect(res.body.sections).toBeDefined();
  }, 15000);

  it("/mastery/weakest response contains NO mastery_score, mastery_pct, accuracy, or percent — level only", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/me/mastery/weakest");

    expect(res.status).toBe(200);
    assertNoLeakedKeys(res.body, "/mastery/weakest");

    const items = res.body.weakest;
    expect(Array.isArray(items)).toBe(true);
    for (const item of items) {
      expect(item).toHaveProperty("tier");
      expect(item).toHaveProperty("masteryLevel");
      expect(item).not.toHaveProperty("mastery_score");
      expect(item).not.toHaveProperty("accuracy");
      expect(item).not.toHaveProperty("attempts");
    }
  }, 15000);

  it("/mastery/weakest strips mastery_score even though the service fetch returns it (dual-use boundary)", async () => {
    fetchWeakestSkills.mockResolvedValue([
      {
        section: "M",
        domain: "Algebra",
        skill: "Linear Equations in One Variable",
        mastery_score: 0.15,
        mastery_level: 0,
        accuracy: 0.15,
      },
    ]);

    const app = await buildApp();
    const res = await request(app).get("/api/me/mastery/weakest");

    expect(res.status).toBe(200);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('"mastery_score"');
    expect(json).not.toContain('"accuracy"');
    expect(json).not.toContain("0.15");
  }, 15000);
});
