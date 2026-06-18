import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-1/§3 | AS1-DRAIN-LIVENESS-001 | Coding §14 denial tests]
 * The scheduled legal-acceptance drain endpoint is cron-only: gated by CRON_SECRET, fail-closed (404)
 * when unset or wrong, and it never requires a user session.
 */

const drainAllMock = vi.hoisted(() => vi.fn(async () => 3));

vi.mock("../../server/lib/legal-acceptance.js", () => ({
  drainAllPendingLegalAcceptances: drainAllMock,
}));
vi.mock("../../server/middleware/supabase-auth.js", () => ({
  getSupabaseAdmin: () => ({}),
}));

import internalCronRoutes from "../../server/routes/internal-cron-routes";

const baselineSecret = process.env.CRON_SECRET;

function makeApp() {
  const app = express();
  app.use("/api/internal", internalCronRoutes);
  return app;
}

const PATH = "/api/internal/legal-acceptance-drain";

describe("Internal cron — legal-acceptance drain (AS1-DRAIN-LIVENESS-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drainAllMock.mockResolvedValue(3);
  });

  afterEach(() => {
    if (baselineSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = baselineSecret;
  });

  it("404s when CRON_SECRET is not configured (fail-closed, reveals nothing)", async () => {
    delete process.env.CRON_SECRET;
    const res = await request(makeApp())
      .get(PATH)
      .set("authorization", "Bearer anything");
    expect(res.status).toBe(404);
    expect(drainAllMock).not.toHaveBeenCalled();
  });

  it("404s on a wrong bearer secret", async () => {
    process.env.CRON_SECRET = "the-real-secret";
    const res = await request(makeApp())
      .get(PATH)
      .set("authorization", "Bearer wrong-secret");
    expect(res.status).toBe(404);
    expect(drainAllMock).not.toHaveBeenCalled();
  });

  it("404s when the Authorization header is missing", async () => {
    process.env.CRON_SECRET = "the-real-secret";
    const res = await request(makeApp()).get(PATH);
    expect(res.status).toBe(404);
    expect(drainAllMock).not.toHaveBeenCalled();
  });

  it("drains and returns 200 with the correct bearer secret", async () => {
    process.env.CRON_SECRET = "the-real-secret";
    const res = await request(makeApp())
      .get(PATH)
      .set("authorization", "Bearer the-real-secret");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, usersDrained: 3 });
    expect(drainAllMock).toHaveBeenCalledTimes(1);
  });
});
