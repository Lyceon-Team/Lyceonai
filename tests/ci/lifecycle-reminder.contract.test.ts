/**
 * Where and when lifecycle emails are sent: their own route, called by two fixed UTC crons, and
 * never by the dispatch sweep.
 *
 * @spec [owner rulings on #1284 (Karl, 2026-10-21) §2:
 *       weekdays `0 22 * * 1-5`, weekends `0 15 * * 0,6`; the quiet-hours guard a backstop
 *       ("both times sit inside 08:00–21:00 Chicago all year"); contracts/notifications.contract.md
 *       C6.2, C14A.4–C14A.5; SCL-240] | @implemented [2026-10-21]
 *
 * plain English: the claim, the exclusions, once-ever and the slot guard on real Postgres are in
 * tests/ci/lifecycle-reminder.pg.ci.test.ts; the slot function itself in
 * tests/ci/lifecycle-send-slots.contract.test.ts. This file proves the wiring: the two crons and
 * only those, an authorised call runs the rule once and reports its summary, a throw is a 500,
 * and the 14:00 sweep no longer runs it.
 */
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ruleMock = vi.hoisted(() => vi.fn());
const dispatchMock = vi.hoisted(() => vi.fn());
const reviewAskMock = vi.hoisted(() => vi.fn());

vi.mock("../../server/lib/notifications/dispatch.js", () => ({
  dispatchQueuedMessages: dispatchMock,
}));
vi.mock("../../server/lib/notifications/dispatch", () => ({
  dispatchQueuedMessages: dispatchMock,
}));
vi.mock(
  "../../server/services/product-feedback/review-ask-email-job.js",
  () => ({ runReviewAskEmailRule: reviewAskMock }),
);
vi.mock("../../server/services/product-feedback/review-ask-email-job", () => ({
  runReviewAskEmailRule: reviewAskMock,
}));
vi.mock("../../server/lib/lifecycle-email.js", () => ({
  runLifecycleRule: ruleMock,
  defaultLifecycleRuleDeps: () => ({ marker: "default-deps" }),
}));
vi.mock("../../server/lib/lifecycle-email", () => ({
  runLifecycleRule: ruleMock,
  defaultLifecycleRuleDeps: () => ({ marker: "default-deps" }),
}));

const ROUTE = "/api/internal/lifecycle-email";
const SWEEP = "/api/internal/notification-dispatch-sweep";
const SUMMARY = { ran: true, claimed: 2, sent: 1, skipped: 1, failed: 0 };

describe("lifecycle emails — where and when they run", () => {
  it("two crons call the lifecycle route: 22:00 UTC Monday–Friday and 15:00 UTC Saturday–Sunday", () => {
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    expect(
      cfg.crons.filter((c) => c.path === ROUTE).map((c) => c.schedule),
    ).toEqual(["0 22 * * 1-5", "0 15 * * 0,6"]);
  });

  describe("the live routes", () => {
    let app: express.Express;
    beforeEach(async () => {
      ruleMock.mockReset();
      dispatchMock.mockReset();
      reviewAskMock.mockReset();
      reviewAskMock.mockResolvedValue({ emitted: 0 });
      dispatchMock.mockResolvedValue({ picked: 0, sent: 0 });
      process.env.CRON_SECRET = "test-cron-secret";
      const router = (await import("../../server/routes/internal-cron-routes"))
        .default;
      app = express();
      app.use("/api/internal", router);
    });

    it("without the secret: 404 and the rule never runs", async () => {
      const res = await request(app).get(ROUTE);
      expect(res.status).toBe(404);
      expect(ruleMock).not.toHaveBeenCalled();
    });

    it("runs the rule once, with the default deps, and reports its summary", async () => {
      ruleMock.mockResolvedValue(SUMMARY);
      const res = await request(app)
        .get(ROUTE)
        .set("Authorization", "Bearer test-cron-secret");
      expect(res.status).toBe(200);
      expect(ruleMock).toHaveBeenCalledTimes(1);
      expect(ruleMock.mock.calls[0]?.[0]).toBeInstanceOf(Date);
      expect(ruleMock.mock.calls[0]?.[1]).toEqual({ marker: "default-deps" });
      expect(res.body.summary).toEqual(SUMMARY);
    });

    it("a rule that throws: 500, so the run shows as failed", async () => {
      ruleMock.mockRejectedValue(new Error("boom"));
      const res = await request(app)
        .get(ROUTE)
        .set("Authorization", "Bearer test-cron-secret");
      expect(res.status).toBe(500);
    });

    it("the 14:00 dispatch sweep no longer sends lifecycle email", async () => {
      ruleMock.mockResolvedValue(SUMMARY);
      const res = await request(app)
        .get(SWEEP)
        .set("Authorization", "Bearer test-cron-secret");
      expect(res.status).toBe(200);
      expect(dispatchMock).toHaveBeenCalledTimes(1); // presence: the sweep ran
      expect(ruleMock).not.toHaveBeenCalled();
    });
  });
});
