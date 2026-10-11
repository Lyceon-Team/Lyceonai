/**
 * Stamps Karl's approval of a content cycle from the merge of its batch pull request.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §2.4 ("Karl's approval is a merge of the batch pull
 *       request"), §8.7 ("Triggers never merge"); owner answer on Doc 10B Phase 1 Step 0, item 1
 *       (Karl, 2026-10-11): "merge alone counts … a plain workflow script stamps the approval from
 *       the merge event … No extra click."] | @implemented [2026-10-11]
 *
 * plain English: run by .github/workflows/content-batch-approval.yml when a pull request into `social`
 * that touches `content/batches/<cycle>/` is merged. For each cycle it touched, it writes
 * `{ by: "Karl", date, pr, mergedBy, mergeSha }` into content/batches/approvals.json, the one file
 * the site reads approval from (shared/content/approvals.ts). It stamps only a merge by the
 * approver (`CONTENT_APPROVER_LOGIN`, a repository variable naming Karl's GitHub account): any
 * other merger, or no variable, writes nothing and exits 1 so the run is red and visible.
 *
 * Inputs (environment): STAMP_PR, STAMP_BASE, STAMP_MERGED_BY, STAMP_MERGED_AT (ISO), STAMP_MERGE_SHA,
 * STAMP_CHANGED_FILES (newline-separated paths), CONTENT_APPROVER_LOGIN.
 *
 * edge cases:
 *  - A cycle already stamped keeps its first stamp (a re-run changes nothing).
 *  - The approvals file itself in the changed files means someone edited it by hand in the pull
 *    request; that is refused (the guard in CI should already have failed the PR).
 *  - The date is the merge day in America/Chicago, the content schedule's time zone.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTENT_BRANCH,
  approvalsFileSchema,
  contentCycleSchema,
  type ApprovalsFile,
} from "../../shared/content/approvals";
import { chicagoToday } from "../../shared/sat-test-dates";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const APPROVALS_PATH = "content/batches/approvals.json";

export type MergeEvent = {
  pr: number;
  /** The branch the pull request was merged into; only CONTENT_BRANCH approves a cycle. */
  base: string;
  mergedBy: string;
  mergedAt: string;
  mergeSha: string;
  changedFiles: readonly string[];
};

export type StampResult =
  | { ok: true; approvals: ApprovalsFile; stamped: string[] }
  | { ok: false; error: string };

/** The cycles a pull request touched: every `content/batches/<cycle>/…` path. */
export function cyclesTouched(changedFiles: readonly string[]): string[] {
  const cycles = new Set<string>();
  for (const file of changedFiles) {
    const m = /^content\/batches\/([^/]+)\//.exec(file);
    if (m?.[1] && contentCycleSchema.safeParse(m[1]).success) cycles.add(m[1]);
  }
  return [...cycles].sort();
}

/** Pure: the approvals file after this merge, or why nothing may be stamped. */
export function stampApprovals(
  current: Readonly<ApprovalsFile>,
  event: MergeEvent,
  approverLogin: string | undefined,
): StampResult {
  if (!approverLogin) {
    return {
      ok: false,
      error: "CONTENT_APPROVER_LOGIN is not set: no approval recorded",
    };
  }
  if (event.mergedBy !== approverLogin) {
    return {
      ok: false,
      error: `merged by ${event.mergedBy}, not the approver (${approverLogin}): no approval recorded`,
    };
  }
  if (event.base !== CONTENT_BRANCH) {
    return {
      ok: false,
      error: `merged into ${event.base}, not ${CONTENT_BRANCH}: content is approved only from ${CONTENT_BRANCH}`,
    };
  }
  if (event.changedFiles.includes(APPROVALS_PATH)) {
    return {
      ok: false,
      error: `the pull request edits ${APPROVALS_PATH} by hand: refused`,
    };
  }
  const mergedAt = new Date(event.mergedAt);
  if (Number.isNaN(mergedAt.getTime())) {
    return { ok: false, error: `merged_at is not a date: ${event.mergedAt}` };
  }
  const next: ApprovalsFile = { ...current };
  const stamped: string[] = [];
  for (const cycle of cyclesTouched(event.changedFiles)) {
    if (next[cycle]) continue;
    next[cycle] = {
      by: "Karl",
      date: chicagoToday(mergedAt),
      pr: event.pr,
      mergedBy: event.mergedBy,
      mergeSha: event.mergeSha,
    };
    stamped.push(cycle);
  }
  const parsed = approvalsFileSchema.safeParse(next);
  if (!parsed.success)
    return { ok: false, error: `invalid stamp: ${parsed.error.message}` };
  return { ok: true, approvals: parsed.data, stamped };
}

/** The file's text: sorted keys, two-space JSON, trailing newline (stable diffs). */
export function serializeApprovals(approvals: Readonly<ApprovalsFile>): string {
  const sorted = Object.fromEntries(
    Object.entries(approvals).sort(([a], [b]) => a.localeCompare(b)),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/**
 * Whether a pull request changed the stamps by hand (Doc 10B §2.4: only the merge workflow
 * writes them). Compares the stamps, not the bytes: a missing file reads as `{}`, so the pull
 * request that first adds the empty file passes, and any stamp added, edited or removed fails.
 * `before`/`after` are the file's text at the base and the head, or null where it is absent.
 */
export function approvalsEditProblem(
  before: string | null,
  after: string | null,
): string | null {
  const read = (text: string | null): string | null => {
    if (text === null) return serializeApprovals({});
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e: unknown) {
      // Unparseable JSON is a finding (null); anything else is a bug, so it propagates.
      if (e instanceof SyntaxError) return null;
      throw e;
    }
    const parsed = approvalsFileSchema.safeParse(raw);
    return parsed.success ? serializeApprovals(parsed.data) : null;
  };
  const a = read(after);
  if (a === null) return `${APPROVALS_PATH} is not a valid approvals file`;
  return a === read(before)
    ? null
    : `${APPROVALS_PATH} is changed by hand; only the merge workflow writes it`;
}

function main(): void {
  const env = process.env;
  const file = join(ROOT, APPROVALS_PATH);
  const current = approvalsFileSchema.parse(
    JSON.parse(readFileSync(file, "utf8")),
  );
  const result = stampApprovals(
    current,
    {
      pr: Number(env.STAMP_PR),
      base: env.STAMP_BASE ?? "",
      mergedBy: env.STAMP_MERGED_BY ?? "",
      mergedAt: env.STAMP_MERGED_AT ?? "",
      mergeSha: env.STAMP_MERGE_SHA ?? "",
      changedFiles: (env.STAMP_CHANGED_FILES ?? "").split("\n").filter(Boolean),
    },
    env.CONTENT_APPROVER_LOGIN?.trim() || undefined,
  );
  if (!result.ok) {
    process.stderr.write(`stamp-approval: ${result.error}\n`);
    process.exit(1);
  }
  writeFileSync(file, serializeApprovals(result.approvals));
  process.stdout.write(
    result.stamped.length > 0
      ? `stamp-approval: approved ${result.stamped.join(", ")} (PR #${env.STAMP_PR})\n`
      : "stamp-approval: nothing new to stamp\n",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
