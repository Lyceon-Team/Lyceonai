/**
 * @spec [owner standing rule — CR-STD-01 "zero scanned files is a broken gate, not a clean
 *   tree"; Coding Standards §17 (no silent failure); CLAUDE.md "Unified code across agents"
 *   — search for an existing canonical primitive and consume it, never fork a second]
 * @implemented 2026-08-21
 *
 * plain English: the one way a CI gate enumerates the committed tree. Every gate that scans
 * files consumes this; none of them re-implements it.
 *
 * WHY THIS EXISTS — A GATE THAT UNDER-SCANNED AND REPORTED CLEAN.
 *   `git ls-files` writes C-style QUOTED paths for any entry containing non-ASCII bytes:
 *
 *       postman/collections/Lyceon - APIs/.resources/definition.yaml          <- plain
 *       "postman/collections/Lyceon - APIs/\342\232\226\357\270\217 Legal/..." <- quoted
 *
 *   The previous implementation split on newline and then dropped any line that failed
 *   `existsSync`. The quoted form is not a path that exists on disk, so EVERY non-ASCII
 *   path was silently discarded — 81 of 830 candidate files in this repo, all of them under
 *   `postman/` (emoji folder names). The retired-endpoints gate reported "748 file(s)
 *   scanned, no caller remains" while a live Postman request pointed at a retired endpoint
 *   inside one of the 81.
 *
 *   That is this codebase's recurring defect wearing a new hat: a read that fails collapsing
 *   into a legitimate-looking answer. The scan did not error. It did not report a smaller
 *   number than expected. It reported a plausible number and a clean verdict.
 *
 *   `-z` is the fix: NUL-delimited output is never quoted and never escaped, so a path with
 *   an emoji, a space, or a newline in it survives verbatim.
 *
 * WHY `existsSync` SURVIVES, BUT LOUDLY.
 *   `git ls-files` lists the INDEX. A file deleted in the working tree but not yet staged is
 *   still listed, and `readFileSync` would throw ENOENT — which matters locally, never in CI
 *   (a fresh checkout cannot be in that state). So the guard stays, but the skipped paths are
 *   RETURNED rather than swallowed, and every caller prints them. The defect being fixed here
 *   is invisibility, not skipping: a named skip is auditable, a silent one is a false green.
 *
 * MUTATIONS THIS MUST CATCH (verified by each consuming gate's self-test):
 *   - drop `-z` / split on newline again  -> the non-ASCII-path case goes red
 *   - re-add a silent `existsSync` filter -> skipped paths stop being reported
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * @param {{ repoRoot: string, pathspec: string[], exclude?: Set<string> }} options
 * @returns {{ files: string[], skippedMissing: string[] }}
 *   `files` are repo-relative paths that exist on disk and are not excluded.
 *   `skippedMissing` are tracked paths absent from the working tree — never silently
 *   dropped; the caller is expected to report them.
 */
export function listTrackedFiles({ repoRoot, pathspec, exclude = new Set() }) {
  // -z: NUL-delimited, so git never quotes or backslash-escapes a path. Without it, any
  // entry with a non-ASCII byte comes back as a quoted literal that matches nothing on disk.
  const out = execFileSync("git", ["ls-files", "-z", "--", ...pathspec], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  // No .trim() anywhere: with -z there is no delimiter whitespace to strip, and a path may
  // legitimately begin or end with a space. Trimming would corrupt exactly those names.
  const tracked = out.split("\0").filter((entry) => entry.length > 0);

  const files = [];
  const skippedMissing = [];
  for (const entry of tracked) {
    if (exclude.has(entry)) {
      continue;
    }
    if (existsSync(resolve(repoRoot, entry))) {
      files.push(entry);
    } else {
      skippedMissing.push(entry);
    }
  }
  return { files, skippedMissing };
}

/**
 * The one place a gate turns a pathspec override string into an argv array. Shared so two
 * gates cannot disagree about how their *_PATHSPEC env var is split.
 */
export function parsePathspecOverride(value, fallback) {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  const parts = value.split(/\s+/).filter((part) => part.length > 0);
  return parts.length > 0 ? parts : fallback;
}
