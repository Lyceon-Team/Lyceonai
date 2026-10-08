/**
 * @spec [Coding Standards §12.1, §14 ("logging redaction → add explicit redaction tests");
 *        Public Disclosure Doctrine rule 2; owner decision 2026-10-07 on the CI audit, item 1]
 * @implemented 2026-10-07
 *
 * plain English: proves the two guards in tests/ci/lib/tutor-log-guard.ts keep LISA's prompts
 * and tutor exchanges out of CI logs, which are public.
 *
 *   - The static rule holds over the whole repository: no test file that imports tutor code
 *     writes to the console or to stdout/stderr, apart from the two named aggregate reports.
 *   - The runtime chokepoint is wired into both vitest configs, and it catches the real thing:
 *     the system instruction the worker actually renders for every golden-set fixture carries
 *     a fingerprint, so printing any of them is dropped and fails the run.
 *   - Each rule goes red on a plant, and stays green on its controls.
 *
 * expected outcome: a test that prints a rendered system instruction, or any console output
 * from a test that handles tutor content, fails CI instead of publishing it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { buildSystemInstruction } from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import { ALL_FIXTURES } from "./lisa-golden-set-fixtures";
import {
  containsTutorPrompt,
  findTutorConsoleWrites,
  importedSpecifiers,
  loadTutorPromptFingerprints,
  makeTutorConsoleGuard,
  TUTOR_IMPORT_RE,
} from "./lib/tutor-log-guard";

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ROOT = resolve(__dirname, "../..");

/**
 * Files that import tutor code and print, where what they print can never be tutor text. Each
 * entry names what it prints. The vitest ones stay behind the runtime chokepoint as well.
 */
const NO_TUTOR_TEXT_OUTPUT: ReadonlyMap<string, string> = new Map([
  [
    "tests/ci/lisa-golden-set.contract.test.ts",
    "pass counts per coverage class",
  ],
  [
    "tests/ci/scanner-precision.contract.test.ts",
    "TP/FN/FP/TN counts per value",
  ],
  [
    "tests/e2e/page-csp-flows.spec.ts",
    "unmocked METHOD /path lines, CSP violation reports, a save count",
  ],
  [
    "tests/e2e/student-harness/server.ts",
    "unserved METHOD /path lines and seed counts; never runs a tutor turn",
  ],
]);

/** Manual tools that are never run in CI; they print to the operator's own terminal. */
const NOT_RUN_IN_CI = ["tests/eval/"];

function testFiles(): string[] {
  const out = execFileSync(
    "git",
    [
      "ls-files",
      "--",
      "tests",
      "*.test.ts",
      "*.test.tsx",
      "*.spec.ts",
      "*.spec.tsx",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  return [
    ...new Set(out.split("\n").filter((f) => /\.(ts|tsx)$/.test(f))),
  ].filter(
    (f) =>
      !f.includes("node_modules/") &&
      !NOT_RUN_IN_CI.some((p) => f.startsWith(p)),
  );
}

describe("static rule: tests that import tutor code do not print", () => {
  it("covers a real set of files, including the tutor tests", () => {
    const files = testFiles();
    // Presence before absence: the scan must actually reach tutor test files.
    expect(files.length).toBeGreaterThan(400);
    const tutorFiles = files.filter((f) =>
      importedSpecifiers(readFileSync(join(ROOT, f), "utf8")).some((s) =>
        TUTOR_IMPORT_RE.test(s),
      ),
    );
    expect(tutorFiles.length).toBeGreaterThan(10);
    expect(files).toContain("tests/ci/lisa-audit-b1.8-proof.contract.test.ts");
  });

  it("no test file that imports tutor code writes to the console or stdout/stderr", () => {
    const violations: string[] = [];
    for (const f of testFiles()) {
      if (NO_TUTOR_TEXT_OUTPUT.has(f)) continue;
      for (const finding of findTutorConsoleWrites(
        readFileSync(join(ROOT, f), "utf8"),
      )) {
        violations.push(`${f} ${finding}`);
      }
    }
    expect(violations).toEqual([]);
  });

  // An exception must name a real file that imports tutor code (otherwise it is dead and should
  // go). It need not still print: a file that stops printing is simply no longer an exception
  // in use, and the claude/eslint-zero lint work removes the golden-set print.
  it("every exception names an existing file that imports tutor code", () => {
    for (const f of NO_TUTOR_TEXT_OUTPUT.keys()) {
      const source = readFileSync(join(ROOT, f), "utf8");
      expect(
        importedSpecifiers(source).some((s) => TUTOR_IMPORT_RE.test(s)),
        f,
      ).toBe(true);
    }
  });

  it("plants: each write form is named; comments and non-tutor files are not", () => {
    const tutorImport = `import { x } from "../../server/services/tutor-context";\n`;
    expect(
      findTutorConsoleWrites(`${tutorImport}console.log(systemInstruction);`),
    ).toEqual(["line 2: console.log("]);
    expect(
      findTutorConsoleWrites(`${tutorImport}process.stdout.write(si);`),
    ).toHaveLength(1);
    expect(
      findTutorConsoleWrites(`${tutorImport}console.error(reply);`),
    ).toHaveLength(1);
    expect(
      findTutorConsoleWrites(
        `vi.mock("../workers/tutor-orchestrator/x");\nconsole.info(a);`,
      ),
    ).toHaveLength(1);
    expect(
      findTutorConsoleWrites(
        `const m = await import("../lisa/prompt");\nconsole.warn(a);`,
      ),
    ).toHaveLength(1);
    // Controls.
    expect(
      findTutorConsoleWrites(
        `${tutorImport}// console.log(systemInstruction);`,
      ),
    ).toEqual([]);
    expect(
      findTutorConsoleWrites(
        `${tutorImport}expect(src).not.toContain("console.log");`,
      ),
    ).toEqual([]);
    expect(
      findTutorConsoleWrites(
        `import { y } from "./calendar";\nconsole.log(y);`,
      ),
    ).toEqual([]);
    // A call written inside a string literal is text, not a write (this file's own plants).
    expect(
      findTutorConsoleWrites(
        `${tutorImport}const plant = "console.log(systemInstruction)";`,
      ),
    ).toEqual([]);
    // ...while a real call on the same line as a string is still named, on its true line.
    expect(
      findTutorConsoleWrites(
        `${tutorImport}/**\n * doc\n */\nconsole.log("x", si);`,
      ),
    ).toEqual(["line 5: console.log("]);
  });
});

describe("runtime chokepoint: prompt text never reaches the console", () => {
  const fingerprints = loadTutorPromptFingerprints(ROOT);

  it("is fingerprinted from the real prompt sources", () => {
    expect(fingerprints.length).toBeGreaterThan(20);
  });

  it("catches the system instruction the worker renders for every golden-set fixture", () => {
    expect(ALL_FIXTURES.length).toBeGreaterThan(20);
    for (const fixture of ALL_FIXTURES) {
      const rendered = buildSystemInstruction(fixture.request);
      expect(rendered.length).toBeGreaterThan(200);
      expect(
        containsTutorPrompt(rendered, fingerprints),
        fixture.id,
      ).not.toBeNull();
    }
  });

  it("drops a matching line, names the file, never the text, and fails the run once", () => {
    const reports: string[] = [];
    let failures = 0;
    const guard = makeTutorConsoleGuard(
      fingerprints,
      (l) => reports.push(l),
      () => (failures += 1),
    );
    const rendered = buildSystemInstruction(ALL_FIXTURES[0]!.request);

    expect(
      guard.onConsoleLog(rendered, "stdout", {
        moduleId: "/repo/tests/ci/planted.test.ts",
      }),
    ).toBe(false);
    expect(
      guard.onConsoleLog(`prefix ${rendered} suffix`, "stderr", undefined),
    ).toBe(false);
    expect(failures).toBe(1);
    expect(guard.blocked()).toEqual([
      "/repo/tests/ci/planted.test.ts",
      "unknown test file",
    ]);
    expect(reports).toHaveLength(2);
    for (const r of reports)
      expect(containsTutorPrompt(r, fingerprints)).toBeNull();

    // Control: ordinary output passes through untouched.
    expect(
      guard.onConsoleLog(
        "Pure Class 1 anti-leak coverage: 12/12",
        "stdout",
        undefined,
      ),
    ).toBeUndefined();
    expect(failures).toBe(1);
  });

  it("is wired into both vitest configs", () => {
    for (const cfg of ["vitest.config.ts", "vitest.integration.config.ts"]) {
      const src = readFileSync(join(ROOT, cfg), "utf8");
      expect(src, cfg).toMatch(
        /onConsoleLog:\s*tutorConsoleGuard\.onConsoleLog/,
      );
      expect(src, cfg).toMatch(
        /makeTutorConsoleGuard\(\s*loadTutorPromptFingerprints\(/,
      );
    }
  });
});
