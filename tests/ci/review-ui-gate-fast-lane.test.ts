/**
 * The fast lane runs the review UI plants a change touches; the full plant set is ci-full's.
 *
 * @spec [owner ruling 2026-10-11 (Karl, on #1204, option (b)): "When a PR changes the review-UI
 *       mutation harness (or anything that triggers the full plant set), the `ci` job skips the
 *       full plant run and prints that ci-full runs it; ci-full (parallel shards) is the gate.
 *       Keep the 25-minute ci limit."; owner decision 2026-10-07 (CI audit item 3)] |
 * @implemented [2026-10-11; changed-file list moved from an env var to an artifact 2026-11-02] |
 *
 * plain English: reads the REAL ci.yml, takes the review UI gate step's own shell block and runs
 * it with bash in a scratch directory whose `scripts/ci/review-ui-gate.parallel.sh` is a recorder
 * (it writes down that it ran and which selection it was given). The step's environment is
 * resolved from the step's OWN `env:` map — each `${{ needs.changes.outputs.X }}` from a fixture
 * of the `changes` job's outputs, which must be declared there — so whatever the workflow puts in
 * the environment, this test puts in the environment. The changed-file list is placed where the
 * workflow's download step puts the `ci-changed-files` artifact. The path-groups verdict comes
 * from the REAL scripts/ci/ci-path-groups.mjs. Then:
 *   - a change to product code runs the driver on exactly that change's files;
 *   - a change of several thousand files (a sync PR; #1388 diffed ~3,640 on 2026-11-02) still
 *     starts and selects exactly those files, where the pre-fix step, which carried the list in
 *     an env var, is reproduced failing to start (E2BIG) on the same list;
 *   - a known change whose artifact is missing fails closed and never guesses a selection;
 *   - a change to the harness, or an unknown change, never runs the driver here, passes, and says
 *     that ci-full runs the full set (and how to ask for it on a PR into cleanup);
 *   - the list travels as an artifact end to end: the `changes` job uploads the file its scope
 *     script writes, the `ci` job downloads that artifact before the gate, and no workflow passes
 *     the list as a job output or env var or interpolates anything into the gate's script;
 *   - ci-full really does run every plant: its shard jobs exist and nothing there narrows the set;
 *   - the ci job keeps its 25-minute limit.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  env?: Record<string, string>;
};
type Job = {
  "timeout-minutes"?: number;
  outputs?: Record<string, string>;
  steps?: Step[];
  strategy?: unknown;
};
type Workflow = { jobs: Record<string, Job> };

const ROOT = resolve(import.meta.dirname, "../..");
const WORKFLOWS = resolve(ROOT, ".github/workflows");
const ci = parse(readFileSync(join(WORKFLOWS, "ci.yml"), "utf8")) as Workflow;
const full = parse(
  readFileSync(join(WORKFLOWS, "ci-full.yml"), "utf8"),
) as Workflow;

const ARTIFACT = "ci-changed-files";
const changesJob = ci.jobs["changes"];
const changesSteps = changesJob?.steps ?? [];
const ciJob = ci.jobs["ci"];
const ciSteps = ciJob?.steps ?? [];
const gateIndex = ciSteps.findIndex((s) =>
  (s.name ?? "").startsWith("Review UI mutation gate"),
);
const gateStep = ciSteps[gateIndex];
const downloadIndex = ciSteps.findIndex(
  (s) =>
    (s.uses ?? "").startsWith("actions/download-artifact@") &&
    s.with?.["name"] === ARTIFACT,
);
const downloadStep = ciSteps[downloadIndex];
const uploadStep = changesSteps.find(
  (s) =>
    (s.uses ?? "").startsWith("actions/upload-artifact@") &&
    s.with?.["name"] === ARTIFACT,
);
const scopeStep = changesSteps.find((s) => s.id === "scope");

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

/** Fixture values for the `changes` job's outputs. `changed_files` is the list as the pre-fix
 *  job output carried it: a regression that reads that output again resolves it here, at full
 *  size, provided the job declares it. */
type Outputs = Record<string, string>;

/** Resolves a workflow expression the way the runner would, for the expressions this step may
 *  use. Anything else, or an output the `changes` job does not declare, throws. */
function resolveExpr(
  value: string,
  outputs: Outputs,
  runnerTemp: string,
): string {
  return value.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_m, expr: string) => {
    if (expr === "runner.temp") return runnerTemp;
    const m = /^needs\.changes\.outputs\.([a-z_]+)$/.exec(expr);
    const name = m?.[1];
    if (name === undefined) throw new Error(`unresolvable expression: ${expr}`);
    if (changesJob?.outputs?.[name] === undefined)
      throw new Error(`the changes job declares no output ${name}`);
    const v = outputs[name];
    if (v === undefined) throw new Error(`no fixture value for output ${name}`);
    return v;
  });
}

type Run = {
  status: number | null;
  errorCode: string | undefined;
  stdout: string;
  driverRan: boolean;
  selection: string | null;
};

const RECORDER = [
  "#!/usr/bin/env bash",
  'echo ran > "$PWD/driver-ran"',
  'if [ -n "${REVIEW_UI_GATE_ONLY_CHANGED:-}" ]; then cat "$REVIEW_UI_GATE_ONLY_CHANGED" > "$PWD/driver-selection"; fi',
  "",
].join("\n");

/** Runs a shell block with a recording driver in place of the real one. `prepare` gets the
 *  scratch RUNNER_TEMP, may place files in it, and returns the step's environment. */
function runBlock(
  script: string,
  prepare: (runnerTemp: string) => Record<string, string>,
): Run {
  const dir = mkdtempSync(join(tmpdir(), "ui-gate-step-"));
  mkdirSync(join(dir, "scripts/ci"), { recursive: true });
  const runnerTemp = join(dir, "runner-temp");
  mkdirSync(runnerTemp);
  const env = prepare(runnerTemp);
  const driver = join(dir, "scripts/ci/review-ui-gate.parallel.sh");
  writeFileSync(driver, RECORDER);
  chmodSync(driver, 0o755);
  const r = spawnSync("bash", ["-e", "-c", script], {
    cwd: dir,
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", RUNNER_TEMP: runnerTemp, ...env },
  });
  const selectionFile = join(dir, "driver-selection");
  const err: NodeJS.ErrnoException | undefined = r.error;
  return {
    status: r.status,
    errorCode: err?.code,
    stdout: r.stdout ?? "",
    driverRan: existsSync(join(dir, "driver-ran")),
    selection: existsSync(selectionFile)
      ? readFileSync(selectionFile, "utf8")
      : null,
  };
}

/** Runs the REAL step: its own block and its own env map, resolved; when `list` is given, the
 *  list is placed where the workflow's download step puts the uploaded file. */
function runStep(outputs: Outputs, list: string | null): Run {
  const script = gateStep?.run;
  const dlPath = downloadStep?.with?.["path"];
  const upPath = uploadStep?.with?.["path"];
  if (script === undefined)
    throw new Error("ci.yml has no review UI gate step block");
  if (typeof dlPath !== "string" || typeof upPath !== "string")
    throw new Error("ci.yml has no ci-changed-files upload/download pair");
  return runBlock(script, (runnerTemp) => {
    if (list !== null) {
      const into = resolveExpr(dlPath, outputs, runnerTemp);
      mkdirSync(into, { recursive: true });
      writeFileSync(join(into, basename(upPath)), list);
    }
    return Object.fromEntries(
      Object.entries(gateStep?.env ?? {}).map(([k, v]) => [
        k,
        resolveExpr(v, outputs, runnerTemp),
      ]),
    );
  });
}

/** The step as it stood before 2026-11-02, verbatim: the list in an env var. Kept only to
 *  reproduce the failure the artifact transport exists to prevent. */
const PRE_FIX_BLOCK = [
  "set -euo pipefail",
  'if [ "$CHANGED_KNOWN" != true ] || [ "$ALL_PLANTS" = true ]; then',
  "  exit 0",
  "fi",
  `printf '%s\\n' "$CHANGED_FILES" > "$RUNNER_TEMP/review-ui-changed.txt"`,
  'export REVIEW_UI_GATE_ONLY_CHANGED="$RUNNER_TEMP/review-ui-changed.txt"',
  "bash scripts/ci/review-ui-gate.parallel.sh",
  "",
].join("\n");

const PRODUCT = [
  "client/src/pages/practice.tsx",
  "client/src/pages/practice.test.tsx",
];
const HARNESS = [
  "scripts/ci/review-ui-gate.mutations.sh",
  "client/src/pages/practice.tsx",
];
/** A sync PR's diff: 5,000 paths, well past the kernel's 128 KiB limit on one env string. */
const SYNC = Array.from(
  { length: 5000 },
  (_, i) =>
    `client/src/features/integration-sync/batch-${String(i).padStart(4, "0")}/module-${i}-with-a-long-descriptive-name.tsx`,
);
const SYNC_TEXT = `${SYNC.join("\n")}\n`;

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
    expect(allPlantsFor(SYNC)).toBe("false");
  });

  it("the sync fixture is several thousand paths and over 300 KB", () => {
    expect(SYNC).toHaveLength(5000);
    expect(Buffer.byteLength(SYNC_TEXT)).toBeGreaterThanOrEqual(300 * 1024);
  });
});

describe("ci: the changed-file list travels as an artifact, end to end", () => {
  it("the changes job uploads the very file its scope script writes, when the change is known", () => {
    expect(scopeStep?.env?.["CHANGED_FILES_OUT"]).toBe(
      "${{ runner.temp }}/changed-files.txt",
    );
    expect(uploadStep?.uses).toBe("actions/upload-artifact@v4");
    expect(uploadStep?.with?.["path"]).toBe(
      scopeStep?.env?.["CHANGED_FILES_OUT"],
    );
    expect(uploadStep?.if).toBe("steps.files.outputs.known == 'true'");
    expect(uploadStep?.with?.["if-no-files-found"]).toBe("error");
  });

  it("the ci job downloads that artifact before the gate step runs", () => {
    expect(downloadStep?.uses).toBe("actions/download-artifact@v4");
    expect(downloadStep?.with?.["path"]).toBe(
      "${{ runner.temp }}/changed-files",
    );
    expect(downloadIndex).toBeGreaterThanOrEqual(0);
    expect(gateIndex).toBeGreaterThan(downloadIndex);
    expect(gateStep?.run).toContain(
      '"$RUNNER_TEMP/changed-files/changed-files.txt"',
    );
  });

  it("the list is neither a job output nor in the gate's env, and the gate's script interpolates nothing", () => {
    expect(changesJob?.outputs?.["changed_known"]).toBe(
      "${{ steps.files.outputs.known }}",
    );
    expect(Object.keys(changesJob?.outputs ?? {})).not.toContain(
      "changed_files",
    );
    expect(Object.keys(gateStep?.env ?? {}).sort()).toEqual([
      "ALL_PLANTS",
      "CHANGED_KNOWN",
    ]);
    expect(gateStep?.run).not.toContain("${{");
  });

  it("no workflow reads the list as a job output or a CHANGED_FILES env var", () => {
    const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
    expect(files).toContain("ci.yml");
    expect(files).toContain("ci-full.yml");
    for (const f of files) {
      const text = readFileSync(join(WORKFLOWS, f), "utf8");
      expect({ f, hit: /outputs\.changed_files\b/.test(text) }).toEqual({
        f,
        hit: false,
      });
      expect({ f, hit: /^\s*CHANGED_FILES\s*:/m.test(text) }).toEqual({
        f,
        hit: false,
      });
    }
  });
});

describe("ci: a product change runs the plants it touches", () => {
  it("runs the driver on exactly the change's files", () => {
    const r = runStep(
      {
        changed_known: "true",
        review_ui_gate: allPlantsFor(PRODUCT),
        changed_files: PRODUCT.join("\n"),
      },
      `${PRODUCT.join("\n")}\n`,
    );
    expect(r.status).toBe(0);
    expect(r.driverRan).toBe(true);
    expect(r.selection).toBe(`${PRODUCT.join("\n")}\n`);
  });
});

describe("ci: a sync PR's change list (several thousand files) still starts the step", () => {
  it("the pre-fix step starts on a small list (so the failure below is the list's size)", () => {
    const r = runBlock(PRE_FIX_BLOCK, () => ({
      CHANGED_KNOWN: "true",
      ALL_PLANTS: "false",
      CHANGED_FILES: PRODUCT.join("\n"),
    }));
    expect(r.errorCode).toBeUndefined();
    expect(r.status).toBe(0);
    expect(r.selection).toBe(`${PRODUCT.join("\n")}\n`);
  });

  it("the pre-fix step, carrying the list in an env var, cannot even start bash (E2BIG)", () => {
    const r = runBlock(PRE_FIX_BLOCK, () => ({
      CHANGED_KNOWN: "true",
      ALL_PLANTS: "false",
      CHANGED_FILES: SYNC.join("\n"),
    }));
    expect(r.errorCode).toBe("E2BIG");
    expect(r.status).toBeNull();
    expect(r.driverRan).toBe(false);
  });

  it("the real step starts and selects exactly those files", () => {
    const r = runStep(
      {
        changed_known: "true",
        review_ui_gate: allPlantsFor(SYNC),
        changed_files: SYNC.join("\n"),
      },
      SYNC_TEXT,
    );
    expect(r.errorCode).toBeUndefined();
    expect(r.status).toBe(0);
    expect(r.driverRan).toBe(true);
    expect(r.selection).toBe(SYNC_TEXT);
  });
});

describe("ci: a known change whose list is missing fails closed", () => {
  it("does not run the driver, fails, and says the artifact is missing", () => {
    const r = runStep({ changed_known: "true", review_ui_gate: "false" }, null);
    expect(r.status).toBe(1);
    expect(r.driverRan).toBe(false);
    expect(r.stdout).toContain(
      "::error title=Review UI mutation gate::the change is known but the ci-changed-files artifact is missing",
    );
  });
});

describe("ci: the full plant set is deferred to ci-full", () => {
  it.each([
    ["the harness changed", "true", HARNESS, allPlantsFor(HARNESS)],
    ["the change is unknown", "false", null, "true"],
    ["the change is unknown (groups not computed)", "false", null, "false"],
  ])(
    "%s: no plant runs here, the step passes and names ci-full",
    (_case, known, files, all) => {
      const r = runStep(
        { changed_known: known, review_ui_gate: all },
        files === null ? null : `${files.join("\n")}\n`,
      );
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
    expect(readFileSync(join(WORKFLOWS, "ci-full.yml"), "utf8")).not.toContain(
      "REVIEW_UI_GATE_ONLY_CHANGED",
    );
    expect(full.jobs["review-ui-gate"]).toBeDefined();
  });

  it("the ci job's limit stays at 25 minutes", () => {
    expect(ciJob?.["timeout-minutes"]).toBe(25);
  });
});
