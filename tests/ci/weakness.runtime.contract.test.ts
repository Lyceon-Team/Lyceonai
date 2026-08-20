import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const masteryMocks = {
  getWeakestSkills: vi.fn(),
};

vi.mock("../../apps/api/src/services/studentMastery", () => ({
  getWeakestSkills: masteryMocks.getWeakestSkills,
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
    // No failOnError flag to assert any more: fetchWeakestSkills always throws on a
    // query error, so there is no opt-out for a caller to get wrong. What still matters
    // is that the route surfaces the throw as a 500 rather than an empty success.
    masteryMocks.getWeakestSkills.mockImplementationOnce(async () => {
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

  it("preserves success response for skills under healthy source read (tier-only)", async () => {
    masteryMocks.getWeakestSkills.mockResolvedValueOnce([
      {
        section: "M",
        domain: "Algebra",
        skill: "Linear Equations in One Variable",
        mastery_score: 0.25,
        mastery_level: 1,
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
          section: "M",
          domain: "Algebra",
          skill: "Linear Equations in One Variable",
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
