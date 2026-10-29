/**
 * Compare two tagging passes and generate the pilot report.
 *
 * Usage: pnpm exec tsx compare-passes.ts
 * Reads: pass-1-results.ndjson, pass-2-results.ndjson, questions-ee.json
 * Writes: pilot-report.json, disagreements.json
 */
import { readFileSync, writeFileSync } from "node:fs";

type TagResult = {
  question_id: string;
  pass_id: string;
  sub_skill_ids: string[];
  cluster_ids: string[];
  distractor_clusters: { option_key: string; cluster_id: string }[];
  derivation_summary: string;
  model_input_tokens: number;
  model_output_tokens: number;
};

type Question = {
  id: string;
  item_type: string;
};

function loadNdjson(path: string): TagResult[] {
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TagResult);
}

function setEqual(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

function dcEqual(
  a: { option_key: string; cluster_id: string }[],
  b: { option_key: string; cluster_id: string }[]
): boolean {
  const keyA = new Set(a.map((d) => `${d.option_key}:${d.cluster_id}`));
  const keyB = new Set(b.map((d) => `${d.option_key}:${d.cluster_id}`));
  if (keyA.size !== keyB.size) return false;
  for (const x of keyA) if (!keyB.has(x)) return false;
  return true;
}

const pass1 = loadNdjson("pass-1-results.ndjson");
const pass2 = loadNdjson("pass-2-results.ndjson");
const questions: Question[] = JSON.parse(readFileSync("questions-ee.json", "utf-8"));

const qMap = new Map(questions.map((q) => [q.id, q]));
const p1Map = new Map(pass1.map((r) => [r.question_id, r]));
const p2Map = new Map(pass2.map((r) => [r.question_id, r]));

// Coverage stats (from pass 1 — the working set)
let withSubSkill = 0;
let withCluster = 0;
let mcqWithDistractor = 0;
let mcqTotal = 0;

for (const r of pass1) {
  if (r.sub_skill_ids.length > 0) withSubSkill++;
  if (r.cluster_ids.length > 0) withCluster++;
  const q = qMap.get(r.question_id);
  if (q?.item_type === "mcq") {
    mcqTotal++;
    if (r.distractor_clusters.length > 0) mcqWithDistractor++;
  }
}

// Agreement
let subSkillMatch = 0;
let clusterMatch = 0;
let dcMatch = 0;
let dcComparable = 0;
const disagreements: {
  question_id: string;
  sub_skill_diff: boolean;
  cluster_diff: boolean;
  dc_diff: boolean;
  pass1_sub: string[];
  pass2_sub: string[];
  pass1_cl: string[];
  pass2_cl: string[];
  pass1_dc: { option_key: string; cluster_id: string }[];
  pass2_dc: { option_key: string; cluster_id: string }[];
}[] = [];

for (const r1 of pass1) {
  const r2 = p2Map.get(r1.question_id);
  if (!r2) continue;

  const subEq = setEqual(r1.sub_skill_ids, r2.sub_skill_ids);
  const clEq = setEqual(r1.cluster_ids, r2.cluster_ids);
  const dEq = dcEqual(r1.distractor_clusters, r2.distractor_clusters);

  if (subEq) subSkillMatch++;
  if (clEq) clusterMatch++;

  const q = qMap.get(r1.question_id);
  if (q?.item_type === "mcq") {
    dcComparable++;
    if (dEq) dcMatch++;
  }

  if (!subEq || !clEq || !dEq) {
    disagreements.push({
      question_id: r1.question_id,
      sub_skill_diff: !subEq,
      cluster_diff: !clEq,
      dc_diff: !dEq,
      pass1_sub: r1.sub_skill_ids,
      pass2_sub: r2.sub_skill_ids,
      pass1_cl: r1.cluster_ids,
      pass2_cl: r2.cluster_ids,
      pass1_dc: r1.distractor_clusters,
      pass2_dc: r2.distractor_clusters,
    });
  }
}

const total = pass1.length;

// First-class count: sub-skill tagged + non-method cluster tagged + distractor where derivable
let firstClass = 0;
for (const r of pass1) {
  const q = qMap.get(r.question_id);
  if (r.sub_skill_ids.length > 0 && r.cluster_ids.length > 0) {
    if (q?.item_type === "grid_in" || r.distractor_clusters.length > 0) {
      firstClass++;
    }
  }
}

// Token costs
let p1InputTotal = 0, p1OutputTotal = 0, p2InputTotal = 0, p2OutputTotal = 0;
for (const r of pass1) { p1InputTotal += r.model_input_tokens; p1OutputTotal += r.model_output_tokens; }
for (const r of pass2) { p2InputTotal += r.model_input_tokens; p2OutputTotal += r.model_output_tokens; }

// Sonnet pricing: $3/M input, $15/M output
const p1Cost = (p1InputTotal / 1e6) * 3 + (p1OutputTotal / 1e6) * 15;
const p2Cost = (p2InputTotal / 1e6) * 3 + (p2OutputTotal / 1e6) * 15;

const report = {
  pilot: "Equivalent Expressions SCL tagging",
  question_count: total,
  mcq_count: mcqTotal,
  grid_in_count: total - mcqTotal,
  coverage: {
    with_sub_skill_tag: withSubSkill,
    with_cluster_tag: withCluster,
    mcq_with_distractor_cluster: mcqWithDistractor,
    mcq_total: mcqTotal,
  },
  agreement: {
    sub_skill_exact_match: `${((subSkillMatch / total) * 100).toFixed(1)}%`,
    sub_skill_match_count: subSkillMatch,
    cluster_exact_match: `${((clusterMatch / total) * 100).toFixed(1)}%`,
    cluster_match_count: clusterMatch,
    distractor_exact_match: dcComparable > 0 ? `${((dcMatch / dcComparable) * 100).toFixed(1)}%` : "N/A",
    distractor_match_count: dcMatch,
    distractor_comparable: dcComparable,
  },
  first_class_count: firstClass,
  disagreement_count: disagreements.length,
  cost: {
    pass1: { input_tokens: p1InputTotal, output_tokens: p1OutputTotal, estimated_usd: `$${p1Cost.toFixed(2)}` },
    pass2: { input_tokens: p2InputTotal, output_tokens: p2OutputTotal, estimated_usd: `$${p2Cost.toFixed(2)}` },
    total_estimated_usd: `$${(p1Cost + p2Cost).toFixed(2)}`,
  },
};

writeFileSync("pilot-report.json", JSON.stringify(report, null, 2));
writeFileSync("disagreements.json", JSON.stringify(disagreements, null, 2));

console.log("\n=== PILOT REPORT ===");
console.log(JSON.stringify(report, null, 2));
console.log(`\nDisagreements: ${disagreements.length} (written to disagreements.json)`);
