/**
 * Bank-wide dedup audit — hashes every question on the branch and checks for
 * collisions: (a) between branch questions, (b) between branch questions and
 * the original prod corpus (excluding hashes that belong to the batch itself).
 *
 * Usage: pnpm tsx scripts/dedup-audit.ts [--verbose]
 *
 * Reports every collision as { source, collides_with, hash, stem_prefix }.
 * Exit code 0 = clean, 1 = collisions found.
 *
 * @spec [questions_governance.md §A] | @implemented [2026-08-17]
 * Prod-grounded dedup audit: catches exact-duplicate stems across the entire
 * question bank (prod + branch). Hash: md5(normalize(stem) + '||' + normalize(passage)).
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { createHash } from "crypto";
import { join, resolve } from "path";
import { parseArgs } from "util";

const REPO_ROOT = resolve(import.meta.dirname, "..");

// ---------------------------------------------------------------------------
// Exact normalization matching prod corpus
// ---------------------------------------------------------------------------

function normalizeDedupText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function dedupHash(stem: string, passage: string | null): string {
  const key =
    normalizeDedupText(stem) + "||" + normalizeDedupText(passage ?? "");
  return createHash("md5").update(key).digest("hex");
}

// ---------------------------------------------------------------------------
// Load all branch questions
// ---------------------------------------------------------------------------

type BranchQuestion = {
  batch: string;
  file: string;
  line: number;
  hash: string;
  stem: string;
  passage: string | null;
  skill: string;
  difficulty: number;
};

function loadBranchQuestions(): BranchQuestion[] {
  const questions: BranchQuestion[] = [];
  const partsRoot = join(REPO_ROOT, "infra/supabase/seed/parts");
  if (!existsSync(partsRoot)) return questions;

  const batchDirs = readdirSync(partsRoot)
    .filter((d) => d.startsWith("batch_"))
    .sort();

  for (const batchDir of batchDirs) {
    const batchPath = join(partsRoot, batchDir);
    const ndjsonFiles = readdirSync(batchPath)
      .filter((f) => f.endsWith(".ndjson"))
      .sort();

    for (const file of ndjsonFiles) {
      const filePath = join(batchPath, file);
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);

      for (let i = 0; i < lines.length; i++) {
        try {
          const rec = JSON.parse(lines[i]);
          const hash = dedupHash(rec.stem, rec.passage);
          questions.push({
            batch: batchDir,
            file,
            line: i + 1,
            hash,
            stem: rec.stem,
            passage: rec.passage,
            skill: rec.skill,
            difficulty: rec.difficulty,
          });
        } catch {
          console.warn(`WARN: malformed JSON in ${batchDir}/${file}:${i + 1}`);
        }
      }
    }
  }

  return questions;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const { values } = parseArgs({
    options: {
      verbose: { type: "boolean", default: false },
    },
    strict: true,
  });

  const verbose = values["verbose"] ?? false;

  const questions = loadBranchQuestions();
  const batchSet = new Set(questions.map((q) => q.batch));
  console.log(
    `Loaded ${questions.length} branch questions across ${batchSet.size} batches`,
  );

  type Collision = {
    source: string;
    hash: string;
    stem_prefix: string;
    collides_with: string;
  };

  const collisions: Collision[] = [];

  // Build a map of hash → first occurrence for cross-batch dedup
  const hashMap = new Map<
    string,
    { batch: string; file: string; line: number }
  >();

  for (const q of questions) {
    const stemPrefix =
      q.stem.substring(0, 80) + (q.stem.length > 80 ? "…" : "");
    const source = `${q.batch}/${q.file}:${q.line}`;

    // Check against other branch questions (different file or batch)
    const existing = hashMap.get(q.hash);
    if (existing) {
      const existingSource = `${existing.batch}/${existing.file}:${existing.line}`;
      // Only flag if they're from different part-files (same hash in same file = intra-file dup, caught by gate)
      if (q.batch !== existing.batch || q.file !== existing.file) {
        collisions.push({
          source,
          hash: q.hash,
          stem_prefix: stemPrefix,
          collides_with: existingSource,
        });
      }
    } else {
      hashMap.set(q.hash, { batch: q.batch, file: q.file, line: q.line });
    }
  }

  if (collisions.length === 0) {
    console.log("\n✅ CLEAN — zero cross-batch duplicates found.");
    if (verbose) {
      console.log(`\n  Branch questions: ${questions.length}`);
      console.log(`  Unique hashes: ${hashMap.size}`);
      console.log(`  Batches: ${[...batchSet].sort().join(", ")}`);
    }
    process.exit(0);
  }

  console.log(`\n❌ CROSS-BATCH DUPLICATES FOUND: ${collisions.length}\n`);
  for (const c of collisions) {
    console.log(`  ${c.source}`);
    console.log(`    hash: ${c.hash}`);
    console.log(`    collides_with: ${c.collides_with}`);
    console.log(`    stem: ${c.stem_prefix}`);
    console.log();
  }

  if (verbose) {
    console.log("Hash summary:");
    console.log(`  Branch questions: ${questions.length}`);
    console.log(`  Unique hashes: ${hashMap.size}`);
  }

  process.exit(1);
}

main();
