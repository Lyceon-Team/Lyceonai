# PSDA-A Write Pass Report

**Batch:** PSDA-A (computational skills)
**Taxonomy:** scl-v1.0.0
**Pass:** Write (1 of 2)
**Date:** 2026-11-04
**Questions tagged:** 992

## Scope

| Skill family | Skill label | Questions |
|---|---|---|
| RAT | Ratios, Rates, Proportional Relationships, and Units | 255 |
| PCT | Percentages | 255 |
| PRB | Probability and Conditional Probability | 241 |
| OVD | One-Variable Data: Distributions and Measures of Center and Spread | 241 |

## Sub-skill distribution

| Sub-skill | Count | % of family |
|---|---|---|
| **RAT.1** Unit conversion (linear) | 22 | 8.6% of 255 |
| **RAT.2** Ratios and proportional scaling | 111 | 43.5% |
| **RAT.3** Rates between different quantities | 134 | 52.5% |
| **RAT.4** Density / per-area / per-volume rates | 11 | 4.3% |
| **RAT.5** Converting squared/cubed units | **0** | 0% |
| **PCT.1** Percent of a quantity | 115 | 45.1% of 255 |
| **PCT.2** Unknown percent or unknown whole | 29 | 11.4% |
| **PCT.3** Apply/undo single percent increase/decrease | 32 | 12.5% |
| **PCT.4** Percent change between two values | 40 | 15.7% |
| **PCT.5** Chained percents | 41 | 16.1% |
| **PRB.1** Probability in whole group | 173 | 71.8% of 241 |
| **PRB.2** Conditional probability | 52 | 21.6% |
| **PRB.3** Find a count from a probability | **0** | 0% |
| **PRB.4** Complement and exclusion | 23 | 9.5% |
| **OVD.1** Read/interpret a data display | 23 | 9.5% of 241 |
| **OVD.2** Find a measure of center | 165 | 68.5% |
| **OVD.3** Measures of spread | 27 | 11.2% |
| **OVD.4** Use the mean-total relationship | 7 | 2.9% |
| **OVD.5** Compare measures across sets | 19 | 7.9% |

**Notes:**
- Co-tagging sums exceed family totals where questions test multiple sub-skills.
- 3 RAT questions cross-tagged with PCT.1 (rate problems requiring percent-of-quantity step).

## Zero-coverage sub-skills

| Sub-skill | Reason |
|---|---|
| **RAT.5** Converting squared/cubed units | No question in this bank requires converting a unit with an exponent (e.g. sq ft → sq m). The bank's unit-conversion items all use first-power units. Expected gap for a text-only bank. |
| **PRB.3** Find a count from a probability | All probability questions in the bank ask for a probability/fraction, not a count. The inclusion test requires "the asked value is a count" — no question met this. Expected gap: CB's published items in this skill tend to ask for probabilities, not counts. |

## Cluster usage (top 15)

| Cluster | Description | Count |
|---|---|---|
| CL.0153 | read a value from a table or chart | 173 |
| CL.0050 | compute the arithmetic mean | 165 |
| CL.0060 | multiply a rate by the amount | 158 |
| CL.0029 | convert between fraction, decimal, and percent | 133 |
| CL.0004 | add or subtract fractions with a common denominator | 72 |
| CL.0083 | scale both quantities by the same factor | 71 |
| CL.0158 | merge categories that together meet the condition | 54 |
| CL.0021 | cancel common factors before multiplying fractions | 40 |
| CL.0106 | turn a percent change into a multiplier | 40 |
| CL.0061 | multiply fractions (numerator × numerator, denominator × denominator) | 37 |
| CL.0072 | order a list of values | 35 |
| CL.0086 | set up and solve a proportion | 34 |
| CL.0107 | undo a percent change by dividing by the multiplier | 34 |
| CL.0098 | take a percent of a quantity | 32 |
| CL.0123 | use total = mean × count | 27 |

## Distractor tagging

| Family | Distractor tags |
|---|---|
| RAT | 549 |
| PCT | 552 |
| PRB | 657 |
| OVD | 522 |
| **Total** | **2,280** |

Grid-in questions tagged with distractors=[] as required.

## Cross-skill tags

3 questions from the RAT family were co-tagged with PCT.1 (percent-of-quantity as an integral part of a rate problem). IDs: SATM2LPGD0B, SATM2MELBB8, SATM2O1Y1BQ.

## Boundary ambiguous cases

- **RAT.2 vs RAT.3:** Some questions involve both a ratio and a rate. Tagged RAT.3 when the stem pairs different kinds of quantity with "per"/"for every"; tagged RAT.2 when same-kind quantities are compared by quotient/multiple.
- **PCT.1 vs PCT.2:** Questions where the percent is given and the task is to find the amount → PCT.1. Where the task gives the amount and asks "what percent" → PCT.2.
- **PCT.3 vs PCT.4:** Tagged PCT.3 when a percent increase/decrease is stated and the task is to find new/original value. Tagged PCT.4 when both values are given and the task is to find the percent change.
- **PRB.1 vs PRB.2:** Tagged PRB.2 only when the stem explicitly restricts the sample space ("given that", "of those who", "if the selected person is"). Plain "what fraction of all" → PRB.1.
- **OVD.2 dominance:** 68.5% of OVD questions ask for a measure of center (mean/median). This reflects the bank's composition, not a tagging bias — most OVD items in the SAT question bank are mean/median computations.

## Suspected mis-skills

None identified. All questions matched their declared skill_codes family.

## Taxonomy gaps

- **RAT.5** and **PRB.3** have zero coverage (see above). These are expected gaps given the bank's composition, not taxonomy defects.
- No off-spec question classes were observed.

## Validation

- 992 unique question IDs — matches expected total.
- All sub_skill IDs validated against the 19-ID taxonomy.
- All cluster IDs validated against CL.0001–CL.0230.
- All distractor cluster IDs validated.
- 0 errors in assembly.
- Field names: id, sub_skills, clusters, distractors, why (exact contract).
