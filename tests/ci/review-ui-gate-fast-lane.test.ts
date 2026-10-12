/**
 * The fast lane runs the review UI plants a change touches; the full plant set is ci-full's.
 *
 * @spec [owner ruling 2026-10-11 (Karl, on #1204, option (b)): "When a PR changes the review-UI
 *       mutation harness (or anything that triggers the full plant set), the `ci` job skips the
 *       full plant run and prints that ci-full runs it; ci-full (parallel shards) is the gate.
 *       Keep the 25-minute ci limit."; owner decision 2026-10-07 (CI audit item 3)] |
 * @implemented [2026-10-11]
 *
 * plain English: reads the REAL ci.yml, takes the review UI gate step's own shell block and runs
 * it with bash in a scratch directory whose `scripts/ci/review-ui-gate.parallel.sh` is a recorder
 * (it writes down that it ran and which selection it was given). The step's inputs come from the
 * REAL path-groups script (scripts/ci/ci-path-groups.mjs) on a changed-file list, so a harness
 * edit is classified by the same code CI uses. Then:
 *   - a change to product code runs the driver on exactly that change's files;
 *   - a change to the harness, or an unknown change, never runs the driver here, passes, and says
 *     that ci-full runs the full set (and how to ask for it on a PR into cleanup);
 *   - ci-full really does run every plant: its shard jobs exist and nothing there narrows the set;
 *   - the ci job keeps its 25-minute limit.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { name?: string; run?: string; env?: Record<string, string> };
type Job = { "timeout-minutes"?: number; steps?: Step[]; strategy?: unknown };
type Workflow = { jobs: Record<string, Job> };

const ROOT = resolve(import.meta.dirname, "../..");
const ci = parse(
  readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8"),
) as Workflow;
const full = parse(
  readFileSync(resolve(ROOT, ".github/workflows/ci-full.yml"), "utf8"),
) as Workflow;

const ciJob = ci.jobs["ci"];
const gateStep = (ciJob?.steps ?? []).find((s) =>
  (s.name ?? "").startsWith("Review UI mutation gate"),
);

/** The real path-groups verdict for a changed-file list: is the full plant set selected? */
function allPlantsFor(changed: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ui-gate-groups-"));
  const list = join(dir, "changed.txt");
  writeFileSync(list, `${changed.join("\n")}\n`);
  const out = execFileSync("node", ["scripts/ci/ci-path-groups.mjs", list], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const line = out.split("\n").find((l) => l.startsWith("review_ui_gate="));
  if (line === undefined)
    throw new Error("ci-path-groups printed no review_ui_gate line");
  return line.slice("review_ui_gate=".length);
}

type Run = {
  status: number | null;
  stdout: string;
  driverRan: boolean;
  selection: string | null;
};

/** Runs the step's own block with a recording driver in place of the real one. */
function runStep(env: {
  CHANGED_KNOWN: string;
  CHANGED_FILES: string;
  ALL_PLANTS: string;
}): Run {
  const script = gateStep?.run;
  if (script === undefined)
    throw new Error("ci.yml has no review UI gate step block");
  const dir = mkdtempSync(join(tmpdir(), "ui-gate-step-"));
  mkdirSync(join(dir, "scripts/ci"), { recursive: true });
  mkdirSync(join(dir, "runner-temp"));
  const driver = join(dir, "scripts/ci/review-ui-gate.parallel.sh");
  writeFileSync(
    driver,
    [
      "#!/usr/bin/env bash",
      'echo ran > "$PWD/driver-ran"',
      'if [ -n "${REVIEW_UI_GATE_ONLY_CHANGED:-}" ]; then cat "$REVIEW_UI_GATE_ONLY_CHANGED" > "$PWD/driver-selection"; fi',
      "",
    ].join("\n"),
  );
  chmodSync(driver, 0o755);
  const r = spawnSync("bash", ["-e", "-c", script], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      RUNNER_TEMP: join(dir, "runner-temp"),
      ...env,
    },
  });
  const selectionFile = join(dir, "driver-selection");
  return {
    status: r.status,
    stdout: r.stdout,
    driverRan: existsSync(join(dir, "driver-ran")),
    selection: existsSync(selectionFile)
      ? readFileSync(selectionFile, "utf8")
      : null,
  };
}

const PRODUCT = [
  "client/src/pages/practice.tsx",
  "client/src/pages/practice.test.tsx",
];
const HARNESS = [
  "scripts/ci/review-ui-gate.mutations.sh",
  "client/src/pages/practice.tsx",
];

describe("ci: the review UI gate step (presence first)", () => {
  it("the ci job and its gate step exist, and the step reads the change inputs", () => {
    expect(ciJob).toBeDefined();
    expect(gateStep?.run).toContain(
      "bash scripts/ci/review-ui-gate.parallel.sh",
    );
    expect(gateStep?.env?.["ALL_PLANTS"]).toBe(
      "${{ needs.changes.outputs.review_ui_gate }}",
    );
    expect(gateStep?.env?.["CHANGED_KNOWN"]).toBe(
      "${{ needs.changes.outputs.changed_known }}",
    );
  });

  it("the path groups classify the cases as the scenarios below assume", () => {
    expect(allPlantsFor(PRODUCT)).toBe("false");
    expect(allPlantsFor(HARNESS)).toBe("true");
  });
});

describe("ci: a product change runs the plants it touches", () => {
  it("runs the driver on exactly the change's files", () => {
    const r = runStep({
      CHANGED_KNOWN: "true",
      CHANGED_FILES: PRODUCT.join("\n"),
      ALL_PLANTS: allPlantsFor(PRODUCT),
    });
    expect(r.status).toBe(0);
    expect(r.driverRan).toBe(true);
    expect(r.selection).toBe(`${PRODUCT.join("\n")}\n`);
  });
});

describe("ci: the full plant set is deferred to ci-full", () => {
  it.each([
    ["the harness changed", "true", HARNESS.join("\n"), allPlantsFor(HARNESS)],
    ["the change is unknown", "false", "", "true"],
    ["the change is unknown (groups not computed)", "false", "", "false"],
  ])(
    "%s: no plant runs here, the step passes and names ci-full",
    (_case, known, files, all) => {
      const r = runStep({
        CHANGED_KNOWN: known,
        CHANGED_FILES: files,
        ALL_PLANTS: all,
      });
      expect(r.status).toBe(0);
      expect(r.driverRan).toBe(false);
      expect(r.stdout).toContain(
        "Not run in this job: ci-full runs every plant across parallel shards (review-ui-gate-shard) and is the gate for this change.",
      );
      expect(r.stdout).toContain("add the ci:full label");
      expect(r.stdout).toContain(
        "::notice title=Review UI mutation gate deferred to ci-full::",
      );
    },
  );
});

describe("ci-full is the gate for the full set; ci keeps 25 minutes", () => {
  it("ci-full runs every plant across shard jobs, with no narrowing selection", () => {
    const shard = full.jobs["review-ui-gate-shard"];
    expect(shard?.strategy).toBeDefined();
    const runs = (shard?.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(runs).toContain("bash scripts/ci/review-ui-gate.parallel.sh");
    expect(
      readFileSync(resolve(ROOT, ".github/workflows/ci-full.yml"), "utf8"),
    ).not.toContain("REVIEW_UI_GATE_ONLY_CHANGED");
    expect(full.jobs["review-ui-gate"]).toBeDefined();
  });

  it("the ci job's limit stays at 25 minutes", () => {
    expect(ciJob?.["timeout-minutes"]).toBe(25);
  });
});
