/**
 * Posts a content batch's summary to Slack #social when its pull request is marked ready.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §8.7; owner brief "Doc 10B Phase 1 — blog pipeline" (Karl,
 *       2026-10-11) scope 4: "when a batch PR is marked ready, post a summary to Slack #social
 *       (titles, publish dates, Codex verdicts, PR link) using the bot-token convention"; owner
 *       answers 11 (one SOCIAL_SLACK_CHANNEL_ID) and 12 (duplicate posts accepted)]
 *       | @implemented [2026-10-11]
 *
 * Usage (from .github/workflows/content-batch-notify.yml):
 *   pnpm exec tsx scripts/content/notify-batch.ts [--dry-run]
 *   env: BASE_SHA, HEAD_SHA, PR_NUMBER, PR_URL; SLACK_BOT_TOKEN and SLACK_CHANNEL_ID (not needed
 *   for --dry-run). The Slack settings are read by scripts/slack/client.ts (docs/runbooks/slack.md).
 *
 * plain English: finds the cycles the pull request carries (the same rule the review-record check
 * uses), then for each cycle lists its posts in publish order: the date and time it goes live,
 * the title, and Codex's verdict from REVIEW.md ("not audited yet" when Codex has not written,
 * "revised" when Claude answered a REVISE). A monthly plan is one line with its verdict. The
 * message ends with the pull request link. Titles, dates and verdicts only: no post text, no
 * reasons, nothing about students. A pull request without content posts nothing. Not idempotent:
 * marking a pull request ready twice posts twice (owner answer 12, 2026-10-11: accepted).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_BLOG_POSTS, type BlogPost } from "../../shared/content/blog";
import { formatSatTestDate } from "../../shared/sat-test-dates";
import {
  escapeMrkdwn,
  postMessage,
  slackConfig,
  type FetchLike,
} from "../slack/client";
import { cyclesConcerned } from "./check-batch-pr";
import { itemOf, reviewSections, tableRows } from "./review-record";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type CycleSummary = {
  cycle: string;
  /** The review record's text, or null when the cycle has none. */
  review: string | null;
};

/** Codex's verdict on `item` as the summary shows it. */
export function verdictFor(review: string | null, item: string): string {
  if (review === null) return "no review record";
  const [, codex, response] = reviewSections(review);
  const row = tableRows(codex ?? "").find((r) => itemOf(r[0]) === item);
  const verdict = row?.[1]?.trim().toUpperCase() ?? "";
  if (!["APPROVE", "REVISE", "REJECT"].includes(verdict))
    return "not audited yet";
  const answered = tableRows(response ?? "").some((r) => itemOf(r[0]) === item);
  return verdict === "REVISE" && answered ? "REVISE (revised)" : verdict;
}

/** "Mon, Oct 19, 2026, 7:00 a.m. CT" for a Chicago wall time `YYYY-MM-DDTHH:mm`. */
export function formatPublishAt(publishAt: string): string {
  const [date = "", time = ""] = publishAt.split("T");
  const [h = 0, m = 0] = time.split(":").map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${formatSatTestDate(date)}, ${hour12}:${String(m).padStart(2, "0")} ${h < 12 ? "a.m." : "p.m."} CT`;
}

/** The Slack message for a ready batch pull request. */
export function batchSummary(
  cycles: readonly CycleSummary[],
  posts: readonly BlogPost[],
  pr: { number: string; url: string },
): string {
  const lines: string[] = [];
  for (const { cycle, review } of cycles) {
    if (cycle.endsWith("-plan")) {
      lines.push(
        `*Monthly content plan ${cycle.replace(/-plan$/, "")}* is ready for Karl's review`,
        `• Plan · Codex: ${verdictFor(review, "plan")}`,
      );
      continue;
    }
    const items = posts
      .filter((p) => p.batch === cycle)
      .sort((a, b) =>
        (a.page.publishAt ?? "").localeCompare(b.page.publishAt ?? ""),
      );
    lines.push(
      `*Content batch ${cycle}* is ready for Karl's review: ${items.length} post${items.length === 1 ? "" : "s"}`,
    );
    for (const post of items) {
      lines.push(
        `• ${post.page.publishAt ? formatPublishAt(post.page.publishAt) : "no publish date"} · ${escapeMrkdwn(post.page.h1)} · Codex: ${verdictFor(review, post.slug)}`,
      );
    }
  }
  lines.push(`<${pr.url}|Pull request #${pr.number}>`);
  return lines.join("\n");
}

function reviewOf(cycle: string): string | null {
  const path = join(ROOT, "content", "batches", cycle, "REVIEW.md");
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** The whole command, injectable for tests. Returns the exit code. */
export async function run(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  deps: {
    changed: readonly string[];
    reviewOf: (cycle: string) => string | null;
    posts: readonly BlogPost[];
    fetchImpl: FetchLike;
    log: { out(line: string): void; err(line: string): void };
  },
): Promise<number> {
  const { log } = deps;
  const prNumber = env.PR_NUMBER?.trim() ?? "";
  const prUrl = env.PR_URL?.trim() ?? "";
  if (!/^\d+$/.test(prNumber) || !prUrl.startsWith("https://github.com/")) {
    log.err("content-notify: PR_NUMBER and PR_URL must be set");
    return 1;
  }
  const cycles = cyclesConcerned(deps.changed);
  if (cycles.length === 0) {
    log.out("content-notify: no content in this pull request; nothing posted");
    return 0;
  }
  const text = batchSummary(
    cycles.map((cycle) => ({ cycle, review: deps.reviewOf(cycle) })),
    deps.posts,
    { number: prNumber, url: prUrl },
  );
  if (argv.includes("--dry-run")) {
    log.out(`content-notify: dry run, nothing sent:\n${text}`);
    return 0;
  }
  const config = slackConfig(env);
  if (!config.ok) {
    log.err(`content-notify: not posted: ${config.error}`);
    return 1;
  }
  try {
    const ts = await postMessage(config.value, text, deps.fetchImpl);
    log.out(
      `content-notify: posted ${cycles.join(", ")} (pull request #${prNumber}), message ${ts}`,
    );
    return 0;
  } catch (e: unknown) {
    log.err(
      `content-notify: NOT POSTED: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const base = process.env.BASE_SHA ?? "";
  const head = process.env.HEAD_SHA ?? "";
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", `${base}...${head}`],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  run(process.argv.slice(2), process.env, {
    changed,
    reviewOf,
    posts: ALL_BLOG_POSTS,
    fetchImpl: (url, init) => fetch(url, init),
    log: {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    },
  }).then(
    (code) => process.exit(code),
    (e: unknown) => {
      process.stderr.write(
        `content-notify: failed: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      process.exit(1);
    },
  );
}
