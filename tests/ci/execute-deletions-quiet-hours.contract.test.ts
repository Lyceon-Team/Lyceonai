/**
 * The deletion executor's quiet-hours guard, and every moved schedule landing in daytime.
 *
 * @spec [owner ruling, Karl 2026-10-09, schedule audit Step 2 items 1 and 2: execute-deletions at
 *       15:00 UTC; "the deletion-completed email is NOT exempt"; no student- or guardian-facing
 *       email 21:00–08:00 America/Chicago] | @implemented [2026-10-09]
 *
 * plain English: the executor sends the deletion-completed notice and then, for a do-not-contact
 * request, adds the address to Resend's suppression list — so a notice postponed to 08:00 would
 * be swallowed by the suppression added after it. The route therefore does nothing inside quiet
 * hours (a manual night run), and the scheduled run is in daytime. Both halves are asserted
 * here, the second computed from the zone database for a summer and a winter day.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const executeMock = vi.hoisted(() => vi.fn());
vi.mock("../../server/lib/account-deletion-execute.js", async (orig) => ({
  ...(await orig<object>()),
  executeDueDeletions: executeMock,
  isDeletionLifecycleV2Enabled: () => true,
}));
vi.mock("../../server/middleware/supabase-auth.js", async (orig) => ({
  ...(await orig<object>()),
  getSupabaseAdmin: () => ({}),
}));

async function app(): Promise<express.Express> {
  const router = (await import("../../server/routes/internal-cron-routes"))
    .default;
  const a = express();
  a.use("/api/internal", router);
  return a;
}

function chicagoHourAt(iso: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date(iso)),
  );
}

describe("execute-deletions does nothing inside quiet hours", () => {
  afterEach(() => {
    vi.useRealTimers();
    executeMock.mockReset();
    delete process.env.CRON_SECRET;
  });

  it("01:00 CDT: skipped, the executor is never called", async () => {
    process.env.CRON_SECRET = "s3cret";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-15T06:00:00Z"));
    const res = await request(await app())
      .get("/api/internal/execute-deletions")
      .set("Authorization", "Bearer s3cret");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      skipped: "quiet_hours",
      executedCount: 0,
    });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("15:00 UTC (10:00 CDT): the executor runs", async () => {
    process.env.CRON_SECRET = "s3cret";
    executeMock.mockResolvedValue({
      executedCount: 1,
      skippedCount: 0,
      failedCount: 0,
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-15T15:00:00Z"));
    const res = await request(await app())
      .get("/api/internal/execute-deletions")
      .set("Authorization", "Bearer s3cret");
    expect(res.status).toBe(200);
    expect(res.body.executedCount).toBe(1);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});

describe("every moved user-facing schedule lands outside quiet hours, summer and winter", () => {
  const crons = (
    JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    }
  ).crons;
  for (const p of [
    "/api/internal/calendar-exam-notify",
    "/api/internal/exam-score-renewal",
    "/api/internal/notification-dispatch-sweep",
    "/api/internal/execute-deletions",
  ]) {
    it.each([["2026-07-14"], ["2026-01-14"]])(`${p} on %s`, (day) => {
      const entry = crons.find((c) => c.path === p);
      expect(entry).toBeDefined();
      const [minute, hour] = (entry?.schedule ?? "").split(" ").map(Number);
      const h = chicagoHourAt(
        `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`,
      );
      expect(h).toBeGreaterThanOrEqual(8);
      expect(h).toBeLessThan(21);
    });
  }
});
