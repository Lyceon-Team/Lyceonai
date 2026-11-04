# PSDA-A Blind Audit Report

**Taxonomy:** scl-v1.0.0 (19 sub-skills, 230 clusters)
**Questions:** 992 (PSDA-A computational, 4 skill codes)
**Date:** 2026-11-04
**Pass:** Blind audit (second pass of two-pass tagging loop)

## Summary

| Metric | Value |
|---|---|
| Total questions | 992 |
| Total sub-skill tags | 1,135 |
| Avg tags/question | 1.14 |
| Multi-skill questions | 140 (14.1%) |
| Cross-family questions | 24 (2.4%) |
| Distractor tags | 1,924 |
| Zero-coverage sub-skills | 2 |

## Sub-Skill Distribution

| Sub-Skill | Count | % of 992 |
|---|---|---|
| RAT.1 Unit conversion (linear) | 9 | 0.9% |
| RAT.2 Ratios and proportional scaling | 102 | 10.3% |
| RAT.3 Rates between different quantities | 170 | 17.1% |
| RAT.4 Density and per-area/per-volume rates | 2 | 0.2% |
| RAT.5 Converting squared/cubed units | 0 | 0.0% |
| PCT.1 Percent of a quantity | 30 | 3.0% |
| PCT.2 Unknown percent or unknown whole | 16 | 1.6% |
| PCT.3 Apply/undo single percent change | 94 | 9.5% |
| PCT.4 Percent change between two values | 43 | 4.3% |
| PCT.5 Chained percents | 117 | 11.8% |
| PRB.1 Probability in whole group | 97 | 9.8% |
| PRB.2 Conditional probability | 142 | 14.3% |
| PRB.3 Find count from probability | 4 | 0.4% |
| PRB.4 Complement and exclusion | 17 | 1.7% |
| OVD.1 Read/interpret data display | 0 | 0.0% |
| OVD.2 Measure of center | 112 | 11.3% |
| OVD.3 Measures of spread | 32 | 3.2% |
| OVD.4 Mean-total relationship | 70 | 7.1% |
| OVD.5 Compare measures across sets | 78 | 7.9% |

## Family Totals

| Family | Tags |
|---|---|
| RAT (Ratios & Rates) | 283 |
| PCT (Percentages) | 300 |
| PRB (Probability) | 260 |
| OVD (One-Variable Data) | 292 |

## PRB.3 (Special Watch)

**PRB.3 count: 4** — low coverage. The backward-count-from-probability pattern (given a probability or fraction and a total, find the count) is rare in the computational bank. Most two-way table questions that ask "how many students..." present enough information to solve directly without requiring the PRB.3 reversal step.

## Low Coverage Sub-Skills

| Sub-Skill | Count | Notes |
|---|---|---|
| RAT.5 (Converting squared/cubed units) | 0 | Expected ~zero per instructions; found 0 |
| OVD.1 (Read/interpret data display) | 0 | Expected: text-only bank has no visual charts/graphs |
| RAT.4 (Density and per-area/per-volume rates) | 2 | Few questions with area/volume denominators |
| PRB.3 (Find count from probability) | 4 | |
| RAT.1 (Unit conversion (linear)) | 9 | |

## Quality Metrics

| Metric | Value |
|---|---|
| Avg clusters/question | 2.17 |
| Avg distractors/question (MCQ only, N=760) | 2.53 |
| Avg why length (chars) | 108.2 |
| MCQ questions | 760 |
| Grid-in questions | 232 |

## Per-Chunk Quality

| Chunk | Lines | Avg Clusters | Avg Distractors (MCQ) | MCQ | Grid-in | Avg Why Len |
|---|---|---|---|---|---|---|
| 00 | 124 | 2.18 | 2.97 | 96 | 28 | 79.4 |
| 01 | 124 | 2.46 | 3.00 | 90 | 34 | 128.0 |
| 02 | 124 | 2.00 | 2.00 | 96 | 28 | 114.0 |
| 03 | 124 | 1.91 | 2.30 | 89 | 35 | 87.2 |
| 04 | 124 | 2.33 | 3.00 | 95 | 29 | 147.7 |
| 05 | 124 | 2.40 | 2.00 | 104 | 20 | 92.4 |
| 06 | 124 | 1.95 | 2.00 | 91 | 33 | 121.1 |
| 07 | 124 | 2.10 | 3.00 | 99 | 25 | 95.3 |

## Taxonomy Observations

1. **RAT.3 is the most-tagged sub-skill (170):** Rate problems dominate the computational bank. Many questions present a "per" relationship as the core ask.

2. **PRB.2 is the dominant probability pattern (142):** Conditional probability via two-way tables and restricted sample spaces is the most common probability ask.

3. **PCT.5 (117):** Chained percent problems (sequential operations on different bases) are well-represented.

4. **OVD.2 (112):** Measure of center (mean, median, mode) is the most common OVD pattern.

5. **OVD.4 (70):** The mean-total relationship pattern (sum = mean x count, find missing value) is common.

6. **Cross-family tagging (24 questions):** 2.4% of questions require skills from multiple families.

## Boundary Ambiguities

- **PCT.3 vs PCT.4 vs PCT.5:** Questions that describe a percent change scenario could be tagged PCT.3 (apply/undo) or PCT.4 (compute percent change). The key distinguisher: PCT.3 gives the percent and asks for the value; PCT.4 gives two values and asks for the percent. PCT.5 requires two+ sequential operations.

- **PRB.1 vs PRB.2:** Many two-way table questions look conditional but ask from the full table. The inclusion test is whether the sample space is restricted before the probability ask.

- **OVD.2 vs OVD.4 vs OVD.5:** Questions asking "what is the mean" are OVD.2; "what value makes the mean equal X" is OVD.4; "how does the mean change if..." is OVD.5. The boundary is the direction of the ask.

## Process Notes

- All 8 chunks (00-07) processed by dedicated fresh agents with full question-by-question analysis
- All chunks blind to write-pass output per protocol
- Each worker solved its slice and wrote its part file once; no worker assembled, merged, or committed the full audit file
- Assembly: one concatenation pass by the orchestrator, canonical field order (id, sub_skills, clusters, distractors, why), no re-sorting
- 992 unique IDs validated at assembly time
