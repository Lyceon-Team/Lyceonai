import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const masteryMocks = {
  getWeakestSkills: vi.fn(),
  getWeakestClusters: vi.fn(),
};

vi.mock("../../apps/api/src/services/studentMastery", () => ({
  getWeakestSkills: masteryMocks.getWeakestSkills,
  getWeakestClusters: masteryMocks.getWeakestClusters,
}));

vi.mock("../../packages/shared/src/mastery", () => ({
  masteryTierFromLevel: (level: number | null) => {
    if (level === null) return "not_started";
    if (level >= 3) return "proficient";
    if (level === 2) return "improving";
    return "weak";
  },
}));

describe("Weakness runtime contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    masteryMocks.getWeakestSkills.mockResolvedValue([]);
    masteryMocks.getWeakestClusters.mockResolvedValue([]);
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = {
        id: "student-1",
        role: "student",
      };
      req.requestId ??= "req-weakness-runtime";
      next();
    });
    return app;
  }

  it("fails closed for skills when required-source read fails", async () => {
    masteryMocks.getWeakestSkills.mockImplementationOnce(async (query: any) => {
      expect(query.failOnError).toBe(true);
      throw new Error("weakest_skills_query_failed");
    });

    const { weaknessRouter } =
      await import("../../apps/api/src/routes/weakness");
    const app = buildApp();
    app.use("/api/me/weakness", weaknessRouter);

    const res = await request(app).get("/api/me/weakness/skills");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to get weakness data" });
  });

  it("fails closed for clusters when required-source read fails", async () => {
    masteryMocks.getWeakestClusters.mockImplementationOnce(
      async (query: any) => {
        expect(query.failOnError).toBe(true);
        throw new Error("weakest_clusters_query_failed");
      },
    );

    const { weaknessRouter } =
      await import("../../apps/api/src/routes/weakness");
    const app = buildApp();
    app.use("/api/me/weakness", weaknessRouter);

    const res = await request(app).get("/api/me/weakness/clusters");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to get weakness data" });
  });

  it("preserves success response for skills under healthy source read (tier-only)", async () => {
    masteryMocks.getWeakestSkills.mockResolvedValueOnce([
      {
        section: "math",
        domain: "Algebra",
        skill: "Linear Equations",
        mastery_score: 0.25,
        mastery_level: 1,
        accuracy: 0.25,
      },
    ]);

    const { weaknessRouter } =
      await import("../../apps/api/src/routes/weakness");
    const app = buildApp();
    app.use("/api/me/weakness", weaknessRouter);

    const res = await request(app).get("/api/me/weakness/skills");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      count: 1,
      skills: [
        expect.objectContaining({
          section: "math",
          domain: "Algebra",
          skill: "Linear Equations",
          tier: "weak",
          masteryLevel: 1,
        }),
      ],
    });
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('"mastery_score"');
    expect(json).not.toContain('"accuracy"');
  });
});
