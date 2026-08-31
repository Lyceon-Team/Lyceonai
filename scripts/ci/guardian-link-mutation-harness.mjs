#!/usr/bin/env node
/**
 * @spec [owner instruction 2026-08-27 Part B — "make the guards structural, not habitual"]
 *
 * plain English: runs the declared mutations against the guardian-link student-side proof and
 * checks that each one turns EXACTLY the cases it claims to turn red. Restores every file
 * afterwards, including on crash.
 *
 * WHY THIS EXISTS. Three variants of one hazard appeared in three consecutive steps, and all
 * three read as green:
 *   - a mutation that never applied, because prettier had reformatted the target (step 2)
 *   - a mutation that reds an EARLIER assertion than the one it meant to prove, so the row
 *     assertions below it never ran (step 1)
 *   - an assertion that could not fail, because the precondition put a different mechanism in
 *     the path — the resolver answering 404 where the route's own guard was named (steps 1-3,
 *     three instances)
 * The common root is that absence of effect is indistinguishable from evidence of correctness.
 * Doing this by hand caught all three, but only because someone looked. This makes the looking
 * mechanical.
 *
 * WHAT IT ENFORCES, one rule per hazard:
 *   1. APPLIED. A mutation whose target text is not found is STALE — a hard failure, never a
 *      pass. It cannot be confused with "the code survived it".
 *   2. EXACT RED SET. Each mutation declares which cases it must turn red, BY NAME. Reddening
 *      more cases than declared fails (the mutation is blunter than claimed); reddening fewer
 *      fails (a case that was supposed to be proven is not). A mutation that reds six cases
 *      therefore proves none of them individually unless it says so.
 *   3. GREEN BASELINE. The suite must be fully green before any mutation and after every
 *      restore, so a pre-existing failure cannot be mistaken for a mutation's effect.
 *
 * REMOVED FROM THE MANIFEST at step 4: "break the status transition in the domain function".
 *   Its target was `status: "active"` in `acceptGuardianLink`, and that statement is no longer
 *   in TypeScript — it moved into `accept_guardian_link_audited`. The harness reported it as
 *   STALE rather than passing, which is the rule working on a refactor rather than on a typo.
 *   It is deleted rather than retargeted because this harness patches source files, and the
 *   SQL is loaded into the database before any of it runs.
 *
 * WHAT IS DELIBERATELY NOT IN THE MANIFEST, and why that is the good news.
 *   The fail-closed property (step 4) has no entry here, because no TypeScript edit can break
 *   it. The transition and its audit row share a database transaction, so the guarantee lives
 *   in `accept_guardian_link_audited` and its siblings rather than in any `catch`. Its proof
 *   accordingly breaks the audit insert AT THE DATABASE — a NOT VALID check constraint — and
 *   asserts the link did not move. A property that application code cannot mutate away is
 *   exactly what moving it into the transaction bought; recording an absence here rather than
 *   inventing a weak mutation to fill the row.
 *
 * Requires a database: skips with a stated reason when PGHOST is unset, exactly as the proof
 * it drives does.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SUITE = "tests/ci/guardian-link-student-side.pg.ci.test.ts";
const ROUTES = "server/routes/student-resources.ts";
const ACCOUNT = "server/lib/account.ts";

/**
 * The mutation manifest.
 *
 * `expectRed` lists a substring of each case title that MUST fail, and nothing else may.
 * Keeping it a substring rather than the full title means a copy-edit to a test name does not
 * silently empty the expectation — the substring still has to match something, and rule 2
 * fails loudly if it matches nothing.
 */
const MUTATIONS = [
  {
    name: "via-guard: the route's own self check, all three link routes",
    file: ROUTES,
    find: '    if (subject.via !== "self") {\n      return sendNotFound(res, requestId);\n    }',
    replace: "    if (false) {\n      return sendNotFound(res, requestId);\n    }",
    occurrences: 3,
    expectRed: [
      "404s a guardian using the student's route",
      "404s a guardian on the student's revoke route",
      "404s a non-self caller on initiate",
    ],
    note: "All three via-cases. Each was written at some point in a state where the RESOLVER answered first and this guard never ran; this mutation is what proves they now reach it.",
  },
  {
    name: "accept: answer 200 and write nothing",
    file: ROUTES,
    find: "      link = await acceptGuardianLink(linkId, subject.studentId);",
    replace:
      '      link = { ...existing, status: "active" };\n      void acceptGuardianLink;',
    occurrences: 1,
    expectRed: [
      "a guardian-initiated link reaches active",
      "409s a second acceptance",
      "409s the student when the link is not theirs",
      "writes one audit_logs row",
      "FAIL-CLOSED: a failing audit insert leaves the link UNACCEPTED",
      "FAIL-CLOSED: with the audit insert repaired",
    ],
    note: "Reds the ROW assertion with HTTP 200 and a body claiming success — the mutation that proves acceptance HAPPENED. THE AUDIT CASE NOW REDS TOO, and did not before step 4: while the route wrote the audit, that row was built from values the route already held and stayed correct whether or not the status write landed. Now the audit is written by the same database transaction as the status change, so skipping the transition skips its record. That change in this manifest is itself evidence the move did what it claimed.",
  },
  {
    name: "initiate: wrong initiator, guardian instead of student",
    file: ROUTES,
    find: '        "student",\n      );',
    replace: '        "guardian",\n      );',
    occurrences: 1,
    expectRed: [
      "a student invites a guardian",
      "the student-initiated direction completes",
    ],
    note: "Reds on the ROW status: pending_student_accept where pending_guardian_accept belongs.",
  },
  {
    name: "revoke: record the guardian as revoker instead of the student",
    file: ROUTES,
    find: "        existing.guardian_profile_id,\n        subject.studentId,\n        subject.studentId,\n        body.data.reason,",
    replace:
      "        existing.guardian_profile_id,\n        subject.studentId,\n        existing.guardian_profile_id,\n        body.data.reason,",
    occurrences: 1,
    expectRed: ["records THEM as revoker"],
    note: "§36.3's entire content: the revoker is recorded, not assumed. Reds exactly one case, so that case is individually proven.",
  },
];

function sh(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
}

/**
 * Run the suite; return the set of failing case titles.
 *
 * The report goes to a FILE, not stdout. The app under test writes structured JSON logs to
 * stdout during the run, so scraping the stream finds a log line before it finds the report —
 * the first version of this did exactly that and died on a "Student accepted link" record.
 */
function runSuite() {
  const reportPath = path.join(ROOT, "node_modules/.cache/glmh-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.rmSync(reportPath, { force: true });
  try {
    sh("pnpm", [
      "exec",
      "vitest",
      "run",
      SUITE,
      "--reporter=json",
      `--outputFile=${reportPath}`,
    ]);
  } catch {
    // A failing suite exits non-zero; the report is still written, and it is the point.
  }
  if (!fs.existsSync(reportPath)) {
    throw new Error("vitest wrote no JSON report — the run did not start");
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const failed = [];
  let total = 0;
  for (const file of report.testResults ?? []) {
    for (const t of file.assertionResults ?? []) {
      total += 1;
      if (t.status === "failed") failed.push(t.title ?? t.fullName ?? "?");
    }
  }
  return { failed, total };
}

function main() {
  if (!process.env.PGHOST) {
    console.log(
      "guardian-link mutation harness: SKIPPED — PGHOST is unset, and the proof this drives requires a real database.",
    );
    console.log(
      "  This is a skip, not a pass. The CI job that runs it sets PGHOST.",
    );
    return 0;
  }

  const files = [...new Set(MUTATIONS.map((m) => m.file))];
  const originals = new Map(
    files.map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]),
  );
  const restore = () => {
    for (const [f, text] of originals)
      fs.writeFileSync(path.join(ROOT, f), text);
  };

  let failures = 0;
  try {
    // RULE 3 — a green baseline, so nothing below is confused with a pre-existing failure.
    const base = runSuite();
    if (base.failed.length > 0) {
      console.log("MUTATION HARNESS: FAIL — the suite is not green before mutating.");
      for (const t of base.failed) console.log(`    pre-existing failure: ${t}`);
      return 1;
    }
    console.log(`baseline: ${base.total} case(s), all green\n`);

    for (const m of MUTATIONS) {
      const abs = path.join(ROOT, m.file);
      const src = originals.get(m.file);
      const count = src.split(m.find).length - 1;

      // RULE 1 — APPLIED. Never let "did not apply" read as "survived".
      if (count !== m.occurrences) {
        console.log(`  ${m.name}`);
        console.log(
          `    STALE — target found ${count} time(s), expected ${m.occurrences}. This mutation did NOT apply.`,
        );
        console.log(
          "    STALE IS A FAILURE, NOT A PASS: nothing was proven about this behaviour.",
        );
        failures += 1;
        continue;
      }

      fs.writeFileSync(abs, src.split(m.find).join(m.replace));
      const { failed } = runSuite();
      restore();

      // RULE 2 — EXACT RED SET.
      const matched = new Set();
      const unexplained = [];
      for (const title of failed) {
        const hit = m.expectRed.find((frag) => title.includes(frag));
        if (hit) matched.add(hit);
        else unexplained.push(title);
      }
      const missing = m.expectRed.filter((frag) => !matched.has(frag));

      console.log(`  ${m.name}`);
      console.log(`    red: ${failed.length} case(s)`);
      if (missing.length === 0 && unexplained.length === 0) {
        for (const frag of m.expectRed) console.log(`      ✓ ${frag}`);
        if (m.expectRed.length > 1) {
          console.log(
            `    NOTE: reds ${m.expectRed.length} cases together, so none of them is proven INDIVIDUALLY by this mutation alone.`,
          );
        }
        console.log(`    ${m.note}`);
      } else {
        for (const frag of missing)
          console.log(`      ✗ declared red but PASSED: ${frag}`);
        for (const t of unexplained)
          console.log(`      ✗ red but NOT declared: ${t}`);
        console.log(
          "    The manifest and the code disagree. Either the mutation is blunter than claimed, or a case it should prove no longer reaches the mechanism it names.",
        );
        failures += 1;
      }
      console.log("");
    }

    // The suite must be green again, or a restore did not take.
    const after = runSuite();
    if (after.failed.length > 0) {
      console.log("MUTATION HARNESS: FAIL — the suite is not green after restore.");
      failures += 1;
    }
  } finally {
    restore();
  }

  console.log(
    failures === 0
      ? "GUARDIAN-LINK MUTATION HARNESS: PASS"
      : `GUARDIAN-LINK MUTATION HARNESS: FAIL (${failures})`,
  );
  return failures === 0 ? 0 : 1;
}

process.exit(main());
