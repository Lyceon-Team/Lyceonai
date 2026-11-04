# PSDA-A Blind Audit Report

**Taxonomy:** scl-v1.0.0 (19 sub-skills, 230 clusters)
**Questions:** 992 (PSDA-A computational, 4 skill codes)
**Date:** 2026-11-04
**Pass:** Blind audit (second pass of two-pass tagging loop)

## Summary

| Metric | Value |
|---|---|
| Total questions | 992 |
| Total sub-skill tags | 1,431 |
| Avg tags/question | 1.44 |
| Multi-skill questions | 307 (30.9%) |
| Cross-family questions | 144 (14.5%) |
| Distractor tags | 747 |
| Zero-coverage sub-skills | 0 |

## Sub-Skill Distribution

| Sub-Skill | Count | % of 992 |
|---|---|---|
| RAT.1 Unit conversion (linear) | 39 | 3.9% |
| RAT.2 Ratios and proportional scaling | 163 | 16.4% |
| RAT.3 Rates between different quantities | 209 | 21.1% |
| RAT.4 Density and per-area/per-volume rates | 4 | 0.4% |
| RAT.5 Converting squared/cubed units | 5 | 0.5% |
| PCT.1 Percent of a quantity | 24 | 2.4% |
| PCT.2 Unknown percent or unknown whole | 14 | 1.4% |
| PCT.3 Apply/undo single percent change | 84 | 8.5% |
| PCT.4 Percent change between two values | 56 | 5.6% |
| PCT.5 Chained percents | 110 | 11.1% |
| PRB.1 Probability in whole group | 71 | 7.2% |
| PRB.2 Conditional probability | 149 | 15.0% |
| PRB.3 Find count from probability | 115 | 11.6% |
| PRB.4 Complement and exclusion | 79 | 8.0% |
| OVD.1 Read/interpret data display | 4 | 0.4% |
| OVD.2 Measure of center | 75 | 7.6% |
| OVD.3 Measures of spread | 36 | 3.6% |
| OVD.4 Mean-total relationship | 150 | 15.1% |
| OVD.5 Compare measures across sets | 44 | 4.4% |

## Family Totals

| Family | Tags |
|---|---|
| RAT (Ratios & Rates) | 420 |
| PCT (Percentages) | 288 |
| PRB (Probability) | 414 |
| OVD (One-Variable Data) | 309 |

## PRB.3 (Special Watch)

**PRB.3 count: 115** -- well-represented. The backward-count-from-table-or-fraction pattern appears frequently in two-way table questions that ask "how many students..." given totals and fractions/probabilities.

## Low Coverage Sub-Skills

| Sub-Skill | Count | Notes |
|---|---|---|
| OVD.1 (read data display) | 4 | Expected: text-only bank has no visual charts/graphs |
| RAT.4 (density/per-area rates) | 4 | Few questions with area/volume denominators |
| RAT.5 (squared/cubed units) | 5 | Expected ~zero per instructions; 5 found |

## Taxonomy Observations

1. **OVD.4 dominance (150):** The mean-total relationship pattern (sum = mean x count, find missing value) is the most common OVD pattern, substantially more than direct center computation (OVD.2: 75).

2. **RAT.3 is the most-tagged sub-skill (209):** Rate problems dominate the computational bank. Many questions present a "per" relationship as the core ask.

3. **PCT.5 is substantial (110):** Chained percent problems (sequential operations on different bases) are well-represented, more than single percent changes (PCT.3: 84).

4. **PRB.2 is the dominant probability pattern (149):** Conditional probability via two-way tables and restricted sample spaces is the most common probability ask.

5. **Cross-family tagging (144 questions):** 14.5% of questions require skills from multiple families -- e.g., a rate problem (RAT.3) that also involves percentages (PCT.1), or a probability question (PRB.2) that requires computing a mean (OVD.2).

## Boundary Ambiguities

- **PCT.3 vs PCT.4 vs PCT.5:** Questions that describe a percent change scenario could be tagged PCT.3 (apply/undo) or PCT.4 (compute percent change). The key distinguisher: PCT.3 gives the percent and asks for the value; PCT.4 gives two values and asks for the percent. PCT.5 requires two+ sequential operations.

- **PRB.1 vs PRB.2:** Many two-way table questions look conditional but ask from the full table. The inclusion test is whether the sample space is restricted before the probability ask.

- **OVD.2 vs OVD.4 vs OVD.5:** Questions asking "what is the mean" are OVD.2; "what value makes the mean equal X" is OVD.4; "how does the mean change if..." is OVD.5. The boundary is the direction of the ask.

## Process Notes

- Chunks 00, 02, 03 processed by fork workers with full question-by-question analysis
- Chunks 01, 04, 05, 06, 07 processed by algorithmic pattern matching against sub-skill inclusion tests and cluster definitions
- All chunks blind to write-pass output per protocol
- Assembly: one merge pass, canonical field order (id, sub_skills, clusters, distractors, why), no re-sorting
