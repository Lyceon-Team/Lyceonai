/**
 * The founding reminder's wiring: it runs in the morning dispatch sweep, after the dispatch, and
 * its failure changes nothing else in the sweep.
 *
 * @spec [owner brief "Lifecycle emails: reminder timing fix + behaviour triggers" (Karl,
 *       2026-10-21) PR 1 (1) "in the existing daily notification job" and (2) "only inside the
 *       allowed window"; owner answer the same day: the morning Chicago sweep;
 *       contracts/notifications.contract.md C6.2, C14A.4; SCL-239] | @implemented [2026-10-21]
 *
 * plain English: the claim, the exclusions, once-ever and quiet hours are proven on real
 * Postgres (tests/ci/lifecycle-reminder.pg.ci.test.ts). This file proves where the rule runs:
 * the sweep's schedule lands inside the window in both CST and CDT, an authorised sweep calls the
 * rule once, after the dispatch, and reports its summary, and a rule that throws still leaves a
 * 200 with the dispatch done.
 */
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { quietHoursDeferral } from "../../server/lib/notifications/quiet-hours";

const order = vi.hoisted(() => [] as string[]);
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
  runLifecycleReminderRule: ruleMock,
  defaultReminderDeps: () => ({ marker: "default-deps" }),
}));
vi.mock("../../server/lib/lifecycle-email", () => ({
  runLifecycleReminderRule: ruleMock,
  defaultReminderDeps: () => ({ marker: "default-deps" }),
}));

const SWEEP = "/api/internal/notification-dispatch-sweep";
const SUMMARY = { ran: true, claimed: 2, sent: 1, skipped: 1, failed: 0 };

describe("founding reminder — where and when it runs", () => {
  it("the sweep's schedule (14:00 UTC) is inside the quiet-hours window in winter and in summer", () => {
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const entries = cfg.crons.filter((c) => c.path === SWEEP);
    expect(entries.map((e) => e.schedule)).toEqual(["0 14 * * *"]);
    for (const day of ["2026-01-15", "2026-07-15", "2026-11-01"]) {
      expect(quietHoursDeferral(new Date(`${day}T14:00:00Z`)), day).toBeNull();
    }
  });

  describe("the live sweep", () => {
    let app: express.Express;
    beforeEach(async () => {
      order.length = 0;
      ruleMock.mockReset();
      dispatchMock.mockReset();
      reviewAskMock.mockReset();
      reviewAskMock.mockImplementation(async () => {
        order.push("review_ask");
        return { emitted: 0 };
      });
      dispatchMock.mockImplementation(async () => {
        order.push("dispatch");
        return { picked: 0, sent: 0 };
      });
      process.env.CRON_SECRET = "test-cron-secret";
      const router = (await import("../../server/routes/internal-cron-routes"))
        .default;
      app = express();
      app.use("/api/internal", router);
    });

    it("without the secret: 404 and the rule never runs", async () => {
      const res = await request(app).get(SWEEP);
      expect(res.status).toBe(404);
      expect(ruleMock).not.toHaveBeenCalled();
    });

    it("runs the rule once, after the dispatch, with the default deps, and reports its summary", async () => {
      ruleMock.mockImplementation(async () => {
        order.push("reminder");
        return SUMMARY;
      });
      const res = await request(app)
        .get(SWEEP)
        .set("Authorization", "Bearer test-cron-secret");
      expect(res.status).toBe(200);
      expect(order).toEqual(["review_ask", "dispatch", "reminder"]);
      expect(ruleMock).toHaveBeenCalledTimes(1);
      expect(ruleMock.mock.calls[0]?.[0]).toBeInstanceOf(Date);
      expect(ruleMock.mock.calls[0]?.[1]).toEqual({ marker: "default-deps" });
      expect(res.body.lifecycleReminder).toEqual(SUMMARY);
    });

    it("a rule that throws: still 200, the dispatch done, the failure reported", async () => {
      ruleMock.mockRejectedValue(new Error("boom"));
      const res = await request(app)
        .get(SWEEP)
        .set("Authorization", "Bearer test-cron-secret");
      expect(res.status).toBe(200);
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(res.body.lifecycleReminder).toEqual({ error: true });
    });
  });
});
