/**
 * One shared scenario for the content-pipeline tests (Doc 10B Phase 1): a real post's page re-cut
 * as a pipeline post, built by the real producer (toScheduledPost), so every test reads the shape
 * the site renders (CLAUDE.md "derive the fixture from real output"; "one scenario, shared").
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_BLOG_POSTS } from "../../shared/content/blog";
import type { ApprovalsFile } from "../../shared/content/approvals";
import type { ScheduledPostSpec } from "../../shared/content/posts/types";
import { REPO_ROOT } from "./prerendered-site";

export const FIXTURE_MERGE_SHA = "a".repeat(40);

/** Cycle 2026-W43 merged by Karl on Friday 2026-10-16. */
export const FIXTURE_APPROVALS: ApprovalsFile = {
  "2026-W43": {
    by: "Karl",
    date: "2026-10-16",
    pr: 1200,
    mergedBy: "kingk237",
    mergeSha: FIXTURE_MERGE_SHA,
  },
};

/** A real post's page as a pipeline post in cycle 2026-W43, Monday 2026-10-19 07:00 Chicago. */
export function scheduledSpec(
  over: Partial<ScheduledPostSpec> = {},
): ScheduledPostSpec {
  const source = ALL_BLOG_POSTS[0];
  if (!source) throw new Error("no blog post to derive a fixture from");
  const {
    path: _p,
    published: _pub,
    lastModified: _lm,
    approved: _a,
    crumb: _c,
    publishAt: _pa,
    targetKeyword: _tk,
    ...page
  } = source.page;
  return {
    slug: "scheduled-fixture",
    category: source.category,
    tags: source.tags,
    batch: "2026-W43",
    publishAt: "2026-10-19T07:00",
    targetKeyword: "scheduled fixture keyword",
    page: {
      ...page,
      h1: "A scheduled fixture post",
      title: "A scheduled fixture post | Lyceon",
    },
    ...over,
  };
}

const TEMPLATE = readFileSync(
  join(REPO_ROOT, "content/batches/REVIEW.template.md"),
  "utf8",
);

export type ReviewRows = {
  self: string[];
  source?: string;
  codex: string[];
  response: string[];
};

/**
 * The real review record template (content/batches/REVIEW.template.md) for cycle 2026-W43, PR
 * #1200, with each section's placeholder row replaced by `rows` (none = header only). */
export function reviewRecord(rows: ReviewRows): string {
  const lines = TEMPLATE.replace(/CYCLE/g, "2026-W43")
    .replace("#PR", "#1200")
    .split("\n");
  const out: string[] = [];
  let section = -1;
  for (const line of lines) {
    if (line.startsWith("## 1.")) section = 0;
    else if (line.startsWith("## 2.")) section = 1;
    else if (line.startsWith("## 3.")) section = 2;
    else if (line.startsWith("## 4.")) section = 3;
    if (line.startsWith("| `slug` |")) {
      out.push(...([rows.self, rows.codex, rows.response][section] ?? []));
      continue;
    }
    if (
      section === 1 &&
      line.startsWith("Source:") &&
      rows.source !== undefined
    ) {
      out.push(`Source: ${rows.source}`);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}
