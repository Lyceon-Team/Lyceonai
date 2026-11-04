# PSDA-A Blind Audit Report

**Taxonomy:** scl-v1.0.0 (19 sub-skills, 230 clusters)
**Questions:** 992 (PSDA-A computational, 4 skill codes)
**Date:** 2026-11-04
**Pass:** Blind audit (second pass of two-pass tagging loop)

## Summary

| Metric | Value |
|---|---|
| Total questions | 992 |
| Total sub-skill tags | 1,112 |
| Avg tags/question | 1.12 |
| Multi-skill questions | 117 (11.8%) |
| Cross-family questions | 21 (2.1%) |
| Distractor tags | 1,994 |
| Zero-coverage sub-skills | 2 |

## Sub-Skill Distribution

| Sub-Skill | Count | % of 992 |
|---|---|---|
| RAT.1 Unit conversion (linear) | 9 | 0.9% |
| RAT.2 Ratios and proportional scaling | 98 | 9.9% |
| RAT.3 Rates between different quantities | 166 | 16.7% |
| RAT.4 Density and per-area/per-volume rates | 2 | 0.2% |
| RAT.5 Converting squared/cubed units | 0 | 0.0% |
| PCT.1 Percent of a quantity | 32 | 3.2% |
| PCT.2 Unknown percent or unknown whole | 16 | 1.6% |
| PCT.3 Apply/undo single percent change | 88 | 8.9% |
| PCT.4 Percent change between two values | 43 | 4.3% |
| PCT.5 Chained percents | 110 | 11.1% |
| PRB.1 Probability in whole group | 95 | 9.6% |
| PRB.2 Conditional probability | 140 | 14.1% |
| PRB.3 Find count from probability | 8 | 0.8% |
| PRB.4 Complement and exclusion | 18 | 1.8% |
| OVD.1 Read/interpret data display | 0 | 0.0% |
| OVD.2 Measure of center | 109 | 11.0% |
| OVD.3 Measures of spread | 30 | 3.0% |
| OVD.4 Mean-total relationship | 64 | 6.5% |
| OVD.5 Compare measures across sets | 84 | 8.5% |

## Family Totals

| Family | Tags |
|---|---|
| RAT (Ratios & Rates) | 275 |
| PCT (Percentages) | 289 |
| PRB (Probability) | 261 |
| OVD (One-Variable Data) | 287 |

## PRB.3 (Special Watch)

**PRB.3 count: 8** -- low coverage. The backward-count-from-table-or-fraction pattern appears frequently in two-way table questions that ask "how many students..." given totals and fractions/probabilities.

## Low Coverage Sub-Skills

| Sub-Skill | Count | Notes |
|---|---|---|
| RAT.5 (Converting squared/cubed units) | 0 | Expected ~zero per instructions; found 0 |
| OVD.1 (Read/interpret data display) | 0 | Expected: text-only bank has no visual charts/graphs |
| RAT.4 (Density and per-area/per-volume rates) | 2 | Few questions with area/volume denominators |
| PRB.3 (Find count from probability) | 8 |  |
| RAT.1 (Unit conversion (linear)) | 9 |  |

## Quality Metrics

| Metric | Value |
|---|---|
| Avg clusters/question | 2.12 |
| Avg distractors/question | 2.01 |
| Avg why length (chars) | 99 |

## Per-Chunk Quality

| Chunk | Lines | Avg Clusters | Avg Distractors | Avg Why Len |
|---|---|---|---|---|
| 00 | 124 | 1.98 | 2.99 | 91 |
| 01 | 124 | 2.46 | 3.00 | 128 |
| 02 | 124 | 2.00 | 2.00 | 114 |
| 03 | 124 | 1.70 | 3.01 | 93 |
| 04 | 124 | 2.19 | 3.00 | 86 |
| 05 | 124 | 2.19 | 3.00 | 84 |
| 06 | 124 | 1.95 | 2.00 | 121 |
| 07 | 124 | 2.48 | 2.00 | 75 |

## Taxonomy Observations

1. **RAT.3 is the most-tagged sub-skill (166):** Rate problems dominate the computational bank. Many questions present a "per" relationship as the core ask.

2. **OVD.4 (64):** The mean-total relationship pattern (sum = mean x count, find missing value) is the most common OVD pattern.

3. **PCT.5 (110):** Chained percent problems (sequential operations on different bases) are well-represented.

4. **PRB.2 is the dominant probability pattern (140):** Conditional probability via two-way tables and restricted sample spaces is the most common probability ask.

5. **Cross-family tagging (21 questions):** 2.1% of questions require skills from multiple families.

## Boundary Ambiguities

- **PCT.3 vs PCT.4 vs PCT.5:** Questions that describe a percent change scenario could be tagged PCT.3 (apply/undo) or PCT.4 (compute percent change). The key distinguisher: PCT.3 gives the percent and asks for the value; PCT.4 gives two values and asks for the percent. PCT.5 requires two+ sequential operations.

- **PRB.1 vs PRB.2:** Many two-way table questions look conditional but ask from the full table. The inclusion test is whether the sample space is restricted before the probability ask.

- **OVD.2 vs OVD.4 vs OVD.5:** Questions asking "what is the mean" are OVD.2; "what value makes the mean equal X" is OVD.4; "how does the mean change if..." is OVD.5. The boundary is the direction of the ask.

## Process Notes

- All 8 chunks (00-07) processed by dedicated fork workers with full question-by-question analysis
- All chunks blind to write-pass output per protocol
- Assembly: one merge pass, canonical field order (id, sub_skills, clusters, distractors, why), no re-sorting
