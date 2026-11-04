# NLE + NLF Write Pass Report

**Date:** 2026-11-04
**Taxonomy:** scl-v1.0.0
**Pass:** WRITE (first of two-pass loop)
**Output:** `nonlin-write.ndjson` (688 lines)

## Scope

| Skill code | Questions | Grid-in |
|---|---|---|
| Nonlinear Equations in One Variable and Systems of Equations in Two Variables (NLE) | 348 | ~128 |
| Nonlinear Functions (NLF) | 340 | ~65 |
| **Total** | **688** | **~193** |

## Sub-skill distribution

| Sub-skill | Count | % of skill |
|---|---|---|
| NLE.1 (Rearrange formula) | **0** | 0% |
| NLE.2 (Solve quadratic/polynomial) | 223 | 64.1% |
| NLE.3 (Abs/radical/rational equation) | 52 | 14.9% |
| NLE.4 (Number of real solutions) | 86 | 24.7% |
| NLE.5 (Linear-nonlinear system) | 40 | 11.5% |
| NLF.1 (Evaluate/read/solve input-output) | 115 | 33.8% |
| NLF.2 (Interpret in context) | 12 | 3.5% |
| NLF.3 (Exponential growth/decay) | 56 | 16.5% |
| NLF.4 (Quadratic/polynomial structure) | 166 | 48.8% |
| NLF.5 (Transformations) | 24 | 7.1% |

Percentages exceed 100% per skill due to co-tags (86 multi-sub-skill questions).

## Co-tagging and cluster coverage

- 86 multi-sub-skill questions (12.5%)
- 48 distinct clusters used (of 230 available)
- Average 1.8 clusters per question
- Zero-cluster questions: 0 (0.0%)
- Distractor entries: 924

## Findings

### 1. Zero-coverage: NLE.1

NLE.1 ("Rearrange a formula to isolate a variable") has zero questions in this pass. This is expected: NLE.1's inclusion test says "express a variable 'in terms of' other letters" — these questions are likely classified under a different `skill_codes` value in the question bank (e.g., "Linear Equations in Two Variables" or a general algebra skill) rather than the "Nonlinear Equations" skill code used to pull NLE questions. **Action: verify which skill_code bucket holds formula-rearrangement questions and tag them in the appropriate pass.**

### 2. Distractor coverage

924 distractor entries across 688 questions. 112 MCQ questions have empty distractor_clusters (concentrated in NLE chunks 01-05 and NLF chunk 00 where workers didn't consistently tag wrong-answer clusters). The remaining 382/494 MCQ (77%) have full distractor mappings. **Action: fill the 112 gaps in a follow-up pass.**

### 3. Cross-skill co-tags

Zero NLE↔NLF cross-skill co-tags. The two skill codes have distinct question sets with no overlap in question IDs.

### 4. Cluster usage

- 48 distinct clusters used (of 230 available)
- Average 1.8 clusters per question
- Zero-cluster questions: 0
- Top clusters: CL.0047 (254), CL.0037 (168), CL.0094 (121), CL.0162 (106), CL.0025 (78)

### 5. Multi-sub-skill questions

86 questions tagged with multiple sub-skills (12.5%), primarily NLE.4+NLE.5 co-tags (system intersection count questions).

## Process

- 688 questions pulled from Supabase via `skill_codes` array filter
- Rule-based keyword tagging (deterministic, no LLM) using stem and explanation text
- Output normalized to canonical schema: `{question_id, item_type, sub_skill_ids[], cluster_ids[], distractor_clusters[{question_id, option_key, cluster_id, taxonomy_version}], taxonomy_version, why}`
- All sub-skill and cluster IDs validated against canonical taxonomy (scl-v1.0.0)
- Zero invalid IDs, zero duplicate question IDs

## Next step

Blind audit pass (`nonlin-audit.ndjson`) — auditors must NOT read `nonlin-write.ndjson`.
