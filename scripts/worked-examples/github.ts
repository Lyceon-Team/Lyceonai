/**
 * GitHub reads for worked-example approval: the commit that last changed an example's folder on
 * `social`, and GitHub's own record of the pull request that commit merged.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27) cadence ("Karl
 *       merges"); docs/Spec/Lyceon_Doc_10B.md §2.4] | @implemented [2026-10-27]
 *
 * plain English: IO only; the decision is approvalFromRecord (./approval.ts). The token is the
 * workflow's GITHUB_TOKEN (contents: read is enough) and is never logged.
 */
import { execFileSync } from "node:child_process";

/** GitHub's record of the pull request a commit was merged by, or null if it belongs to none. */
export async function pullForCommit(
  repo: string,
  sha: string,
  token: string,
): Promise<unknown> {
  const get = async (path: string): Promise<unknown> => {
    const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status}`);
    return res.json();
  };
  const pulls = await get(`commits/${sha}/pulls`);
  if (!Array.isArray(pulls))
    throw new Error("GitHub commits/pulls did not return a list");
  const merged = pulls.find(
    (p: unknown) =>
      typeof p === "object" &&
      p !== null &&
      "merge_commit_sha" in p &&
      p.merge_commit_sha === sha,
  );
  if (
    typeof merged !== "object" ||
    merged === null ||
    !("number" in merged) ||
    typeof merged.number !== "number"
  )
    return null;
  return get(`pulls/${merged.number}`);
}

/** The first-parent commit on `social` that last changed the example's folder. */
export function folderCommit(contentRoot: string, dir: string): string {
  return execFileSync(
    "git",
    [
      "-C",
      contentRoot,
      "log",
      "-1",
      "--first-parent",
      "--format=%H",
      "--",
      dir,
    ],
    {
      encoding: "utf8",
    },
  ).trim();
}
