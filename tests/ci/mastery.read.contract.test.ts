/**
 * @spec [Doc 05A §7.4 + Doc 05B §5.4 + AC#20 — mastery read contract: tier-only responses]
 * | @implemented [2026-06-23]
 * plain English: verifies that the mastery read routes call the canonical service layer and
 * return tier-only data (no mastery_score, no mastery_pct, no percent).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

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
  mapMasteryStatusFromLevel: vi.fn(),
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
    req.requestId ??= "req-mastery-read";
    next();
  });
  app.use("/api/me/mastery", masteryRouter);
  return app;
}

describe("Mastery Read Contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSkillMasteryRows.mockResolvedValue([
      {
        section: "math",
        domain: "algebra",
        skill: "linear_equations",
        mastery_level: 2,
        event_count_total: 4,
        computed_at: "2026-06-23T00:00:00Z",
      },
    ]);
    fetchDomainMasteryRows.mockResolvedValue([
      { section: "math", domain: "algebra", mastery_level: 2 },
    ]);
    buildMasterySummaryFromRows.mockReturnValue([
      {
        section: "math",
        domains: [{ domain: "algebra", tier: "improving", masteryLevel: 2 }],
      },
    ]);
    buildMasterySkillTreeFromRows.mockReturnValue([
      {
        section: "math",
        label: "Math",
        domains: [
          {
            domain: "algebra",
            label: "Algebra",
            masteryLevel: 2,
            tier: "improving",
            computedAt: null,
            skills: [],
          },
        ],
      },
    ]);
    fetchWeakestSkills.mockResolvedValue([
      {
        section: "math",
        domain: "algebra",
        skill: "linear_equations",
        mastery_score: 0.35,
        mastery_level: 1,
      },
    ]);
  });

  it("uses canonical mastery read layer for summary (domain rows)", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/me/mastery/summary");

    expect(res.status).toBe(200);
    expect(res.body.sections).toHaveLength(1);
    expect(fetchDomainMasteryRows).toHaveBeenCalledWith({
      userId: "student-1",
      section: undefined,
    });
    expect(buildMasterySummaryFromRows).toHaveBeenCalled();
  }, 15000);

  it("uses canonical mastery read layer for skill tree", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/me/mastery/skills");

    expect(res.status).toBe(200);
    expect(fetchSkillMasteryRows).toHaveBeenCalledWith({ userId: "student-1" });
    expect(fetchDomainMasteryRows).toHaveBeenCalledWith({
      userId: "student-1",
    });
    expect(buildMasterySkillTreeFromRows).toHaveBeenCalled();
  }, 15000);

  it("uses canonical mastery read layer for weakest skills (tier-only response)", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/me/mastery/weakest");

    expect(res.status).toBe(200);
    expect(fetchWeakestSkills).toHaveBeenCalledWith({
      userId: "student-1",
      limit: 5,
      minAttempts: 2,
    });
    const items = res.body.weakest;
    expect(Array.isArray(items)).toBe(true);
    expect(items[0]).toHaveProperty("tier");
    expect(items[0]).not.toHaveProperty("mastery_score");
    expect(items[0]).not.toHaveProperty("accuracy");
  }, 15000);
});
