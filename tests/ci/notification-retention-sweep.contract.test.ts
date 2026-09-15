/**
 * @spec [contracts/notifications.contract.md C11.2 (the scheduled entry point is
 *        CRON_SECRET-gated and registered in vercel.json), C11.3 (every run logged);
 *        owner brief 2026-09-15 Part A2 (the scheduling trap)] | @implemented [2026-09-15]
 *
 * plain English: the sweep's SQL and its log line are proven on real Postgres in
 * tests/ci/notifications-retention-page.pg.ci.test.ts. This file proves the wiring around
 * them: the cron entry exists in vercel.json (the only scheduler; pg_cron stays unused), the
 * route refuses everything without the secret (404, reveals nothing), and an authorised call
 * runs the sweep once and returns its summary. Cron REGISTRATION on the Vercel project is
 * not readable from tooling and is the owner's dashboard check; what can be proven here is
 * that the entry the dashboard would read is present and points at a live, gated route.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";

const sweepMock = vi.hoisted(() => vi.fn());
vi.mock("../../server/lib/notifications/retention.js", () => ({
  sweepNotificationRetention: sweepMock,
}));
vi.mock("../../server/lib/notifications/retention", () => ({
  sweepNotificationRetention: sweepMock,
}));

const CRON_PATH = "/api/internal/notification-retention-sweep";

describe("notification retention sweep — scheduling and gating", () => {
  it("vercel.json carries the cron entry, daily, alongside the other internal sweeps (no pg_cron, no second scheduler)", () => {
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const entry = cfg.crons.find((c) => c.path === CRON_PATH);
    expect(entry, `${CRON_PATH} is not in vercel.json crons`).toBeDefined();
    // Five-field cron with a fixed minute and hour: exactly once a day.
    expect(entry?.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
    // The other notification sweep stays; this one does not replace it.
    expect(cfg.crons.map((c) => c.path)).toContain(
      "/api/internal/notification-dispatch-sweep",
    );
    // No migration in this change schedules anything through pg_cron.
    const migration = readFileSync(
      "supabase/migrations/20260915100000_notification_retention_sweep_and_feed_archive.sql",
      "utf8",
    );
    expect(migration).not.toMatch(/cron\.schedule|pg_cron/);
  });

  it("the route is cron-authorized and fails closed (source)", () => {
    const src = readFileSync("server/routes/internal-cron-routes.ts", "utf8");
    const at = src.indexOf('"/notification-retention-sweep"');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 400);
    expect(body).toContain("cronAuthorized(req)");
    expect(body).toContain("404");
  });

  describe("the live route", () => {
    let app: express.Express;
    beforeEach(async () => {
      sweepMock.mockReset();
      process.env.CRON_SECRET = "test-cron-secret";
      const router = (await import("../../server/routes/internal-cron-routes"))
        .default;
      app = express();
      app.use("/api/internal", router);
    });

    it("without the secret: 404 and the sweep is never called", async () => {
      const res = await request(app).get(CRON_PATH);
      expect(res.status).toBe(404);
      expect(sweepMock).not.toHaveBeenCalled();
      const wrong = await request(app)
        .get(CRON_PATH)
        .set("Authorization", "Bearer not-it");
      expect(wrong.status).toBe(404);
      expect(sweepMock).not.toHaveBeenCalled();
    });

    it("with the secret: runs the sweep once and returns its summary", async () => {
      sweepMock.mockResolvedValueOnce({
        deletedEvents: 0,
        deletedMessages: 0,
        cutoff: "2026-06-17T05:00:00.000Z",
        batchSize: 1000,
        batchFull: false,
      });
      const res = await request(app)
        .get(CRON_PATH)
        .set("Authorization", "Bearer test-cron-secret");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        deletedEvents: 0,
        deletedMessages: 0,
        cutoff: "2026-06-17T05:00:00.000Z",
        batchSize: 1000,
        batchFull: false,
      });
      expect(sweepMock).toHaveBeenCalledTimes(1);
    });

    it("a sweep failure is a 500, never a silent 200", async () => {
      sweepMock.mockRejectedValueOnce(new Error("boom"));
      const res = await request(app)
        .get(CRON_PATH)
        .set("Authorization", "Bearer test-cron-secret");
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: "notification_retention_sweep_failed",
      });
    });
  });
});
