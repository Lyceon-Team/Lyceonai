# PSDA Sub-Skill Mapping: Current → Final (Additive)

scl-v1.0.0 | 2026-11-05

## Summary

- **Strategy**: ADDITIVE — every existing prod sub-skill ID survives (deprecated, kept for video lane tags); new re-derived carve added alongside with distinct IDs
- **Before**: 30 PSDA sub-skills (RAT.1-5, PCT.1-5, OVD.1-5, TVD.1-5, PRB.1-4, INFS.1-3, ESC1-3)
- **After**: 74 PSDA sub-skills (30 deprecated + 44 active)
- **Non-PSDA**: 107 sub-skills unchanged
- **Grand total**: 181 sub-skills
- **Clusters**: 52 new (CL.0232–CL.0283); 230 original unchanged; CL.0231 reserved (retired)
- **Loader**: insert-only, ZERO deletes

## ID Collision Resolution

Old prod IDs (RAT.1-5, PCT.1-5, etc.) keep their exact IDs as deprecated. New re-derived sub-skills that would collide are renumbered starting from old_max + 1 per family:

| Family | Old IDs (deprecated) | New IDs (active) |
|--------|---------------------|-------------------|
| RAT | RAT.1–5 | RAT.6–14 (9) |
| PCT | PCT.1–5 | PCT.6–15 (10) |
| OVD | OVD.1–5 | OVD.6–13 (8) |
| TVD | TVD.1–5 | TVD.6–14 (9) |
| PRB | PRB.1–4 | PRB.5–7 (3) |
| INFS | INFS.1–3 | INFS.4–5 (2) |
| ESC | ESC1, ESC2, ESC3 | ESC.1, ESC.2, ESC.3 (no collision — different ID format) |

## RAT — Ratios, Rates, Proportional Relationships, and Units

Source: **pass2** (9 sub-skills, all >=3 evidence).

### Deprecated (old prod, kept for video lane tags)

| ID | Name | Evidence |
|----|------|----------|
| RAT.1 | Unit conversion (linear units) | 8 |
| RAT.2 | Ratios and proportional scaling | 8 |
| RAT.3 | Rates between different quantities | 8 |
| RAT.4 | Density and per-area/per-volume rates | 8 |
| RAT.5 | Converting squared or cubed units | 4 |

### Active (re-derived)

| New ID | Name | Evidence |
|--------|------|----------|
| RAT.6 | Single-Step Unit Conversion | 11 |
| RAT.7 | Multi-Step Unit Conversion | 13 |
| RAT.8 | Squared and Cubed Unit Conversion | 4 |
| RAT.9 | Rate Application | 11 |
| RAT.10 | Proportion Setup and Solve | 15 |
| RAT.11 | Proportional Expression Construction | 8 |
| RAT.12 | Ratio Interpretation and Simplification | 6 |
| RAT.13 | Density and Derived-Rate Calculations | 7 |
| RAT.14 | Multi-Step Rate and Proportion Problems | 9 |

## PCT — Percentages

Source: **pass2** (13 sub-skills → 10 after merges).

### Deprecated (old prod)

| ID | Name | Evidence |
|----|------|----------|
| PCT.1 | Percent of a quantity | 10 |
| PCT.2 | Unknown percent or unknown whole | 10 |
| PCT.3 | Apply or undo a single percent increase or decrease | 10 |
| PCT.4 | Percent change between two values | 9 |
| PCT.5 | Chained percents (percent of a percent result) | 10 |

### Active (re-derived)

| New ID | Name | Evidence | Notes |
|--------|------|----------|-------|
| PCT.6 | Find Part, Percent, or Whole | 16 | Merged P2's PCT.1+2+3 |
| PCT.7 | Apply Percent Increase or Decrease | 5 | P2's PCT.4 |
| PCT.8 | Percent Change Calculation | 6 | P2's PCT.5 |
| PCT.9 | Reverse Percent (Find Original Before Change) | 3 | P2's PCT.6 |
| PCT.10 | Percent as Algebraic Expression | 11 | P2's PCT.7 |
| PCT.11 | Interpret Percent Expression | 3 | P2's PCT.8 |
| PCT.12 | Successive and Exponential Percent Changes | 11 | Merged P2's PCT.9+13 |
| PCT.13 | Chained Percent Relationships | 7 | P2's PCT.10 |
| PCT.14 | Compound Category Percentages | 4 | P2's PCT.11 |
| PCT.15 | Percent from Data | 9 | P2's PCT.12 |

## PRB — Probability and Conditional Probability

Source: **pass1** write-pass carve (3 sub-skills).

### Deprecated (old prod)

| ID | Name | Evidence |
|----|------|----------|
| PRB.1 | Probability of an event in the whole group | 10 |
| PRB.2 | Conditional probability (restricted sample space) | 10 |
| PRB.3 | Find a count from a probability or from totals | 7 |
| PRB.4 | Complement and exclusion events | 6 |

### Active (re-derived)

| New ID | Name | Evidence |
|--------|------|----------|
| PRB.5 | Whole-Group Probability | 25 |
| PRB.6 | Conditional Probability | 10 |
| PRB.7 | Find Count from Probability | 6 |

## OVD — One-Variable Data

Source: **pass2** (9 sub-skills → 8 after merge).

### Deprecated (old prod)

| ID | Name | Evidence |
|----|------|----------|
| OVD.1 | Read and interpret a data display | 8 |
| OVD.2 | Find a measure of center from data | 8 |
| OVD.3 | Measures of spread: range and standard deviation | 8 |
| OVD.4 | Use the mean-total relationship | 8 |
| OVD.5 | Compare measures across data sets or after a change | 8 |

### Active (re-derived)

| New ID | Name | Evidence | Notes |
|--------|------|----------|-------|
| OVD.6 | Read or Interpret a Data Display | 17 | |
| OVD.7 | Compute the Mean | 9 | |
| OVD.8 | Find the Median | 11 | |
| OVD.9 | Compute the Range | 3 | |
| OVD.10 | Compare or Relate Measures of Center and Spread | 13 | |
| OVD.11 | Effect of Data Changes on Statistics | 7 | |
| OVD.12 | Solve for an Unknown Using the Mean (Including Weighted Mean) | 9 | Merged P2's OVD.7+8 |
| OVD.13 | Compare Standard Deviations from Distributions | 4 | |

## TVD — Two-Variable Data

Source: **pass1** (9 sub-skills).

### Deprecated (old prod)

| ID | Name | Evidence |
|----|------|----------|
| TVD.1 | Read data and changes from a graph | 7 |
| TVD.2 | Predict with a fitted model and compare data to it | 8 |
| TVD.3 | Linear model: direction, slope, intercept, equation, interpretation | 10 |
| TVD.4 | Nonlinear model fitted to a scatterplot | 4 |
| TVD.5 | Classify linear vs exponential relationships | 9 |

### Active (re-derived)

| New ID | Name | Evidence |
|--------|------|----------|
| TVD.6 | Read Values from Graphs and Scatterplots | 8 |
| TVD.7 | Make Predictions Using a Line or Curve of Best Fit | 9 |
| TVD.8 | Estimate the Slope of a Line of Best Fit | 6 |
| TVD.9 | Select or Write the Equation of a Line of Best Fit | 12 |
| TVD.10 | Identify the Appropriate Model Type | 11 |
| TVD.11 | Compute Average Rate of Change Between Intervals | 6 |
| TVD.12 | Evaluate Residuals and Deviations from a Model | 4 |
| TVD.13 | Interpret Slope or Intercept in Real-World Context | 3 |
| TVD.14 | Select or Determine a Nonlinear Model Equation | 4 |

## INFS — Inference from Sample Statistics and Margin of Error

Source: **pass1** write-pass carve (2 sub-skills).

### Deprecated (old prod)

| ID | Name | Evidence |
|----|------|----------|
| INFS.1 | Estimate a population count from a sample | 11 |
| INFS.2 | Interpret an estimate with a margin of error | 13 |
| INFS.3 | What the sampling design supports | 3 |

### Active (re-derived)

| New ID | Name | Evidence |
|--------|------|----------|
| INFS.4 | Interpreting Margin of Error | 14 |
| INFS.5 | Estimating Population Values from Samples | 10 |

## ESC — Evaluating Statistical Claims

Source: **pass1** (3 sub-skills). No ID collision (old undotted ESC1/ESC2/ESC3 vs new dotted ESC.1/ESC.2/ESC.3).

### Deprecated (old prod)

| ID | Name | Evidence |
|----|------|----------|
| ESC1 | Scope of generalization: the largest population the results apply to | 6 |
| ESC2 | Detect a biased (non-representative) sample | 3 |
| ESC3 | Sampling variability: a sample result is not a certainty | 2 |

### Active (re-derived)

| New ID | Name | Evidence |
|--------|------|----------|
| ESC.1 | Determining Generalization Scope | 6 |
| ESC.2 | Identifying Sampling Bias | 3 |
| ESC.3 | Understanding Sample Variability | 2 |

ESC.3 has 2 CB evidence (below >=3 cutoff) but kept per user ruling: "ESC: 3 — unchanged".
