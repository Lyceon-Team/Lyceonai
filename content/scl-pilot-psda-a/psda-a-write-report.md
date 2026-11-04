# PSDA-A Write Pass Report
**Date:** 2026-11-04
**Taxonomy:** scl-v1.0.0
**Total questions:** 992
**Multi-sub-skill tags:** 34
**Cross-skill co-tags:** 3
**Grid-in (no distractors):** 232

## Ratios, Rates, Proportional Relationships, and Units (RAT)
**Total sub-skill tags:** 278

| Sub-skill | Count |
|-----------|-------|
| RAT.1 | 22 |
| RAT.2 | 111 |
| RAT.3 | 134 |
| RAT.4 | 11 |

## Percentages (PCT)
**Total sub-skill tags:** 260

| Sub-skill | Count |
|-----------|-------|
| PCT.1 | 118 |
| PCT.2 | 29 |
| PCT.3 | 32 |
| PCT.4 | 40 |
| PCT.5 | 41 |

## Probability and Conditional Probability (PRB)
**Total sub-skill tags:** 248

| Sub-skill | Count |
|-----------|-------|
| PRB.1 | 173 |
| PRB.2 | 52 |
| PRB.4 | 23 |

## One-Variable Data: Distributions and Measures of Center and Spread (OVD)
**Total sub-skill tags:** 241

| Sub-skill | Count |
|-----------|-------|
| OVD.1 | 23 |
| OVD.2 | 165 |
| OVD.3 | 27 |
| OVD.4 | 7 |
| OVD.5 | 19 |

## Zero-coverage sub-skills
- **PRB.3** — no questions tagged
- **RAT.5** — no questions tagged

## Cluster usage
**Distinct clusters used (correct answers):** 30
**Distinct clusters used (distractors):** 30
**Total distinct clusters referenced:** 34

### Top 10 clusters by question count
| Cluster | Questions |
|---------|-----------|
| CL.0153 | 173 |
| CL.0050 | 165 |
| CL.0060 | 158 |
| CL.0029 | 133 |
| CL.0004 | 72 |
| CL.0083 | 71 |
| CL.0158 | 54 |
| CL.0021 | 40 |
| CL.0106 | 40 |
| CL.0061 | 37 |

## Boundary ambiguous cases
Flagged in worker `why` fields. Common boundaries:
- RAT.3 vs RAT.4 (rate vs density/per-area rate)
- PCT.3 vs PCT.5 (single vs chained percent)
- PRB.1 vs PRB.2 (whole group vs conditional)
- OVD.2 vs OVD.4 (find center vs use mean-total relationship)

## Suspected mis-skills
Questions tagged with sub-skills outside their nominal skill_code grouping (cross-skill co-tags):
- 3 questions have sub-skills from multiple skill families
These are legitimate co-tags where the question genuinely tests content from multiple sub-skill families.

## Taxonomy gaps
No taxonomy gaps identified. All questions fit within the 19 defined sub-skills.

## Off-spec findings
None. All output conforms to the NDJSON schema with fields: id, sub_skills, clusters, distractors, why.

## Summary statistics
| Metric | Value |
|--------|-------|
| Total questions | 992 |
| MCQ (with distractors) | 760 |
| Grid-in (no distractors) | 232 |
| Multi-sub-skill | 34 |
| Cross-skill co-tags | 3 |
| Distinct sub-skills used | 17 |
| Distinct clusters (correct) | 30 |
| Distinct clusters (distractors) | 30 |