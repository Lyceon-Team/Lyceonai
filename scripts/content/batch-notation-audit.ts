/**
 * Per-batch notation audit — runs notation-diff ONLY on the batch's
 * target skills, using cached official corpus NDJSON.
 *
 * Integrates into the authoring loop after the structural gate passes.
 * Any NOVEL_NOTATION finding → REJECT (same severity as gate failure).
 *
 * Usage:
 *   batch-notation-audit --batch-dir <parts-dir> --out <report.json>
 *
 * Requires: content/official-corpus/<skill-slug>.ndjson for each
 * target skill. Missing cache → skip that skill with a warning
 * (never false-positive on uncached skills).
 *
 * @spec Scoped spec-alignment audit (Karl, 2026-10-18)
 * @implemented 2026-10-18
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  readCache,
  isCached,
  type OfficialQuestion,
} from "./official-corpus-ocr.js";
import {
  buildReferenceDistribution,
  buildBankProfile,
  diff,
} from "./notation-diff.js";
import type { TokenName } from "./notation-tokens.js";

type BatchQuestion = {
  id: string;
  skill: string;
  skill_codes?: string[];
  stem: string;
  options?: Array<{ key: string; text: string }> | null;
  passage?: string | null;
};

type AuditResult = {
  version: 1;
  batch_dir: string;
  generated_at: string;
  target_skills: string[];
  cached_skills: string[];
  uncached_skills: string[];
  findings: Array<{
    question_id: string;
    skill: string;
    token: TokenName;
    official_count: number;
    official_sample_size: number;
    severity: "NOVEL_NOTATION";
  }>;
  skill_reports: Array<{
    skill: string;
    official_sample_size: number;
    batch_count: number;
    novel_tokens: Array<{
      token: TokenName;
      question_ids: string[];
    }>;
  }>;
  pass: boolean;
};

function loadBatchQuestions(batchDir: string): BatchQuestion[] {
  const files = readdirSync(batchDir).filter((f) => f.endsWith(".ndjson"));
  const questions: BatchQuestion[] = [];

  for (const file of files) {
    const lines = readFileSync(join(batchDir, file), "utf-8")
      .split("\n")
      .filter((l) => l.trim());

    for (const line of lines) {
      const rec = JSON.parse(line) as Record<string, unknown>;
      questions.push({
        id: rec.id as string,
        skill:
          (rec.skill as string) ?? (rec.skill_codes as string[])?.[0] ?? "",
        skill_codes: rec.skill_codes as string[] | undefined,
        stem: rec.stem as string,
        options: rec.options as Array<{ key: string; text: string }> | null,
        passage: rec.passage as string | null,
      });
    }
  }

  return questions;
}

export function runNotationAudit(batchDir: string): AuditResult {
  const questions = loadBatchQuestions(batchDir);

  const targetSkills = [...new Set(questions.map((q) => q.skill))].sort();
  const cachedSkills = targetSkills.filter((s) => isCached(s));
  const uncachedSkills = targetSkills.filter((s) => !isCached(s));

  const officialRecords: OfficialQuestion[] = [];
  for (const skill of cachedSkills) {
    officialRecords.push(...readCache(skill));
  }

  const bankRecords = questions
    .filter((q) => cachedSkills.includes(q.skill))
    .map((q) => ({
      id: q.id,
      skill_codes: [q.skill],
      stem: q.stem,
      options: q.options?.map((o) => ({ text: o.text })) ?? null,
    }));

  const reference = buildReferenceDistribution(officialRecords);
  const bankProfile = buildBankProfile(bankRecords);

  const officialCounts = new Map<string, number>();
  for (const rec of officialRecords) {
    officialCounts.set(rec.skill, (officialCounts.get(rec.skill) ?? 0) + 1);
  }
  const bankCounts = new Map<string, number>();
  for (const q of bankRecords) {
    const s = q.skill_codes[0];
    if (s) bankCounts.set(s, (bankCounts.get(s) ?? 0) + 1);
  }

  const skillReports = diff(reference, bankProfile, officialCounts, bankCounts);

  const findings: AuditResult["findings"] = [];
  const skillSummaries: AuditResult["skill_reports"] = [];

  for (const report of skillReports) {
    if (!cachedSkills.includes(report.skill)) continue;

    const novelTokens: AuditResult["skill_reports"][0]["novel_tokens"] = [];

    for (const nn of report.novel_notation) {
      for (const qid of nn.ids) {
        findings.push({
          question_id: qid,
          skill: report.skill,
          token: nn.token,
          official_count: nn.official_count,
          official_sample_size: report.official_sample_size,
          severity: "NOVEL_NOTATION",
        });
      }

      novelTokens.push({
        token: nn.token,
        question_ids: nn.ids,
      });
    }

    if (novelTokens.length > 0) {
      skillSummaries.push({
        skill: report.skill,
        official_sample_size: report.official_sample_size,
        batch_count: report.lyceon_count,
        novel_tokens: novelTokens,
      });
    }
  }

  return {
    version: 1,
    batch_dir: batchDir,
    generated_at: new Date().toISOString(),
    target_skills: targetSkills,
    cached_skills: cachedSkills,
    uncached_skills: uncachedSkills,
    findings,
    skill_reports: skillSummaries,
    pass: findings.length === 0,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  let batchDir = "";
  let out = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--batch-dir" && args[i + 1]) batchDir = args[++i]!;
    else if (args[i] === "--out" && args[i + 1]) out = args[++i]!;
  }

  if (!batchDir || !out) {
    console.error(
      "Usage: batch-notation-audit --batch-dir <parts-dir> --out <report.json>",
    );
    process.exit(1);
  }

  const result = runNotationAudit(batchDir);

  writeFileSync(out, JSON.stringify(result, null, 2) + "\n");

  console.log(`Notation audit: ${result.pass ? "PASS" : "FAIL"}`);
  console.log(`  Target skills: ${result.target_skills.length}`);
  console.log(`  Cached: ${result.cached_skills.length}`);
  console.log(`  Uncached (skipped): ${result.uncached_skills.length}`);
  console.log(`  Findings: ${result.findings.length}`);

  if (result.findings.length > 0) {
    console.log("\nNOVEL_NOTATION findings:");
    for (const f of result.findings) {
      console.log(
        `  ${f.question_id}: ${f.token} in ${f.skill} (0/${f.official_sample_size} official)`,
      );
    }
  }

  if (result.uncached_skills.length > 0) {
    console.log("\nWARNING: uncached skills (not audited):");
    for (const s of result.uncached_skills) {
      console.log(`  ${s}`);
    }
  }

  process.exit(result.pass ? 0 : 1);
}

const isDirectRun =
  typeof import.meta.url === "string" &&
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""));

if (isDirectRun) {
  main();
}
