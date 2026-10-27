/**
 * CI path groups — which change-triggered checks a fast-lane run must include.
 *
 * @spec [owner decisions 2026-10-07 on the CI audit, items 2-3] | @implemented [2026-10-07]
 *
 * plain English: the fast lane (ci.yml, every pull request) runs a few checks only when the
 * change can affect them: a gate's self-test when that gate's script changes, the review UI
 * mutation gate's full plant set when the harness itself changes (since Karl's ruling of
 * 2026-10-11 on #1204, ci.yml defers that set to ci-full's shards rather than run it), the
 * dependency audit when a manifest or the lockfile changes, the question-authoring test when the question tooling
 * changes. Every one of them always runs in the full tier (ci-full.yml) on the way to `main`.
 * This script maps the changed files to those groups.
 *
 * It fails OPEN: when the list of changed files is unknown (no list, or ALL=true), every group
 * is true and the run includes everything.
 *
 * Usage: node scripts/ci/ci-path-groups.mjs <changed-files.txt>   (ALL=true forces every group)
 * Prints `<group>=true|false` lines; append them to $GITHUB_OUTPUT.
 */
import { existsSync, readFileSync } from "node:fs";

/** group → path prefixes (a trailing "/" is a directory; anything else is a prefix of a name). */
export const GROUPS = {
  review_ui_gate: ["scripts/ci/review-ui-gate."],
  boot_probe: ["scripts/ci/boot-probe", "scripts/ci/boot-env.manifest.json"],
  section_vocabulary: ["scripts/ci/section-vocabulary-gate."],
  fixture_canonicality: ["scripts/ci/test-fixture-canonicality-gate."],
  guardian_dead_code: ["scripts/ci/guardian-dead-code-gate."],
  deps: [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "packages/shared/package.json",
    "apps/workers/tutor-orchestrator/package.json",
  ],
  // The Layer 2 crisis classifier: its prompt, its caller, its golden set, and the Layer 1 seed
  // the golden set's must-trigger list is read from (CC Brief "P1: Stop False Crisis Positives").
  crisis_classifier: [
    "server/services/crisis-classifier-prompt.ts",
    "server/services/tutor-crisis.ts",
    "scripts/ci/crisis-classifier-golden-set.ts",
    "supabase/migrations/20260917000001_layer1_crisis_pattern_seed_v1.sql",
  ],
  // Smart landing (Karl, 2026-10-26, item 4): the browser spec that opens a landing's session in
  // the real session page. Everything between the landing and question 1: the landing itself,
  // the practice start that builds its set, the session page and runner, and the harness.
  smart_landing: [
    "server/services/landing/",
    "server/routes/landing-routes.ts",
    "server/routes/practice-canonical.ts",
    "packages/shared/src/smart-landing-schema.ts",
    "packages/shared/src/practice-response-schema.ts",
    "shared/section-display.ts",
    "client/src/pages/resume-practice.tsx",
    "client/src/pages/qotd-landing.tsx",
    "client/src/pages/lyceon-dashboard.tsx",
    "client/src/hooks/useSmartLanding.ts",
    "client/src/lib/landing-entry.ts",
    "client/src/components/practice/",
    "client/src/components/home/qotd/",
    "supabase/migrations/",
    "tests/e2e/smart-landing.spec.ts",
    "tests/e2e/run-student-harness-e2e.sh",
    "tests/e2e/student-harness/",
    "scripts/ci/smart-landing-e2e.mutations.sh",
  ],
  question_tooling: [
    "scripts/assemble-batch.ts",
    "shared/question-ingestion-qa.ts",
    "shared/question-bank-contract.ts",
    "shared/practice/letter-reference.ts",
    "shared/question-markup.ts",
    "content/canonical/",
    "docs/questions_governance.md",
    "tests/assemble-batch",
  ],
};

export function groupsFor(changed) {
  const out = {};
  for (const [group, prefixes] of Object.entries(GROUPS)) {
    out[group] =
      changed === null ||
      changed.some((f) => prefixes.some((p) => f === p || f.startsWith(p)));
  }
  return out;
}

function main() {
  const path = process.argv[2];
  const all = process.env.ALL === "true" || !path || !existsSync(path);
  const changed = all
    ? null
    : readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => l !== "");
  for (const [group, on] of Object.entries(groupsFor(changed)))
    process.stdout.write(`${group}=${on}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
)
  main();
