# PSDA Taxonomy Re-Derivation: Two-Pass Reconciliation Report

**Status:** PROPOSAL — for Karl + owner reconciliation. NOT written to canonical file.
**Date:** 2026-11-04
**Taxonomy version:** scl-v1.0.0
**Method:** Pass 1 (write derivation) + Pass 2 (blind audit) from official CB question bank
**Source:** 373 questions across 21 PDFs, all 7 PSDA skills

---

## Executive Summary

| Skill | Current | Proposed | Change | Pass Agreement |
|-------|---------|----------|--------|----------------|
| RAT   | 5       | 7        | +2     | MODERATE       |
| PCT   | 5       | 8        | +3     | DIVERGENT      |
| PRB   | 4       | 4        | 0*     | DIVERGENT      |
| OVD   | 5       | 7        | +2     | MODERATE       |
| TVD   | 5       | 8        | +3     | GOOD           |
| INFS  | 2       | 2        | 0      | MODERATE       |
| ESC   | 0       | 3        | +3     | STRONG         |
| **Total** | **26** | **39** | **+13** | |

*PRB stays at 4 but is internally restructured (PRB.4 merged into PRB.1 as cluster).

**Confidence breakdown:** 3 STRONG, 31 HIGH, 5 MODERATE, 1 LOW (PRB.4 complement/exclusion).

**5 decisions needed from Karl** (marked with [KARL] below).

**4 off-spec patterns flagged** (questions that may not belong in their CB-assigned skill).

---

## Decisions for Karl

1. **RAT — Expression Construction and Ratio Interpretation:** P2 carved Proportional Expression Construction (8q) and Ratio Interpretation (6q) as separate sub-skills. P1 folded them into the composite tier. Should these be separate sub-skills, or clusters within RAT.5/RAT.7?

2. **PCT — Percent as Algebraic Expression:** P2 identified 14 questions where the answer is a symbolic expression, not a numeric value. P1 distributed these across PCT.1 and PCT.3. Should this be a separate sub-skill (PCT.4)?

3. **PCT — Percent from Data:** P2 carved 9 questions where a data-reading step precedes percent computation. P1 classified by percent-operation type instead. Is "data then percent" a separate sub-skill or a cluster?

4. **PRB — Complement/Exclusion:** Both passes suggest complement/exclusion is too thin for a standalone sub-skill (2–6q). Should it be demoted to a cluster within PRB.1, or kept as PRB.4?

5. **OVD — Effect of Data Changes on Statistics:** P2 carved 7 questions (Medium+Hard) about how data modifications affect statistics. P1 included these in the broader "compare" sub-skill. Should this be separate?

---

## Off-Spec Patterns

| Skill | Question(s) | Issue | Flagged By |
|-------|-------------|-------|------------|
| RAT | `3638f413` | Exponential rate (doubling) — may belong to growth/decay | P1 |
| RAT | `3ac09984` | Rate + constant offset (not purely proportional) | P1 |
| PCT | `8e2e424e`, `ba0e23b0` | Exponential percent growth/decay (a^t) — may belong to Algebra | P2 |
| PRB | `b680e76d` | Table arithmetic, not probability — both passes flag as mis-tagged | Both |

---

## Per-Skill Detail

### RAT — Ratios, Rates, Proportional Relationships, and Units (84 questions)

**Current → Proposed mapping:**

| Current | Action | Proposed |
|---------|--------|----------|
| RAT.1 Unit conversion (linear) | SPLIT | RAT.1 Single-Step + RAT.2 Multi-Step |
| RAT.2 Ratios and proportional scaling | RENAME | RAT.5 Proportion Setup and Solve |
| RAT.3 Rates between quantities | RENAME | RAT.4 Single-Step Rate Application |
| RAT.4 Density | RENAME | RAT.6 Density and Derived-Rate Calculations |
| RAT.5 Squared/cubed conversion | KEEP | RAT.3 Squared and Cubed Unit Conversion |

**Proposed sub-skills (7):**

| ID | Name | Confidence | Questions | Difficulty |
|----|------|------------|-----------|------------|
| RAT.1 | Single-Step Unit Conversion | HIGH | 11–17 | Easy |
| RAT.2 | Multi-Step (Chained) Unit Conversion | HIGH | 11–13 | Easy–Hard |
| RAT.3 | Squared and Cubed Unit Conversion | HIGH | 4 | Med–Hard |
| RAT.4 | Single-Step Rate Application | HIGH | 11–15 | Easy |
| RAT.5 | Proportion Setup and Solve | HIGH | 14–15 | Easy–Hard |
| RAT.6 | Density and Derived-Rate Calculations | HIGH | 7–13 | Easy–Hard |
| RAT.7 | Multi-Step Rate and Proportion Problems | MODERATE [KARL] | 9–10 | Med–Hard |

**Proposed clusters:** Direct Factor Application, Cross-Multiplication, Conversion-Factor Chaining, Density Formula Application, Ratio-to-Expression Translation (P2 only, MODERATE), Multi-Operation Rate-Proportion Composition.

---

### PCT — Percentages (75 questions)

**Current → Proposed mapping:**

| Current | Action | Proposed |
|---------|--------|----------|
| PCT.1 Percent of a quantity | SPLIT | PCT.1 Find the Part + PCT.2 Find Percent/Whole |
| PCT.2 Unknown percent or whole | ABSORBED | Into PCT.2 (above) |
| PCT.3 Apply/undo percent change | KEEP (combined) | PCT.3 Apply or Undo Percent Increase/Decrease |
| PCT.4 Percent change | KEEP | PCT.5 Percent Change Calculation |
| PCT.5 Chained percents | SPLIT | PCT.6 Successive + PCT.7 Transitive |
| — (new) | NEW [KARL] | PCT.4 Percent as Algebraic Expression |
| — (new) | NEW [KARL] | PCT.8 Percent from Data |

**Proposed sub-skills (8):**

| ID | Name | Confidence | Questions | Difficulty |
|----|------|------------|-----------|------------|
| PCT.1 | Find the Part (Percent of a Quantity) | HIGH | 8–18 | Easy |
| PCT.2 | Find the Percent or Find the Whole | MODERATE | 8 | Easy–Med |
| PCT.3 | Apply or Undo a Percent Increase/Decrease | HIGH | 8–19 | All |
| PCT.4 | Percent as Algebraic Expression | MODERATE [KARL] | 14 | Med–Hard |
| PCT.5 | Percent Change Calculation | HIGH | 6 | All |
| PCT.6 | Successive Percent Changes | HIGH | 9 | Med–Hard |
| PCT.7 | Chained Percent Relationships (Transitive) | HIGH | 7 | Hard |
| PCT.8 | Percent from Data | MODERATE [KARL] | 9 | Easy–Hard |

**Proposed clusters:** Proportion Setup and Solve, Percent-Change Formula Application, Single-Multiplier Construction or Interpretation, Multiplier Chaining, Reverse Division, Transitive Substitution Across Percent Links, Data Extraction Then Percent Computation (MODERATE), Nested Subset Computation.

---

### PRB — Probability and Conditional Probability (42 questions)

**Current → Proposed mapping:**

| Current | Action | Proposed |
|---------|--------|----------|
| PRB.1 Whole-group probability | KEEP (absorb PRB.4) | PRB.1 Whole-Group Probability |
| PRB.2 Conditional probability | KEEP | PRB.2 Conditional Probability |
| PRB.3 Find count from probability | KEEP | PRB.3 Find a Count from Probability |
| PRB.4 Complement and exclusion | MERGE into PRB.1 [KARL] | → Cluster within PRB.1 |

**Proposed sub-skills (4, restructured):**

| ID | Name | Confidence | Questions | Difficulty |
|----|------|------------|-----------|------------|
| PRB.1 | Whole-Group Probability | HIGH | 23–25 | Easy–Med |
| PRB.2 | Conditional Probability | HIGH | 10 | Easy–Hard |
| PRB.3 | Find a Count from Probability | HIGH | 5–6 | Easy–Hard |
| PRB.4 | Complement and Multi-Event Probability | LOW [KARL] | 2–6 | Med |

**Proposed clusters:** Direct Ratio (favorable/total), Complement Arithmetic, Restricted Sample Space, Algebraic Count-Finding, Two-Way Table Navigation.

**Note:** P2 proposed 8 sub-skills but split by data source (description vs frequency table vs two-way table) rather than cognitive operation. These are better represented as clusters. P1's 3-sub-skill structure (merging complement into whole-group) is pedagogically cleaner.

---

### OVD — One-Variable Data (73 questions)

**Current → Proposed mapping:**

| Current | Action | Proposed |
|---------|--------|----------|
| OVD.1 Read a data display | KEEP | OVD.1 Read or Interpret a Data Display |
| OVD.2 Measure of center | SPLIT | OVD.2 Compute the Mean + OVD.3 Find the Median |
| OVD.3 Spread | KEEP (combined) | OVD.4 Measures of Spread (Range + SD Comparison) |
| OVD.4 Mean-total relationship | KEEP (combined) | OVD.5 Use the Mean-Total Relationship (Algebraic) |
| OVD.5 Compare measures | SPLIT | OVD.6 Compare/Relate Measures + OVD.7 Effect of Changes |

**Proposed sub-skills (7):**

| ID | Name | Confidence | Questions | Difficulty |
|----|------|------------|-----------|------------|
| OVD.1 | Read or Interpret a Data Display | HIGH | 10–17 | Easy–Med |
| OVD.2 | Compute the Mean | HIGH | 9 | All |
| OVD.3 | Find the Median | HIGH | 11 | All |
| OVD.4 | Measures of Spread (Range + SD Comparison) | HIGH | 6–7 | All |
| OVD.5 | Use the Mean-Total Relationship (Algebraic) | HIGH | 7–9 | Med–Hard |
| OVD.6 | Compare or Relate Measures of Center and Spread | HIGH | 12–13 | All |
| OVD.7 | Effect of Data Changes on Statistics | MODERATE [KARL] | 7 | Med–Hard |

**Proposed clusters:** Graph/Table Value Extraction, Sum-and-Divide (Mean), Order-and-Locate (Median), Max-Minus-Min (Range), Algebraic Mean Inversion, Distribution-Shape Reasoning, Data-Modification Effect Analysis, Statistic Identification and Selection.

---

### TVD — Two-Variable Data: Models and Scatterplots (63 questions)

**Current → Proposed mapping:**

| Current | Action | Proposed |
|---------|--------|----------|
| TVD.1 Read data from graph | SPLIT | TVD.1 Read Values + TVD.6 Average Rate of Change |
| TVD.2 Predict with model | SPLIT | (part of TVD.1 reading) + TVD.5 Residuals |
| TVD.3 Linear model | SPLIT | TVD.2 Estimate Slope + TVD.3 Write Equation + TVD.7 Interpret |
| TVD.4 Nonlinear model | KEEP | TVD.8 Choose a Nonlinear Model Equation |
| TVD.5 Classify relationships | RENAME | TVD.4 Classify Model Type and Describe Associations |

**Proposed sub-skills (8):**

| ID | Name | Confidence | Questions | Difficulty |
|----|------|------------|-----------|------------|
| TVD.1 | Read Values from Graphs and Models | HIGH | 8–16 | Easy |
| TVD.2 | Estimate the Slope of a Line of Best Fit | HIGH | 6 | Easy–Med |
| TVD.3 | Choose or Write a Line of Best Fit Equation | HIGH | 12–13 | All |
| TVD.4 | Classify Model Type and Describe Associations | HIGH | 11–12 | All |
| TVD.5 | Compute and Use Residuals | HIGH | 4 | Med |
| TVD.6 | Average Rate of Change | HIGH | 6 | All |
| TVD.7 | Interpret Slope or Intercept in Context | HIGH | 3 | Hard |
| TVD.8 | Choose a Nonlinear Model Equation | HIGH | 3–4 | Easy+Hard |

**Proposed clusters:** Visual Data Extraction, Slope Computation from Two Points, Sign-and-Intercept Reasoning, Pattern Classification, Residual and Deviation Analysis, Interval Rate-of-Change Computation, Contextual Slope Interpretation, Nonlinear Model Fitting by Key Features.

**Note:** TVD had the strongest pass agreement among the larger skills. All 8 proposed sub-skills are HIGH confidence.

---

### INFS — Inference from Sample Statistics and Margin of Error (24 questions)

**Current → Proposed mapping:**

| Current | Action | Proposed |
|---------|--------|----------|
| INFS.1 Estimate population count | RENAME | INFS.2 Estimate Population Values from Samples |
| INFS.2 Interpret estimate with MOE | RENAME | INFS.1 Interpret Margin of Error |

**Proposed sub-skills (2):**

| ID | Name | Confidence | Questions | Difficulty |
|----|------|------------|-----------|------------|
| INFS.1 | Interpret Margin of Error | HIGH | 14 | All |
| INFS.2 | Estimate Population Values from Samples | HIGH | 9–10 | All |

**Note:** P2 proposed 8 sub-skills, but 5 had only 1 question each — too thin to stand alone. These are better represented as clusters. The 2-sub-skill structure is stable. P2's INFS-G (Generalization scope, 1q) may belong in ESC.

**Proposed clusters:** Construct Confidence Interval, Evaluate Claims Against MOE, Factors Affecting MOE Size (MODERATE), Compute Sample Statistic, Scale Sample Proportion to Population, Multi-Step Estimation (MODERATE).

---

### ESC — Evaluating Statistical Claims (11 questions)

**Current → Proposed mapping:**

| Current | Action | Proposed |
|---------|--------|----------|
| (none — 0 current sub-skills) | NEW | ESC.1, ESC.2, ESC.3 |

**Proposed sub-skills (3):**

| ID | Name | Confidence | Questions | Difficulty |
|----|------|------------|-----------|------------|
| ESC.1 | Determining Generalization Scope | STRONG | 6 | Easy–Hard |
| ESC.2 | Identifying Sampling Bias | STRONG | 3 | Easy+Hard |
| ESC.3 | Understanding Sample Variability | STRONG | 2 | Med |

**This is the highest-confidence result in the entire reconciliation.** Both passes independently derived exactly the same 3 sub-skills with the same question assignments (only naming differed). ESC.3 is thin (2q) but conceptually distinct and both passes found it independently.

**Proposed clusters:** Sampling Frame Identification, Sampling Method Critique, Estimate vs Exact Value Distinction.

---

## Method Notes

- **Pass 1 (write derivation):** Fresh general-purpose agent, given only the CB PDFs and the current taxonomy as context. Derived sub-skills and clusters bottom-up from the questions.
- **Pass 2 (blind audit):** Fresh general-purpose agent, given only the CB PDFs. No access to Pass 1 output or current taxonomy. Derived independently.
- **Reconciliation:** Compared both passes' output. Where both agree → HIGH/STRONG confidence. Where one pass found a split the other didn't → MODERATE, flagged for Karl. Where counts are very thin (≤2q) → LOW.
- **Question counts differ between passes** because the passes made different boundary decisions about which questions belong to which sub-skill, and P2 found more questions in some PDFs (particularly OVD: P1 found 56, P2 found 73).
