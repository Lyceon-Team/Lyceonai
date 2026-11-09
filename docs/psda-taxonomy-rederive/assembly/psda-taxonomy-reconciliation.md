# PSDA Taxonomy Re-Derivation: Two-Pass Reconciliation

> **Date:** 2026-11-04
> **Scope:** All 7 PSDA skills, 373 CB questions across 21 PDFs
> **Method:** Two independent cold-start derivations from official CB question bank, followed by reconciliation
> **Pass 1 (Write):** 7 independent agents, each blind to current taxonomy
> **Pass 2 (Blind Audit):** 6 independent agents (INFS+ESC combined), blind to Pass 1
> **Output:** Proposals + evidence only — no prod writes, no tagging

---

## Executive Summary

| Skill | Current | Pass 1 | Pass 2 | Agreement | Recommendation |
|---|---|---|---|---|---|
| RAT (84q) | 5 | 7 | 9 | **Moderate** — core 7 agree, P2 adds 2 more | **7 sub-skills** (P1 carve) |
| PCT (75q) | 5 | 5 | 13 | **Divergent** — P1 kept all, P2 split heavily | **8 sub-skills** (merge P2's granularity) |
| PRB (42q) | 4 | 3 | 8 | **Divergent** — both agree on conditional + find-count; P2 splits whole-group by data source | **5 sub-skills** |
| OVD (56-73q) | 5 | 5 | 9 | **Moderate** — both confirm OVD.1; P2 splits center+spread | **7 sub-skills** |
| TVD (63q) | 5 | 9 | 8 | **Strong** — 6 of 8 sub-skills match exactly | **8 sub-skills** (P2 carve) |
| INFS (24q) | 3 | 2 | 8 | **Moderate** — same 2 major categories, P2 over-split | **3 sub-skills** |
| ESC (11q) | 3 | 3 | 3 | **Strong** — identical 3 sub-skills | **3 sub-skills** (keep current) |
| **TOTALS** | **27** (incl 3 ESC) | **34** | **52** | | **41 proposed** |

---

## Skill-by-Skill Reconciliation

---

### 1. RAT — Ratios, Rates, Proportional Relationships, and Units (84 questions)

**Agreement level: MODERATE (core 7 agree)**

Both passes independently split the current 5 sub-skills into a finer structure. The core 7 categories agree; Pass 2 adds 2 more (Proportional Expression Construction, Ratio Interpretation).

#### Cross-pass alignment

| Proposed ID | Name | P1 | P2 | Qs | Confidence |
|---|---|---|---|---|---|
| RAT.1 | Single-Step Unit Conversion | RAT.1 (17q) | RAT.1 (11q) | ~11 | **HIGH** — both split single from multi |
| RAT.2 | Multi-Step Unit Conversion | RAT.2 (11q) | RAT.2 (13q) | ~13 | **HIGH** — both identify chained factors |
| RAT.3 | Squared/Cubed Unit Conversion | RAT.3 (4q) | RAT.3 (4q) | 4 | **HIGH** — exact match |
| RAT.4 | Rate Application (single-step) | RAT.5 (15q) | RAT.4 (11q) | ~11 | **HIGH** — both isolate direct rate use |
| RAT.5 | Proportion Setup and Solve | RAT.4 (14q) | RAT.5 (15q) | ~15 | **HIGH** — both identify cross-multiply pattern |
| RAT.6 | Density / Per-Area / Per-Volume Rates | RAT.6 (13q) | RAT.8 (7q) | ~7-13 | **MODERATE** — agree on concept, P1 over-assigns |
| RAT.7 | Multi-Step Rate/Proportion with Algebra | RAT.7 (10q) | RAT.9 (9q) | ~9-10 | **HIGH** — both identify algebraic compound problems |
| — | Proportional Expression Construction | ∅ | RAT.6 (8q) | 8 | **P2-ONLY** — Karl decision needed |
| — | Ratio Interpretation / Simplification | ∅ | RAT.7 (6q) | 6 | **P2-ONLY** — Karl decision needed |

**P2-only sub-skills for Karl's review:**
- **RAT.6 (P2): Proportional Expression Construction** — 8 questions where the task is translating a stated ratio into an algebraic expression (e.g., coaches-to-athletes = 1:26, x coaches → 26x athletes). Pass 1 distributed these across RAT.1 and RAT.4. The question is whether "ratio → expression" is a distinct sub-skill from "set up and solve a proportion."
- **RAT.7 (P2): Ratio Interpretation and Simplification** — 6 questions about simplifying ratios, finding constant ratios in tables, computing unit rates. Pass 1 folded these into RAT.4/RAT.5. Most are Easy.

#### Current → Proposed mapping

| Current | Proposed | Notes |
|---|---|---|
| RAT.1 (Unit conversion, linear) | RAT.1 + RAT.2 | Split single-step from multi-step |
| RAT.2 (Ratios and proportional scaling) | RAT.5 | Proportion setup |
| RAT.3 (Rates between different quantities) | RAT.4 + RAT.7 | Direct rate + algebraic compound |
| RAT.4 (Density, per-area/volume) | RAT.6 | Direct map |
| RAT.5 (Squared/cubed units) | RAT.3 | Direct map |

#### Off-spec patterns
- `3638f413`: Exponential/non-linear rate relationship (P1 placed in RAT.7)
- `3ac09984`: Rate application with constant offset (P1 placed in RAT.5)

---

### 2. PCT — Percentages (75 questions)

**Agreement level: DIVERGENT**

Pass 1 kept all 5 current sub-skills. Pass 2 split into 13. The divergence reflects genuinely different philosophies: P1 groups by "direction" of the percent operation (find part vs find whole vs apply change), while P2 splits by both direction AND algebraic complexity.

#### Proposed synthesis: 8 sub-skills

Where both passes agree on a boundary, keep it. Where P2 splits too fine (single-digit counts on related operations), merge. Where P2 identifies a genuinely distinct skill P1 missed, add it.

| Proposed ID | Name | P1 Source | P2 Source | Qs | Confidence |
|---|---|---|---|---|---|
| PCT.1 | Find Part, Percent, or Whole | PCT.1 (18q) + PCT.2 (13q) | PCT.1 (8q) + PCT.2 (4q) + PCT.3 (4q) | ~16 | **HIGH** — core percent triangle |
| PCT.2 | Apply or Undo a Percent Change | PCT.3 (19q) | PCT.4 (5q) + PCT.6 (3q) | ~8 | **HIGH** — forward and reverse single change |
| PCT.3 | Percent Change Calculation | PCT.4 (6q) | PCT.5 (6q) | 6 | **HIGH** — exact match |
| PCT.4 | Percent as Algebraic Expression | in PCT.1-3 | PCT.7 (11q) | 11 | **P2-ONLY but strong** — 11 questions is substantial |
| PCT.5 | Interpret Percent Expression | in PCT.3 | PCT.8 (3q) | 3 | **MODERATE** — small but distinct (decode not construct) |
| PCT.6 | Successive Percent Changes | PCT.5 (19q) | PCT.9 (9q) | ~9 | **HIGH** — chained multipliers |
| PCT.7 | Chained Percent Relationships | in PCT.5 | PCT.10 (7q) | 7 | **P2-ONLY but strong** — transitive substitution, all Hard |
| PCT.8 | Percent from Data / Compound Categories | in PCT.1/5 | PCT.11 (4q) + PCT.12 (9q) | ~13 | **MODERATE** — data-reading then percent |

**Dropped from P2 (merged up):**
- PCT.13 (Exponential Percent Growth, 2q) → too small, merge into PCT.6 (successive changes) or flag as TVD/advanced math overlap

#### Current → Proposed mapping

| Current | Proposed | Notes |
|---|---|---|
| PCT.1 (Percent of a quantity) | PCT.1 | Merged with find-percent and find-whole |
| PCT.2 (Unknown percent or whole) | PCT.1 | Merged — same percent triangle |
| PCT.3 (Apply/undo single change) | PCT.2 | Direct map |
| PCT.4 (Percent change between values) | PCT.3 | Direct map |
| PCT.5 (Chained percents) | PCT.6 + PCT.7 | Split: successive changes vs transitive chains |

**New sub-skills not in current taxonomy:**
- **PCT.4 (Algebraic Expression)** — 11 questions. This is a genuinely distinct skill: translating "r% greater than x" into `(1 + r/100)x`. Currently buried across PCT.1-3. Strong evidence.
- **PCT.5 (Interpret Expression)** — 3 questions. Inverse of PCT.4: given `0.82(1.07)x`, decode the percent meaning. Small but cognitively distinct.
- **PCT.8 (Percent from Data / Compound Categories)** — 13 questions requiring data extraction before percent calculation, or nested subset computation. Currently spread across PCT.1/5.

#### Off-spec patterns
- `8e2e424e`, `ba0e23b0`: Exponential percent growth — only 2 questions, overlaps with exponential functions domain

---

### 3. PRB — Probability and Conditional Probability (42 questions)

**Agreement level: DIVERGENT on sub-structure, AGREE on boundaries**

Both passes agree on three high-level boundaries: (1) unconditional/whole-group probability, (2) conditional probability, (3) reverse/find-count problems. They diverge on how finely to split category 1.

Pass 1: 3 sub-skills (merged PRB.4 complement into PRB.1 whole-group, 25q)
Pass 2: 8 sub-skills (split whole-group by data source: description vs frequency table vs 2-way marginal vs 2-way joint)

#### Proposed synthesis: 5 sub-skills

| Proposed ID | Name | P1 Source | P2 Source | Qs | Confidence |
|---|---|---|---|---|---|
| PRB.1 | Simple Probability (description or list) | PRB.1 (25q subset) | PRB.1 (11q) | ~11 | **HIGH** — core P(event) from described group |
| PRB.2 | Probability from a Two-Way Table | PRB.1 (subset) | PRB.3 (6q) + PRB.4 (2q) | ~8 | **HIGH** — both identify 2-way table as distinct data source |
| PRB.3 | Conditional Probability | PRB.2 (10q) | PRB.5 (10q) | 10 | **HIGH** — exact match, same 10 questions |
| PRB.4 | Find Count from Probability (Reverse) | PRB.3 (6q) | PRB.6 (5q) | ~5-6 | **HIGH** — both identify reverse solving |
| PRB.5 | Probability from Frequency Tables | PRB.1 (subset) | PRB.2 (4q) | ~4 | **MODERATE** — P2 split, P1 lumped |

**Dropped from P2 (merged up):**
- PRB.7 (Complement, 2q) → merged into PRB.1 (Pass 1 reasoning: complement is a single arithmetic step)
- PRB.8 (Symbolic/Algebraic, 2q) → merged into PRB.4 (algebraic probability is still reverse-solving)

**Dropped from current:**
- **PRB.4 (Complement and exclusion events)** — Both passes agree this is not a standalone sub-skill. Only 1-2 pure complement questions; the rest fold into whole-group probability.

#### Current → Proposed mapping

| Current | Proposed | Notes |
|---|---|---|
| PRB.1 (Whole-group probability) | PRB.1 + PRB.2 + PRB.5 | Split by data source |
| PRB.2 (Conditional probability) | PRB.3 | Direct map |
| PRB.3 (Find count from probability) | PRB.4 | Direct map |
| PRB.4 (Complement/exclusion) | **RETIRE** → PRB.1 | Both passes agree: not standalone |

#### Anomalies
- `b680e76d`: CB mis-tag identified by Pass 1 — not a probability question (table arithmetic)

---

### 4. OVD — One-Variable Data: Distributions and Measures of Center and Spread (56-73 questions)

**Agreement level: MODERATE**

**Question count discrepancy:** Pass 1 found 56 questions, Pass 2 found 73. Pass 2 likely counted more carefully from the PDFs (33+19+21 page counts = 73).

Both confirm OVD.1 (Read/Interpret Display) exists as standalone. They diverge on whether to split "compute center" (mean vs median separately) and "spread" (range vs SD comparison).

#### Proposed synthesis: 7 sub-skills

| Proposed ID | Name | P1 Source | P2 Source | Qs | Confidence |
|---|---|---|---|---|---|
| OVD.1 | Read or Interpret a Data Display | OVD.1 (10q) | OVD.1 (17q) | ~17 | **HIGH** — both confirm standalone |
| OVD.2 | Compute the Mean | OVD.2 (21q subset) | OVD.2 (9q) | ~9 | **MODERATE** — P2 splits mean/median; P1 lumps |
| OVD.3 | Find the Median | OVD.2 (subset) | OVD.3 (11q) | ~11 | **MODERATE** — P2 split with good evidence |
| OVD.4 | Compute Range and Compare Spread | OVD.3 (6q) | OVD.4 (3q) + OVD.9 (4q) | ~7 | **HIGH** — spread measures grouped |
| OVD.5 | Compare or Relate Measures | OVD.5 (12q subset) | OVD.5 (13q) | ~13 | **HIGH** — both identify conceptual reasoning |
| OVD.6 | Effect of Data Changes on Statistics | OVD.5 (subset) | OVD.6 (7q) | 7 | **MODERATE** — P2 split from compare; Med+Hard only |
| OVD.7 | Solve for Unknown Using the Mean | OVD.4 (7q) | OVD.7 (7q) + OVD.8 (2q) | ~9 | **HIGH** — algebraic mean inversion |

**Rationale for splitting OVD.2 (P1) into mean vs median:**
Pass 2's split is well-evidenced: compute-mean (sum/count, 9q) and find-median (order-and-locate, 11q) use different procedures. The 21q bucket in P1 is the largest single sub-skill across all PSDA — splitting improves diagnostic value.

**Merged from P2:**
- OVD.8 (Combined/Weighted Mean, 2q) → merged into OVD.7 (both are algebraic mean problems)
- OVD.9 (Compare SDs, 4q) → merged into OVD.4 (both are spread measures)

#### Current → Proposed mapping

| Current | Proposed | Notes |
|---|---|---|
| OVD.1 (Read/interpret display) | OVD.1 | Direct map, confirmed by both passes |
| OVD.2 (Measures of center) | OVD.2 + OVD.3 | Split mean from median |
| OVD.3 (Spread: range and SD) | OVD.4 | Direct map (range + SD comparison) |
| OVD.4 (Mean-total relationship) | OVD.7 | Direct map (algebraic mean) |
| OVD.5 (Compare/effects) | OVD.5 + OVD.6 | Split conceptual comparison from data-change effects |

---

### 5. TVD — Two-Variable Data: Models and Scatterplots (63 questions)

**Agreement level: STRONG**

This was a NEW skill with no current sub-skills (current TVD.1-5 were added recently). Both passes derived very similar structures independently. 6 of 8 sub-skills match exactly.

#### Proposed: 8 sub-skills (adopt P2 carve with P1 refinement)

| Proposed ID | Name | P1 Source | P2 Source | Qs | Confidence |
|---|---|---|---|---|---|
| TVD.1 | Reading Values from Graphs and Models | TVD.1 (8q) + TVD.2 (9q) | TVD.1 (16q) | ~16 | **HIGH** — P2 merged read+predict; both agree on the content |
| TVD.2 | Estimating Slope of a Line of Best Fit | TVD.3 (6q) | TVD.2 (6q) | 6 | **HIGH** — exact match |
| TVD.3 | Choosing/Writing a LOBF Equation | TVD.4 (12q) | TVD.3 (13q) | ~13 | **HIGH** — exact match |
| TVD.4 | Classifying Model Type and Associations | TVD.5 (11q) | TVD.4 (12q) | ~12 | **HIGH** — exact match |
| TVD.5 | Computing and Using Residuals | TVD.7 (4q) | TVD.5 (4q) | 4 | **HIGH** — exact match |
| TVD.6 | Average Rate of Change | TVD.6 (6q) | TVD.6 (6q) | 6 | **HIGH** — exact match |
| TVD.7 | Interpreting Slope in Context | TVD.8 (3q) | TVD.7 (3q) | 3 | **HIGH** — exact match |
| TVD.8 | Choosing a Nonlinear Model Equation | TVD.9 (4q) | TVD.8 (3q) | ~3-4 | **HIGH** — near-exact match |

**Key design decision:** P1 split "reading values" (8q) from "making predictions" (9q); P2 merged them into a single 16q sub-skill. Recommendation: **adopt P2's merged form** — reading a value from a LOBF is functionally the same skill as reading a value from raw data, and the 8q/9q split is fragile.

#### Current → Proposed mapping

| Current | Proposed | Notes |
|---|---|---|
| TVD.1 (Read data and changes) | TVD.1 + TVD.6 | Split: pure reading vs rate-of-change computation |
| TVD.2 (Predict with fitted model) | TVD.1 + TVD.5 | Split: prediction-reading vs residual computation |
| TVD.3 (Linear model: direction, slope, equation) | TVD.2 + TVD.3 + TVD.7 | Split into slope estimation, equation writing, and contextual interpretation |
| TVD.4 (Nonlinear model) | TVD.8 | Direct map |
| TVD.5 (Classify linear vs exponential) | TVD.4 | Direct map (broadened to include quadratic) |

---

### 6. INFS — Inference from Sample Statistics and Margin of Error (24 questions)

**Agreement level: MODERATE (same 2 major categories, P2 over-split)**

Both passes converge on two dominant categories: (1) MOE interpretation (~14q) and (2) Population estimation (~10q). Pass 2 further split into 8 sub-skills, but 5 of those have only 1 question each — too fine for reliable assessment.

#### Proposed: 3 sub-skills

| Proposed ID | Name | P1 Source | P2 Source | Qs | Confidence |
|---|---|---|---|---|---|
| INFS.1 | Interpreting Margin of Error | INFS.1 (14q) | INFS-A (10q) + INFS-E (1q) + INFS-F (1q) | ~12-14 | **HIGH** — dominant category |
| INFS.2 | Estimating Population Values from Samples | INFS.2 (10q) | INFS-B (7q) + INFS-C (1q) + INFS-D (2q) + INFS-H (1q) | ~10-11 | **HIGH** — second major category |
| INFS.3 | Scope of Generalization | ∅ (in INFS.1) | INFS-G (1q) | ~1-2 | **LOW** — only 1-2 questions, but current taxonomy has it |

**Decision point for Karl:** INFS.3 (current: "What the sampling design supports") has only 1-2 CB questions. Both passes flagged overlap with ESC (generalization scope). Options:
- **A. Keep INFS.3** — matches current taxonomy, conceptually distinct from ESC even if overlap exists
- **B. Retire INFS.3** — merge into INFS.1 or ESC; the CB evidence doesn't support it as standalone

#### Current → Proposed mapping

| Current | Proposed | Notes |
|---|---|---|
| INFS.1 (Estimate population count) | INFS.2 | Renamed for clarity |
| INFS.2 (Interpret estimate with MOE) | INFS.1 | Renamed for clarity |
| INFS.3 (Sampling design supports) | INFS.3 | Kept but flagged — weak CB evidence (1-2q) |

---

### 7. ESC — Evaluating Statistical Claims (11 questions)

**Agreement level: STRONG — identical structure**

Both passes independently derived exactly 3 sub-skills with the same question assignments. This is the highest agreement of any skill.

#### Proposed: 3 sub-skills (keep current)

| Proposed ID | Name | P1 Source | P2 Source | Qs | Confidence |
|---|---|---|---|---|---|
| ESC.1 | Determining Generalization Scope | ESC.1 (6q) | ESC-B (6q) | 6 | **HIGH** — exact match |
| ESC.2 | Identifying Sampling Bias | ESC.2 (3q) | ESC-A (3q) | 3 | **HIGH** — exact match |
| ESC.3 | Understanding Sample Variability | ESC.3 (2q) | ESC-C (2q) | 2 | **HIGH** — exact match |

#### Current → Proposed mapping

| Current | Proposed | Notes |
|---|---|---|
| ESC1 (Scope of generalization) | ESC.1 | Direct map, confirmed |
| ESC2 (Detect biased sample) | ESC.2 | Direct map, confirmed |
| ESC3 (Sampling variability) | ESC.3 | Direct map, confirmed |

#### Notable observation (both passes)
Neither pass found any CB questions testing causation vs. correlation or experiment design — despite the skill name including "Experiments." The entire 11-question pool is about observational study interpretation. This is a gap in CB coverage, not a taxonomy issue.

---

## Proposed Cluster Changes

Clusters are global/shared and represent solving strategies that cross sub-skill boundaries. Both passes proposed skill-local clusters. The reconciliation below maps them to cross-cutting patterns.

### High-confidence clusters (both passes agree)

| Cluster | Skills | Evidence |
|---|---|---|
| Direct Factor Application | RAT | Single multiply/divide using one conversion factor or rate |
| Cross-Multiplication | RAT, PCT | Set up a/b = c/d, cross-multiply, solve |
| Conversion-Factor Chaining | RAT | Two+ sequential multiplications by conversion factors |
| Proportion Setup and Solve | RAT, PCT | part/whole = rate/100 pattern |
| Percent-Change Formula | PCT | (new - old) / old × 100 |
| Single-Multiplier Construction | PCT | Convert verbal percent to (1 ± r/100) multiplier |
| Multiplier Chaining | PCT | Compose two+ percent multipliers sequentially |
| Transitive Substitution | PCT | Chain a = p%·b and a = q%·c to find b-to-c relationship |
| Graph/Table Value Extraction | OVD, TVD | Read numeric values from visual displays |
| Sum-and-Divide (Mean) | OVD | Compute arithmetic mean from data |
| Order-and-Locate (Median) | OVD | Sort and find middle position |
| Algebraic Mean Inversion | OVD | Solve sum/count = mean for unknown |
| Slope Computation from Two Points | TVD | (y2-y1)/(x2-x1) from graph or data |
| Sign-and-Intercept Reasoning | TVD | Match LOBF equation by slope sign and y-intercept |
| Pattern Classification | TVD | Determine linear/exponential/quadratic from data |
| Residual Computation | TVD | Observed - predicted |
| Confidence Interval Construction | INFS | estimate ± MOE |
| Scale Sample to Population | INFS | sample proportion × population size |
| Sampling Method Evaluation | ESC | Identify sampled population, detect bias |

---

## Off-Spec Patterns (CB-absent or anomalous)

| Pattern | Skill | Question IDs | Notes |
|---|---|---|---|
| Exponential/non-linear rate | RAT | `3638f413` | CB appears to include one non-linear rate problem |
| Rate with constant offset | RAT | `3ac09984` | Rate application plus a fixed additive term |
| Exponential percent growth | PCT | `8e2e424e`, `ba0e23b0` | Only 2 questions; overlaps with exponential functions (Advanced Math) |
| CB mis-tag | PRB | `b680e76d` | Table arithmetic, not probability — identified by Pass 1 |
| No causation/experiment questions | ESC | — | Despite skill name, all 11 CB questions are observational study interpretation |

---

## Current Sub-Skills with No/Weak CB Support

| Current ID | Name | CB Evidence | Status |
|---|---|---|---|
| PRB.4 | Complement and exclusion events | 1-2 questions | **RETIRE** — both passes agree not standalone |
| INFS.3 | What the sampling design supports | 1-2 questions | **WEAK** — Karl decision: keep or merge into INFS.1/ESC.1 |

All other current sub-skills have CB support from at least one pass.

---

## Summary of Proposed Changes

### Sub-skills to ADD (not in current taxonomy)
1. **RAT.2** — Multi-Step Unit Conversion (split from RAT.1)
2. **RAT.4** — Rate Application, single-step (split from RAT.3)
3. **RAT.7** — Multi-Step Rate/Proportion with Algebra (new)
4. **PCT.4** — Percent as Algebraic Expression (11q, strong evidence)
5. **PCT.5** — Interpret Percent Expression (3q)
6. **PCT.8** — Percent from Data / Compound Categories (13q)
7. **OVD.3** — Find the Median (split from OVD.2)
8. **OVD.6** — Effect of Data Changes (split from OVD.5)
9. **TVD.2** — Estimating Slope of LOBF (split from TVD.3)
10. **TVD.5** — Computing and Using Residuals (split from TVD.2)
11. **TVD.6** — Average Rate of Change (split from TVD.1)
12. **TVD.7** — Interpreting Slope in Context (split from TVD.3)
13. **TVD.8** — Choosing a Nonlinear Model Equation (split from TVD.4)

### Sub-skills to RENAME (same concept, clearer name)
1. RAT.1 → "Single-Step Unit Conversion" (was "Unit conversion, linear")
2. RAT.5 → "Proportion Setup and Solve" (was "Converting squared/cubed units" — that's now RAT.3)
3. RAT.6 → "Density and Per-Area/Volume Rates" (was "Density, per-area, per-volume")
4. PCT.1 → "Find Part, Percent, or Whole" (was "Percent of a quantity" + "Unknown percent/whole")
5. PCT.2 → "Apply or Undo a Percent Change" (was separate PCT.3)
6. PCT.6 → "Successive Percent Changes" (was PCT.5 "Chained percents")
7. INFS.1 → "Interpreting Margin of Error" (was INFS.2)
8. INFS.2 → "Estimating Population Values from Samples" (was INFS.1)

### Sub-skills to RETIRE
1. **PRB.4** (Complement/exclusion) → merge into PRB.1

### Sub-skills to SPLIT
1. Current RAT.1 → RAT.1 + RAT.2 (single vs multi-step conversion)
2. Current PCT.1 + PCT.2 → PCT.1 (merged percent triangle)
3. Current PCT.5 → PCT.6 + PCT.7 (successive changes vs transitive chains)
4. Current OVD.2 → OVD.2 + OVD.3 (mean vs median)
5. Current OVD.5 → OVD.5 + OVD.6 (compare vs data-change effects)
6. Current TVD.3 → TVD.2 + TVD.3 + TVD.7 (slope, equation, interpretation)

### Karl Decision Points
1. **RAT P2-only sub-skills:** Include "Proportional Expression Construction" (8q) and "Ratio Interpretation" (6q)?
2. **INFS.3:** Keep as standalone (1-2q CB evidence) or retire?
3. **PCT.13 (Exponential growth, 2q):** Merge into PCT.6 or flag as Advanced Math overlap?
4. **OVD question count:** Pass 2 found 73 vs Pass 1's 56 — which count is correct? (Affects evidence coverage.)

---

## Pass Data Locations

- **Pass 1 (Write):** `scratchpad/psda-taxonomy-rederive/pass1-write/*.json`
- **Pass 2 (Blind Audit):** `scratchpad/psda-taxonomy-rederive/pass2-audit/*.json`
- **This reconciliation:** `scratchpad/psda-taxonomy-rederive/assembly/psda-taxonomy-reconciliation.md`
