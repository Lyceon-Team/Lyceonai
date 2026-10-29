/**
 * The Vercel cron schedules, pinned.
 *
 * @spec [owner ruling, Karl 2026-10-09, schedule audit Step 2 item 1: calendar-exam-notify →
 *       `0 21 * * *`, exam-score-renewal → `0 20 * * *`, notification-dispatch-sweep →
 *       `0 14 * * *`, execute-deletions → `0 15 * * *`, single UTC entries (a one-hour seasonal
 *       shift accepted); "everything else stays"] | @implemented [2026-10-09]
 *
 * plain English: `crons` in vercel.json is hand-authored (generate:vercel-routes rewrites only
 * `routes` and leaves every other key untouched), so nothing regenerates it and nothing else
 * would notice a schedule moving. This reads the file and asserts the whole list: the four the
 * ruling moved, and every other entry exactly as it was before the ruling. A new or removed
 * entry fails here too, on purpose — it is a schedule decision, and it should be one on purpose.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

type Cron = { path: string; schedule: string };

const vercel = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../vercel.json"), "utf8"),
) as { crons: Cron[] };

describe("vercel.json cron schedules (owner ruling 2026-10-09)", () => {
  it("the four moved schedules", () => {
    const at = (p: string): string[] =>
      vercel.crons.filter((c) => c.path === p).map((c) => c.schedule);
    expect(at("/api/internal/calendar-exam-notify")).toEqual(["0 21 * * *"]);
    expect(at("/api/internal/exam-score-renewal")).toEqual(["0 20 * * *"]);
    expect(at("/api/internal/notification-dispatch-sweep")).toEqual([
      "0 14 * * *",
    ]);
    expect(at("/api/internal/execute-deletions")).toEqual(["0 15 * * *"]);
  });

  it("every other entry is unchanged, and there is nothing else", () => {
    expect(vercel.crons).toEqual([
      { path: "/api/internal/legal-acceptance-drain", schedule: "0 3 * * *" },
      { path: "/api/internal/execute-deletions", schedule: "0 15 * * *" },
      { path: "/api/internal/stale-session-sweep", schedule: "30 3 * * *" },
      { path: "/api/internal/baseline-pending-sweep", schedule: "0 4 * * *" },
      {
        path: "/api/internal/notification-dispatch-sweep",
        schedule: "0 14 * * *",
      },
      {
        path: "/api/internal/notification-retention-sweep",
        schedule: "0 5 * * *",
      },
      { path: "/api/internal/calendar-weekly-regen", schedule: "30 5 * * *" },
      { path: "/api/internal/calendar-exam-notify", schedule: "0 21 * * *" },
      { path: "/api/internal/exam-score-renewal", schedule: "0 20 * * *" },
      // Doc 10B §8.4 daily publish check (owner answer 5, 2026-10-11: 07:00-07:59 Chicago go-live
      // accepted): two UTC entries, the job acts only in the 07 Chicago hour, so one fires in CDT
      // and the other in CST.
      { path: "/api/internal/content-publish", schedule: "5 12 * * *" },
      { path: "/api/internal/content-publish", schedule: "5 13 * * *" },
      { path: "/api/internal/qotd-schedule", schedule: "15 7 * * *" },
      {
        path: "/api/internal/marketing-email-reconcile",
        schedule: "45 7 * * *",
      },
      { path: "/api/internal/qotd-daily-email", schedule: "5 6 * * *" },
      { path: "/api/internal/qotd-daily-email", schedule: "0 22 * * *" },
      { path: "/api/internal/qotd-daily-email", schedule: "0 23 * * *" },
      // Owner brief "Guardian accountability loop" (Karl, 2026-10-13): the guardian digest at
      // 18:00 Chicago, two UTC entries with a Chicago-hour guard like the QOTD email — 23:00 UTC
      // is 18:00 CDT, 00:00 UTC is 18:00 CST.
      {
        path: "/api/internal/guardian-daily-digest",
        schedule: "0 23 * * *",
      },
      { path: "/api/internal/guardian-daily-digest", schedule: "0 0 * * *" },
      // Owner rulings on #1284 (Karl, 2026-10-21): every
      // lifecycle email at 22:00 UTC Monday–Friday and 15:00 UTC Saturday–Sunday.
      { path: "/api/internal/lifecycle-email", schedule: "0 22 * * 1-5" },
      { path: "/api/internal/lifecycle-email", schedule: "0 15 * * 0,6" },
      { path: "/api/internal/landing-summaries", schedule: "30 6 * * *" },
      // Owner brief "One funnel for every social post" (Karl, 2026-10-28) item 3: the growth
      // report, Mondays at 14:00 UTC.
      { path: "/api/internal/growth-report", schedule: "0 14 * * 1" },
    ]);
  });
});
