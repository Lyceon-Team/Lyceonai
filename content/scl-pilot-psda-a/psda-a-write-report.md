# PSDA-A Write Pass Report

**Taxonomy:** scl-v1.0.0  
**Date:** 2026-11-04  
**Pass:** Write (1 of 2 — blind audit follows separately)  
**Questions:** 992  
**Skills:** 4 (PSDA-A computational)

## Scope

| Skill | Questions | Sub-skills |
|---|---|---|
| Ratios, Rates, Proportional Relationships, and Units | 255 | RAT.1–RAT.5 |
| Percentages | 255 | PCT.1–PCT.5 |
| Probability and Conditional Probability | 241 | PRB.1–PRB.4 |
| One-Variable Data | 241 | OVD.1–OVD.5 |

## Validation

- **992 rows**, 992 unique question IDs — matches source count exactly
- **0 validation errors** — every sub-skill and cluster ID is in the scl-v1.0.0 taxonomy
- **No CL.0231** or retired IDs used
- **CL.0222 (Desmos)** excluded from PCT questions per ruling (method_in Percentages 0.934)

## Sub-skill Distribution

| Sub-skill | Count | % of pool |
|---|---|---|
| PRB.1 | 173 | 71.8% of PRB |
| OVD.2 | 165 | 68.5% of OVD |
| RAT.3 | 134 | 52.5% of RAT |
| PCT.1 | 118 | 46.3% of PCT |
| RAT.2 | 111 | 43.5% of RAT |
| PRB.2 | 52 | 21.6% of PRB |
| PCT.5 | 41 | 16.1% of PCT |
| PCT.4 | 40 | 15.7% of PCT |
| PCT.3 | 32 | 12.5% of PCT |
| PCT.2 | 29 | 11.4% of PCT |
| OVD.3 | 27 | 11.2% of OVD |
| PRB.4 | 23 | 9.5% of PRB |
| OVD.1 | 23 | 9.5% of OVD |
| RAT.1 | 22 | 8.6% of RAT |
| OVD.5 | 19 | 7.9% of OVD |
| RAT.4 | 11 | 4.3% of RAT |
| OVD.4 | 7 | 2.9% of OVD |
| **PRB.3** | **0** | **0% — zero coverage** |
| **RAT.5** | **0** | **0% — zero coverage** |

### Zero-coverage sub-skills

- **PRB.3** (Find a count from a probability or from totals): No questions in the PRB pool had a stem that gives a probability and asks for a count. The bank may lack this pattern for these skill codes.
- **RAT.5** (Converting squared or cubed units): No questions required converting a unit with an exponent (e.g. ft² → m²). The RAT pool's unit conversions were all linear (RAT.1).

## Cluster Usage

- **30 distinct clusters** used across 992 questions
- Top 5: CL.0153 (173), CL.0050 (165), CL.0060 (158), CL.0029 (133), CL.0004 (72)

## Co-tagging

- **34 multi-sub-skill questions** (3.4%) — questions testing more than one sub-skill
- **3 cross-skill questions** — tagged with sub-skills from different skill families
- PCT pool has 258 sub-skill assignments across 255 questions (co-tag overlap)

## Format

- **760 MCQ** questions with distractor tags (2,280 distractor entries total)
- **232 grid-in** questions (distractors = [], as required)

## Output

- `psda-a-write.ndjson` — 992 lines, one JSON object per line
- Fields: `id`, `sub_skills`, `clusters`, `distractors`, `why`
