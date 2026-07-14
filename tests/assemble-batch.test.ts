import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { resolve, join } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const SCRATCH = resolve(ROOT, "tests/__fixtures__/assemble-batch-scratch");
const ASSEMBLE_BATCH_SCRIPT = resolve(ROOT, "scripts/assemble-batch.ts");

function runGate(
  partsDir: string,
  opts: { dryRun?: boolean; out?: string; report?: string } = {},
): { status: number; stdout: string; stderr: string } {
  const outPath = opts.out ?? join(SCRATCH, "out.sql");
  const reportPath = opts.report ?? join(SCRATCH, "report.json");
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
    writeParts(dir, [validMcqRecord({ section: "MATH" })]);
    const result = runGate(dir, { dryRun: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("invalid section");
  });

  it("rejects domain-section mismatch", () => {
    const dir = join(SCRATCH, "domain-mismatch");
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
      validMcqRecord({ difficulty: 2 }),
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
