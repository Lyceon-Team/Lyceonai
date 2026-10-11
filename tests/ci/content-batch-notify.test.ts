/**
 * The batch notification (Doc 10B Phase 1 scope 4): a ready batch pull request posts its titles,
 * publish dates, Codex verdicts and link to #social, through the shared Slack client.
 *
 * @spec [owner brief "Doc 10B Phase 1 — blog pipeline" (Karl, 2026-10-11) scope 4; owner answers
 *       11 and 12] | @implemented [2026-10-11]
 *
 * plain English: the posts are built by the real producer (toScheduledPost) and the review record
 * is the real template filled in (tests/lib/content-fixtures.ts), so the message is proven against
 * what a real batch carries. Slack is a fake that records each call.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { toScheduledPost } from "../../shared/content/blog";
import {
  batchSummary,
  formatPublishAt,
  run,
  verdictFor,
} from "../../scripts/content/notify-batch";
import type { FetchLike } from "../../scripts/slack/client";
import {
  FIXTURE_APPROVALS,
  reviewRecord,
  scheduledSpec,
} from "../lib/content-fixtures";
import { REPO_ROOT } from "../lib/prerendered-site";

const POSTS = [
  toScheduledPost(
    scheduledSpec({
      slug: "post-b",
      publishAt: "2026-10-21T07:00",
      targetKeyword: "fixture b",
      page: { ...scheduledSpec().page, h1: "Post B & friends" },
    }),
    FIXTURE_APPROVALS,
  ),
  toScheduledPost(
    scheduledSpec({
      slug: "post-a",
      publishAt: "2026-10-19T07:00",
      targetKeyword: "fixture a",
      page: { ...scheduledSpec().page, h1: "Post A" },
    }),
    FIXTURE_APPROVALS,
  ),
];

const SELF = ["| `post-a` | pass | ok |", "| `post-b` | pass | ok |"];
const AUDITED = reviewRecord({
  self: SELF,
  source: "Codex scheduled task, 2026-10-15",
  codex: [
    '| `post-a` | APPROVE | Every claim cited. | https://satsuite.collegeboard.org/sat/dates-deadlines: "Nov. 7, 2026" |',
    '| `post-b` | REVISE | The deadline is wrong. | https://satsuite.collegeboard.org/sat/dates-deadlines: "Oct. 23, 2026" |',
  ],
  response: [
    "| `post-b` | The deadline is wrong. | Fixed: Oct. 23, 2026. | abc1234 |",
  ],
});
const PR = {
  number: "1200",
  url: "https://github.com/Lyceon-Team/lyceonai/pull/1200",
};

type Call = { url: string; body: string };
function fakeSlack(error?: string): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: String(init.body ?? "") });
    return {
      ok: true,
      status: 200,
      json: async () =>
        error ? { ok: false, error } : { ok: true, ts: "1760000000.000200" },
    };
  };
  return { fetch, calls };
}
function logs() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    log: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
  };
}
const ENV = {
  PR_NUMBER: PR.number,
  PR_URL: PR.url,
  SLACK_BOT_TOKEN: "xoxb-test-token-not-real",
  SLACK_CHANNEL_ID: "C0TESTCHAN1",
};
const CHANGED = ["content/batches/2026-W43/REVIEW.md"];

describe("the summary", () => {
  it("lists every post in publish order with its date, title and Codex verdict, then the link", () => {
    expect(
      batchSummary([{ cycle: "2026-W43", review: AUDITED }], POSTS, PR),
    ).toBe(
      [
        "*Content batch 2026-W43* is ready for Karl's review: 2 posts",
        "• Mon, Oct 19, 2026, 7:00 a.m. CT · Post A · Codex: APPROVE",
        "• Wed, Oct 21, 2026, 7:00 a.m. CT · Post B &amp; friends · Codex: REVISE (revised)",
        "<https://github.com/Lyceon-Team/lyceonai/pull/1200|Pull request #1200>",
      ].join("\n"),
    );
  });

  it("a batch Codex has not audited says so; a missing record says so", () => {
    const unaudited = reviewRecord({ self: SELF, codex: [], response: [] });
    expect(verdictFor(unaudited, "post-a")).toBe("not audited yet");
    expect(verdictFor(null, "post-a")).toBe("no review record");
    const revisedNot = reviewRecord({
      self: SELF,
      source: "Codex",
      codex: ["| `post-b` | REVISE | x | y |"],
      response: [],
    });
    expect(verdictFor(revisedNot, "post-b")).toBe("REVISE");
  });

  it("a monthly plan is one line with its verdict", () => {
    const plan = reviewRecord({
      self: ["| `plan` | pass | ok |"],
      source: "Codex",
      codex: ["| `plan` | APPROVE | Dates match College Board. | url |"],
      response: [],
    });
    expect(
      batchSummary([{ cycle: "2026-11-plan", review: plan }], [], PR),
    ).toBe(
      [
        "*Monthly content plan 2026-11* is ready for Karl's review",
        "• Plan · Codex: APPROVE",
        `<${PR.url}|Pull request #1200>`,
      ].join("\n"),
    );
  });

  it("formats Chicago wall times", () => {
    expect(formatPublishAt("2026-11-02T07:00")).toBe(
      "Mon, Nov 2, 2026, 7:00 a.m. CT",
    );
    expect(formatPublishAt("2026-11-02T13:30")).toBe(
      "Mon, Nov 2, 2026, 1:30 p.m. CT",
    );
  });
});

describe("the post", () => {
  it("posts exactly one message to the configured channel, with the summary", async () => {
    const slack = fakeSlack();
    const l = logs();
    const code = await run([], ENV, {
      changed: CHANGED,
      reviewOf: () => AUDITED,
      posts: POSTS,
      fetchImpl: slack.fetch,
      log: l.log,
    });
    expect(code).toBe(0);
    expect(slack.calls.map((c) => c.url)).toEqual([
      "https://slack.com/api/chat.postMessage",
    ]);
    const body = JSON.parse(slack.calls[0]?.body ?? "{}") as {
      channel: string;
      text: string;
    };
    expect(body.channel).toBe("C0TESTCHAN1");
    expect(body.text).toContain("Post A · Codex: APPROVE");
    expect(body.text).toContain(PR.url);
    // The log names the cycle and message, never the token.
    expect(l.out.join("\n")).toContain("posted 2026-W43");
    expect([...l.out, ...l.err].join("\n")).not.toContain("xoxb-");
  });

  it("a pull request without content posts nothing", async () => {
    const slack = fakeSlack();
    const l = logs();
    const code = await run([], ENV, {
      changed: ["client/src/App.tsx"],
      reviewOf: () => null,
      posts: POSTS,
      fetchImpl: slack.fetch,
      log: l.log,
    });
    expect(code).toBe(0);
    expect(slack.calls).toEqual([]);
  });

  it("a missing channel, or a Slack error, fails loudly", async () => {
    const noChannel = logs();
    const slack = fakeSlack();
    expect(
      await run(
        [],
        { ...ENV, SLACK_CHANNEL_ID: "" },
        {
          changed: CHANGED,
          reviewOf: () => AUDITED,
          posts: POSTS,
          fetchImpl: slack.fetch,
          log: noChannel.log,
        },
      ),
    ).toBe(1);
    expect(slack.calls).toEqual([]);
    expect(noChannel.err.join("\n")).toContain("SOCIAL_SLACK_CHANNEL_ID");

    const failing = logs();
    expect(
      await run([], ENV, {
        changed: CHANGED,
        reviewOf: () => AUDITED,
        posts: POSTS,
        fetchImpl: fakeSlack("not_in_channel").fetch,
        log: failing.log,
      }),
    ).toBe(1);
    expect(failing.err.join("\n")).toContain(
      "NOT POSTED: chat.postMessage: not_in_channel",
    );
  });

  it("--dry-run sends nothing and needs no token", async () => {
    const slack = fakeSlack();
    const l = logs();
    const code = await run(
      ["--dry-run"],
      { PR_NUMBER: PR.number, PR_URL: PR.url },
      {
        changed: CHANGED,
        reviewOf: () => AUDITED,
        posts: POSTS,
        fetchImpl: slack.fetch,
        log: l.log,
      },
    );
    expect(code).toBe(0);
    expect(slack.calls).toEqual([]);
    expect(l.out.join("\n")).toContain("Post A · Codex: APPROVE");
  });
});

describe("the workflow", () => {
  type Step = {
    name?: string;
    if?: string;
    env?: Record<string, string>;
    run?: string;
  };
  const wf = parseYaml(
    readFileSync(
      join(REPO_ROOT, ".github/workflows/content-batch-notify.yml"),
      "utf8",
    ),
  ) as {
    on: { pull_request: { types: string[]; branches: string[] } };
    jobs: { notify: { steps: Step[] } };
  };

  it("runs when a pull request into seo is marked ready, and only the post step holds the token", () => {
    expect(wf.on.pull_request).toEqual({
      types: ["ready_for_review"],
      branches: ["seo"],
    });
    const steps = wf.jobs.notify.steps;
    const post = steps.findIndex((s) => s.run?.includes("notify-batch.ts"));
    expect(post).toBeGreaterThan(-1);
    for (const [i, step] of steps.entries())
      expect(JSON.stringify(step).includes("secrets."), step.name).toBe(
        i === post,
      );
    expect(steps[post]?.env?.SLACK_CHANNEL_ID).toBe(
      "${{ vars.SOCIAL_SLACK_CHANNEL_ID }}",
    );
  });
});
