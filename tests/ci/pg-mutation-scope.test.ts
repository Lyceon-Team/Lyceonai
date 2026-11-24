/**
 * The pg-mutations scope: which planted-defect groups a full-tier run includes.
 *
 * @spec [CI scope ruling (Karl, 2026-11-04): the media and marketing checks run only when a
 *       change can affect them, "scoped to the right files"; owner decisions 2026-10-07 items 2-3
 *       (fail open)] | @implemented [2026-11-04]
 *
 * plain English: scripts/ci/pg-mutation-scope.mjs computes each scoped group's dependencies from
 * the real tree (no fixture tree, no hand-written dependency list) and keeps a scoped group only
 * when a changed file is one of them. These cases hold, against the real repository:
 *   - presence first: each scoped group's dependencies hold the files its harness plants into,
 *     the tests it runs and the data those tests read, so the "skipped" cases below are not
 *     skipped because the set is empty;
 *   - a change that cannot affect a scoped group skips it, and never skips an unscoped group;
 *   - a change to any dependency (a planted file, shared schema, a migration, the harness, the
 *     workflow, the lockfile) keeps it;
 *   - an unknown change runs everything;
 *   - the trace check fails on a read outside the set and on a trace that read nothing.
 */
import { describe, expect, it } from "vitest";
import {
  ALL_GROUPS,
  SCOPED_GROUPS,
  closure,
  groupTests,
  groupsToRun,
  touches,
  untracked,
} from "../../scripts/ci/pg-mutation-scope.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const UNSCOPED = ALL_GROUPS.filter((g) => !SCOPED_GROUPS.includes(g));

describe("the scoped groups' dependencies (presence first)", () => {
  const we = closure("worked-examples");
  const bd = closure("qotd-breakdown");

  it("hold what the worked-example harness plants into, runs and reads", () => {
    for (const f of [
      "scripts/ci/worked-examples.mutations.sh",
      "tests/ci/worked-examples.test.ts",
      "tests/ci/worked-examples-voice.test.ts",
      "tests/ci/video-pilots.test.ts",
      "scripts/worked-examples/final-mix.ts",
      "scripts/worked-examples/voice.ts",
      "video-kit/worked-examples/voice.json",
      "packages/shared/src/worked-example-schema.ts",
      "scripts/ci/worked-examples-schema-gates.sql",
      ".github/workflows/worked-example-daily.yml",
    ])
      expect(touches(we, f), f).toBe(true);
    // The question-bank seed content.ts reads by directory, found by the scope trace.
    expect(touches(we, "infra/supabase/seed/proving_batch_001.sql")).toBe(true);
  });

  it("hold what the breakdown harness plants into, runs and reads", () => {
    for (const f of [
      "scripts/ci/qotd-breakdown.mutations.sh",
      "tests/ci/qotd-breakdown.test.ts",
      "scripts/qotd-social/breakdown.ts",
      "shared/qotd/breakdown.ts",
      "scripts/worked-examples/final-mix.ts",
      "scripts/ci/qotd-schema-gates.sql",
    ])
      expect(touches(bd, f), f).toBe(true);
  });

  it("each scoped group's harness names the tests it runs", () => {
    expect(groupTests("worked-examples")).toEqual([
      "tests/ci/social-weekly-secret-guard.test.ts",
      "tests/ci/video-pilots.test.ts",
      "tests/ci/voice-bakeoff.test.ts",
      "tests/ci/weekly-pipeline.test.ts",
      "tests/ci/worked-example-figure.test.ts",
      "tests/ci/worked-examples-voice.test.ts",
      "tests/ci/worked-examples.test.ts",
    ]);
    expect(groupTests("qotd-breakdown")).toEqual([
      "tests/ci/qotd-breakdown.test.ts",
    ]);
  });

  it("stay narrow: no server route, billing or client page is a dependency", () => {
    for (const dep of [we, bd]) {
      for (const f of [
        "server/lib/stripe/webhook-handler.ts",
        "server/routes/practice-canonical.ts",
        "client/src/pages/lyceon-dashboard.tsx",
        "packages/shared/src/calendar-schema.ts",
      ])
        expect(touches(dep, f), f).toBe(false);
    }
  });
});

describe("which groups run", () => {
  it("a change no scoped group depends on runs only the unscoped groups", () => {
    for (const f of [
      "server/lib/stripe/webhook-handler.ts",
      "client/src/pages/lyceon-dashboard.tsx",
      "docs/runbooks/email-send-gate.md",
    ])
      expect(groupsToRun([f]), f).toEqual(UNSCOPED);
  });

  it("an unscoped group always runs", () => {
    expect(groupsToRun([])).toEqual(UNSCOPED);
  });

  it("a change to a dependency runs the group", () => {
    const cases: Array<[string, string[]]> = [
      [
        "scripts/worked-examples/final-mix.ts",
        ["worked-examples", "qotd-breakdown"],
      ],
      ["scripts/qotd-social/breakdown.ts", ["qotd-breakdown"]],
      ["video-kit/worked-examples/voice.json", ["worked-examples"]],
      [
        "packages/shared/src/worked-example-schema.ts",
        ["worked-examples", "qotd-breakdown"],
      ],
      [
        "supabase/migrations/20261128000000_email_gate_milestone_window.sql",
        [...SCOPED_GROUPS],
      ],
      ["scripts/ci/worked-examples.mutations.sh", ["worked-examples"]],
      ["scripts/ci/lib/vitest-round-trips.sh", [...SCOPED_GROUPS]],
      [".github/workflows/ci-full.yml", [...SCOPED_GROUPS]],
      ["pnpm-lock.yaml", [...SCOPED_GROUPS]],
    ];
    for (const [f, scoped] of cases) {
      const run = groupsToRun([f]);
      for (const g of scoped) expect(run, `${f} -> ${g}`).toContain(g);
      for (const g of UNSCOPED) expect(run, `${f} -> ${g}`).toContain(g);
    }
  });

  it("an unknown change runs every group", () => {
    expect(groupsToRun(null)).toEqual(ALL_GROUPS);
  });
});

describe("the scope trace", () => {
  const line = (p: string) =>
    `123 openat(AT_FDCWD, "${ROOT}/${p}", O_RDONLY|O_CLOEXEC) = 23`;

  it("passes reads inside the dependencies", () => {
    const trace = [
      line("scripts/worked-examples/final-mix.ts"),
      line("video-kit/worked-examples/voice.json"),
    ].join("\n");
    expect(untracked("worked-examples", trace)).toEqual([]);
  });

  it("names a read outside them", () => {
    const trace = [
      line("scripts/worked-examples/final-mix.ts"),
      line("server/lib/stripe/webhook-handler.ts"),
    ].join("\n");
    expect(untracked("worked-examples", trace)).toEqual([
      "server/lib/stripe/webhook-handler.ts",
    ]);
  });

  it("ignores failed opens, node_modules and files outside the repository", () => {
    const trace = [
      `1 openat(AT_FDCWD, "${ROOT}/server/lib/stripe/webhook-handler.ts", O_RDONLY) = -1 ENOENT (No such file)`,
      `1 openat(AT_FDCWD, "${ROOT}/node_modules/vitest/package.json", O_RDONLY) = 5`,
      `1 openat(AT_FDCWD, "/etc/hosts", O_RDONLY) = 5`,
    ].join("\n");
    expect(untracked("worked-examples", trace)).toEqual([]);
  });
});
