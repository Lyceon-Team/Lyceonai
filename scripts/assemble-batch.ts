/**
 * Assembly gate — reads NDJSON part-files, validates against taxonomy.json,
 * mints canonical IDs, derives grid-in variants, renders SQL INSERTs.
 *
 * @spec [questions_governance.md §A.1–A.9]
 * CLI: pnpm assemble-batch --in <parts_dir> --out <batch>.sql --report <report>.json [--manifest <manifest>.json] [--dry-run] [--dry-apply]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { createHash } from "crypto";
import { join, resolve } from "path";
import { parseArgs } from "util";
import pg from "pg";
import {
  buildCanonicalId,
  MC_OPTION_KEYS,
  type CanonicalSectionCode,
} from "../shared/question-bank-contract.js";
import {
  parseGridInValue,
  gridInAcceptedForms,
} from "../shared/question-ingestion-qa.js";

const REPO_ROOT = resolve(import.meta.dirname, "..");

type Taxonomy = {
  sections: string[];
  math_section: string;
  domains: Record<string, string[]>;
  skills: Record<string, string[]>;
  difficulty: Record<string, string>;
  item_types: string[];
  option_keys: string[];
  distractor_taxonomy: Record<string, string[]>;
};

type ContentRecord = {
  section: string;
  domain: string;
  skill: string;
  difficulty: number;
  item_type: string;
  stem: string;
  passage: string | null;
  options?: Array<{ key: string; text: string }>;
  correct_option?: string;
  option_metadata?: Record<
    string,
    { role: string; error_taxonomy: string | null }
  >;
  correct_answer?: string;
  explanation: string;
  estimated_time_seconds: number;
};

type Violation = {
  file: string;
  line: number;
  record_index: number;
  field: string;
  reason: string;
};

type BatchManifest = {
  target_skills: string[];
  difficulties: number[];
  extra_hard: Array<{ skill: string; difficulty: number }>;
};

type AssembledQuestion = {
  id: string;
  section: string;
  source_type: number;
  domain: string;
  skill: string;
  difficulty: number;
  item_type: string;
  stem: string;
  passage: string | null;
  options: unknown;
  correct_answer: string;
  correct_variants: string[] | null;
  explanation: string;
  option_metadata: unknown;
  estimated_time_seconds: number;
};

function loadTaxonomy(): Taxonomy {
  const path = join(REPO_ROOT, "content/canonical/taxonomy.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

function mathSection(taxonomy: Taxonomy): string {
  if (
    !taxonomy.math_section ||
    !taxonomy.sections.includes(taxonomy.math_section)
  ) {
    throw new Error("taxonomy.json math_section is missing or not in sections");
  }
  return taxonomy.math_section;
}

function difficultyKeys(taxonomy: Taxonomy): number[] {
  return Object.keys(taxonomy.difficulty).map(Number);
}

function loadAppliedIds(): Set<string> {
  const path = join(REPO_ROOT, "content/canonical/applied_ids.json");
  if (!existsSync(path)) return new Set();
  const data = JSON.parse(readFileSync(path, "utf-8"));
  return new Set(data.ids as string[]);
}

function sectionForDomain(taxonomy: Taxonomy, domain: string): string | null {
  for (const [section, domains] of Object.entries(taxonomy.domains)) {
    if (domains.includes(domain)) return section;
  }
  return null;
}

function allSkills(taxonomy: Taxonomy): Set<string> {
  const skills = new Set<string>();
  for (const arr of Object.values(taxonomy.skills)) {
    for (const s of arr) skills.add(s);
  }
  return skills;
}

function domainForSkill(taxonomy: Taxonomy, skill: string): string | null {
  for (const [domain, skills] of Object.entries(taxonomy.skills)) {
    if (skills.includes(skill)) return domain;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Near-duplicate detection
// ---------------------------------------------------------------------------

/**
 * Collapse whitespace, lowercase. Keyed on stem+passage together: RW items
 * share generic stems ("Which choice completes the text…") with distinct
 * passages, so stem-only would false-flag them. Math stems are the content
 * and collide meaningfully.
 */
function normalizeForDupeCheck(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function stemPassageHash(stem: string, passage: string | null): string {
  const key =
    normalizeForDupeCheck(stem) + "\0" + normalizeForDupeCheck(passage ?? "");
  return createHash("sha256").update(key).digest("hex");
}

function checkNearDuplicates(
  records: Array<{ rec: ContentRecord; file: string; line: number }>,
): Violation[] {
  const violations: Violation[] = [];
  const seen = new Map<string, { file: string; line: number; index: number }>();

  for (let i = 0; i < records.length; i++) {
    const { rec, file, line } = records[i];
    const hash = stemPassageHash(rec.stem, rec.passage);
    const existing = seen.get(hash);
    if (existing) {
      violations.push({
        file,
        line,
        record_index: i,
        field: "stem+passage",
        reason: `NEAR_DUPLICATE: stem+passage hash collision with ${existing.file}:${existing.line} (record ${existing.index})`,
      });
    } else {
      seen.set(hash, { file, line, index: i });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Coverage assertion (requires --manifest)
// ---------------------------------------------------------------------------

function loadManifest(path: string): BatchManifest {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as BatchManifest;
  if (!Array.isArray(raw.target_skills) || raw.target_skills.length === 0) {
    throw new Error("manifest.target_skills must be a non-empty array");
  }
  if (!Array.isArray(raw.difficulties) || raw.difficulties.length === 0) {
    throw new Error("manifest.difficulties must be a non-empty array");
  }
  if (!Array.isArray(raw.extra_hard)) {
    throw new Error("manifest.extra_hard must be an array");
  }
  return raw;
}

function buildExpectedTally(manifest: BatchManifest): Map<string, number> {
  const expected = new Map<string, number>();
  for (const skill of manifest.target_skills) {
    for (const d of manifest.difficulties) {
      const key = `${skill}\0${d}`;
      expected.set(key, (expected.get(key) ?? 0) + 1);
    }
  }
  for (const extra of manifest.extra_hard) {
    const key = `${extra.skill}\0${extra.difficulty}`;
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }
  return expected;
}

function checkCoverage(
  records: Array<{ rec: ContentRecord; file: string; line: number }>,
  manifest: BatchManifest,
  taxonomy: Taxonomy,
): Violation[] {
  const violations: Violation[] = [];
  const v = (reason: string): void => {
    violations.push({
      file: "<manifest>",
      line: 0,
      record_index: -1,
      field: "coverage",
      reason,
    });
  };

  // Validate manifest skills against taxonomy
  const frozenSkills = allSkills(taxonomy);
  for (const skill of manifest.target_skills) {
    if (!frozenSkills.has(skill)) {
      v(`MANIFEST_ERROR: target skill "${skill}" not in the frozen 29`);
    }
  }
  for (const extra of manifest.extra_hard) {
    if (!frozenSkills.has(extra.skill)) {
      v(
        `MANIFEST_ERROR: extra_hard skill "${extra.skill}" not in the frozen 29`,
      );
    }
    if (!manifest.target_skills.includes(extra.skill)) {
      v(
        `MANIFEST_ERROR: extra_hard skill "${extra.skill}" not in target_skills`,
      );
    }
  }

  const expected = buildExpectedTally(manifest);
  const targetSkillSet = new Set(manifest.target_skills);

  // Build actual tally
  const actual = new Map<string, number>();
  for (const { rec } of records) {
    const key = `${rec.skill}\0${rec.difficulty}`;
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }

  // Off-target skills (record-level — include file:line for traceability)
  for (let i = 0; i < records.length; i++) {
    const { rec, file, line } = records[i];
    if (!targetSkillSet.has(rec.skill)) {
      violations.push({
        file,
        line,
        record_index: i,
        field: "coverage",
        reason: `OFF_TARGET: skill "${rec.skill}" not in manifest target set`,
      });
    }
  }

  // Missing leaves (expected but absent or under-counted)
  Array.from(expected.entries()).forEach(([key, expCount]) => {
    const [skill, diff] = key.split("\0");
    const actualCount = actual.get(key) ?? 0;
    if (actualCount < expCount) {
      v(
        `MISSING_LEAF: "${skill}" d${diff} — expected ${expCount}, got ${actualCount}`,
      );
    }
  });

  // Over-counted leaves (more than expected)
  Array.from(actual.entries()).forEach(([key, actCount]) => {
    const [skill, diff] = key.split("\0");
    const expCount = expected.get(key) ?? 0;
    if (actCount > expCount) {
      v(
        `OVER_COUNT: "${skill}" d${diff} — expected ${expCount}, got ${actCount}`,
      );
    }
  });

  // Total check
  let expectedTotal = 0;
  expected.forEach((count) => {
    expectedTotal += count;
  });
  if (records.length !== expectedTotal) {
    v(`TOTAL_MISMATCH: expected ${expectedTotal}, got ${records.length}`);
  }

  return violations;
}

function validateRecord(
  rec: ContentRecord,
  taxonomy: Taxonomy,
  mathSection: string,
  file: string,
  line: number,
  index: number,
): Violation[] {
  const violations: Violation[] = [];
  const v = (field: string, reason: string): void => {
    violations.push({ file, line, record_index: index, field, reason });
  };

  if (!taxonomy.sections.includes(rec.section)) {
    v(
      "section",
      `invalid section "${rec.section}"; expected one of ${taxonomy.sections.join(", ")}`,
    );
  }

  const allDomains = [...Object.values(taxonomy.domains)].flat();
  if (!allDomains.includes(rec.domain)) {
    v("domain", `invalid domain "${rec.domain}"`);
  }

  const expectedSection = sectionForDomain(taxonomy, rec.domain);
  if (expectedSection && rec.section !== expectedSection) {
    v(
      "domain",
      `DOMAIN_SECTION_MISMATCH: domain "${rec.domain}" belongs to section "${expectedSection}", got "${rec.section}"`,
    );
  }

  const frozenSkills = allSkills(taxonomy);
  if (!frozenSkills.has(rec.skill)) {
    v("skill", `skill "${rec.skill}" not in the frozen 29`);
  }

  const expectedDomain = domainForSkill(taxonomy, rec.skill);
  if (expectedDomain && rec.domain !== expectedDomain) {
    v(
      "skill",
      `skill "${rec.skill}" belongs to domain "${expectedDomain}", got "${rec.domain}"`,
    );
  }

  const validDifficulties = difficultyKeys(taxonomy);
  if (!validDifficulties.includes(rec.difficulty)) {
    v(
      "difficulty",
      `difficulty must be ${validDifficulties.join(", ")}; got ${rec.difficulty}`,
    );
  }

  if (!taxonomy.item_types.includes(rec.item_type)) {
    v(
      "item_type",
      `invalid item_type "${rec.item_type}"; expected one of ${taxonomy.item_types.join(", ")}`,
    );
  }

  if (!rec.stem || rec.stem.trim().length === 0) {
    v("stem", "stem is empty");
  }

  if (!rec.explanation || rec.explanation.trim().length === 0) {
    v("explanation", "explanation is empty");
  }

  // Tripwire: flag explanations that MAY reference options by letter (A/B/C/D).
  // Options are shuffled at serve (Feature-8 option_order); letter refs are gibberish.
  // This regex is a detection aid — it flags for human/LLM review, not auto-reject,
  // because capital A–D also appear as math variables, geometric labels, and articles.
  // The auditor performs the binding comprehension check; the gate only warns.
  const letterRefTripwire =
    /(?:Option|option|Choice|choice|Answer|answer)\s+[A-D]\b|\([A-D]\)|answer is [A-D]\b/;
  if (letterRefTripwire.test(rec.explanation)) {
    console.warn(
      `[REVIEW] ${file}:${line} (record ${index}): possible letter-reference in explanation — verify by reading`,
    );
  }

  if (
    rec.section !== mathSection &&
    (rec.passage === null || rec.passage === undefined)
  ) {
    v("passage", "RW questions must have a passage");
  }
  if (
    rec.section === mathSection &&
    rec.passage !== null &&
    rec.passage !== undefined
  ) {
    v("passage", "Math questions must have passage=null");
  }

  if (rec.item_type === "mcq") {
    validateMcq(rec, taxonomy, v);
  } else if (rec.item_type === "grid_in") {
    validateGridIn(rec, mathSection, v);
  }

  if (
    typeof rec.estimated_time_seconds !== "number" ||
    rec.estimated_time_seconds <= 0
  ) {
    v("estimated_time_seconds", "must be a positive number");
  }

  return violations;
}

function validateMcq(
  rec: ContentRecord,
  taxonomy: Taxonomy,
  v: (field: string, reason: string) => void,
): void {
  if (!Array.isArray(rec.options) || rec.options.length !== 4) {
    v(
      "options",
      `MCQ must have exactly 4 options; got ${Array.isArray(rec.options) ? rec.options.length : "non-array"}`,
    );
    return;
  }

  const keys = rec.options.map((o) => o.key);
  for (const k of MC_OPTION_KEYS) {
    if (!keys.includes(k)) {
      v("options", `missing option key "${k}"`);
    }
  }

  for (const opt of rec.options) {
    if (!opt.text || opt.text.trim().length === 0) {
      v("options", `option ${opt.key} has empty text`);
    }
  }

  if (
    !rec.correct_option ||
    !MC_OPTION_KEYS.includes(
      rec.correct_option as (typeof MC_OPTION_KEYS)[number],
    )
  ) {
    v(
      "correct_option",
      `correct_option must be one of A,B,C,D; got "${rec.correct_option}"`,
    );
  }

  if (!rec.option_metadata) {
    v("option_metadata", "MCQ must have option_metadata");
    return;
  }

  const metaKeys = Object.keys(rec.option_metadata).sort();
  const expectedKeys = [...MC_OPTION_KEYS].sort();
  if (
    metaKeys.length !== expectedKeys.length ||
    metaKeys.some((k, i) => k !== expectedKeys[i])
  ) {
    v(
      "option_metadata",
      `option_metadata keys must be exactly ${expectedKeys.join(",")}; got ${metaKeys.join(",")}`,
    );
    return;
  }

  const correctEntries = Object.entries(rec.option_metadata).filter(
    ([, m]) => m.role === "correct",
  );
  if (correctEntries.length !== 1) {
    v(
      "option_metadata",
      `exactly one option_metadata entry must have role="correct"; found ${correctEntries.length}`,
    );
  } else if (correctEntries[0][0] !== rec.correct_option) {
    v(
      "option_metadata",
      `role="correct" is on key "${correctEntries[0][0]}" but correct_option is "${rec.correct_option}"`,
    );
  }

  const distLabels = taxonomy.distractor_taxonomy[rec.section];
  for (const k of MC_OPTION_KEYS) {
    const meta = rec.option_metadata[k];
    if (!meta) continue;
    if (k === rec.correct_option) {
      if (meta.role !== "correct") {
        v(
          "option_metadata",
          `correct option ${k} must have role="correct"; got "${meta.role}"`,
        );
      }
      if (meta.error_taxonomy !== null) {
        v(
          "option_metadata",
          `correct option ${k} must have error_taxonomy=null`,
        );
      }
    } else {
      if (meta.role !== "distractor") {
        v(
          "option_metadata",
          `distractor option ${k} must have role="distractor"; got "${meta.role}"`,
        );
      }
      if (!meta.error_taxonomy) {
        v(
          "option_metadata",
          `distractor option ${k} must have an error_taxonomy label`,
        );
      } else if (distLabels && !distLabels.includes(meta.error_taxonomy)) {
        v(
          "option_metadata",
          `distractor option ${k} has invalid error_taxonomy "${meta.error_taxonomy}" for section ${rec.section}`,
        );
      }
    }
  }

  if (rec.correct_answer !== undefined) {
    v(
      "correct_answer",
      "MCQ must not have correct_answer (use correct_option)",
    );
  }
}

function validateGridIn(
  rec: ContentRecord,
  mathSection: string,
  v: (field: string, reason: string) => void,
): void {
  if (rec.section !== mathSection) {
    v("item_type", "grid_in is Math-only");
  }

  if (rec.options !== undefined) {
    if (!Array.isArray(rec.options) || rec.options.length > 0) {
      v(
        "options",
        `grid_in options must be omitted or an empty array; got ${Array.isArray(rec.options) ? `array of length ${rec.options.length}` : typeof rec.options}`,
      );
    }
  }

  if (rec.correct_option !== undefined) {
    v("correct_option", "grid_in must not have correct_option");
  }

  if (rec.option_metadata !== undefined) {
    v("option_metadata", "grid_in must not have option_metadata");
  }

  if (!rec.correct_answer || rec.correct_answer.trim().length === 0) {
    v("correct_answer", "grid_in must have a correct_answer value");
    return;
  }

  const parsed = parseGridInValue(rec.correct_answer);
  if (!parsed) {
    v(
      "correct_answer",
      `grid_in correct_answer "${rec.correct_answer}" is not a parseable value`,
    );
  }
}

function escapeSQL(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

const JSONB_DOLLAR_TAG = "$lyceon_json$";

function jsonbLiteral(value: unknown, id: string, field: string): string {
  const json = JSON.stringify(value);
  if (json.includes(JSONB_DOLLAR_TAG)) {
    throw new Error(`dollar-tag collision in ${id}.${field}`);
  }
  return `${JSONB_DOLLAR_TAG}${json}${JSONB_DOLLAR_TAG}::jsonb`;
}

function verifyJsonbLiterals(sql: string, id: string): void {
  let searchFrom = 0;
  while (true) {
    const start = sql.indexOf(JSONB_DOLLAR_TAG, searchFrom);
    if (start === -1) break;
    const contentStart = start + JSONB_DOLLAR_TAG.length;
    const end = sql.indexOf(JSONB_DOLLAR_TAG, contentStart);
    if (end === -1) {
      throw new Error(`Unclosed jsonb dollar-quote in INSERT for ${id}`);
    }
    const json = sql.substring(contentStart, end);
    try {
      JSON.parse(json);
    } catch (e) {
      throw new Error(
        `Post-render jsonb verification failed for ${id}: ${(e as Error).message}\n  literal: ${json.slice(0, 200)}`,
        { cause: e },
      );
    }
    searchFrom = end + JSONB_DOLLAR_TAG.length;
  }
}

function renderInsert(q: AssembledQuestion, today: string): string {
  const optionsValue = q.item_type === "mcq" ? q.options : [];
  const correctAnswer = escapeSQL(q.correct_answer);
  const stem = escapeSQL(q.stem);
  const explanation = escapeSQL(q.explanation);
  const passage = q.passage !== null ? `E'${escapeSQL(q.passage)}'` : "NULL";

  const variantsSQL =
    q.correct_variants !== null
      ? `ARRAY[${q.correct_variants.map((v) => `'${escapeSQL(v)}'`).join(", ")}]`
      : "NULL";

  const optionMetaSQL =
    q.option_metadata !== null
      ? jsonbLiteral(q.option_metadata, q.id, "option_metadata")
      : "NULL";

  const lineage = jsonbLiteral(
    {
      provenance: "Lyceon original",
      authored_by: "claude",
      authored_date: today,
    },
    q.id,
    "source_lineage",
  );
  const attribution = jsonbLiteral(
    {
      model: "claude",
      generation_date: today,
      prompt_version: "questions_governance_v1",
    },
    q.id,
    "generation_attribution",
  );

  const sql = `INSERT INTO questions (id, section, source_type, domain, skill_codes, difficulty, item_type, stem, passage, options, correct_answer, correct_variants, explanation, option_metadata, assets, status, version, estimated_time_seconds, premium_flag, source_lineage, generation_attribution) VALUES ('${q.id}', '${q.section}', ${q.source_type}, '${escapeSQL(q.domain)}', ARRAY['${escapeSQL(q.skill)}'], ${q.difficulty}, '${q.item_type}', E'${stem}', ${passage}, ${jsonbLiteral(optionsValue, q.id, "options")}, '${correctAnswer}', ${variantsSQL}, E'${explanation}', ${optionMetaSQL}, NULL, 'draft', 1, ${q.estimated_time_seconds}, false, ${lineage}, ${attribution});`;

  verifyJsonbLiterals(sql, q.id);

  return sql;
}

const QUESTIONS_DDL = `
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY
    CHECK (id ~ '^SAT(M|RW)[12][A-Z0-9]{6}$'),
  section TEXT NOT NULL
    CHECK (section = ANY (ARRAY['M','RW'])),
  source_type INTEGER NOT NULL
    CHECK (source_type = ANY (ARRAY[1,2])),
  domain TEXT NOT NULL,
  skill_codes TEXT[] NOT NULL,
  difficulty INTEGER NOT NULL
    CHECK (difficulty >= 1 AND difficulty <= 3),
  item_type TEXT NOT NULL DEFAULT 'mcq'
    CHECK (item_type = ANY (ARRAY['mcq','grid_in'])),
  stem TEXT NOT NULL,
  passage TEXT,
  options JSONB NOT NULL,
  correct_answer TEXT NOT NULL,
  correct_variants TEXT[],
  explanation TEXT NOT NULL,
  option_metadata JSONB,
  assets JSONB,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status = ANY (ARRAY['draft','qa','published','retired'])),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  estimated_time_seconds INTEGER,
  premium_flag BOOLEAN DEFAULT FALSE,
  quality_score NUMERIC,
  issue_flags TEXT[],
  source_lineage JSONB,
  generation_attribution JSONB,
  CONSTRAINT questions_item_shape_chk CHECK (
    (item_type='mcq'     AND jsonb_typeof(options)='array' AND jsonb_array_length(options)=4 AND correct_variants IS NULL)
    OR
    (item_type='grid_in' AND jsonb_typeof(options)='array' AND jsonb_array_length(options)=0 AND correct_variants IS NOT NULL AND array_length(correct_variants,1)>=1)
  )
);
`;

async function dryApply(
  sqlContent: string,
  expectedCount: number,
): Promise<void> {
  const host = process.env["PGHOST"] ?? "localhost";
  const port = Number(process.env["PGPORT"] ?? "5432");
  const user = process.env["PGUSER"] ?? "postgres";
  const database = "gate_dry_apply";

  const adminClient = new pg.Client({ host, port, user, database: "postgres" });
  await adminClient.connect();
  try {
    await adminClient.query(`DROP DATABASE IF EXISTS ${database}`);
    await adminClient.query(`CREATE DATABASE ${database}`);
  } finally {
    await adminClient.end();
  }

  const client = new pg.Client({ host, port, user, database });
  await client.connect();
  try {
    await client.query(QUESTIONS_DDL);
    await client.query(sqlContent);
    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM questions",
    );
    const inserted = (rows[0] as { n: number }).n;
    if (inserted !== expectedCount) {
      throw new Error(
        `Dry-apply row count mismatch: expected ${expectedCount}, got ${inserted}`,
      );
    }
    console.log(`DRY-APPLY PASS: ${inserted} rows inserted and verified.`);
  } finally {
    await client.end();
    const cleanup = new pg.Client({
      host,
      port,
      user,
      database: "postgres",
    });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${database}`);
    await cleanup.end();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      in: { type: "string" },
      out: { type: "string" },
      report: { type: "string" },
      manifest: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "dry-apply": { type: "boolean", default: false },
    },
    strict: true,
  });

  const partsDir = values["in"];
  const outPath = values["out"];
  const reportPath = values["report"];
  const manifestPath = values["manifest"];
  const dryRun = values["dry-run"] ?? false;
  const dryApplyFlag = values["dry-apply"] ?? false;

  if (!partsDir) {
    console.error("--in <parts_dir> is required");
    process.exit(1);
  }
  if (!outPath && !dryRun) {
    console.error("--out <batch.sql> is required (unless --dry-run)");
    process.exit(1);
  }
  if (!reportPath) {
    console.error("--report <report.json> is required");
    process.exit(1);
  }

  const resolvedPartsDir = resolve(partsDir);
  if (!existsSync(resolvedPartsDir)) {
    console.error(`Parts directory not found: ${resolvedPartsDir}`);
    process.exit(1);
  }

  const taxonomy = loadTaxonomy();
  const math = mathSection(taxonomy);
  const appliedIds = loadAppliedIds();

  const partFiles = readdirSync(resolvedPartsDir)
    .filter((f) => f.endsWith(".ndjson"))
    .sort();

  if (partFiles.length === 0) {
    console.error(`No .ndjson files found in ${resolvedPartsDir}`);
    process.exit(1);
  }

  const allViolations: Violation[] = [];
  const records: Array<{ rec: ContentRecord; file: string; line: number }> = [];

  for (const file of partFiles) {
    const filePath = join(resolvedPartsDir, file);
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);

    for (let i = 0; i < lines.length; i++) {
      let parsed: ContentRecord;
      try {
        parsed = JSON.parse(lines[i]) as ContentRecord;
      } catch {
        allViolations.push({
          file,
          line: i + 1,
          record_index: records.length,
          field: "JSON",
          reason: `malformed JSON on line ${i + 1}`,
        });
        continue;
      }

      const recViolations = validateRecord(
        parsed,
        taxonomy,
        math,
        file,
        i + 1,
        records.length,
      );
      allViolations.push(...recViolations);
      records.push({ rec: parsed, file, line: i + 1 });
    }
  }

  // -----------------------------------------------------------------------
  // Near-duplicate detection (stem+passage hash collision)
  // -----------------------------------------------------------------------
  allViolations.push(...checkNearDuplicates(records));

  // -----------------------------------------------------------------------
  // Coverage assertion (only when --manifest is provided)
  // -----------------------------------------------------------------------
  if (manifestPath) {
    const manifest = loadManifest(resolve(manifestPath));
    allViolations.push(...checkCoverage(records, manifest, taxonomy));
  }

  if (allViolations.length > 0) {
    const report = {
      status: "FAIL",
      violations: allViolations,
      record_count: records.length,
      file_count: partFiles.length,
    };
    writeFileSync(resolve(reportPath), JSON.stringify(report, null, 2));
    console.error(`GATE FAIL: ${allViolations.length} violation(s) found.`);
    for (const v of allViolations) {
      console.error(`  ${v.file}:${v.line} [${v.field}] ${v.reason}`);
    }
    process.exit(1);
  }

  const batchIds = new Set<string>();
  const assembled: AssembledQuestion[] = [];

  for (const { rec } of records) {
    const sectionCode = rec.section as CanonicalSectionCode;

    let id: string;
    let attempts = 0;
    do {
      id = buildCanonicalId(sectionCode, 2);
      attempts++;
      if (attempts > 100) {
        console.error("FATAL: could not mint unique ID after 100 attempts");
        process.exit(1);
      }
    } while (batchIds.has(id) || appliedIds.has(id));
    batchIds.add(id);

    let correctAnswer: string;
    let correctVariants: string[] | null = null;
    let options: unknown = [];
    let optionMetadata: unknown = null;

    if (rec.item_type === "mcq") {
      correctAnswer = rec.correct_option!;
      options = rec.options;
      optionMetadata = rec.option_metadata;
    } else {
      correctAnswer = rec.correct_answer!;
      const rational = parseGridInValue(rec.correct_answer!);
      if (rational) {
        correctVariants = gridInAcceptedForms(rational);
      }
    }

    assembled.push({
      id,
      section: rec.section,
      source_type: 2,
      domain: rec.domain,
      skill: rec.skill,
      difficulty: rec.difficulty,
      item_type: rec.item_type,
      stem: rec.stem,
      passage: rec.passage ?? null,
      options,
      correct_answer: correctAnswer,
      correct_variants: correctVariants,
      explanation: rec.explanation,
      option_metadata: optionMetadata,
      estimated_time_seconds: rec.estimated_time_seconds,
    });
  }

  assembled.sort((a, b) => a.id.localeCompare(b.id));

  const today = new Date().toISOString().split("T")[0];
  const report = {
    status: "PASS",
    record_count: assembled.length,
    file_count: partFiles.length,
    ids: assembled.map((q) => q.id),
    grid_in_count: assembled.filter((q) => q.item_type === "grid_in").length,
    mcq_count: assembled.filter((q) => q.item_type === "mcq").length,
    sections: Object.fromEntries(
      taxonomy.sections.map((s) => [
        s,
        assembled.filter((q) => q.section === s).length,
      ]),
    ),
  };
  writeFileSync(resolve(reportPath), JSON.stringify(report, null, 2));

  if (dryRun) {
    console.log(
      `DRY RUN PASS: ${assembled.length} records validated, 0 violations.`,
    );
    console.log(`Report: ${reportPath}`);
    process.exit(0);
  }

  const header = [
    `-- Assembled batch: ${assembled.length} questions`,
    `-- @spec [questions_governance.md §A.1–A.9] | @assembled [${today}]`,
    `-- All questions: source_type=2, status='draft'. DO NOT apply to prod — Karl applies after Codex APPROVE.`,
    "",
  ].join("\n");

  const inserts = assembled.map((q) => renderInsert(q, today)).join("\n\n");

  const sqlContent = header + inserts + "\n";
  writeFileSync(resolve(outPath!), sqlContent);
  console.log(`GATE PASS: ${assembled.length} records assembled to ${outPath}`);
  console.log(`Report: ${reportPath}`);

  if (dryApplyFlag) {
    await dryApply(sqlContent, assembled.length);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
