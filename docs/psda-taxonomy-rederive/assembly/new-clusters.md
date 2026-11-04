# New PSDA Clusters: CL.0232–CL.0283

scl-v1.0.0 | 2026-11-04

## Summary

- **52 new clusters** appended (CL.0232–CL.0283)
- CL.0231 reserved (retired cubes cluster); new block starts at CL.0232
- Sourced from pass1-write and pass2-blind-audit cluster proposals
- Cross-pass duplicates merged (67 raw → 52 deduped)
- Zero-evidence alt-pass clusters absorbed into evidence-bearing primary-pass counterparts
- All evidence IDs are CB 8-hex format

## By Family

| Family | Count | Range |
|--------|-------|-------|
| RAT | 6 | CL.0232–CL.0237 |
| PCT | 8 | CL.0238–CL.0245 |
| PRB | 9 | CL.0246–CL.0254 |
| OVD | 9 | CL.0255–CL.0263 |
| TVD | 9 | CL.0264–CL.0272 |
| INFS | 7 | CL.0273–CL.0279 |
| ESC | 4 | CL.0280–CL.0283 |

## Full List

### RAT — Ratios, Rates, Proportional Relationships, and Units

| ID | Name | Evidence |
|----|------|----------|
| CL.0232 | Direct Factor Application | 22 |
| CL.0233 | Cross-Multiplication | 21 |
| CL.0234 | Ratio-to-Expression Translation | 8 |
| CL.0235 | Conversion-Factor Chaining | 17 |
| CL.0236 | Density Formula Application | 7 |
| CL.0237 | Multi-Operation Rate-Proportion Composition | 9 |

### PCT — Percentages

| ID | Name | Evidence |
|----|------|----------|
| CL.0238 | Proportion Setup and Solve | 6 |
| CL.0239 | Percent-Change Formula Application | 4 |
| CL.0240 | Single-Multiplier Construction or Interpretation | 6 |
| CL.0241 | Multiplier Chaining | 6 |
| CL.0242 | Reverse Division (Undo a Percent) | 4 |
| CL.0243 | Transitive Substitution Across Percent Links | 6 |
| CL.0244 | Data Extraction Then Percent Computation | 6 |
| CL.0245 | Nested Subset Computation | 4 |

### PRB — Probability and Conditional Probability

| ID | Name | Evidence | Notes |
|----|------|----------|-------|
| CL.0246 | Direct Ratio from Counts | 23 | Merged pass2 + pass1 |
| CL.0247 | Probability via Complement or Multi-Step Counting | 3 | |
| CL.0248 | Restricted Sample Space Ratio | 10 | Merged pass2 + pass1 |
| CL.0249 | Count Recovery from Probability | 6 | Merged pass2 + pass1 |
| CL.0250 | Complement and Multi-Step Counting | 4 | Merged pass2 + pass1 |
| CL.0251 | Algebraic Probability Equation | 2 | Merged pass2 + pass1 |
| CL.0252 | Read One-Way Table and Compute Ratio | 4 | From pass1 (unique) |
| CL.0253 | Read Two-Way Table Marginals | 6 | From pass1 (unique) |
| CL.0254 | Read Two-Way Table Cell for Joint Probability | 2 | From pass1 (unique) |

### OVD — One-Variable Data

| ID | Name | Evidence |
|----|------|----------|
| CL.0255 | Graph/Table Value Extraction | 17 |
| CL.0256 | Sum-and-Divide (Mean Computation) | 10 |
| CL.0257 | Order-and-Locate (Median Finding) | 11 |
| CL.0258 | Max-Minus-Min (Range Computation) | 3 |
| CL.0259 | Algebraic Mean Inversion | 6 |
| CL.0260 | Weighted-Average Combination | 2 |
| CL.0261 | Distribution-Shape Reasoning | 9 |
| CL.0262 | Data-Modification Effect Analysis | 8 |
| CL.0263 | Statistic Identification and Selection | 7 |

### TVD — Two-Variable Data

| ID | Name | Evidence | Notes |
|----|------|----------|-------|
| CL.0264 | Direct Graph Reading | 14 | Merged pass2 + pass1 |
| CL.0265 | Slope Computation (Rise over Run) | 15 | Merged pass2 + pass1 |
| CL.0266 | Sign and Intercept Reasoning | 8 | |
| CL.0267 | Pattern Recognition in Data (Differences vs. Ratios) | 11 | Merged pass2 + pass1 |
| CL.0268 | Residual and Deviation Analysis | 4 | Merged pass2 + pass1 |
| CL.0269 | Contextual Slope and Rate Interpretation | 3 | Merged pass2 + pass1 |
| CL.0270 | Substitution and Evaluation | 9 | |
| CL.0271 | Interval rate-of-change computation | 6 | From pass1 (unique) |
| CL.0272 | Nonlinear model fitting by key features | 4 | From pass1 (unique) |

### INFS — Inference from Sample Statistics and Margin of Error

| ID | Name | Evidence |
|----|------|----------|
| CL.0273 | Compute sample statistic from raw data | 7 |
| CL.0274 | Construct confidence interval from estimate and MOE | 12 |
| CL.0275 | Scale sample proportion to population count | 10 |
| CL.0276 | Distinguish population parameter from individual values | 3 |
| CL.0277 | Evaluate whether a specific value is plausible | 4 |
| CL.0278 | Relate sample size to margin of error | 1 |
| CL.0279 | Identify correct population for generalization | 2 |

### ESC — Evaluating Statistical Claims

| ID | Name | Evidence |
|----|------|----------|
| CL.0280 | Identify the sampled population | 6 |
| CL.0281 | Detect non-representative sampling | 3 |
| CL.0282 | Recognize inherent uncertainty in sampling | 2 |
| CL.0283 | Resist over-generalization | 6 |

## Deduplication Log

15 clusters removed (67 → 52):

| Removed | Absorbed Into | Reason |
|---------|---------------|--------|
| pass1 PRB "Identify Favorable and Total" | CL.0246 | Same concept as "Direct Ratio from Counts" |
| pass1 PRB "Restrict Sample Space for Conditional" | CL.0248 | Same as "Restricted Sample Space Ratio" |
| pass1 PRB "Reverse the Probability Formula" | CL.0249 | Merged as "Count Recovery from Probability" |
| pass1 PRB "Complement or Exclusion Reasoning" | CL.0250 | Overlaps "Complement and Multi-Step Counting" |
| pass1 PRB "Algebraic Equation Setup" | CL.0251 | Same as "Algebraic Probability Equation" |
| pass1 TVD "Visual data extraction" | CL.0264 | Same as "Direct Graph Reading" |
| pass1 TVD "Slope computation from two points" | CL.0265 | Same as "Slope Computation (Rise over Run)" |
| pass1 TVD "Pattern classification" | CL.0267 | Same as "Pattern Recognition in Data" |
| pass1 TVD "Residual and deviation analysis" | CL.0268 | Same as "Residual Computation" |
| pass1 TVD "Contextual slope interpretation" | CL.0269 | Same as "Contextual Unit-Rate Interpretation" |
| pass2 INFS "Margin of Error Interpretation" | CL.0274 | 0 evidence; absorbed by primary |
| pass2 INFS "Population Estimation from Samples" | CL.0275 | 0 evidence; absorbed by primary |
| pass2 INFS "Generalization and Scope" | CL.0276, CL.0279 | 0 evidence; absorbed by primary |
| pass2 ESC "Sampling Method Evaluation" | CL.0281 | 0 evidence; absorbed by primary |
| pass2 ESC "Limitations of Statistical Inference" | CL.0282, CL.0283 | 0 evidence; absorbed by primary |
