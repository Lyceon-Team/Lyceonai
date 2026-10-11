/**
 * The daily content publish job (Doc 10B §8.4): the rebuild fires only on publish days, at 07:xx
 * America/Chicago in summer and winter time, and only for an approved post.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3, §8.3, §8.4, §8.6; owner answer on Doc 10B Phase 1
 *       Step 0, item 5 (Karl, 2026-10-11)] | @implemented [2026-10-11]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toScheduledPost, type BlogPost } from "../../shared/content/blog";
import { publishAtProblem } from "../../shared/content/schedule";
import {
  decideContentPublish,
  runContentPublish,
} from "../../server/services/content/publish-job";
import { FIXTURE_APPROVALS, scheduledSpec } from "../lib/content-fixtures";
import { REPO_ROOT } from "../lib/prerendered-site";

const HOOK = "https://api.vercel.com/v1/integrations/deploy/test/hook";

// Monday 2026-10-19 (CDT, UTC-5) and Monday 2026-11-02 (CST, UTC-6).
const mondaySummer = scheduledSpec({ publishAt: "2026-10-19T07:00" });
const mondayWinter = scheduledSpec({
  slug: "winter-fixture",
  publishAt: "2026-11-02T07:00",
  batch: "2026-W43",
});
const approved = (spec = mondaySummer): BlogPost =>
  toScheduledPost(spec, FIXTURE_APPROVALS);
const unapproved = (spec = mondaySummer): BlogPost => toScheduledPost(spec, {});

function countingFetch(ok = true): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(null, { status: ok ? 201 : 500 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("the rebuild fires only on publish days", () => {
  it("summer time: the 12:05 UTC run (07:05 Chicago) deploys for a post due today", () => {
    expect(
      decideContentPublish([approved()], new Date("2026-10-19T12:05:00Z")),
    ).toEqual({
      action: "deploy",
      due: ["scheduled-fixture"],
      today: "2026-10-19",
      chicagoHour: 7,
    });
  });

  it("summer time: the 13:05 UTC run is the 08:00 hour, so it does nothing", () => {
    expect(
      decideContentPublish([approved()], new Date("2026-10-19T13:05:00Z")),
    ).toMatchObject({
      action: "skip",
      reason: "not_publish_hour",
    });
  });

  it("winter time: the 12:05 UTC run is 06:05 Chicago (nothing), the 13:05 run deploys", () => {
    const post = approved(mondayWinter);
    expect(
      decideContentPublish([post], new Date("2026-11-02T12:05:00Z")),
    ).toMatchObject({
      action: "skip",
      reason: "not_publish_hour",
    });
    expect(
      decideContentPublish([post], new Date("2026-11-02T13:05:00Z")),
    ).toMatchObject({
      action: "deploy",
      due: ["winter-fixture"],
    });
  });

  it("a day with no post due does nothing (Tuesday after the Monday post)", () => {
    expect(
      decideContentPublish([approved()], new Date("2026-10-20T12:05:00Z")),
    ).toMatchObject({
      action: "skip",
      reason: "nothing_due",
    });
  });

  it("an unapproved post due today never triggers a build", () => {
    expect(
      decideContentPublish([unapproved()], new Date("2026-10-19T12:05:00Z")),
    ).toMatchObject({
      action: "skip",
      reason: "nothing_due",
    });
  });

  it("the job posts the deploy hook exactly once on a publish day, never otherwise", async () => {
    const day = countingFetch();
    const r = await runContentPublish({
      posts: [approved()],
      now: new Date("2026-10-19T12:05:00Z"),
      deployHookUrl: HOOK,
      fetchImpl: day.fetchImpl,
    });
    expect(r.deploy).toBe("triggered");
    expect(day.calls).toEqual([HOOK]);

    const other = countingFetch();
    const skip = await runContentPublish({
      posts: [approved()],
      now: new Date("2026-10-20T12:05:00Z"),
      deployHookUrl: HOOK,
      fetchImpl: other.fetchImpl,
    });
    expect(skip.deploy).toBe("not_needed");
    expect(other.calls).toEqual([]);
  });

  it("a failing hook is reported as failed", async () => {
    const bad = countingFetch(false);
    const r = await runContentPublish({
      posts: [approved()],
      now: new Date("2026-10-19T12:05:00Z"),
      deployHookUrl: HOOK,
      fetchImpl: bad.fetchImpl,
    });
    expect(r.deploy).toBe("failed");
  });

  it("vercel.json runs the job at 12:xx and 13:xx UTC (one of them is 07:xx Chicago in each season)", () => {
    const crons = (
      JSON.parse(readFileSync(join(REPO_ROOT, "vercel.json"), "utf8")) as {
        crons: { path: string; schedule: string }[];
      }
    ).crons
      .filter((c) => c.path === "/api/internal/content-publish")
      .map((c) => c.schedule.split(" ")[1]);
    expect(crons.sort()).toEqual(["12", "13"]);
  });
});

describe("the publish cadence (Doc 10B §3: Mon/Wed/Fri 07:00 Chicago)", () => {
  it("Monday, Wednesday and Friday at 07:00 are on cadence", () => {
    for (const at of [
      "2026-10-19T07:00",
      "2026-10-21T07:00",
      "2026-10-23T07:00",
    ])
      expect(publishAtProblem(at), at).toBeNull();
  });
  it("another weekday or another time is refused", () => {
    expect(publishAtProblem("2026-10-20T07:00")).toMatch(/Tuesday/);
    expect(publishAtProblem("2026-10-19T09:00")).toMatch(/not at 07:00/);
  });
});
