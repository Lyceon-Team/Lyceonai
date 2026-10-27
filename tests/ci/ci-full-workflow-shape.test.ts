/**
 * The full tier's split stays whole: every check still runs, once, where it should.
 *
 * @spec [CI wall-time brief (Karl, 2026-10-11): "same plants, same proof, no check weakened, with
 *       a final job verifying the shard totals"; owner decisions 2026-10-07 items 2-3] |
 * @implemented [2026-10-11]
 *
 * plain English: ci-full.yml splits `pg-mutations` into a matrix of groups and the review UI
 * mutation gate into shard jobs plus a job that adds up their totals. A split can lose a check
 * silently, so this reads the REAL workflow file and holds:
 *   - every `pg-mutations` step that is not setup carries exactly one group, the group is in the
 *     matrix, and every group has steps (a new step added without a group would run in every job,
 *     or in none if its `if` names a missing group: both are red here);
 *   - steps that share state stay together: the two calendar parity steps read the database the
 *     pipeline step builds, and the PostgREST harness (BYPASSRLS is cluster-wide) is its group's
 *     last step;
 *   - the shard jobs' matrix, their job count and shard count, and the combine step's arguments
 *     agree, so the combine step expects exactly the shards that ran;
 *   - the verdict still needs `review-ui-gate` (the combine job) and `pg-mutations`;
 *   - a label event never cancels a run in progress.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = {
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
};
type Job = {
  needs?: string | string[];
  if?: string;
  env?: Record<string, string>;
  strategy?: { matrix?: Record<string, unknown> };
  steps?: Step[];
};
type Workflow = {
  concurrency?: { group?: string; "cancel-in-progress"?: string | boolean };
  jobs: Record<string, Job>;
};

const ROOT = resolve(import.meta.dirname, "../..");
const wf = parse(
  readFileSync(resolve(ROOT, ".github/workflows/ci-full.yml"), "utf8"),
) as Workflow;

const SETUP = new Set([
  "Checkout",
  "Setup pnpm",
  "Setup Node",
  "Install dependencies",
  "Ensure postgresql-client 16",
  "Set up Python",
  "Install PostgREST (real transport)",
]);

function job(name: string): Job {
  const j = wf.jobs[name];
  if (!j) throw new Error(`ci-full.yml has no job ${name}`);
  return j;
}

function groupOf(step: Step): string | null {
  const m = /^matrix\.group == '([a-z-]+)'$/.exec(step.if ?? "");
  return m ? (m[1] ?? null) : null;
}

describe("pg-mutations: every step in exactly one group", () => {
  const pg = job("pg-mutations");
  const groups = (pg.strategy?.matrix?.group ?? []) as string[];
  const steps = pg.steps ?? [];
  const checks = steps.filter((s) => !SETUP.has(s.name ?? ""));

  it("has groups and checks to split (presence first)", () => {
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(checks.length).toBeGreaterThanOrEqual(20);
  });

  it("setup steps run in every group (no `if`)", () => {
    for (const s of steps.filter((x) => SETUP.has(x.name ?? ""))) {
      expect(s.if, s.name).toBeUndefined();
    }
  });

  it("each check names one group from the matrix", () => {
    for (const s of checks) {
      const g = groupOf(s);
      expect(g, `${s.name}: if=${s.if ?? "(none)"}`).not.toBeNull();
      expect(groups, s.name).toContain(g);
    }
  });

  it("no group is empty", () => {
    for (const g of groups) {
      expect(
        checks.some((s) => groupOf(s) === g),
        g,
      ).toBe(true);
    }
  });

  it("the calendar parity steps run with the step that builds their database", () => {
    const named = (prefix: string): Step => {
      const s = checks.find((x) => (x.name ?? "").startsWith(prefix));
      if (!s) throw new Error(`no step ${prefix}`);
      return s;
    };
    const build = groupOf(named("Apply the migration pipeline"));
    expect(groupOf(named("Parity vs calendar_formula_reference"))).toBe(build);
    expect(groupOf(named("Parity exam_placement comparison"))).toBe(build);
    const order = checks.map((s) => s.name ?? "");
    expect(
      order.findIndex((n) => n.startsWith("Apply the migration pipeline")),
    ).toBeLessThan(order.findIndex((n) => n.startsWith("Parity vs")));
  });

  it("the PostgREST mutation harness is the last step of its group", () => {
    const i = checks.findIndex((s) =>
      (s.name ?? "").startsWith("Mastery emission → REAL PostgREST proof"),
    );
    expect(i).toBeGreaterThanOrEqual(0);
    const g = groupOf(checks[i]!);
    expect(checks.slice(i + 1).filter((s) => groupOf(s) === g)).toEqual([]);
  });
});

describe("review UI gate: shard jobs and the job that adds them up agree", () => {
  const shard = job("review-ui-gate-shard");
  const combine = job("review-ui-gate");
  const matrix = (shard.strategy?.matrix?.job ?? []) as number[];
  const jobs = Number(shard.env?.REVIEW_UI_GATE_JOBS);
  const per = Number(shard.env?.REVIEW_UI_GATE_SHARDS);

  it("the matrix is 0..JOBS-1 and the shard count is fixed", () => {
    expect(jobs).toBeGreaterThanOrEqual(2);
    expect(per).toBeGreaterThanOrEqual(1);
    expect(matrix).toEqual(Array.from({ length: jobs }, (_, i) => i));
  });

  it("each shard job runs the gate as its job of JOBS and uploads its summary", () => {
    const run = (shard.steps ?? []).find((s) =>
      (s.run ?? "").includes("review-ui-gate.parallel.sh"),
    );
    expect(run).toBeDefined();
    const upload = (shard.steps ?? []).find((s) =>
      (s.uses ?? "").startsWith("actions/upload-artifact"),
    );
    expect(upload).toBeDefined();
    const raw = readFileSync(
      resolve(ROOT, ".github/workflows/ci-full.yml"),
      "utf8",
    );
    expect(raw).toContain(
      "REVIEW_UI_GATE_JOB: ${{ matrix.job }}/${{ env.REVIEW_UI_GATE_JOBS }}",
    );
  });

  it("the combine job needs the shards, runs even when one failed, and expects JOBS x SHARDS", () => {
    expect(combine.needs).toEqual(["scope", "review-ui-gate-shard"]);
    expect(combine.if ?? "").toContain("always()");
    const step = (combine.steps ?? []).find((s) =>
      (s.run ?? "").includes("review-ui-gate.combine.sh"),
    );
    expect(step?.run).toMatch(
      new RegExp(`review-ui-gate\\.combine\\.sh "[^"]+" ${jobs} ${per}\\n`),
    );
    expect(step?.run).toContain('[ "$SHARD_RESULT" = success ]');
  });
});

describe("the verdict and the trigger", () => {
  it("the required ci-full check still needs the combine job and the pg-mutations matrix", () => {
    const needs = job("ci-full").needs as string[];
    for (const n of [
      "scope",
      "review-ui-gate",
      "gate-selftests",
      "pg-mutations",
      "browser",
      // Owner ruling on #1300 (2026-10-23): the LISA chat dock's browser spec.
      "lisa-dock-browser",
      // Smart landing (Karl, 2026-10-26, item 4): the landing browser spec and its planted defect.
      "smart-landing-browser",
    ]) {
      expect(needs).toContain(n);
    }
  });

  it("the LISA dock browser job runs with the full tier, against Postgres, through its runner script, and its result is in the verdict", () => {
    const dock = job("lisa-dock-browser");
    expect(dock.needs).toBe("scope");
    expect(dock.if).toBe("${{ needs.scope.outputs.run == 'true' }}");
    const steps = (dock.steps ?? []).map((st) => st.run ?? "");
    expect(steps).toContain("bash tests/e2e/run-lisa-dock-e2e.sh");
    expect(JSON.stringify(dock)).toContain("pgvector/pgvector");
    const verdict = (job("ci-full").steps ?? []).find(
      (st) => st.name === "Verdict",
    );
    expect(verdict?.env?.RESULTS ?? "").toContain(
      "${{ needs.lisa-dock-browser.result }}",
    );
  });

  it("the smart landing browser job runs with the full tier, against Postgres, through its planted-defect script, and its result is in the verdict", () => {
    const landing = job("smart-landing-browser");
    expect(landing.needs).toBe("scope");
    expect(landing.if).toBe("${{ needs.scope.outputs.run == 'true' }}");
    const steps = (landing.steps ?? []).map((st) => st.run ?? "");
    expect(steps).toContain("bash scripts/ci/smart-landing-e2e.mutations.sh");
    expect(JSON.stringify(landing)).toContain("pgvector/pgvector");
    const verdict = (job("ci-full").steps ?? []).find(
      (st) => st.name === "Verdict",
    );
    expect(verdict?.env?.RESULTS ?? "").toContain(
      "${{ needs.smart-landing-browser.result }}",
    );
  });

  it("a label event never cancels a run in progress; a new head still does", () => {
    expect(String(wf.concurrency?.["cancel-in-progress"])).toBe(
      "${{ github.event_name != 'pull_request' || github.event.action != 'labeled' }}",
    );
  });
});
