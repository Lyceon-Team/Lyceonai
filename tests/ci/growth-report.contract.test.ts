/**
 * The Monday growth report: the message, the run's once-only rule, and the cron route.
 *
 * @spec [owner brief "One funnel for every social post: /start + CTAs + weekly growth report"
 *       (Karl, 2026-10-28) items 3-4] | @implemented [2026-10-28]
 *
 * plain English: the formatter shows each number with its change against the week before (a
 * difference only when the week before was 0, never a percentage of nothing), sign-ups by channel
 * and returning students by test date; the run posts once per week (a second call is a no-op), and
 * a Slack failure or missing Slack setting releases the week so a re-run posts it; the route is
 * 404 without the cron secret and 500 when nothing was posted. The real-Postgres numbers are
 * proved in growth-report.pg.ci.test.ts.
 */
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GrowthReport } from "../../packages/shared/src/growth-report-schema";
import {
  change,
  formatGrowthReport,
  runGrowthReport,
  weekLabel,
  type GrowthPostOutcome,
  type GrowthReportDeps,
} from "../../server/lib/growth-report";

export const SAMPLE_REPORT: GrowthReport = {
  week: {
    week_start: "2026-10-26",
    signups: 12,
    signups_by_channel: { reddit: 5, untagged: 4, tiktok: 3 },
    active_students: 40,
    returning_students: 18,
    returning_by_test_date: [
      { test_date: "2026-12-05", students: 10 },
      { test_date: "2027-03-06", students: 3 },
      { test_date: null, students: 5 },
    ],
    questions_answered: 1240,
    full_length_answers: 98,
    reviews_done: 31,
    study_minutes_estimate: 2478,
    signups_answered_24h: 7,
    upgrades: 2,
  },
  previous: {
    week_start: "2026-10-19",
    signups: 9,
    signups_by_channel: { untagged: 9 },
    active_students: 42,
    returning_students: 13,
    returning_by_test_date: [{ test_date: "2026-12-05", students: 13 }],
    questions_answered: 1107,
    full_length_answers: 0,
    reviews_done: 31,
    study_minutes_estimate: 2160,
    signups_answered_24h: 4,
    upgrades: 0,
  },
};

describe("the message", () => {
  it("names the week as Monday to Sunday, Chicago time", () => {
    expect(weekLabel("2026-10-26")).toBe("Oct 26 – Nov 1");
    expect(formatGrowthReport(SAMPLE_REPORT).split("\n")[0]).toBe(
      "*Weekly growth* · Oct 26 – Nov 1 (Mon–Sun, Chicago time) vs Oct 19 – Oct 25",
    );
  });

  it("shows each change; a week before of 0 gets the difference only, never a percentage", () => {
    expect(change(12, 9)).toBe("+3 (+33%)");
    expect(change(40, 42)).toBe("−2 (−5%)");
    expect(change(31, 31)).toBe("no change");
    expect(change(98, 0)).toBe("+98");
    expect(change(0, 0)).toBe("no change");
    const text = formatGrowthReport(SAMPLE_REPORT);
    expect(text).toContain("• Upgrades: *2* (+2 vs 0)");
    expect(text).toContain("• Full-length test answers: *98* (+98 vs 0)");
    expect(text).not.toMatch(/Infinity|NaN/);
  });

  it("carries every metric the brief lists", () => {
    const text = formatGrowthReport(SAMPLE_REPORT);
    expect(text).toContain("• Sign-ups: *12* (+3 (+33%) vs 9)");
    expect(text).toContain("by channel: reddit 5 · untagged 4 · tiktok 3");
    expect(text).toContain("• Active students: *40* (−2 (−5%) vs 42)");
    expect(text).toContain(
      "• Students back from the week before: *18* (+5 (+38%) vs 13)",
    );
    expect(text).toContain(
      "by test date: Sat, Dec 5, 2026 10 · Sat, Mar 6, 2027 3 · no test date 5",
    );
    expect(text).toContain(
      "• Questions answered: *1,240* (+133 (+12%) vs 1,107)",
    );
    expect(text).toContain("• Reviews done: *31* (no change vs 31)");
    expect(text).toContain(
      "• Study time, estimated (hours): *41.3* (+5.3 (+15%) vs 36.0)",
    );
    expect(text).toContain(
      "• Sign-ups who answered a question within 24 h: *7 of 12* (week before: 4 of 9)",
    );
    expect(text).toContain("ALPHA and paid are not split here");
    expect(text).toContain(
      "under-13, deleted, internal and test accounts excluded",
    );
  });
});

type Ledger = Map<string, { posted: boolean }>;

function fakeDeps(
  ledger: Ledger,
  outcome: GrowthPostOutcome,
  posts: string[],
  report: unknown = SAMPLE_REPORT,
): GrowthReportDeps {
  return {
    now: () => new Date("2026-11-02T14:00:00Z"),
    weekStart: async () => "2026-10-26",
    claim: async (week) => {
      if (ledger.has(week)) return false;
      ledger.set(week, { posted: false });
      return true;
    },
    markPosted: async (week) => {
      ledger.set(week, { posted: true });
    },
    release: async (week) => {
      if (!ledger.get(week)?.posted) ledger.delete(week);
    },
    excludedProfileIds: async () => ["00000000-0000-4000-8000-000000000001"],
    report: async () => report,
    post: async (text) => {
      if (outcome === "posted") posts.push(text);
      return outcome;
    },
  };
}

describe("the run", () => {
  it("posts once per week: a second call is a no-op", async () => {
    const ledger: Ledger = new Map();
    const posts: string[] = [];
    expect(await runGrowthReport(fakeDeps(ledger, "posted", posts))).toEqual({
      status: "posted",
      week_start: "2026-10-26",
      excluded_accounts: 1,
    });
    expect(await runGrowthReport(fakeDeps(ledger, "posted", posts))).toEqual({
      status: "already_claimed",
      week_start: "2026-10-26",
    });
    expect(posts).toHaveLength(1);
    expect(ledger.get("2026-10-26")).toEqual({ posted: true });
  });

  it("a Slack failure releases the week, so a re-run posts it", async () => {
    const ledger: Ledger = new Map();
    const posts: string[] = [];
    expect(await runGrowthReport(fakeDeps(ledger, "failed", posts))).toEqual({
      status: "not_posted",
      week_start: "2026-10-26",
      reason: "failed",
    });
    expect(ledger.has("2026-10-26")).toBe(false);
    expect(
      (await runGrowthReport(fakeDeps(ledger, "posted", posts))).status,
    ).toBe("posted");
    expect(posts).toHaveLength(1);
  });

  it("a missing Slack setting releases the week too", async () => {
    const ledger: Ledger = new Map();
    const result = await runGrowthReport(fakeDeps(ledger, "misconfigured", []));
    expect(result).toMatchObject({
      status: "not_posted",
      reason: "misconfigured",
    });
    expect(ledger.size).toBe(0);
  });

  it("numbers of the wrong shape post nothing and release the week", async () => {
    const ledger: Ledger = new Map();
    const posts: string[] = [];
    await expect(
      runGrowthReport(
        fakeDeps(ledger, "posted", posts, {
          ...SAMPLE_REPORT,
          week: { ...SAMPLE_REPORT.week, signups: -1 },
        }),
      ),
    ).rejects.toThrow();
    expect(posts).toEqual([]);
    expect(ledger.size).toBe(0);
  });
});

const liveDeps = vi.hoisted(() => ({
  current: null as null | (() => GrowthReportDeps),
}));
vi.mock("../../server/lib/growth-report.js", async (orig) => ({
  ...(await orig<object>()),
  liveGrowthReportDeps: () => {
    if (!liveDeps.current) throw new Error("no deps");
    return liveDeps.current();
  },
}));

describe("the cron route", () => {
  const PATH = "/api/internal/growth-report";
  let app: express.Express;
  beforeEach(async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const router = (await import("../../server/routes/internal-cron-routes"))
      .default;
    app = express();
    app.use("/api/internal", router);
  });

  it("vercel.json runs it on Mondays at 14:00 UTC", () => {
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    expect(cfg.crons.filter((c) => c.path === PATH)).toEqual([
      { path: PATH, schedule: "0 14 * * 1" },
    ]);
  });

  it("without the secret: 404 and nothing runs", async () => {
    const posts: string[] = [];
    liveDeps.current = () => fakeDeps(new Map(), "posted", posts);
    expect((await request(app).get(PATH)).status).toBe(404);
    expect(
      (await request(app).get(PATH).set("Authorization", "Bearer nope")).status,
    ).toBe(404);
    expect(posts).toEqual([]);
  });

  it("with the secret: posts once; a second call answers 200 and posts nothing", async () => {
    const ledger: Ledger = new Map();
    const posts: string[] = [];
    liveDeps.current = () => fakeDeps(ledger, "posted", posts);
    const auth = "Bearer test-cron-secret";
    const first = await request(app).get(PATH).set("Authorization", auth);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      ok: true,
      job: "growth_report",
      summary: { status: "posted", week_start: "2026-10-26" },
    });
    const second = await request(app).get(PATH).set("Authorization", auth);
    expect(second.status).toBe(200);
    expect(second.body.summary.status).toBe("already_claimed");
    expect(posts).toHaveLength(1);
  });

  it("a Slack failure answers 500 so the run shows as failed", async () => {
    liveDeps.current = () => fakeDeps(new Map(), "failed", []);
    const res = await request(app)
      .get(PATH)
      .set("Authorization", "Bearer test-cron-secret");
    expect(res.status).toBe(500);
    expect(res.body.summary).toMatchObject({ status: "not_posted" });
  });
});
