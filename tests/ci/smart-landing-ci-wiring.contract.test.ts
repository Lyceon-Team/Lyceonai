/**
 * Smart landing's browser spec runs on the pull requests that can break it.
 *
 * @spec [owner change "Smart landing: replacing the multi-section sets" (Karl, 2026-10-26) item 4:
 *        "an end-to-end test that opens the set_math_5 session and the 5 more session in the real
 *        session page and reaches question 1, plus a planted defect that breaks it ... One PR
 *        into cleanup, CI green"] | @implemented [2026-10-26]
 *
 * plain English: a pull request into `cleanup` runs the fast lane (ci.yml); the full tier
 * (ci-full.yml, checked by ci-full-workflow-shape.test.ts) needs the `ci:full` label there. So
 * the fast lane runs the browser spec and its planted defect whenever a change touches anything
 * between a landing and question 1. Today's bug was a change to the landing's set (server) that
 * the session page (client) could not open; the real path-groups script must select the job for
 * either side, and for the harness the spec runs on.
 *   W1 ci.yml has the job, gated on the `smart_landing` group, running the planted-defect script
 *      against Postgres, and `changes` exports the group
 *   W2 the real `groupsFor` selects it for both halves of today's bug and for the harness, and not
 *      for an unrelated change
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { groupsFor } from "../../scripts/ci/ci-path-groups.mjs";

type Job = {
  needs?: string | string[];
  if?: string;
  services?: unknown;
  outputs?: Record<string, string>;
  steps?: { run?: string }[];
};
const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8")) as {
  jobs: Record<string, Job>;
};

describe("smart landing browser spec: CI wiring", () => {
  it("W1 the fast lane runs it, gated on the smart_landing group, against Postgres", () => {
    const job = ci.jobs["smart-landing-browser"];
    expect(job).toBeDefined();
    expect(job?.needs).toBe("changes");
    expect(job?.if).toContain("needs.changes.outputs.smart_landing == 'true'");
    expect((job?.steps ?? []).map((s) => s.run ?? "")).toContain(
      "bash scripts/ci/smart-landing-e2e.mutations.sh",
    );
    expect(JSON.stringify(job?.services)).toContain("pgvector/pgvector");
    expect(ci.jobs.changes?.outputs?.smart_landing).toBe(
      "${{ steps.groups.outputs.smart_landing }}",
    );
  });

  it("W2 the group selects both halves of today's bug and the harness, never an unrelated change", () => {
    for (const file of [
      "server/services/landing/landing-deps.ts", // the set the landing builds
      "client/src/pages/resume-practice.tsx", // the page that opens it
      "server/routes/practice-canonical.ts", // the practice start
      "tests/e2e/student-harness/server.ts", // the stack the spec runs on
      "tests/e2e/smart-landing.spec.ts",
    ]) {
      expect(groupsFor([file]).smart_landing, file).toBe(true);
    }
    expect(groupsFor(["docs/plans/README.md"]).smart_landing).toBe(false);
    expect(groupsFor(["server/routes/tutor-runtime.ts"]).smart_landing).toBe(
      false,
    );
    // Unknown change list: fails open (every group runs).
    expect(groupsFor(null).smart_landing).toBe(true);
  });
});
