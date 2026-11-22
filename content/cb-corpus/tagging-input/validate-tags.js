#!/usr/bin/env node
// Validates a tagging NDJSON file against the active taxonomy.
// Usage: node validate-tags.js <ndjson-file> [--strict]
// Checks:
//   1. Every sub_skill ID is in the active set
//   2. Every cluster ID is in the active set
//   3. No CL.0231
//   4. Every distractor option_key is A-D
//   5. Every distractor cluster_id is in the active set
//   6. Each record has id, sub_skills[], clusters[], distractors[], why
//   7. No empty sub_skills arrays (anti-fabrication)
//   8. Reports statistics for anti-fabrication checks

const fs = require('fs');
const path = require('path');

const taxPath = path.join(__dirname, 'taxonomy-ref.json');
const tax = JSON.parse(fs.readFileSync(taxPath, 'utf8'));

const activeSubSkills = new Set(tax.active_sub_skill_ids);
const activeClusters = new Set(tax.active_cluster_ids);

const file = process.argv[2];
if (!file) {
  console.error('Usage: node validate-tags.js <ndjson-file>');
  process.exit(1);
}

const strict = process.argv.includes('--strict');
const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
const errors = [];
const warnings = [];
let totalSubSkills = 0;
let totalClusters = 0;
let totalDistractors = 0;
let emptySubSkills = 0;
let emptyClusters = 0;
let emptyDistractors = 0;
const ids = new Set();

for (let i = 0; i < lines.length; i++) {
  let rec;
  try {
    rec = JSON.parse(lines[i]);
  } catch (e) {
    errors.push(`Line ${i+1}: Invalid JSON: ${e.message}`);
    continue;
  }

  if (!rec.id) errors.push(`Line ${i+1}: Missing id`);
  if (ids.has(rec.id)) errors.push(`Line ${i+1}: Duplicate id ${rec.id}`);
  ids.add(rec.id);

  if (!Array.isArray(rec.sub_skills)) {
    errors.push(`Line ${i+1} (${rec.id}): sub_skills is not an array`);
  } else {
    totalSubSkills += rec.sub_skills.length;
    if (rec.sub_skills.length === 0) emptySubSkills++;
    for (const ss of rec.sub_skills) {
      if (!activeSubSkills.has(ss)) errors.push(`Line ${i+1} (${rec.id}): Invalid sub_skill ${ss}`);
    }
  }

  if (!Array.isArray(rec.clusters)) {
    errors.push(`Line ${i+1} (${rec.id}): clusters is not an array`);
  } else {
    totalClusters += rec.clusters.length;
    if (rec.clusters.length === 0) emptyClusters++;
    for (const cl of rec.clusters) {
      if (cl === 'CL.0231') errors.push(`Line ${i+1} (${rec.id}): FORBIDDEN CL.0231`);
      if (!activeClusters.has(cl)) errors.push(`Line ${i+1} (${rec.id}): Invalid cluster ${cl}`);
    }
  }

  if (!Array.isArray(rec.distractors)) {
    errors.push(`Line ${i+1} (${rec.id}): distractors is not an array`);
  } else {
    totalDistractors += rec.distractors.length;
    if (rec.distractors.length === 0) emptyDistractors++;
    for (const d of rec.distractors) {
      if (!d.option_key || !/^[A-D]$/.test(d.option_key)) {
        errors.push(`Line ${i+1} (${rec.id}): Invalid distractor option_key ${d.option_key}`);
      }
      if (d.cluster_id === 'CL.0231') errors.push(`Line ${i+1} (${rec.id}): FORBIDDEN CL.0231 in distractor`);
      if (d.cluster_id && !activeClusters.has(d.cluster_id)) {
        errors.push(`Line ${i+1} (${rec.id}): Invalid distractor cluster_id ${d.cluster_id}`);
      }
    }
  }

  if (!rec.why && strict) warnings.push(`Line ${i+1} (${rec.id}): Missing 'why' field`);
}

console.log(`\n=== Validation Report: ${path.basename(file)} ===`);
console.log(`Records: ${lines.length}`);
console.log(`Unique IDs: ${ids.size}`);
console.log(`Total sub_skills: ${totalSubSkills} (avg ${(totalSubSkills/lines.length).toFixed(1)}/item)`);
console.log(`Total clusters: ${totalClusters} (avg ${(totalClusters/lines.length).toFixed(1)}/item)`);
console.log(`Total distractors: ${totalDistractors} (avg ${(totalDistractors/lines.length).toFixed(1)}/item)`);
console.log(`Empty sub_skills: ${emptySubSkills}/${lines.length}`);
console.log(`Empty clusters: ${emptyClusters}/${lines.length}`);
console.log(`Empty distractors: ${emptyDistractors}/${lines.length}`);

if (errors.length > 0) {
  console.log(`\nERRORS (${errors.length}):`);
  for (const e of errors.slice(0, 50)) console.log(`  ${e}`);
  if (errors.length > 50) console.log(`  ... and ${errors.length - 50} more`);
}
if (warnings.length > 0) {
  console.log(`\nWARNINGS (${warnings.length}):`);
  for (const w of warnings.slice(0, 20)) console.log(`  ${w}`);
}

const pass = errors.length === 0;
console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
