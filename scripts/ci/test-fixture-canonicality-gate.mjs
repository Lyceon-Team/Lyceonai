#!/usr/bin/env node
/**
 * @spec [Doc 05B §4.2 domain canonicality is BLOCKING; owner ruling 2026-08-20 build
 *   question 2 answer (skill names are the canonical DB strings, rendered verbatim)]
 * @implemented 2026-08-20
 *
 * plain English: fails the build when a TEST FIXTURE seeds a (section, domain, skill)
 * triple the database would reject.
 *
 * WHY THIS GATE EXISTS.
 *   `SAT_TAXONOMY` shipped slugs — `math`, `advanced_math`, `linear_equations` — against
 *   a database holding `M`, `Advanced Math`, `Linear Equations in One Variable`. The join
 *   matched nothing and the mastery page rendered "No Mastery Data Yet" for every student
 *   who had data. It survived for months because the TESTS seeded the same slugs: every
 *   suite agreed with the broken code instead of with the schema, so the whole surface
 *   was green and wrong. A fixture that the database would reject is not a fixture, it is
 *   a second, private schema.
 *
 * WHAT IT CHECKS.
 *   Object literals that stand in for a ROW of a table whose (section, domain) pairing
 *   the database CHECK-constrains — `student_skill_mastery`, `student_domain_mastery`,
 *   `questions` — or for a mastery DTO built from one. It recognises them by a
 *   `section` property sitting beside one of ROW_MARKERS below.
 *     1. `section` must be 'M' or 'RW' (the `questions_section_check` CHECK).
 *     2. `domain` must be canonical FOR THAT SECTION (CANONICAL_DOMAINS_BY_SECTION,
 *        which mirrors refresh_domain_mastery's own two lists).
 *     3. `skill` must not be snake_case. Canonical skills are College Board display
 *        strings; a lower_snake identifier is the exact shape of the slugs that caused
 *        the outage.
 *
 * WHAT IT DOES NOT CHECK, AND WHY. Two deliberate limits, stated rather than hidden:
 *   1. It does not confirm the skill string EXISTS in `canonical_skill_catalog`. That
 *      needs a committed snapshot of the view and no such snapshot exists in the repo;
 *      inventing one from memory would be a fabricated source of truth, which is worse
 *      than a stated limit. Rule 3 is a shape check, and says so when it fires.
 *   2. It does not police `section` on surfaces that legitimately carry a DIFFERENT
 *      vocabulary. Three exist in this repo today: `questions.section` ('M'/'RW'),
 *      calendar task targets ('MATH'/'RW', apps/api/src/routes/calendar.ts:314), and
 *      display labels ('Math'/'Reading & Writing'). Only the first is CHECK-constrained,
 *      so only fixtures standing in for those rows are in scope. Widening the net to
 *      every `section:` literal produces false positives on the other two, and a gate
 *      that cries wolf gets switched off.
 *
 * MUTATIONS THIS MUST CATCH (each verified by scripts/ci/test-fixture-canonicality-gate.selftest.sh):
 *   - reintroduce `section: "math"` in any mastery fixture   → rule 1, names file:line
 *   - pair a real domain with the wrong section              → rule 2, names file:line
 *   - reintroduce `skill: "linear_equations"`                → rule 3, names file:line
 *   - point the gate at zero files                           → EXIT 1. Zero scanned files
 *     is not zero violations: a glob that stops matching reports "clean" forever.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const REPO_ROOT = resolve(new URL("../..", import.meta.url).pathname);

/**
 * The canonical pairing, read from the committed application source rather than
 * restated here. Parsing the literal out of question-bank-contract.ts keeps this gate
 * from becoming the third copy of the list it exists to defend.
 */
function loadCanonicalDomains() {
  const contractPath = resolve(REPO_ROOT, "shared/question-bank-contract.ts");
  const source = readFileSync(contractPath, "utf8");
  const sf = ts.createSourceFile(
    contractPath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );

  let found = null;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "CANONICAL_DOMAINS_BY_SECTION" &&
      node.initializer
    ) {
      const init = ts.isAsExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (ts.isObjectLiteralExpression(init)) {
        const out = {};
        for (const prop of init.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const key = prop.name.getText(sf).replace(/['"]/g, "");
          if (!ts.isArrayLiteralExpression(prop.initializer)) continue;
          out[key] = prop.initializer.elements
            .filter((e) => ts.isStringLiteral(e))
            .map((e) => e.text);
        }
        found = out;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!found || !found.M?.length || !found.RW?.length) {
    // Not "no domains" — a failed parse. The two are different answers and only one
    // of them may pass.
    console.error(
      "FAIL: could not parse CANONICAL_DOMAINS_BY_SECTION out of shared/question-bank-contract.ts.",
    );
    console.error(
      "      The gate has no canonical list to check against, which is a broken gate, not a clean tree.",
    );
    process.exit(1);
  }
  return found;
}

const DEFAULT_PATHSPEC = [
  "tests/**/*.ts",
  "tests/**/*.tsx",
  "client/src/**/*.test.ts",
  "client/src/**/*.test.tsx",
  "apps/**/__tests__/**/*.ts",
  "packages/**/__tests__/**/*.ts",
];

/**
 * Files in scope: every test source that could seed a mastery fixture.
 *
 * FIXTURE_CANONICALITY_PATHSPEC exists so the self-test can point the gate at a narrower
 * set. It is not a bypass: narrowing it to nothing makes the gate EXIT 1 (see main), so
 * the only thing this variable can do is make the gate louder or fail. Untracked files
 * are deliberately out of scope — `git ls-files` is the committed tree, which is what CI
 * actually runs.
 */
function listCandidateFiles() {
  const override = process.env.FIXTURE_CANONICALITY_PATHSPEC;
  const pathspec = override
    ? override.split(/\s+/).filter((part) => part.length > 0)
    : DEFAULT_PATHSPEC;
  const out = execFileSync("git", ["ls-files", "--", ...pathspec], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => existsSync(resolve(REPO_ROOT, line)));
}

/**
 * Keys that mark a literal as standing in for a row of one of the CHECK-constrained
 * tables (or a DTO built from one). `section` alone is not enough — see limit 2 above.
 */
const ROW_MARKERS = [
  "mastery_level", // student_skill_mastery / student_domain_mastery
  "masteryLevel", // the same row, as a client DTO
  "mastery_score",
  "mastery_pct",
  "student_id",
  "skill_codes", // questions
  "levelKey", // the RULE 1 DTO
];

function stringLiteralProps(node, sf) {
  /** @type {Map<string, {value: string | null, node: ts.Node}>} */
  const props = new Map();
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    const rawKey = prop.name.getText(sf);
    const key = rawKey.replace(/^["']|["']$/g, "");
    const init = prop.initializer;
    const value =
      ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)
        ? init.text
        : null;
    props.set(key, { value, node: init });
  }
  return props;
}

function checkFile(relPath, canonical, violations) {
  const abs = resolve(REPO_ROOT, relPath);
  const source = readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(abs, source, ts.ScriptTarget.Latest, true);

  const report = (node, rule, message) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    violations.push({ file: relPath, line: line + 1, rule, message });
  };

  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const props = stringLiteralProps(node, sf);
      const section = props.get("section");
      const looksLikeMasteryFixture =
        section !== undefined &&
        ROW_MARKERS.some((marker) => props.has(marker));

      if (looksLikeMasteryFixture && section.value !== null) {
        // Rule 1 — the section CHECK.
        if (section.value !== "M" && section.value !== "RW") {
          report(
            section.node,
            "section",
            `section: ${JSON.stringify(section.value)} — the database stores 'M' or 'RW' (CHECK-constrained)`,
          );
        } else {
          // Rule 2 — the (section, domain) pairing.
          const domain = props.get("domain");
          if (domain && domain.value !== null) {
            const allowed = canonical[section.value] ?? [];
            if (!allowed.includes(domain.value)) {
              report(
                domain.node,
                "domain",
                `(${section.value}, ${JSON.stringify(domain.value)}) is not a canonical pair — allowed for ${section.value}: ${allowed.map((d) => JSON.stringify(d)).join(", ")}`,
              );
            }
          }
        }

        // Rule 3 — skill shape (see "WHAT IT DOES NOT CHECK" above).
        const skill = props.get("skill");
        if (
          skill &&
          skill.value !== null &&
          /^[a-z0-9]+(_[a-z0-9]+)+$/.test(skill.value)
        ) {
          report(
            skill.node,
            "skill",
            `skill: ${JSON.stringify(skill.value)} is snake_case — canonical skills are College Board display strings such as "Linear Equations in One Variable". (Shape check only: this gate cannot confirm membership in canonical_skill_catalog.)`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function main() {
  const canonical = loadCanonicalDomains();
  const files = listCandidateFiles();

  if (files.length === 0) {
    console.error(
      "FAIL: the fixture-canonicality gate scanned ZERO files. A glob that stops matching",
    );
    console.error(
      "      reports a clean tree forever; zero scanned files is a broken gate, not a pass.",
    );
    process.exit(1);
  }

  const violations = [];
  for (const file of files) {
    checkFile(file, canonical, violations);
  }

  if (violations.length > 0) {
    console.error(
      `FAIL: ${violations.length} non-canonical mastery fixture value(s) across ${files.length} scanned file(s).`,
    );
    console.error(
      "      A fixture the database would reject is a second, private schema — it is how",
    );
    console.error(
      "      the SAT_TAXONOMY slug mismatch stayed green for months.\n",
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  [${v.rule}] ${v.message}`);
    }
    process.exit(1);
  }

  console.log(
    `OK: fixture canonicality — ${files.length} test file(s) scanned, no non-canonical (section, domain, skill) fixture found.`,
  );
}

main();
