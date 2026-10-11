/**
 * CI check for a pull request into `seo` that carries content (Doc 10B §8.7).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §8.7; owner brief "Doc 10B Phase 1" (Karl, 2026-10-11) scope 2;
 *       owner answers on Step 0, items 1 and 3] | @implemented [2026-10-11]
 *
 * plain English: run by .github/workflows/content-batch-checks.yml on every pull request into
 * `seo`, as a draft and when marked ready. It fails when:
 *  - the pull request edits content/batches/approvals.json (only the merge workflow writes it);
 *  - a cycle the pull request touches (a content/batches/<cycle>/ file, or a post whose `batch`
 *    is that cycle) has no REVIEW.md, or its REVIEW.md breaks the rules in ./review-record.ts
 *    (draft: the self-audit; ready: also the Codex audit and Claude's responses);
 *  - a commit marked `Audit-By: Codex` changes anything but the Codex section of a review record;
 *  - a Codex section copied from a pull request comment does not match that comment, or the
 *    comment is not Codex's.
 * Environment: BASE_SHA, HEAD_SHA, PR_DRAFT ("true"/"false"), GH_TOKEN and GITHUB_REPOSITORY (to
 * read a Codex comment). Prints every problem; exits 1 if there is any.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_BLOG_POSTS } from "../../shared/content/blog";
import { APPROVALS_PATH, cyclesTouched } from "./stamp-approval";
import {
  codexCommitProblems,
  copiedCommentProblems,
  reviewRecordProblems,
  reviewSections,
} from "./review-record";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

/** The items a cycle carries now: post slugs, or `plan` for a monthly plan. */
export function cycleItems(cycle: string): string[] {
  if (cycle.endsWith("-plan")) return ["plan"];
  return ALL_BLOG_POSTS.filter((p) => p.batch === cycle).map((p) => p.slug);
}

/** The cycles a change set concerns: batch folders touched, and the batches of posts touched. */
export function cyclesConcerned(changed: readonly string[]): string[] {
  const cycles = new Set(cyclesTouched(changed));
  for (const file of changed) {
    const m = /^shared\/content\/posts\/([a-z0-9-]+)\.ts$/.exec(file);
    const post = m?.[1]
      ? ALL_BLOG_POSTS.find((p) => p.slug === m[1])
      : undefined;
    if (post?.batch) cycles.add(post.batch);
  }
  return [...cycles].sort();
}

const COMMENT_URL =
  /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/\d+#issuecomment-(\d+)/;

function codexCommentProblems(codexSection: string): string[] {
  const m = COMMENT_URL.exec(/^Source:\s*(.+)$/m.exec(codexSection)?.[1] ?? "");
  if (!m) return [];
  const raw = execFileSync(
    "gh",
    [
      "api",
      `repos/${m[1]}/issues/comments/${m[2]}`,
      "--jq",
      "{login: .user.login, body: .body}",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  const comment = JSON.parse(raw) as { login: string; body: string };
  const problems = copiedCommentProblems(codexSection, comment.body);
  if (!/codex/i.test(comment.login)) {
    problems.push(
      `the Codex audit is copied from a comment by ${comment.login}, not by Codex`,
    );
  }
  return problems;
}

function main(): void {
  const base = process.env.BASE_SHA ?? "";
  const head = process.env.HEAD_SHA ?? "HEAD";
  const ready = process.env.PR_DRAFT === "false";
  const changed = git("diff", "--name-only", `${base}...${head}`)
    .split("\n")
    .filter(Boolean);
  const problems: string[] = [];

  if (changed.includes(APPROVALS_PATH)) {
    problems.push(
      `${APPROVALS_PATH} is changed by hand; only the merge workflow writes it`,
    );
  }

  for (const cycle of cyclesConcerned(changed)) {
    const path = join("content", "batches", cycle, "REVIEW.md");
    if (!existsSync(join(ROOT, path))) {
      problems.push(`cycle ${cycle} has no review record (${path})`);
      continue;
    }
    const text = readFileSync(join(ROOT, path), "utf8");
    for (const p of reviewRecordProblems(text, {
      items: cycleItems(cycle),
      ready,
    })) {
      problems.push(`${path}: ${p}`);
    }
    if (ready) {
      for (const p of codexCommentProblems(reviewSections(text)[1] ?? ""))
        problems.push(`${path}: ${p}`);
    }
  }

  const codexCommits = git("log", "--format=%H%x09%B%x1e", `${base}..${head}`)
    .split("\x1e")
    .map((c) => c.trim())
    .filter((c) => /^Audit-By:\s*Codex\s*$/im.test(c))
    .map((c) => c.split("\t")[0] ?? "");
  for (const sha of codexCommits) {
    const files = git("diff-tree", "--no-commit-id", "--name-only", "-r", sha)
      .split("\n")
      .filter(Boolean);
    // A file added or deleted by the commit has no text on one side of it.
    const show = (rev: string, path: string): string =>
      git("ls-tree", "--name-only", rev, "--", path).trim() === path
        ? git("show", `${rev}:${path}`)
        : "";
    const changes = files.map((path) => ({
      path,
      before: show(`${sha}^`, path),
      after: show(sha, path),
    }));
    for (const p of codexCommitProblems(changes))
      problems.push(`${sha.slice(0, 7)}: ${p}`);
  }

  if (problems.length > 0) {
    process.stderr.write(`CONTENT BATCH CHECK FAILED (${problems.length}):\n`);
    for (const p of problems) process.stderr.write(`  - ${p}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `CONTENT BATCH CHECK OK (${ready ? "ready" : "draft"}; ${changed.length} files)\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
