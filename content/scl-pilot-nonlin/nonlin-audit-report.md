# Blind Audit Report — NLE + NLF SCL Tagging (scl-v1.0.0)

**Date:** 2026-11-04
**Pass:** Blind audit (independent second pass)
**Scope:** 682 questions — 346 NLE (Nonlinear Equations) + 336 NLF (Nonlinear Functions)
**Taxonomy:** scl-v1.0.0 (10 sub-skills: NLE.1–5, NLF.1–5; 230 clusters: CL.0001–CL.0230)
**Output:** `content/scl-pilot-nonlin/nonlin-audit.ndjson`

---

## Summary

| Metric | Value |
|---|---|
| Total questions | 682 |
| NLE bank | 346 |
| NLF bank | 336 |
| Unique question IDs | 682 (0 duplicates) |
| Validation errors | 0 |
| Total sub-skill tags | 805 (1.18 tags/question avg) |
| Unique clusters used | 51 of 230 |
| Suspected mis-skills | 3 (NLE bank → NLF sub-skills) |

---

## Per-Skill Sub-skill Counts

| Sub-skill | Count | % of bank | Notes |
|---|---|---|---|
| **NLE.1** (formula rearrangement) | 0 | 0% | ZERO COVERAGE — expected, no formula-rearrangement questions in NLE bank |
| **NLE.2** (solve quadratic/polynomial) | 157 | 45.4% of NLE | Dominant: factoring, quadratic formula, Vieta's |
| **NLE.3** (radical/rational/absolute value) | 50 | 14.5% of NLE | Radical eqns, rational eqns, abs value |
| **NLE.4** (solution count/discriminant) | 87 | 25.1% of NLE | Often co-tagged with NLE.5 |
| **NLE.5** (nonlinear systems) | 106 | 30.6% of NLE | Parabola-line, circle-line intersections |
| **NLF.1** (evaluate/IO/find constants) | 124 | 36.9% of NLF | Substitute-and-evaluate, find constant from point |
| **NLF.2** (interpret in verbal context) | 5 | 1.5% of NLF | Low — most contextual questions have numeric answers |
| **NLF.3** (exponential growth/decay) | 59 | 17.6% of NLF | Base matching, exponent rules, asymptotes |
| **NLF.4** (quadratic/polynomial structure) | 192 | 57.1% of NLF | Dominant: vertex form, min/max, zeros, end behavior |
| **NLF.5** (transformations/shifts) | 25 | 7.4% of NLF | Horizontal/vertical shifts, often co-tagged |

---

## Co-tag Patterns (top 10)

| Pattern | Count | Notes |
|---|---|---|
| NLF.4 only | 160 | Vertex reading, polynomial structure |
| NLE.2 only | 145 | Straightforward solve |
| NLF.1 only | 82 | Pure evaluation |
| NLE.5 only | 54 | Pure system |
| NLE.3 only | 45 | Radical/rational/abs value |
| NLE.4 only | 42 | Discriminant only |
| NLE.4 + NLE.5 | 40 | System + solution count |
| NLF.3 only | 26 | Exponential structure |
| NLF.1 + NLF.3 | 26 | Evaluate exponential |
| NLF.4 + NLF.5 | 17 | Structure + transformation |

---

## Suspected Mis-skills (3)

Questions in the NLE bank that the audit tagged with NLF sub-skills instead:

| Question ID | Audit tag | Reason |
|---|---|---|
| SATM2CIQ1LY | NLF.1 | f(3a-1) = 2^(3a-1) = 32 = 2^5. Match function input, not polynomial solve. |
| SATM2G1KDCJ | NLF.3 | 4^(x+1) = 8^(2x-1): exponential base-rewriting, linear result. Not NLE. |
| SATM2V4R0JM | NLF.1 | f(a) = 32 where f(x) = 2^x. Find input from output — NLF.1, not NLE. |

No NLF bank questions were tagged with NLE sub-skills.

---

## Boundary Ambiguous Cases

| Question ID | Tags | Boundary |
|---|---|---|
| SATM2X4XQ01 | NLF.3 | Range of 3^(x-4)-2: exponential structure vs. transformation |
| SATM2TTVQ4A | NLF.4 | Min of \|x-4\|+2: absolute value function, not polynomial, but extremum → NLF.4 |
| NLE.4 + NLE.5 co-tags (40 questions) | NLE.4, NLE.5 | "Find k for exactly one solution" in a system — both sub-skills legitimately apply |

---

## Zero-Coverage Sub-skills

- **NLE.1** (Isolate a variable in a nonlinear formula): 0 questions. This is expected — the NLE question bank contains no formula-rearrangement questions. This sub-skill would require questions like "solve A = πr² for r" which are not present.

---

## Taxonomy Gaps / Off-Spec Findings

1. **NLF.2 severely underrepresented** (5 of 336 NLF = 1.5%). Most questions with real-world context still have numeric answer choices, disqualifying them from NLF.2 which requires verbal-context interpretation in the choices.

2. **Cluster utilization is narrow**: 51 of 230 clusters used. The remaining 179 clusters likely serve other skills (EE, PA, HoA, Geometry, etc.) and are correctly unused for NLE/NLF.

3. **Question count delta**: Write pass had 688 questions; audit found 682 (6 fewer: 2 NLE + 4 NLF). Likely unpublished between passes — not an audit discrepancy.

4. **No cross-domain co-tags**: Zero questions received both NLE and NLF tags. The boundary between "solve an equation" (NLE) and "analyze a function" (NLF) was clean across all 682 questions.

---

## Cluster Coverage (Top 15 solving + Top 10 distractor)

### Solving clusters
| Cluster | Count | Description |
|---|---|---|
| CL.0094 | 167 | Substitute and evaluate |
| CL.0037 | 157 | Factor trinomial |
| CL.0122 | 153 | Zero product property |
| CL.0047 | 147 | Isolate variable |
| CL.0017 | 115 | Combine like terms |
| CL.0162 | 113 | Read vertex from vertex form |
| CL.0095 | 108 | Substitute expression |
| CL.0025 | 79 | Compute discriminant |
| CL.0006 | 47 | Apply exponent rules |
| CL.0120 | 46 | Sum/product of solutions |
| CL.0099 | 44 | Complete the square |
| CL.0034 | 38 | Expand product |
| CL.0077 | 34 | Check extraneous solutions |
| CL.0091 | 30 | Square both sides |
| CL.0087 | 25 | Cross multiply |

### Distractor clusters
| Cluster | Count |
|---|---|
| CL.0094 | 307 |
| CL.0162 | 210 |
| CL.0025 | 156 |
| CL.0047 | 89 |
| CL.0122 | 85 |
| CL.0120 | 77 |
| CL.0037 | 67 |
| CL.0087 | 55 |
| CL.0156 | 54 |
| CL.0077 | 50 |
