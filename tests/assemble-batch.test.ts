import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, join } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const SCRATCH = resolve(ROOT, "tests/__fixtures__/assemble-batch-scratch");
const ASSEMBLE_BATCH_SCRIPT = resolve(ROOT, "scripts/assemble-batch.ts");
const PROD_CORPUS_PATH = resolve(ROOT, "content/canonical/prod_dedup_corpus.txt");

/**
 * A real "function of the underlined sentence" record, read from the batch it shipped in, so
 * the markup rules are proved against what authoring actually produces (2026-10-11). Its
 * passage gets a fixture-only closing sentence so the bank dedup gate does not reject it as
 * the published item it is.
 */
function realUnderlinedRecord(): Record<string, unknown> {
  const rec = readFileSync(
    resolve(ROOT, "content/canonical/batch_024_parts/craft_and_structure.ndjson"),
    "utf-8",
  )
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .find((r) => typeof r.passage === "string" && r.passage.includes("<u>"));
  if (rec === undefined) throw new Error("batch_024 has no <u> record to derive from");
  return { ...rec, passage: `${String(rec.passage)} (Fixture copy for the markup gate.)` };
}

function runGate(
  partsDir: string,
  opts: { dryRun?: boolean; out?: string; report?: string } = {},
): { status: number; stdout: string; stderr: string } {
  const outPath = opts.out ?? join(SCRATCH, "out.sql");
  const reportPath = opts.report ?? join(SCRATCH, "report.json");
  // Every invocation runs against a scratch corpus seeded from the real one,
  // NEVER against content/canonical/prod_dedup_corpus.txt itself. On a
  // successful pass the gate appends the batch's stem hashes to whatever
  // corpus it was given; pointed at the production file, these fixtures write
  // their own hashes into it and from then on collide with themselves —
  // BANK_DUPLICATE, gate exit 1, and every non-dry-run test here fails
  // permanently. That is not hypothetical: it is what commit beecdf4 did.
  const corpusPath = join(SCRATCH, "dedup-corpus.txt");
  writeFileSync(
    corpusPath,
    existsSync(PROD_CORPUS_PATH) ? readFileSync(PROD_CORPUS_PATH, "utf-8") : "",
  );
  const args = [
    "exec",
    "tsx",
    ASSEMBLE_BATCH_SCRIPT,
    "--in",
    partsDir,
    "--out",
    outPath,
    "--report",
    reportPath,
    "--corpus",
    corpusPath,
    ...(opts.dryRun ? ["--dry-run"] : []),
  ];

  const result = spawnSync("pnpm", args, {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 30000,
    shell: false,
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function writeParts(dir: string, records: object[]): void {
  mkdirSync(dir, { recursive: true });
  const ndjson = records.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(join(dir, "test.ndjson"), ndjson);
}

function validMcqRecord(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    section: "M",
    domain: "Algebra",
    skill: "Linear Equations in One Variable",
    difficulty: 1,
    item_type: "mcq",
    stem: "If $2x = 10$, what is $x$?",
    passage: null,
    options: [
      { key: "A", text: "5" },
      { key: "B", text: "10" },
      { key: "C", text: "2" },
      { key: "D", text: "-5" },
    ],
    correct_option: "A",
    option_metadata: {
      A: { role: "correct", error_taxonomy: null },
      B: { role: "distractor", error_taxonomy: "partial_reasoning" },
      C: { role: "distractor", error_taxonomy: "arithmetic_slip" },
      D: { role: "distractor", error_taxonomy: "sign_error" },
    },
    explanation:
      "The correct answer is A. Divide both sides by 2 to get x = 5.",
    estimated_time_seconds: 45,
    ...overrides,
  };
}

function validGridInRecord(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    section: "M",
    domain: "Algebra",
    skill: "Linear Equations in One Variable",
    difficulty: 2,
    item_type: "grid_in",
    stem: "If $3x + 6 = 21$, what is the value of $x$?",
    passage: null,
    correct_answer: "5",
    explanation:
      "The correct answer is 5. Subtract 6 from both sides to get 3x = 15, then divide by 3.",
    estimated_time_seconds: 60,
    ...overrides,
  };
}

beforeAll(() => {
  mkdirSync(SCRATCH, { recursive: true });
});

describe("assemble-batch gate", () => {
  it("passes on valid MCQ record (dry-run)", () => {
    const dir = join(SCRATCH, "valid-mcq");
    writeParts(dir, [validMcqRecord()]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("DRY RUN PASS");
  });

  it("passes on valid grid-in record and derives correct_variants", () => {
    const dir = join(SCRATCH, "valid-grid-in");
    const outPath = join(SCRATCH, "grid-in-out.sql");
    writeParts(dir, [validGridInRecord()]);
    const result = runGate(dir, { out: outPath });
    expect(result.status).toBe(0);
    const sql = readFileSync(outPath, "utf-8");
    expect(sql).toContain("ARRAY['5']");
  });

  it("grid-in with fraction derives correct_variants via gridInAcceptedForms", () => {
    const dir = join(SCRATCH, "grid-in-fraction");
    const outPath = join(SCRATCH, "grid-in-fraction-out.sql");
    writeParts(dir, [validGridInRecord({ correct_answer: "2/3" })]);
    const result = runGate(dir, { out: outPath });
    expect(result.status).toBe(0);
    const sql = readFileSync(outPath, "utf-8");
    expect(sql).toContain("2/3");
    expect(sql).toContain(".666");
    expect(sql).toContain(".667");
  });

  it("rejects invalid section", () => {
    const dir = join(SCRATCH, "bad-section");
    // canonicality-gate: negative-fixture — the subject of this assertion is a section
    // value the frozen taxonomy rejects. Making it canonical would delete the test.
    writeParts(dir, [validMcqRecord({ section: "MATH" })]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("invalid section");
  });

  it("rejects domain-section mismatch", () => {
    const dir = join(SCRATCH, "domain-mismatch");
    // canonicality-gate: negative-fixture — (RW, "Algebra") is the pair
    // questions_domain_section_canonical rejects; it is what this test asserts on.
    writeParts(dir, [validMcqRecord({ section: "RW", domain: "Algebra" })]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("DOMAIN_SECTION_MISMATCH");
  });

  it("rejects non-frozen skill", () => {
    const dir = join(SCRATCH, "bad-skill");
    writeParts(dir, [validMcqRecord({ skill: "Made Up Skill" })]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not in the frozen 29");
  });

  it("rejects skill-domain mismatch", () => {
    const dir = join(SCRATCH, "skill-domain-mismatch");
    writeParts(dir, [
      validMcqRecord({
        domain: "Advanced Math",
        skill: "Linear Equations in One Variable",
      }),
    ]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'skill "Linear Equations in One Variable" belongs to domain',
    );
  });

  it("rejects MCQ with wrong option count", () => {
    const dir = join(SCRATCH, "bad-options");
    writeParts(dir, [
      validMcqRecord({
        options: [
          { key: "A", text: "5" },
          { key: "B", text: "10" },
        ],
      }),
    ]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exactly 4 options");
  });

  it("rejects MCQ with mismatched option_metadata role", () => {
    const dir = join(SCRATCH, "bad-meta-role");
    writeParts(dir, [
      validMcqRecord({
        option_metadata: {
          A: { role: "distractor", error_taxonomy: "sign_error" },
          B: { role: "distractor", error_taxonomy: "partial_reasoning" },
          C: { role: "distractor", error_taxonomy: "arithmetic_slip" },
          D: { role: "distractor", error_taxonomy: "sign_error" },
        },
      }),
    ]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('role="correct"');
  });

  it("rejects invalid distractor taxonomy label", () => {
    const dir = join(SCRATCH, "bad-distractor-label");
    writeParts(dir, [
      validMcqRecord({
        option_metadata: {
          A: { role: "correct", error_taxonomy: null },
          B: { role: "distractor", error_taxonomy: "made_up_label" },
          C: { role: "distractor", error_taxonomy: "arithmetic_slip" },
          D: { role: "distractor", error_taxonomy: "sign_error" },
        },
      }),
    ]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("invalid error_taxonomy");
  });

  it("rejects RW question without passage", () => {
    const dir = join(SCRATCH, "rw-no-passage");
    writeParts(dir, [
      validMcqRecord({
        section: "RW",
        domain: "Information and Ideas",
        skill: "Central Ideas and Details",
        passage: null,
        option_metadata: {
          A: { role: "correct", error_taxonomy: null },
          B: { role: "distractor", error_taxonomy: "detail_misread" },
          C: { role: "distractor", error_taxonomy: "inference_overreach" },
          D: { role: "distractor", error_taxonomy: "evidence_mismatch" },
        },
      }),
    ]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("RW questions must have a passage");
  });

  it("rejects grid_in with unparseable correct_answer", () => {
    const dir = join(SCRATCH, "bad-grid-in-answer");
    writeParts(dir, [validGridInRecord({ correct_answer: "abc" })]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not a parseable value");
  });

  it("rejects malformed NDJSON", () => {
    const dir = join(SCRATCH, "malformed-ndjson");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bad.ndjson"), "this is not json\n");
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("malformed JSON");
  });

  it("rejects invalid difficulty", () => {
    const dir = join(SCRATCH, "bad-difficulty");
    writeParts(dir, [validMcqRecord({ difficulty: 4 })]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("difficulty must be");
  });

  it("rejects grid_in with non-array options (no silent auto-fix)", () => {
    const dir = join(SCRATCH, "grid-in-bad-options");
    writeParts(dir, [validGridInRecord({ options: "bad" })]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "grid_in options must be omitted or an empty array",
    );
  });

  it("rejects MCQ with extra option_metadata key", () => {
    const dir = join(SCRATCH, "extra-meta-key");
    writeParts(dir, [
      validMcqRecord({
        option_metadata: {
          A: { role: "correct", error_taxonomy: null },
          B: { role: "distractor", error_taxonomy: "partial_reasoning" },
          C: { role: "distractor", error_taxonomy: "arithmetic_slip" },
          D: { role: "distractor", error_taxonomy: "sign_error" },
          E: { role: "correct", error_taxonomy: null },
        },
      }),
    ]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("option_metadata keys must be exactly");
  });

  it("rejects MCQ with two role=correct entries", () => {
    const dir = join(SCRATCH, "two-correct");
    writeParts(dir, [
      validMcqRecord({
        option_metadata: {
          A: { role: "correct", error_taxonomy: null },
          B: { role: "correct", error_taxonomy: null },
          C: { role: "distractor", error_taxonomy: "arithmetic_slip" },
          D: { role: "distractor", error_taxonomy: "sign_error" },
        },
      }),
    ]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "exactly one option_metadata entry must have role",
    );
  });

  it("rejects grid_in for RW section", () => {
    const dir = join(SCRATCH, "rw-grid-in");
    writeParts(dir, [
      validGridInRecord({
        section: "RW",
        domain: "Information and Ideas",
        skill: "Central Ideas and Details",
      }),
    ]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("grid_in is Math-only");
  });

  it("mints unique IDs sorted alphabetically in output", () => {
    const dir = join(SCRATCH, "multi-record");
    const outPath = join(SCRATCH, "multi-out.sql");
    writeParts(dir, [
      validMcqRecord(),
      // Distinct stem, not just a distinct difficulty: the gate dedups on
      // stem+passage, so two records differing only by difficulty are one
      // question to it and are rejected INTRA_BATCH_DUPLICATE. This test needs
      // three genuinely distinct questions to prove three distinct IDs.
      validMcqRecord({
        difficulty: 2,
        stem: "If $5x = 20$, what is $x$?",
      }),
      validGridInRecord(),
    ]);
    const result = runGate(dir, { out: outPath });
    expect(result.status).toBe(0);
    const sql = readFileSync(outPath, "utf-8");
    const ids = [...sql.matchAll(/VALUES \('(SAT[^']+)'/g)].map((m) => m[1]);
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(3);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("renders jsonb correctly when option text contains embedded double-quotes and backslashes", () => {
    const dir = join(SCRATCH, "embedded-quotes");
    const outPath = join(SCRATCH, "embedded-quotes-out.sql");
    writeParts(dir, [
      validMcqRecord({
        section: "RW",
        domain: "Information and Ideas",
        skill: "Command of Evidence",
        passage:
          'In Voss\'s novel, Thomas states, "My brother and I were inseparable."',
        options: [
          {
            key: "A",
            text: 'Thomas states, "My brother and I were inseparable; every summer we explored the woods together, never once quarreling."',
          },
          {
            key: "B",
            text: 'A letter from Thomas\'s mother reads, "I worry about the boys constantly fighting."',
          },
          {
            key: "C",
            text: 'Thomas reflects, "Looking back, I realize childhood has \\frac{many}{layers}."',
          },
          {
            key: "D",
            text: "The novel's epilogue describes a holiday dinner.",
          },
        ],
        option_metadata: {
          A: { role: "distractor", error_taxonomy: "partial_reasoning" },
          B: { role: "correct", error_taxonomy: null },
          C: { role: "distractor", error_taxonomy: "partial_reasoning" },
          D: { role: "distractor", error_taxonomy: "evidence_mismatch" },
        },
        correct_option: "B",
      }),
    ]);
    const result = runGate(dir, { out: outPath });
    expect(result.status).toBe(0);
    const sql = readFileSync(outPath, "utf-8");
    expect(sql).toContain("$lyceon_json$");
    expect(sql).toContain("::jsonb");
    expect(sql).toContain("My brother and I were inseparable");
    expect(sql).not.toContain("'::jsonb");
  });

  it("passes a real underlined-sentence record whose passage carries one <u>...</u>", () => {
    const dir = join(SCRATCH, "underline-real");
    const rec = realUnderlinedRecord();
    // Presence before absence: the fixture really has the stem and the span under test.
    expect(String(rec.stem)).toMatch(/the underlined sentence/);
    expect(String(rec.passage).match(/<u>/g)).toHaveLength(1);
    writeParts(dir, [rec]);
    const result = runGate(dir, { dryRun: true });
    // A one-record batch always trips the batch-level longest-answer statistic, so the gate
    // exits 1 — with that as its ONLY violation: no per-record rule fired on the record.
    expect(result.stderr).toContain("GATE FAIL: 1 violation(s) found.");
    expect(result.stderr).toContain("[RW_LONGEST_ANSWER_TELL]");
    expect(result.stderr).not.toContain("MISSING_UNDERLINED_TARGET");
    expect(result.stderr).not.toContain("RAW_HTML");
  });

  it("rejects an underlined-sentence stem whose passage lost its <u>...</u>", () => {
    const dir = join(SCRATCH, "underline-missing");
    const rec = realUnderlinedRecord();
    writeParts(dir, [
      { ...rec, passage: String(rec.passage).replace("<u>", "").replace("</u>", "") },
    ]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("MISSING_UNDERLINED_TARGET");
  });

  it("rejects an underlined-sentence stem with two <u>...</u> spans", () => {
    const dir = join(SCRATCH, "underline-two");
    const rec = realUnderlinedRecord();
    writeParts(dir, [{ ...rec, passage: `${String(rec.passage)} <u>Another.</u>` }]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("has 2 paired <u>...</u> span(s)");
  });

  it("rejects any tag other than a paired <u>, in any rendered field", () => {
    const dir = join(SCRATCH, "underline-raw-html");
    const rec = realUnderlinedRecord();
    writeParts(dir, [{ ...rec, explanation: `${String(rec.explanation)} <b>Note.</b>` }]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("RAW_HTML: explanation carries <b>, </b>");
  });

  it("report JSON has expected shape on success", () => {
    const dir = join(SCRATCH, "report-shape");
    const reportPath = join(SCRATCH, "report-shape.json");
    writeParts(dir, [validMcqRecord()]);
    runGate(dir, { dryRun: true, report: reportPath });
    const report = JSON.parse(readFileSync(reportPath, "utf-8"));
    expect(report.status).toBe("PASS");
    expect(report.record_count).toBe(1);
  });
});
