/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md Q1; owner Step 0 decision 6, 2026-10-05 (Vercel
 *       cron, then the deploy hook)] | @implemented [2026-10-05]
 *
 * plain English: the wiring around the scheduler (tests/ci/qotd-schedule-job.test.ts proves the
 * job itself): the cron entry is in vercel.json at an hour after Chicago midnight, the route
 * refuses everything without CRON_SECRET (404, reveals nothing), and an authorised call runs the
 * job once and returns its summary nested under the envelope. Same pattern as
 * tests/ci/notification-retention-sweep.contract.test.ts.
 *
 * QOTD resilience brief (Karl, 2026-10-09): the route now runs the MONITORED fill
 * (server/services/qotd/qotd-health.ts, proved in tests/ci/qotd-resilience.pg.ci.test.ts), and
 * returns the horizon beside the summary. The owner's test alert route is wired here too.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const runMock = vi.hoisted(() => vi.fn());
const alertMock = vi.hoisted(() => vi.fn());
vi.mock("../../server/services/qotd/qotd-health.js", async (orig) => ({
  ...(await orig<object>()),
  runMonitoredQotdSchedule: runMock,
  defaultSendAlert: () => async () => ({ slack: "sent", email: "sent" }),
  defaultOpsAlertDeps: () => ({}),
}));
vi.mock("../../server/lib/ops-alerts.js", async (orig) => ({
  ...(await orig<object>()),
  sendOpsAlert: alertMock,
}));

describe("the cron route", () => {
  const CRON_PATH = "/api/internal/qotd-schedule";
  let app: express.Express;
  beforeEach(async () => {
    runMock.mockReset();
    runMock.mockResolvedValue({
      summary: { today: "2026-10-05", days: [] },
      health: {
        horizon: {
          today: "2026-10-05",
          today_covered: true,
          runs_out_on: "2026-10-13",
          horizon: 7,
        },
        raised: [],
        recovered: false,
      },
    });
    alertMock.mockReset();
    alertMock.mockResolvedValue({ slack: "sent", email: "sent" });
    process.env.CRON_SECRET = "test-cron-secret";
    const router = (await import("../../server/routes/internal-cron-routes"))
      .default;
    app = express();
    app.use("/api/internal", router);
  });

  it("vercel.json schedules it daily after America/Chicago midnight in both CST and CDT", () => {
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const entry = cfg.crons.find((c) => c.path === CRON_PATH);
    expect(entry?.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
    const hour = Number(entry?.schedule.split(" ")[1]);
    // Chicago midnight is 05:00 UTC (CDT) or 06:00 UTC (CST).
    expect(hour).toBeGreaterThanOrEqual(6);
  });

  it("without the secret: 404 and the job never runs", async () => {
    expect((await request(app).get(CRON_PATH)).status).toBe(404);
    const wrong = await request(app)
      .get(CRON_PATH)
      .set("Authorization", "Bearer not-it");
    expect(wrong.status).toBe(404);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("with the secret: runs once and returns the summary nested under the envelope", async () => {
    const res = await request(app)
      .get(CRON_PATH)
      .set("Authorization", "Bearer test-cron-secret");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      job: "qotd_schedule",
      summary: { today: "2026-10-05", days: [] },
      horizon: 7,
      runsOutOn: "2026-10-13",
    });
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("a failed run is a 500 with a named error", async () => {
    runMock.mockRejectedValueOnce(new Error("db down"));
    const res = await request(app)
      .get(CRON_PATH)
      .set("Authorization", "Bearer test-cron-secret");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "qotd_schedule_failed" });
  });

  it("the owner's test alert: 404 without the secret; with it, ONE ops_test alert", async () => {
    const TEST_PATH = "/api/internal/ops-alert-test";
    expect((await request(app).get(TEST_PATH)).status).toBe(404);
    expect(alertMock).not.toHaveBeenCalled();
    const res = await request(app)
      .get(TEST_PATH)
      .set("Authorization", "Bearer test-cron-secret");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      job: "ops_alert_test",
      outcome: { slack: "sent", email: "sent" },
    });
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0]?.[0]).toMatchObject({
      condition: "ops_test",
    });
  });
});
