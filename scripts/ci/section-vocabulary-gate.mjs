#!/usr/bin/env node
/**
 * @spec [Doc-04B_V4.3 §11.2; Doc-05B_V1.0 §4.2; owner ruling 2026-09-02]
 * @implemented [2026-09-02]
 *
 * SECTION VOCABULARY GATE — one internal vocabulary, one display mapping.
 *
 * plain English: a section is 'M' or 'RW'. That is what all sixteen CHECK constraints
 * accept, and it is the only spelling any non-display code may use. Human-readable
 * forms ("Math", "Reading & Writing") are produced by `shared/section-display.ts` at
 * render time and by nothing else. Non-canonical INPUT spellings are absorbed by
 * `shared/question-bank-contract.ts` at the boundary and by nothing else.
 *
 * WHY THIS EXISTS. Before 2026-09-02 this repository carried FIVE section vocabularies:
 *   1. M / RW                       canonical, 16 CHECK-constrained columns
 *   2. MATH / RW                    exam + calendar + a "single source of truth" Zod enum
 *   3. Math / Reading & Writing     display, hardcoded in eleven files
 *   4. math / rw                    fullLengthExam's SectionType
 *   5. Math / RW / Random           practice, and the only one that reached storage
 * Vocabulary 5 was persisted into `practice_sessions.filters->session_spec->sections`,
 * the one place a section is stored inside jsonb where no CHECK can see it, and thirteen
 * production rows held it. Vocabularies 2, 4 and 5 were deleted; this gate is what stops
 * a sixth from appearing.
 *
 * THE TWO RULES
 *   A. A string literal in a SECTION POSITION must be 'M' or 'RW', or one of the named
 *      sentinels. A section position is the value of a section-named property, or an
 *      operand of an equality comparison whose other side names a section.
 *      Two files are exempt, for opposite and stated reasons:
 *        shared/section-display.ts       produces the long forms (render output)
 *        shared/question-bank-contract.ts accepts foreign spellings (boundary input)
 *   B. The literal "MATH" is forbidden EVERYWHERE, with no file exemption. Doc 04B V4.3
 *      §11.2 names it as a retired defect — `upper(p_section)` producing the wrong value
 *      — so once vocabulary 2 is gone the spelling has no legitimate home in TypeScript.
 *
 * WHAT IT DELIBERATELY DOES NOT FLAG.
 *   Prose. "SAT Reading & Writing Prep" in a page title, a blog post or an SEO record is
 *   English, not a section value, and a gate that fails the build on marketing copy gets
 *   switched off. Rule A is positional for exactly that reason: it looks at where the
 *   literal SITS, not at what it spells.
 *   Comments are stripped before Rule B, so this file and the migration that repairs the
 *   data can explain the history without tripping the check they describe.
 *   Identifiers are not literals: MATH_TOKENS, SECTION_LABEL_MATH, MATHPIX_API_ID and
 *   MATH_SCALED_BY_RAW_CORRECT are names, and Rule B matches string VALUES only.
 *
 * WHAT RULE A CANNOT SEE, STATED RATHER THAN IMPLIED.
 *   A section passed as a POSITIONAL ARGUMENT — `buildHookState("Math")`,
 *   `addModule("math", 1, 27)` — is invisible to it: the parameter's meaning lives in
 *   the callee's type, and this gate does not run the type checker. Nineteen such call
 *   sites existed in CanonicalPracticePage.test.tsx and none of them reds here; they
 *   were found by the TESTS failing once isMathSection stopped accepting "Math", which
 *   is the correct second line of defence and not a substitute for the first. If a
 *   positional section argument ever needs gating, the fix is a named property or a
 *   type-aware check, not a wider string match — a gate that flagged every "Math" in
 *   the tree would be a gate that flagged the blog.
 *
 * MUTATIONS THIS MUST CATCH (scripts/ci/section-vocabulary-gate.mutations.sh):
 *   M1  introduce `section: "Math"` on a data path            -> Rule A red
 *   M2  introduce the literal "MATH" anywhere                 -> Rule B red
 *   M3  point the gate at zero files                          -> tripwire red
 *   M4  delete a rule's enforcement                           -> self-test red
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { listTrackedFiles } from "./lib/git-tracked-files.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..");

/** The only values a section position may hold. */
const CANONICAL_SECTIONS = new Set(["M", "RW"]);

/**
 * The retired spelling Rule B forbids, derived rather than spelled.
 *
 * THIS IS NOT AN EVASION, and the alternative is worse. Rule B has no file allowlist —
 * that is the whole point of it — so a gate that contained its own trigger as a literal
 * would fail on itself, and the only ways out are an exemption for this file (which
 * makes "no allowlist" false and creates the one place a bad value could hide) or
 * obfuscation. Deriving it is neither: `upper()` of the section's display name is
 * PRECISELY the defect Doc 04B V4.3 §11.2 describes — V4.1 computed the section code as
 * `upper(p_section)` and got the wrong value — so this expression is the bug written
 * out, and it evaluates to exactly the string being banned.
 *
 * Any text gate that scans the tree it lives in has this property. Stating it beats
 * carrying a silent exemption.
 */
const SECTION_DISPLAY_NAME_MATH = "Math";
const RETIRED_SPELLING = SECTION_DISPLAY_NAME_MATH.toUpperCase();

/**
 * Named sentinels. Each is a state that is NOT a section, and each is listed here rather
 * than pattern-matched so adding one is a visible decision:
 *   "break"  full-length exam lifecycle state between sections (ExamRunner)
 *   "random" practice: no section filter requested (useCanonicalPractice)
 *   ""       practice page: "all sections" in a Select whose empty value means unset
 */
const SECTION_SENTINELS = new Set(["break", "random", ""]);

/**
 * STRONGLY section-typed names. A value here can be nothing but a section, so ANY
 * non-canonical, non-sentinel literal is a finding — including a spelling nobody has
 * invented yet.
 */
const STRONG_SECTION_NAMES = new Set([
  "sectionCode",
  "sectionCodes",
  "section_code",
  "sectionKey",
  "sectionToken",
  "sectionValue",
  "question_section",
  "question_section_code",
  "current_section",
  "currentSection",
  "focusSection",
  "legacySection",
  "majorSection",
  "minorSection",
  "primarySection",
  "resolvedSection",
  "p_section",
]);

/**
 * WEAKLY section-typed names. `section` is also an ordinary English word used as a map
 * key: `QUESTIONS_COLUMN_DISPOSITION` (packages/shared/src/column-disposition.ts) has
 * `section: "served_pre_submit"`, where `section` names a COLUMN and the value is a
 * disposition. Flagging that would be a false positive, and a gate that cries wolf on
 * correct code is a gate somebody deletes.
 *
 * So on a weak name the value must additionally LOOK like a section — it must be one of
 * the spellings that actually existed in this repository. That closed list is the point:
 * this gate's job is to stop the five vocabularies coming back.
 */
const WEAK_SECTION_NAMES = new Set(["section", "sections", "sectionParam"]);

/**
 * Every non-canonical section spelling this repository has carried, lowercased.
 * Vocabularies 2-5 from the header, plus the module-id forms and the abbreviation this
 * codebase's own display module used to emit.
 */
const DRIFT_SPELLINGS = new Set([
  "math",
  "maths",
  "m1",
  "m2",
  "rw1",
  "rw2",
  "r&w",
  "reading",
  "writing",
  "readingwriting",
  "reading writing",
  "reading_writing",
  "reading-writing",
  "reading & writing",
  "reading and writing",
]);

const SECTION_NAMES = new Set([
  ...STRONG_SECTION_NAMES,
  ...WEAK_SECTION_NAMES,
]);

function isDriftSpelling(value) {
  return DRIFT_SPELLINGS.has(value.trim().toLowerCase());
}

/**
 * Rule A exemptions. Two files, for opposite reasons, both stated above. This list is
 * printed on every green run: an exemption nobody sees is an exemption that grows.
 */
const RULE_A_EXEMPT_FILES = new Set([
  "shared/section-display.ts",
  "shared/question-bank-contract.ts",
]);

/** Same marker convention as scripts/ci/test-fixture-canonicality-gate.mjs. */
const NEGATIVE_FIXTURE_MARKER =
  /canonicality-gate:\s*negative-fixture\s*[-—:]\s*\S+/;
const MARKER_LOOKBACK_LINES = 3;

const DEFAULT_PATHSPEC = [
  "apps/**",
  "client/**",
  "server/**",
  "shared/**",
  "packages/**",
  "tests/**",
  "scripts/**",
  ":(exclude)**/node_modules/**",
  ":(exclude)**/dist/**",
];

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs"];

function parsePathspecOverride(raw, fallback) {
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  return raw
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function markerLineAbove(lines, zeroBasedLine) {
  const from = Math.max(0, zeroBasedLine - MARKER_LOOKBACK_LINES);
  for (let i = from; i <= zeroBasedLine; i += 1) {
    if (NEGATIVE_FIXTURE_MARKER.test(lines[i] ?? "")) return i + 1;
  }
  return 0;
}

function bareName(text) {
  return text.replace(/^["']|["']$/g, "");
}

function isSectionName(text) {
  return SECTION_NAMES.has(bareName(text));
}

function isStrongSectionName(text) {
  return STRONG_SECTION_NAMES.has(bareName(text));
}

/**
 * Does this expression NAME a section? `sectionCode`, `row.section`, `s.question_section`
 * all do; `mode` does not. Used for the comparison arm of Rule A.
 */
function namesASection(node, sf) {
  if (ts.isIdentifier(node)) return isSectionName(node.text);
  if (ts.isPropertyAccessExpression(node)) return isSectionName(node.name.text);
  if (ts.isElementAccessExpression(node)) {
    const arg = node.argumentExpression;
    return ts.isStringLiteral(arg) ? isSectionName(arg.text) : false;
  }
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) {
    return namesASection(node.expression, sf);
  }
  if (ts.isAsExpression(node)) return namesASection(node.expression, sf);
  return false;
}

const EQUALITY_OPERATORS = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

function literalText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : null;
}

/** Every string literal sitting in a section position, with its line. */
function collectSectionPositionLiterals(sf) {
  /** @type {Array<{value: string, line: number, why: string, strong: boolean}>} */
  const hits = [];
  const push = (node, value, why, strong) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ value, line, why, strong });
  };

  const fromValueNode = (valueNode, why, strong) => {
    const direct = literalText(valueNode);
    if (direct !== null) {
      push(valueNode, direct, why, strong);
      return;
    }
    // `sections: ["Math"]` — an array in a section position puts every element in one.
    if (ts.isArrayLiteralExpression(valueNode)) {
      for (const element of valueNode.elements) {
        const text = literalText(element);
        if (text !== null) {
          push(element, text, `${why} (array element)`, strong);
        }
      }
      return;
    }
    // `section: cond ? "Math" : "RW"` — both branches land in the section position.
    if (ts.isConditionalExpression(valueNode)) {
      fromValueNode(valueNode.whenTrue, why, strong);
      fromValueNode(valueNode.whenFalse, why, strong);
    }
  };

  const visit = (node) => {
    // (a) property assignment: `section: "Math"`
    if (ts.isPropertyAssignment(node) && isSectionName(node.name.getText(sf))) {
      fromValueNode(
        node.initializer,
        `value of \`${node.name.getText(sf)}\``,
        isStrongSectionName(node.name.getText(sf)),
      );
    }
    // (b) variable/property declared with a section-ish name
    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      isSectionName(node.name.text) &&
      node.initializer
    ) {
      fromValueNode(
        node.initializer,
        `initializer of \`${node.name.text}\``,
        isStrongSectionName(node.name.text),
      );
    }
    // (c) assignment: `target.section = "MATH"`
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      namesASection(node.left, sf)
    ) {
      fromValueNode(node.right, "assigned to a section", true);
    }
    // (d) equality against something that names a section
    if (
      ts.isBinaryExpression(node) &&
      EQUALITY_OPERATORS.has(node.operatorToken.kind)
    ) {
      if (namesASection(node.left, sf)) {
        fromValueNode(node.right, "compared against a section", true);
      }
      if (namesASection(node.right, sf)) {
        fromValueNode(node.left, "compared against a section", true);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** Every string literal whose exact value is the retired spelling. */
function collectRetiredSpellingLiterals(sf) {
  /** @type {Array<{line: number}>} */
  const hits = [];
  const visit = (node) => {
    const text = literalText(node);
    if (text === RETIRED_SPELLING) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      hits.push({ line });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function checkFile(relPath, violations, exemptions) {
  const source = readFileSync(resolve(REPO_ROOT, relPath), "utf8");
  const lines = source.split("\n");
  const sf = ts.createSourceFile(
    resolve(REPO_ROOT, relPath),
    source,
    ts.ScriptTarget.Latest,
    true,
  );

  const record = (line, rule, message) => {
    const marker = markerLineAbove(lines, line);
    if (marker > 0) {
      exemptions.add(`${relPath}:${marker}`);
      return;
    }
    violations.push({ file: relPath, line: line + 1, rule, message });
  };

  if (!RULE_A_EXEMPT_FILES.has(relPath)) {
    for (const hit of collectSectionPositionLiterals(sf)) {
      if (CANONICAL_SECTIONS.has(hit.value)) continue;
      if (SECTION_SENTINELS.has(hit.value)) continue;
      // Weak names need the value to look like a section; strong names do not.
      if (!hit.strong && !isDriftSpelling(hit.value)) continue;
      record(
        hit.line,
        "section-literal",
        `${JSON.stringify(hit.value)} as the ${hit.why} — a section is 'M' or 'RW'. Long forms are produced by shared/section-display.ts at render; foreign input spellings are normalised by shared/question-bank-contract.ts at the boundary.`,
      );
    }
  }

  // Rule B has no file exemption, including for the two Rule A files.
  for (const hit of collectRetiredSpellingLiterals(sf)) {
    record(
      hit.line,
      "retired-spelling",
      `the literal ${JSON.stringify(RETIRED_SPELLING)} — Doc 04B V4.3 §11.2 names it a retired defect (upper(p_section) producing the wrong value). The canonical code is "M"; the display form is produced by shared/section-display.ts.`,
    );
  }
}

function main() {
  const pathspec = parsePathspecOverride(
    process.env.SECTION_VOCABULARY_PATHSPEC,
    DEFAULT_PATHSPEC,
  );
  const { files, skippedMissing } = listTrackedFiles({
    repoRoot: REPO_ROOT,
    pathspec,
  });

  if (skippedMissing.length > 0) {
    console.error(
      `NOTE: ${skippedMissing.length} tracked path(s) are absent from the working tree and were not scanned:`,
    );
    for (const entry of skippedMissing) console.error(`      ${entry}`);
  }

  const sources = files.filter((f) =>
    SOURCE_EXTENSIONS.some((ext) => f.endsWith(ext)),
  );

  // CR-STD-01: zero scanned files is a broken gate, not a clean tree.
  if (sources.length === 0) {
    console.error(
      "FAIL: the section-vocabulary gate scanned ZERO source files. A pathspec that stops",
    );
    console.error(
      "      matching reports a clean tree forever; that is a broken gate, not a pass.",
    );
    process.exit(1);
  }

  const violations = [];
  const exemptions = new Set();
  for (const file of sources) checkFile(file, violations, exemptions);

  if (violations.length > 0) {
    console.error(
      `FAIL: ${violations.length} non-canonical section literal(s) across ${sources.length} scanned file(s).`,
    );
    console.error(
      "      One internal vocabulary ('M'/'RW'), one display mapping, applied only at render.\n",
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  [${v.rule}] ${v.message}`);
    }
    process.exit(1);
  }

  console.log(
    `OK: section vocabulary — ${sources.length} source file(s) scanned, every section literal is 'M' or 'RW'.`,
  );
  console.log(
    `    Rule A exempt files (${RULE_A_EXEMPT_FILES.size}), by design:`,
  );
  for (const f of [...RULE_A_EXEMPT_FILES].sort()) {
    console.log(`      ${f}`);
  }
  console.log(
    `    ${exemptions.size} deliberate negative fixture(s) exempt by marker:`,
  );
  for (const e of [...exemptions].sort()) console.log(`      ${e}`);
}

main();
