#!/usr/bin/env node
/**
 * vitest summary gate — proves a PG-backed suite RAN, from vitest's own machine-readable verdict.
 *
 * @spec [owner ruling R10 2026-09-03: "a gate that cannot recognise a pass" — failure class 12]
 * @implemented 2026-09-03
 *
 * WHY THIS REPLACES `grep -q skipped`. The previous guard grepped the whole stdout for the
 * word "skipped". Any log line anywhere in the process that happened to contain the word —
 * the notifications dispatcher's `{"skipped":0}` summary did, on 2026-09-03 — turned a 7/7
 * pass into "the suite SKIPPED rather than running". That is a gate that cannot recognise a
 * pass. This one reads the JSON report vitest writes with `--reporter=json --outputFile=<f>`
 * (the same verdict its console summary prints, as structured data) and nothing else. Text
 * output is never inspected, so no log line can ever influence it.
 *
 * Usage:
 *   pnpm exec vitest run <files> --reporter=default --reporter=json --outputFile=/tmp/vitest.json
 *   node scripts/ci/vitest-summary-gate.mjs --json /tmp/vitest.json --file tests/ci/x.test.ts [--file ...]
 *   node scripts/ci/vitest-summary-gate.mjs --selftest
 *
 * Exit 1 with a reason when: the report is missing or unreadable; `success` is not true;
 * no test passed; any test is skipped, failed, or todo; any suite file is skipped or failed;
 * or a named file has no `passed` result with at least one assertion. The self-test proves
 * each of those turns the gate red and that a clean report turns it green.
 */
import { readFileSync } from "node:fs";

export function evaluate(report, files) {
  const reasons = [];
  if (!report || typeof report !== "object") return ["report is not an object"];

  if (report.success !== true) reasons.push(`report.success is ${String(report.success)}`);
  const n = (k) => (typeof report[k] === "number" ? report[k] : 0);
  if (n("numPassedTests") === 0) reasons.push("no test passed (numPassedTests = 0)");
  if (n("numPendingTests") > 0) reasons.push(`${n("numPendingTests")} test(s) skipped (numPendingTests)`);
  if (n("numFailedTests") > 0) reasons.push(`${n("numFailedTests")} test(s) failed`);
  if (n("numTodoTests") > 0) reasons.push(`${n("numTodoTests")} test(s) todo`);
  if (n("numPendingTestSuites") > 0) reasons.push(`${n("numPendingTestSuites")} suite file(s) skipped`);
  if (n("numFailedTestSuites") > 0) reasons.push(`${n("numFailedTestSuites")} suite file(s) failed`);

  const results = Array.isArray(report.testResults) ? report.testResults : [];
  for (const file of files) {
    const match = results.find((r) => typeof r.name === "string" && (r.name === file || r.name.endsWith(`/${file}`)));
    if (!match) {
      reasons.push(`no result for ${file} — it did not run`);
    } else if (match.status !== "passed") {
      reasons.push(`${file} status is ${String(match.status)}, not passed`);
    } else if (!Array.isArray(match.assertionResults) || match.assertionResults.length === 0) {
      reasons.push(`${file} passed with zero assertions — a vacuous pass`);
    }
  }
  return reasons;
}

function fixture(overrides = {}, fileOverrides = {}) {
  return {
    success: true,
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: 7,
    numPassedTests: 7,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    ...overrides,
    testResults: [
      {
        name: "/home/runner/work/Lyceonai/Lyceonai/tests/ci/a.pg.ci.test.ts",
        status: "passed",
        assertionResults: Array.from({ length: 7 }, (_, i) => ({ status: "passed", title: `case ${i}` })),
        ...fileOverrides,
      },
    ],
  };
}

function selftest() {
  const A = ["tests/ci/a.pg.ci.test.ts"];
  const cases = [
    ["clean report passes", fixture(), A, 0],
    ["a skipped test fails it", fixture({ numPendingTests: 3, numTotalTests: 10 }), A, 1],
    ["a skipped suite file fails it", fixture({ success: true, numPendingTestSuites: 1, numPassedTestSuites: 0, numPassedTests: 0, numPendingTests: 7 }, { status: "skipped", assertionResults: [] }), A, 1],
    ["a failed test fails it", fixture({ success: false, numFailedTests: 1, numPassedTests: 6 }), A, 1],
    ["zero passes fails it", fixture({ numPassedTests: 0, numTotalTests: 0 }, { assertionResults: [] }), A, 1],
    ["a named file that did not run fails it", fixture(), [...A, "tests/ci/b.pg.ci.test.ts"], 1],
    ["a passed file with zero assertions fails it", fixture({}, { assertionResults: [] }), A, 1],
    ["an unreadable report fails it", null, A, 1],
  ];
  let bad = 0;
  for (const [label, report, files, expected] of cases) {
    const reasons = evaluate(report, files);
    const got = reasons.length ? 1 : 0;
    const ok = got === expected;
    if (!ok) bad += 1;
    process.stdout.write(`  ${ok ? "ok  " : "FAIL"} ${label}${reasons.length ? ` — ${reasons[0]}` : ""}\n`);
  }
  process.stdout.write(bad ? `VITEST SUMMARY GATE SELF-TEST: FAIL (${bad})\n` : "VITEST SUMMARY GATE SELF-TEST: PASS\n");
  process.exit(bad ? 1 : 0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) return selftest();
  const files = [];
  let jsonPath = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--file") files.push(args[++i]);
    else if (args[i] === "--json") jsonPath = args[++i];
  }
  if (!jsonPath) {
    process.stderr.write("VITEST SUMMARY GATE: --json <report> is required\n");
    process.exit(1);
  }
  let report = null;
  try {
    report = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (err) {
    process.stderr.write(`VITEST SUMMARY GATE: cannot read report ${jsonPath}: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  const reasons = evaluate(report, files);
  if (reasons.length) {
    for (const r of reasons) process.stderr.write(`VITEST SUMMARY GATE: ${r}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `VITEST SUMMARY GATE: PASS (${report.numPassedTests} passed, 0 skipped, 0 failed; ${files.length} named file(s) ran with assertions)\n`,
  );
}

main();
