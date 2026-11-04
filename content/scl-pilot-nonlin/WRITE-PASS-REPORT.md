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

## Findings

### 1. Zero-coverage: NLE.1

NLE.1 ("Rearrange a formula to isolate a variable") has zero questions in this pass. This is expected: NLE.1's inclusion test says "express a variable 'in terms of' other letters" — these questions are likely classified under a different `skill_codes` value in the question bank (e.g., "Linear Equations in Two Variables" or a general algebra skill) rather than the "Nonlinear Equations" skill code used to pull NLE questions. **Action: verify which skill_code bucket holds formula-rearrangement questions and tag them in the appropriate pass.**

### 2. Distractor coverage

382 of ~495 expected MCQ questions have distractor annotations (77%). Some workers produced fewer distractor mappings for questions where the wrong-answer cluster was ambiguous or where the error pattern didn't map cleanly to a single cluster.

### 3. Cross-skill co-tags

Zero NLE↔NLF cross-skill co-tags. The two skill codes have distinct question sets with no overlap in question IDs.

### 4. Cluster usage

- 49 unique clusters used (of 230 available)
- Average 1.79 clusters per question
- Top clusters: CL.0047 (254), CL.0037 (166), CL.0094 (120), CL.0162 (106), CL.0025 (78)

### 5. Multi-sub-skill questions

86 questions tagged with multiple sub-skills (12.5%), primarily NLE.4+NLE.5 co-tags (system intersection count questions).

## Process

- 688 questions pulled from Supabase via `skill_codes` array filter
- 12 parallel tagging workers (6 NLE × 58 + 5 NLF × 57 + 1 NLF × 55)
- Output normalized to canonical schema: `{question_id, sub_skills[], clusters[], distractors[{option_key, cluster_id}], why}`
- All sub-skill and cluster IDs validated against `valid-subskill-ids.json` / `valid-cluster-ids.json`
- Zero invalid IDs, zero duplicate question IDs

## Next step

Blind audit pass (`nonlin-audit.ndjson`) — auditors must NOT read `nonlin-write.ndjson`.
