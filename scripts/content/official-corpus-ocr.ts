/**
 * Official SAT corpus OCR pipeline.
 *
 * Resolves taxonomy skills to their official PDF files, reads pages
 * via AI vision, and extracts questions as NDJSON into
 * content/official-corpus/<skill-slug>.ndjson.
 *
 * Cache-once: if the NDJSON already exists for a skill, skip it.
 *
 * @spec Scoped spec-alignment audit (Karl, 2026-10-18)
 * @implemented 2026-10-18
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ── Skill → PDF mapping ────────────────────────────────────────────

const PDF_DIR = "docs/SAT Qeustions S.D";
const CORPUS_DIR = "content/official-corpus";

/**
 * The PDF filenames have inconsistent spelling of some skills.
 * This maps taxonomy skill names → the substring used in PDF filenames.
 */
const SKILL_TO_PDF_FRAGMENT: Record<string, string> = {
  // Algebra
  "Linear Equations in One Variable": "Linear equations in one variabe",
  "Linear Equations in Two Variables": "Linear equations in two variabe",
  "Linear Functions": "Linear functions",
  "Linear Inequalities in One or Two Variables":
    "Linear inequalities in one or two variabes",
  "Systems of Two Linear Equations in Two Variables":
    "System of two linear equations in two variabe",

  // Advanced Math
  "Equivalent Expressions": "Equivalent expressions",
  "Nonlinear Equations in One Variable and Systems of Equations in Two Variables":
    "Nonlinear equations in one variable and systems of equations in two variables",
  "Nonlinear Functions": "Nonlinear functions",

  // Problem Solving and Data Analysis
  "Ratios, Rates, Proportional Relationships, and Units":
    "Ratios, rates, proportional relationships, and units",
  Percentages: "Pecentages",
  "One-Variable Data: Distributions and Measures of Center and Spread":
    "One-variable data, Distributions and measures of center and spread",
  "Two-Variable Data: Models and Scatterplots":
    "Two-variable data, Models and scatterplots",
  "Probability and Conditional Probability":
    "Probability and conditional probability",
  "Inference from Sample Statistics and Margin of Error":
    "Inference from sample statistics and margin of error",
  "Evaluating Statistical Claims: Observational Studies and Experiments":
    "Evaluating statistical claims, Observational studies and experiments",

  // Geometry and Trigonometry
  "Lines, Angles, and Triangles": "Lines, angles, and triangles",
  "Right Triangles and Trigonometry": "Right triangles and trigonometry",
  Circles: "Circles",
  "Area and Volume": "Area and volume",

  // Information and Ideas
  "Central Ideas and Details": "Central ideas and details",
  "Command of Evidence": "Command of Evidence",
  Inferences: "Inferences",

  // Craft and Structure
  "Words in Context": "Words in Context",
  "Text Structure and Purpose": "Text Structure and Purpose",
  "Cross-Text Connections": "Cross-Text Connections",

  // Expression of Ideas
  Transitions: "Transitions",
  "Rhetorical Synthesis": "Rhetorical synthesis",

  // Standard English Conventions
  Boundaries: "Boundaries",
  "Form, Structure, and Sense": "Form, Structure, and Sense",
};

const DIFFICULTY_MAP: Record<string, string> = {
  "1": "Easy",
  "2": "Medium",
  "3": "Hard",
};

export function skillSlug(skill: string): string {
  return skill
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Resolve a (skill, difficulty?) to matching PDF file paths.
 * If difficulty is omitted, returns all three difficulty PDFs for that skill.
 */
export function resolvePdfs(skill: string, difficulty?: string): string[] {
  const fragment = SKILL_TO_PDF_FRAGMENT[skill];
  if (!fragment) return [];

  const difficulties = difficulty
    ? [DIFFICULTY_MAP[difficulty] ?? difficulty]
    : ["Easy", "Medium", "Hard"];

  const allFiles = readdirSync(PDF_DIR);
  const matches: string[] = [];

  for (const diff of difficulties) {
    const prefix = `${diff} - ${fragment}`;
    for (const f of allFiles) {
      if (f.startsWith(prefix) && f.endsWith(".pdf")) {
        matches.push(join(PDF_DIR, f));
      }
    }
  }

  return matches;
}

/**
 * Check if a skill's official corpus NDJSON cache already exists.
 */
export function isCached(skill: string): boolean {
  const slug = skillSlug(skill);
  const path = join(CORPUS_DIR, `${slug}.ndjson`);
  return existsSync(path) && readFileSync(path, "utf-8").trim().length > 0;
}

/**
 * Return the cache path for a skill.
 */
export function cachePath(skill: string): string {
  return join(CORPUS_DIR, `${skillSlug(skill)}.ndjson`);
}

// ── Types for the OCR output ────────────────────────────────────────

export type OfficialQuestion = {
  official_id: string;
  skill: string;
  difficulty: string;
  ocr_text: string;
};

/**
 * Write extracted questions to the NDJSON cache file for a skill.
 */
export function writeCache(
  skill: string,
  questions: OfficialQuestion[],
): string {
  const outPath = cachePath(skill);
  const lines = questions.map((q) => JSON.stringify(q));
  writeFileSync(outPath, lines.join("\n") + "\n");
  return outPath;
}

/**
 * Read the cached NDJSON for a skill.
 */
export function readCache(skill: string): OfficialQuestion[] {
  const path = cachePath(skill);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as OfficialQuestion);
}

// ── CLI for manual testing ──────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);

  if (args[0] === "resolve") {
    const skill = args[1];
    const diff = args[2];
    if (!skill) {
      console.error("Usage: official-corpus-ocr resolve <skill> [difficulty]");
      process.exit(1);
    }
    const pdfs = resolvePdfs(skill, diff);
    console.log(`Skill: ${skill}`);
    console.log(`Slug: ${skillSlug(skill)}`);
    console.log(`Cached: ${isCached(skill)}`);
    console.log(`PDFs (${pdfs.length}):`);
    for (const p of pdfs) console.log(`  ${p}`);
    return;
  }

  if (args[0] === "list-uncached") {
    const taxonomy = JSON.parse(
      readFileSync("content/canonical/taxonomy.json", "utf-8"),
    );
    const allSkills: string[] = [];
    for (const skills of Object.values(taxonomy.skills) as string[][]) {
      allSkills.push(...skills);
    }
    for (const skill of allSkills) {
      const cached = isCached(skill);
      const pdfs = resolvePdfs(skill);
      console.log(
        `${cached ? "[CACHED]" : "[NEEDED]"} ${skill} → ${pdfs.length} PDFs, slug: ${skillSlug(skill)}`,
      );
    }
    return;
  }

  console.log("Usage:");
  console.log("  official-corpus-ocr resolve <skill> [difficulty]");
  console.log("  official-corpus-ocr list-uncached");
}

const isDirectRun =
  typeof import.meta.url === "string" &&
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""));

if (isDirectRun) {
  main();
}
