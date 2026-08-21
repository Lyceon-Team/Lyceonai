/**
 * @spec [Doc 05A §7.4 + Doc 05B §5.4 + AC#20 — mastery read contract: tier-only responses]
 * | @implemented [2026-06-23]
 * plain English: verifies that the mastery read routes call the canonical service layer and
 * return tier-only data (no mastery_score, no mastery_pct, no percent).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { masteryLevelLabelsFixture } from "../utils/mastery-levels-fixture";

const fetchSkillMasteryRows = vi.fn();
const fetchDomainMasteryRows = vi.fn();
const fetchWeakestSkills = vi.fn();
const fetchSkillsForDomain = vi.fn();

vi.mock("../../apps/api/src/services/mastery-read", async () => {
  const actual = await vi.importActual<
    typeof import("../../apps/api/src/services/mastery-read")
  >("../../apps/api/src/services/mastery-read");
  return {
    // The pure builders are the behaviour under test on the drill-down routes; only the
    // IO is stubbed.
    buildDomainLevelView: actual.buildDomainLevelView,
    buildSkillLevelView: actual.buildSkillLevelView,
    fetchSkillMasteryRows,
    fetchDomainMasteryRows,
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
    // Canonical DB values throughout: section 'M'/'RW' (CHECK-constrained), College
    // Board domain and skill display strings. The previous fixtures used slugs the
    // database would reject, which is precisely how SAT_TAXONOMY's mismatch survived —
    // the tests agreed with the broken code instead of with the schema.
    fetchSkillMasteryRows.mockResolvedValue([
      {
        section: "M",
        domain: "Algebra",
        skill: "Linear Equations in One Variable",
        mastery_level: 2,
        computed_at: "2026-06-23T00:00:00Z",
      },
    ]);
    fetchDomainMasteryRows.mockResolvedValue([
      { section: "M", domain: "Algebra", mastery_level: 2 },
    ]);
    fetchSkillsForDomain.mockResolvedValue([
      "Linear Equations in One Variable",
    ]);
    fetchWeakestSkills.mockResolvedValue([
      {
        section: "M",
        domain: "Algebra",
        skill: "Linear Equations in One Variable",
        mastery_score: 0.35,
        mastery_level: 1,
      },
    ]);
  });

  it("serves the domain grid from the canonical read layer, all eight domains", async () => {
    fetchDomainMasteryRows.mockResolvedValue([
      { section: "M", domain: "Algebra", mastery_level: 2 },
    ]);

    const app = await buildApp();
    const res = await request(app).get("/api/me/mastery/domains");

    expect(res.status).toBe(200);
    expect(fetchDomainMasteryRows).toHaveBeenCalledWith({
      userId: "student-1",
      section: undefined,
    });
    expect(res.body.domains).toHaveLength(8);
    expect(
      res.body.domains.find((d: { domain: string }) => d.domain === "Algebra"),
    ).toEqual({
      section: "M",
      domain: "Algebra",
      levelKey: "L2",
      level: 2,
      displayName: "Developing",
    });
  }, 15000);

  it("serves every catalog skill in a domain, unmeasured ones included and labelled", async () => {
    fetchSkillsForDomain.mockResolvedValue([
      "Linear Equations in One Variable",
      "Linear Functions",
      "Systems of Two Linear Equations in Two Variables",
    ]);
    fetchSkillMasteryRows.mockResolvedValue([
      {
        section: "M",
        domain: "Algebra",
        skill: "Linear Functions",
        mastery_level: 3,
        computed_at: "2026-08-20T00:00:00Z",
      },
    ]);

    const app = await buildApp();
    const res = await request(app).get(
      "/api/me/mastery/domains/M/Algebra/skills",
    );

    expect(res.status).toBe(200);
    expect(fetchSkillsForDomain).toHaveBeenCalledWith("M", "Algebra");
    expect(fetchSkillMasteryRows).toHaveBeenCalledWith({
      userId: "student-1",
      section: "M",
      domain: "Algebra",
    });
    expect(res.body.catalogEmpty).toBe(false);
    // The two skills with no events are PRESENT and labelled, not omitted. An absent
    // row and an unmeasured row say different things to a student picking what to
    // practise next.
    expect(res.body.skills).toEqual([
      {
        skill: "Linear Equations in One Variable",
        levelKey: "unmeasured",
        level: null,
        displayName: "Not enough answers yet",
      },
      {
        skill: "Linear Functions",
        levelKey: "L3",
        level: 3,
        displayName: "Proficient",
      },
      {
        skill: "Systems of Two Linear Equations in Two Variables",
        levelKey: "unmeasured",
        level: null,
        displayName: "Not enough answers yet",
      },
    ]);
  }, 15000);

  it("distinguishes an empty catalog from a failed read (owner build question 6)", async () => {
    fetchSkillsForDomain.mockResolvedValue([]);
    fetchSkillMasteryRows.mockResolvedValue([]);

    const app = await buildApp();
    const empty = await request(app).get(
      "/api/me/mastery/domains/M/Algebra/skills",
    );
    expect(empty.status).toBe(200);
    expect(empty.body.catalogEmpty).toBe(true);
    expect(empty.body.skills).toEqual([]);

    // Same visible outcome from a broken read would be a lie. It is a 500 instead.
    fetchSkillsForDomain.mockRejectedValueOnce(
      new Error("skill_catalog_query_failed: connection reset"),
    );
    const failed = await request(app).get(
      "/api/me/mastery/domains/M/Algebra/skills",
    );
    expect(failed.status).toBe(500);
    expect(failed.body).not.toHaveProperty("catalogEmpty");
  }, 15000);

  it("rejects a non-canonical (section, domain) pair with 400, not an empty panel", async () => {
    const app = await buildApp();
    const res = await request(app).get(
      "/api/me/mastery/domains/math/algebra/skills",
    );

    expect(res.status).toBe(400);
    expect(fetchSkillsForDomain).not.toHaveBeenCalled();
  }, 15000);

  it("uses canonical mastery read layer for weakest skills (level-only response)", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/me/mastery/weakest");

    expect(res.status).toBe(200);
    expect(fetchWeakestSkills).toHaveBeenCalledWith({
      userId: "student-1",
      limit: 5,
    });
    const items = res.body.weakest;
    expect(Array.isArray(items)).toBe(true);
    // The four-tier vocabulary is gone; a weakest row now carries the level and its
    // owner-ruled display name, and nothing about how the level was reached.
    expect(items[0]).toEqual({
      section: "M",
      domain: "Algebra",
      skill: "Linear Equations in One Variable",
      levelKey: "L1",
      level: 1,
      displayName: "Building",
    });
    expect(items[0]).not.toHaveProperty("tier");
  }, 15000);
});
