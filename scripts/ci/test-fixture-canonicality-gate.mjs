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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  listTrackedFiles,
  parsePathspecOverride,
} from "./lib/git-tracked-files.mjs";
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
  // The whole test tree, not an extension list. Formats the gate can parse are checked;
  // formats it cannot are caught by the unparsed-format tripwire rather than skipped. That
  // is the #640 lesson applied to a gate that genuinely needs a parser per format.
  "tests/**",
  "client/src/**/*.test.ts",
  "client/src/**/*.test.tsx",
  "apps/**/__tests__/**",
  "packages/**/__tests__/**",
  // Binaries and generated blobs cannot hold a reviewable fixture literal.
  ":(exclude)*.png",
  ":(exclude)*.jpg",
  ":(exclude)*.jpeg",
  ":(exclude)*.gif",
  ":(exclude)*.webp",
  ":(exclude)*.pdf",
  ":(exclude)*.ico",
  ":(exclude)*.woff",
  ":(exclude)*.woff2",
  ":(exclude)*.ttf",
  ":(exclude)*.zip",
  ":(exclude)*.gz",
  ":(exclude)**/node_modules/**",
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
  const pathspec = parsePathspecOverride(
    process.env.FIXTURE_CANONICALITY_PATHSPEC,
    DEFAULT_PATHSPEC,
  );
  return listTrackedFiles({ repoRoot: REPO_ROOT, pathspec });
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

/**
 * THE THREE RULES, IN ONE PLACE.
 *
 * `props` is a Map<key, {value: string|null}> and `report(key, rule, message)` resolves a
 * key back to a line however the caller's format allows. Everything below is format-blind
 * on purpose: the TypeScript extractor and the JSON extractor feed the SAME function, so a
 * rule cannot be true of a `.ts` fixture and false of an `.ndjson` one. Forking these rules
 * per format is precisely the divergence this gate exists to catch, one level up.
 */
function applyFixtureRules(props, canonical, report) {
  const section = props.get("section");
  // WHAT COUNTS AS A DB-CANONICAL FIXTURE — and why `stem`/`item_type` are NOT markers.
  //   `section` alone is not enough: `apps/api/src/services/fullLengthExam.ts:173` declares
  //   `type SectionType = "rw" | "math"` for EXAM MODULES, with an explicit normalizer at
  //   :652 mapping "M"/"MATH" -> "math". Exam-state fixtures carrying `section: "math"` are
  //   therefore correct, not drift, and a gate that flags them fails the build on working
  //   code. Marking on question-content keys (`stem`, `item_type`) catches exactly those.
  //
  //   `domain` is the discriminator. The canonical (section, domain) pair is what these
  //   rules are ABOUT, it exists only on records shaped like database rows, and exam-module
  //   state has no domain at all.
  //   NOT YET ENABLED: adding `props.has("domain")` as a second discriminator surfaces 26
  //   candidate findings across 8 files (section "Math"/"MATH", snake_case domains and
  //   skills, and one flatly wrong (RW, "Algebra") pair). Those are real candidates, but
  //   they belong to the owner's parked section-vocabulary audit, not to a gate-plumbing
  //   change. Enabling it here would fail the build on a question nobody has ruled on yet.
  const looksLikeMasteryFixture =
    section !== undefined && ROW_MARKERS.some((marker) => props.has(marker));
  if (!looksLikeMasteryFixture || section.value === null) {
    return;
  }

  // Rule 1 — the section CHECK.
  if (section.value !== "M" && section.value !== "RW") {
    report(
      "section",
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
          "domain",
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
      "skill",
      "skill",
      `skill: ${JSON.stringify(skill.value)} is snake_case — canonical skills are College Board display strings such as "Linear Equations in One Variable". (Shape check only: this gate cannot confirm membership in canonical_skill_catalog.)`,
    );
  }
}

/** TypeScript/JavaScript source: object literals, located by AST position. */
function checkSourceFile(relPath, source, canonical, violations) {
  const sf = ts.createSourceFile(
    resolve(REPO_ROOT, relPath),
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const props = stringLiteralProps(node, sf);
      applyFixtureRules(props, canonical, (key, rule, message) => {
        const entry = props.get(key);
        const anchor = entry ? entry.node : node;
        const { line } = sf.getLineAndCharacterOfPosition(anchor.getStart(sf));
        violations.push({ file: relPath, line: line + 1, rule, message });
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/**
 * JSON and NDJSON fixtures.
 *
 * WHY THIS EXISTS. The gate used to scan `tests/**\/*.ts` and `*.tsx` only, while eight
 * fixture records lived in `tests/fixtures/**\/*.ndjson` — files literally under a directory
 * named `fixtures`, invisible to a gate whose success line says "no non-canonical fixture
 * found". Their values happened to be canonical, so nothing was wrong; the CLAIM was just
 * broader than the check, which is the same shape as every other defect in this vertical.
 */
function checkJsonFile(relPath, source, canonical, violations) {
  const lines = source.split("\n");
  const locate = (key, value) => {
    const needle =
      typeof value === "string"
        ? new RegExp(`"${key}"\\s*:\\s*${escapeForRegExp(JSON.stringify(value))}`)
        : new RegExp(`"${key}"\\s*:`);
    const idx = lines.findIndex((line) => needle.test(line));
    return idx === -1 ? 1 : idx + 1;
  };

  const walk = (value, lineHint) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, lineHint);
      return;
    }
    if (value === null || typeof value !== "object") {
      return;
    }
    /** @type {Map<string, {value: string | null}>} */
    const props = new Map();
    for (const [k, v] of Object.entries(value)) {
      props.set(k, { value: typeof v === "string" ? v : null });
    }
    applyFixtureRules(props, canonical, (key, rule, message) => {
      const entry = props.get(key);
      violations.push({
        file: relPath,
        line: lineHint ?? locate(key, entry ? entry.value : null),
        rule,
        message,
      });
    });
    for (const v of Object.values(value)) walk(v, lineHint);
  };

  if (relPath.endsWith(".ndjson")) {
    // One record per line: the line number IS the record index, no searching needed.
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // A malformed line is not this gate's business — the pipeline's own parser owns
        // that. Skipping is safe here BECAUSE it is reported, not swallowed.
        violations.push({
          file: relPath,
          line: index + 1,
          rule: "unparsed",
          message:
            "line is not valid JSON, so its fixture values could not be checked. A record this gate cannot read must not be reported as a record it approved.",
        });
        return;
      }
      walk(parsed, index + 1);
    });
    return;
  }

  try {
    walk(JSON.parse(source), null);
  } catch {
    violations.push({
      file: relPath,
      line: 1,
      rule: "unparsed",
      message:
        "file is not valid JSON, so its fixture values could not be checked.",
    });
  }
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * THE TRIPWIRE — a file type this gate cannot parse must announce itself.
 *
 * #640 established that an extension ALLOWLIST is a blind-spot generator: it grows one every
 * time the repo gains a file type, and nothing says so. This gate genuinely cannot use a
 * denylist — it needs a parser per format, and there is no parser for CSS or SQL. So instead
 * of pretending, it FAILS when an unparsed file inside its own scope looks like it holds a
 * fixture. The next `.yaml` fixture someone adds under `tests/` breaks the build with an
 * instruction, rather than being silently skipped.
 */
const FIXTURE_KEY_TRIPWIRE = /["']?section["']?\s*:\s*["']/;

function checkUnparsedFile(relPath, source, violations) {
  if (!FIXTURE_KEY_TRIPWIRE.test(source)) {
    return;
  }
  const lines = source.split("\n");
  const idx = lines.findIndex((line) => FIXTURE_KEY_TRIPWIRE.test(line));
  violations.push({
    file: relPath,
    line: idx === -1 ? 1 : idx + 1,
    rule: "unparsed-format",
    message:
      "this file is in the gate's scope and carries a `section:` literal, but the gate has no parser for its extension — so its fixture values are UNCHECKED. Add a parser branch in checkFile(), or move the fixture to a format the gate reads (.ts/.tsx/.js/.json/.ndjson).",
  });
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs"];
const JSON_EXTENSIONS = [".json", ".ndjson"];

function checkFile(relPath, canonical, violations) {
  const source = readFileSync(resolve(REPO_ROOT, relPath), "utf8");
  if (SOURCE_EXTENSIONS.some((ext) => relPath.endsWith(ext))) {
    checkSourceFile(relPath, source, canonical, violations);
    return;
  }
  if (JSON_EXTENSIONS.some((ext) => relPath.endsWith(ext))) {
    checkJsonFile(relPath, source, canonical, violations);
    return;
  }
  checkUnparsedFile(relPath, source, violations);
}

function main() {
  const canonical = loadCanonicalDomains();
  const { files, skippedMissing } = listCandidateFiles();
  // Never silent — see scripts/ci/lib/git-tracked-files.mjs. An unreported skip is how a
  // sibling gate under-scanned 81 files and still reported a clean tree.
  if (skippedMissing.length > 0) {
    console.error(
      `NOTE: ${skippedMissing.length} tracked path(s) are absent from the working tree and were not scanned:`,
    );
    for (const entry of skippedMissing) {
      console.error(`      ${entry}`);
    }
  }

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
