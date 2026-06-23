/**
 * @spec [Doc 05A §7.4 + AC#20 + INV-05A-12 — no mastery_score/mastery_pct/percent on any
 *   student/guardian mastery surface; AC#19 — no per-skill rows on guardian surfaces]
 * | @implemented [2026-06-23]
 * plain English: committed CI gate asserting the mastery anti-leak invariants. Every student
 * and guardian mastery surface must return tier-only data. mastery_score is server-side only
 * (adaptiveSelector). This is the same class of gate as the question anti-leak probe —
 * reproducible in CI, not a local-only assertion.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mocks — mastery-read service layer
// ---------------------------------------------------------------------------

const fetchSkillMasteryRows = vi.fn();
const fetchDomainMasteryRows = vi.fn();
const buildMasterySummaryFromRows = vi.fn();
const buildMasterySkillTreeFromRows = vi.fn();
const fetchWeakestSkills = vi.fn();

vi.mock("../../apps/api/src/services/mastery-read", () => ({
  fetchSkillMasteryRows,
  fetchDomainMasteryRows,
  buildMasterySummaryFromRows,
  buildMasterySkillTreeFromRows,
  fetchWeakestSkills,
}));

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

async function buildApp() {
  const { masteryRouter } = await import("../../apps/api/src/routes/mastery");
  const app = express();
  app.use((req: any, _res, next) => {
    req.user = {
      id: "student-1",
      role: "student",
      isGuardian: false,
      isAdmin: false,
    };
    req.requestId ??= "req-anti-leak";
    next();
  });
  app.use("/api/me/mastery", masteryRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tier-only fixtures (no mastery_score, no mastery_pct, no accuracy, no percent)
// ---------------------------------------------------------------------------

const TIER_ONLY_TREE = [
  {
    section: "math",
    label: "Math",
    domains: [
      {
        domain: "algebra",
        label: "Algebra",
        masteryLevel: 3,
        tier: "proficient",
        computedAt: "2026-06-23T00:00:00Z",
        skills: [
          {
            skill: "linear_equations",
            label: "Linear Equations",
            masteryLevel: 3,
            tier: "proficient",
            computedAt: "2026-06-23T00:00:00Z",
          },
        ],
      },
    ],
  },
];

const TIER_ONLY_SUMMARY = [
  {
    section: "math",
    domains: [{ domain: "algebra", tier: "proficient", masteryLevel: 3 }],
  },
];

const SERVICE_WEAKNESS_ROWS = [
  {
    section: "math",
    domain: "algebra",
    skill: "linear_equations",
    mastery_score: 0.25,
    mastery_level: 1,
    accuracy: 0.25,
  },
];

// ---------------------------------------------------------------------------
// Anti-leak assertions
// ---------------------------------------------------------------------------

const LEAKED_KEYS = [
  "mastery_score",
  "mastery_pct",
  "accuracyPercent",
  "avgMastery",
  "accuracy",
  "overallAccuracy",
];

function assertNoLeakedKeys(body: unknown, surface: string): void {
  const json = JSON.stringify(body);
  for (const key of LEAKED_KEYS) {
    expect(json).not.toContain(`"${key}"`);
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
        section: "math",
        domain: "algebra",
        skill: "linear_equations",
        mastery_level: 3,
        event_count_total: 10,
        computed_at: "2026-06-23T00:00:00Z",
      },
    ]);
    fetchDomainMasteryRows.mockResolvedValue([
      { section: "math", domain: "algebra", mastery_level: 3 },
    ]);
    buildMasterySkillTreeFromRows.mockReturnValue(TIER_ONLY_TREE);
    buildMasterySummaryFromRows.mockReturnValue(TIER_ONLY_SUMMARY);
    fetchWeakestSkills.mockResolvedValue(SERVICE_WEAKNESS_ROWS);
  });

  it("/mastery/skills response contains NO mastery_score, mastery_pct, accuracy, avgMastery, or percent", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/me/mastery/skills");

    expect(res.status).toBe(200);
    assertNoLeakedKeys(res.body, "/mastery/skills");
    expect(res.body.sections).toBeDefined();
  }, 15000);

  it("/mastery/summary response contains NO mastery_score, mastery_pct, accuracy, or percent", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/me/mastery/summary");

    expect(res.status).toBe(200);
    assertNoLeakedKeys(res.body, "/mastery/summary");
    expect(res.body.sections).toBeDefined();
  }, 15000);

  it("/mastery/weakest response contains NO mastery_score, mastery_pct, accuracy, or percent — tier only", async () => {
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
        section: "math",
        domain: "algebra",
        skill: "linear_equations",
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
