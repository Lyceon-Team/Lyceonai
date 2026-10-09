/**
 * The daily-question email's cron wiring.
 *
 * @spec [owner brief "Question of the Day on Home" (Karl, 2026-10-08/09), "Daily email": 5 PM
 *       America/Chicago every day, correct across DST] | @implemented [2026-10-09]
 *
 * plain English: the project's Vercel plan allows only DAILY crons, so the route is scheduled
 * three times a day: one entry lands in the 17:00 Chicago hour in summer (CDT), one in winter
 * (CST), and one just after Chicago midnight rolls the SAT dates. The proof is computed from the
 * zone database for a summer and a winter day, not restated. Every entry is daily. The route
 * refuses a call without CRON_SECRET (404) and returns the job summary nested under the envelope.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const runMock = vi.hoisted(() => vi.fn());
vi.mock("../../server/services/qotd/qotd-email-job.js", async (orig) => ({
  ...(await orig<object>()),
  runQotdEmailJob: runMock,
  defaultQotdEmailJobDeps: () => ({}),
}));

const CRON_PATH = "/api/internal/qotd-daily-email";

function entries(): string[] {
  const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons: { path: string; schedule: string }[];
  };
  return cfg.crons.filter((c) => c.path === CRON_PATH).map((c) => c.schedule);
}

function chicagoHourAt(
  isoDay: string,
  utcHour: number,
  minute: number,
): number {
  const at = new Date(
    `${isoDay}T${String(utcHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`,
  );
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      hourCycle: "h23",
    }).format(at),
  );
}

describe("vercel.json schedules the daily email", () => {
  it("every entry is daily (the plan allows nothing more frequent)", () => {
    const schedules = entries();
    expect(schedules.length).toBeGreaterThanOrEqual(2);
    for (const s of schedules) expect(s).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });

  it.each([
    ["summer (CDT)", "2026-07-14"],
    ["winter (CST)", "2026-01-14"],
  ])("one entry lands in the 17:00 Chicago hour in %s", (_season, day) => {
    const hits = entries().filter((s) => {
      const [minute, hour] = s.split(" ").map(Number);
      return chicagoHourAt(day, hour ?? -1, minute ?? 0) === 17;
    });
    expect(hits).toHaveLength(1);
  });

  it("one entry runs just after Chicago midnight in both seasons (the SAT-date roll)", () => {
    const early = entries().filter((s) => {
      const [minute, hour] = s.split(" ").map(Number);
      return ["2026-07-14", "2026-01-14"].every(
        (day) => chicagoHourAt(day, hour ?? -1, minute ?? 0) <= 1,
      );
    });
    expect(early).toHaveLength(1);
  });
});

describe("the cron route", () => {
  let app: express.Express;
  beforeEach(async () => {
    runMock.mockReset();
    runMock.mockResolvedValue({ ok: true, sent: 0 });
    process.env.CRON_SECRET = "test-cron-secret";
    const router = (await import("../../server/routes/internal-cron-routes"))
      .default;
    app = express();
    app.use("/api/internal", router);
  });

  it("without the secret: 404 and the job never runs", async () => {
    expect((await request(app).get(CRON_PATH)).status).toBe(404);
    expect(
      (await request(app).get(CRON_PATH).set("Authorization", "Bearer no"))
        .status,
    ).toBe(404);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("with the secret: runs once and nests the summary", async () => {
    const res = await request(app)
      .get(CRON_PATH)
      .set("Authorization", "Bearer test-cron-secret");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      job: "qotd_daily_email",
      summary: { ok: true, sent: 0 },
    });
    expect(runMock).toHaveBeenCalledTimes(1);
  });
});
