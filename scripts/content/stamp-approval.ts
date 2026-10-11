/**
 * Stamps Karl's approval of a content cycle from the merge of its batch pull request.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §2.4 ("Karl's approval is a merge of the batch pull
 *       request"), §8.7 ("Triggers never merge"); owner answer on Doc 10B Phase 1 Step 0, item 1
 *       (Karl, 2026-10-11): "merge alone counts … a plain workflow script stamps the approval from
 *       the merge event … No extra click."]; owner brief 2026-10-11 ("change how the approval is
 *       recorded so it doesn't need a direct push to a protected branch"): the stamp is pushed with
 *       a GitHub App token that the `social` ruleset bypass-lists, from a push-triggered job in an
 *       Environment only `social` can use] | @implemented [2026-10-11]
 *
 * plain English: run by .github/workflows/content-batch-approval.yml on every push to `social`.
 * It reads the merge from GitHub's own record of the pull request behind the pushed commit
 * (mergeEventFromPull), so the merge it stamps is Karl's click, not anything the pull request
 * contains. For each cycle the merged pull request touched, it writes
 * `{ by: "Karl", date, pr, mergedBy, mergeSha }` into content/batches/approvals.json, the one file
 * the site reads approval from (shared/content/approvals.ts). It stamps only a merge by the
 * approver (`CONTENT_APPROVER_LOGIN`, a repository variable naming Karl's GitHub account): any
 * other merger, or no variable, writes nothing and exits 1 so the run is red and visible.
 *
 * Inputs (environment): STAMP_PULL_JSON (GitHub's record of the pull request the pushed commit
 * belongs to, empty if none), STAMP_PUSH_SHA, STAMP_CHANGED_FILES (newline-separated paths),
 * CONTENT_APPROVER_LOGIN.
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
import { z } from "zod";
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

/**
 * The fields of GitHub's pull request object (REST `GET /repos/{owner}/{repo}/pulls/{number}`)
 * the stamp reads. Everything else in the response is ignored.
 */
const mergedPullSchema = z.object({
  number: z.number().int().positive(),
  merged_at: z.string().nullable(),
  merge_commit_sha: z.string().nullable(),
  merged_by: z.object({ login: z.string().min(1) }).nullable(),
  base: z.object({ ref: z.string().min(1) }),
});

/**
 * The merge a push to `social` carries, from GitHub's own record of the pull request, or the
 * reason there is none.
 *
 * plain English: the stamp job runs on every push to `social` (the only way it can hold the
 * App key; see .github/workflows/content-batch-approval.yml). It asks GitHub which pull request
 * the pushed commit belongs to and reads the merge from GitHub's record, not from anything the
 * pull request itself contains. It counts only when that pull request is merged and its merge
 * commit IS the pushed commit; otherwise (no pull request: the App's own stamp commit, or a
 * push that merged nothing) there is nothing to stamp.
 */
export function mergeEventFromPull(
  pull: unknown,
  pushSha: string,
  changedFiles: readonly string[],
): { ok: true; event: MergeEvent } | { ok: false; reason: string } {
  const parsed = mergedPullSchema.safeParse(pull);
  if (!parsed.success)
    return { ok: false, reason: "no pull request record for this push" };
  const pr = parsed.data;
  if (pr.merged_at === null || pr.merged_by === null)
    return { ok: false, reason: `pull request #${pr.number} is not merged` };
  if (pr.merge_commit_sha !== pushSha)
    return {
      ok: false,
      reason: `pull request #${pr.number} was not merged by this push (${pushSha.slice(0, 7)})`,
    };
  return {
    ok: true,
    event: {
      pr: pr.number,
      base: pr.base.ref,
      mergedBy: pr.merged_by.login,
      mergedAt: pr.merged_at,
      mergeSha: pr.merge_commit_sha,
      changedFiles,
    },
  };
}

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
  const pullJson = env.STAMP_PULL_JSON?.trim() ?? "";
  const merge = mergeEventFromPull(
    pullJson === "" ? null : JSON.parse(pullJson),
    env.STAMP_PUSH_SHA ?? "",
    (env.STAMP_CHANGED_FILES ?? "").split("\n").filter(Boolean),
  );
  if (!merge.ok) {
    // Not a batch merge (the App's own stamp commit, or a push that merged no pull request):
    // nothing to approve, and nothing wrong.
    process.stdout.write(`stamp-approval: ${merge.reason}; nothing to stamp\n`);
    return;
  }
  const result = stampApprovals(
    current,
    merge.event,
    env.CONTENT_APPROVER_LOGIN?.trim() || undefined,
  );
  if (!result.ok) {
    process.stderr.write(`stamp-approval: ${result.error}\n`);
    process.exit(1);
  }
  writeFileSync(file, serializeApprovals(result.approvals));
  process.stdout.write(
    result.stamped.length > 0
      ? `stamp-approval: approved ${result.stamped.join(", ")} (PR #${merge.event.pr})\n`
      : "stamp-approval: nothing new to stamp\n",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
