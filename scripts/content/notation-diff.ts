/**
 * Notation-token corpus shape-diff — Phase 1.
 *
 * Compares the notation-token profile of the Lyceon bank against
 * an official SAT corpus to surface NOVEL_NOTATION findings:
 * tokens present in Lyceon questions that never appear in the
 * official corpus for that skill.
 *
 * Usage:
 *   notation-diff --official <corpus.ndjson> --bank <bank.ndjson> --out <report.json>
 *
 * Both inputs are NDJSON with at least: { skill, stem, options? }
 * The official corpus uses the field names from Step 0:
 *   { official_id, assessment, test, domain, skill, difficulty, ocr_text }
 * The bank uses the standard question record shape.
 *
 * @spec Corpus shape-diff Phase 1 (Karl, 2026-10-18)
 * @implemented 2026-10-18
 */

import { readFileSync, writeFileSync } from "node:fs";
import { tokens, questionTokens, type TokenName } from "./notation-tokens.js";

// ── Types ────────────────────────────────────────────────────────────

type OfficialRecord = {
  official_id: string;
  skill: string;
  ocr_text: string;
};

type BankRecord = {
  id: string;
  skill_codes: string[];
  stem: string;
  options?: Array<{ text: string }> | null;
};

type NovelNotation = {
  token: TokenName;
  lyceon_count: number;
  official_count: number;
  ids: string[];
  severity: "likely_off_spec";
};

type SkillReport = {
  skill: string;
  official_sample_size: number;
  lyceon_count: number;
  novel_notation: NovelNotation[];
};

// ── Core logic (pure) ────────────────────────────────────────────────

/**
 * Build the per-skill allowed-token map from the official corpus.
 * Returns { skill -> { token -> count } }
 */
export function buildReferenceDistribution(
  records: OfficialRecord[],
): Map<string, Map<TokenName, number>> {
  const dist = new Map<string, Map<TokenName, number>>();

  for (const rec of records) {
    const skill = rec.skill;
    if (!dist.has(skill)) dist.set(skill, new Map());
    const skillMap = dist.get(skill)!;

    const found = tokens(rec.ocr_text);
    for (const t of found) {
      skillMap.set(t, (skillMap.get(t) ?? 0) + 1);
    }
  }

  return dist;
}

/**
 * Build the per-skill token profile + question ID index from the bank.
 * Returns { skill -> { token -> Set<questionId> } }
 */
export function buildBankProfile(
  records: BankRecord[],
): Map<string, Map<TokenName, Set<string>>> {
  const profile = new Map<string, Map<TokenName, Set<string>>>();

  for (const rec of records) {
    const skill = rec.skill_codes?.[0];
    if (!skill) continue;

    if (!profile.has(skill)) profile.set(skill, new Map());
    const skillMap = profile.get(skill)!;

    const found = questionTokens(rec);
    for (const t of found) {
      if (!skillMap.has(t)) skillMap.set(t, new Set());
      skillMap.get(t)!.add(rec.id);
    }
  }

  return profile;
}

/**
 * Diff the bank profile against the reference distribution.
 * Emits NOVEL_NOTATION findings for tokens with official_count = 0.
 */
export function diff(
  reference: Map<string, Map<TokenName, number>>,
  bankProfile: Map<string, Map<TokenName, Set<string>>>,
  officialCounts: Map<string, number>,
  bankCounts: Map<string, number>,
): SkillReport[] {
  const allSkills = new Set([...reference.keys(), ...bankProfile.keys()]);
  const reports: SkillReport[] = [];

  for (const skill of [...allSkills].sort()) {
    const refMap = reference.get(skill) ?? new Map<TokenName, number>();
    const bankMap = bankProfile.get(skill) ?? new Map<TokenName, Set<string>>();

    const novel: NovelNotation[] = [];

    for (const [token, ids] of bankMap) {
      const officialCount = refMap.get(token) ?? 0;
      if (officialCount === 0) {
        novel.push({
          token,
          lyceon_count: ids.size,
          official_count: 0,
          ids: [...ids].sort(),
          severity: "likely_off_spec",
        });
      }
    }

    novel.sort((a, b) => b.lyceon_count - a.lyceon_count);

    reports.push({
      skill,
      official_sample_size: officialCounts.get(skill) ?? 0,
      lyceon_count: bankCounts.get(skill) ?? 0,
      novel_notation: novel,
    });
  }

  return reports;
}

// ── CLI ──────────────────────────────────────────────────────────────

function parseArgs(): {
  official: string;
  bank: string;
  out: string;
} {
  const args = process.argv.slice(2);
  let official = "";
  let bank = "";
  let out = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--official" && args[i + 1]) official = args[++i]!;
    else if (args[i] === "--bank" && args[i + 1]) bank = args[++i]!;
    else if (args[i] === "--out" && args[i + 1]) out = args[++i]!;
  }

  if (!official || !bank || !out) {
    console.error(
      "Usage: notation-diff --official <corpus.ndjson> --bank <bank.ndjson> --out <report.json>",
    );
    process.exit(1);
  }

  return { official, bank, out };
}

function readNdjson<T>(path: string): T[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

function main(): void {
  const { official, bank, out } = parseArgs();

  console.log("Loading official corpus...");
  const officialRecords = readNdjson<OfficialRecord>(official);
  console.log(`  ${officialRecords.length} official questions`);

  console.log("Loading Lyceon bank...");
  const bankRecords = readNdjson<BankRecord>(bank);
  console.log(`  ${bankRecords.length} bank questions`);

  console.log("Building reference distribution...");
  const reference = buildReferenceDistribution(officialRecords);

  console.log("Building bank profile...");
  const bankProfile = buildBankProfile(bankRecords);

  // Count questions per skill
  const officialCounts = new Map<string, number>();
  for (const rec of officialRecords) {
    officialCounts.set(rec.skill, (officialCounts.get(rec.skill) ?? 0) + 1);
  }
  const bankCountMap = new Map<string, number>();
  for (const rec of bankRecords) {
    const skill = rec.skill_codes?.[0];
    if (skill) bankCountMap.set(skill, (bankCountMap.get(skill) ?? 0) + 1);
  }

  console.log("Computing diff...");
  const reports = diff(reference, bankProfile, officialCounts, bankCountMap);

  const totalFindings = reports.reduce(
    (s, r) => s + r.novel_notation.length,
    0,
  );
  const totalFlaggedIds = reports.reduce(
    (s, r) => s + r.novel_notation.reduce((s2, n) => s2 + n.ids.length, 0),
    0,
  );

  const output = {
    version: 1,
    generated_at: new Date().toISOString(),
    summary: {
      official_questions: officialRecords.length,
      bank_questions: bankRecords.length,
      skills_with_findings: reports.filter((r) => r.novel_notation.length > 0)
        .length,
      total_novel_tokens: totalFindings,
      total_flagged_questions: totalFlaggedIds,
    },
    skills: reports.filter((r) => r.novel_notation.length > 0),
  };

  writeFileSync(out, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nReport written to ${out}`);
  console.log(
    `  ${output.summary.skills_with_findings} skills with findings, ${totalFindings} novel tokens, ${totalFlaggedIds} flagged questions`,
  );

  if (totalFindings > 0) {
    console.log("\nFindings:");
    for (const skill of output.skills) {
      for (const finding of skill.novel_notation) {
        console.log(
          `  ${skill.skill}: ${finding.token} (${finding.lyceon_count} questions, 0/${skill.official_sample_size} official)`,
        );
      }
    }
  }
}

// Run only when executed directly
const isDirectRun =
  typeof import.meta.url === "string" &&
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""));

if (isDirectRun) {
  main();
}
