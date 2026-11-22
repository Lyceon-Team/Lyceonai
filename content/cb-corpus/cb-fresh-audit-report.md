# CB Fresh Audit — Comparison Report

**Date**: 2026-11-22
**Audit file**: `content/cb-corpus/cb-fresh-audit.ndjson` (1,618 items)
**Compared against**: `content/cb-corpus/cb-tags-reconciled.ndjson` (stored tags) and each item's CB skill label from `content/official-corpus/`

---

## Metric 1 — Skill-Level Match (audit primary sub-skill family → CB skill label)

Maps the audit's primary sub-skill family (e.g. `RAT` → "Ratios, Rates, Proportional Relationships, and Units") to the item's College Board skill label.

**Match: 1,606 / 1,618 = 99.3%**

12 mismatches (boundary items where the audit's primary sub-skill falls in a neighbouring CB category):

| Item ID | Audit primary | Audit family (CB mapping) | Actual CB label |
|---------|--------------|--------------------------|-----------------|
| 53d97af5 | ESC.1 | Evaluating Statistical Claims | Inference from Sample Statistics |
| 145337bc | LAT.1 | Lines, Angles, and Triangles | Right Triangles and Trigonometry |
| 64c1f044 | LAT.4 | Lines, Angles, and Triangles | Right Triangles and Trigonometry |
| 2be01bd9 | LAT.5 | Lines, Angles, and Triangles | Right Triangles and Trigonometry |
| 9f6f96ff | LE1.4 | Linear equations in one variable | Systems of Two Linear Equations |
| 3638f413 | NLF.3 | Nonlinear Functions | Ratios, Rates, Proportional Relationships |
| 97e50fa2 | NLF.4 | Nonlinear Functions | Nonlinear Equations |
| 66bce0c1 | NLF.4 | Nonlinear Functions | Nonlinear Equations |
| 8da536c6 | PCT.12 | Percentages | Linear equations in two variables |
| f5563c26 | PCT.14 | Percentages | Systems of Two Linear Equations |
| 63573fea | RAT.14 | Ratios, Rates | Percentages |
| d7a8aa9c | RTT4 | Right Triangles and Trigonometry | Lines, Angles, and Triangles |

---

## Metric 2 — Primary Sub-Skill Agreement (audit vs stored)

Compares the audit's primary (first) sub-skill to the stored tag's primary sub-skill.

**Agreement: 934 / 1,618 = 57.7%**

684 disagreements. This is expected: the audit was derived blind and independently, and many items genuinely sit at the boundary of related sub-skills. Top disagreement patterns (count ≥ 10):

| Audit primary | Stored primary | Count |
|--------------|----------------|-------|
| NLF.4 | NLF.1 | 22 |
| RAT.6 | RAT.9 | 20 |
| LI.1 | LI.2 | 19 |
| NLF.3 | NLF.1 | 18 |
| LE1.2 | LE1.1 | 17 |
| NLF.1 | NLF.4 | 17 |
| EE.2 | EE.1 | 16 |
| SYS.4 | SYS.1 | 16 |
| CIR1 | CIR2 | 16 |
| PRB.5 | PRB.6 | 15 |
| EE.3 | EE.1 | 13 |
| LI.1 | LI.5 | 12 |
| INFS.4 | INFS.5 | 12 |
| RAT.10 | RAT.9 | 12 |
| LF.3 | LF.1 | 11 |
| NLE.5 | NLE.2 | 11 |
| NLF.2 | NLF.3 | 10 |
| LAT.4 | LAT.2 | 10 |
| LAT.5 | LAT.2 | 10 |

Most disagreements are within the same skill family, confirming the audit and stored tags agree on the domain but differ on which sub-skill is primary.

---

## Metric 3 — Cluster Agreement (Jaccard per skill family)

Mean Jaccard similarity between audit and stored cluster sets, grouped by the audit's primary sub-skill family.

| Family | Mean Jaccard | n |
|--------|-------------|---|
| AV | 0.104 | 80 |
| CIR1 | 0.269 | 18 |
| CIR2 | 0.222 | 9 |
| CIR3 | 0.000 | 8 |
| CIR5 | 0.333 | 9 |
| EE | 0.230 | 101 |
| ESC | 0.431 | 12 |
| INFS | 0.316 | 23 |
| LAT | 0.261 | 78 |
| LE1 | 0.465 | 105 |
| LE2 | 0.213 | 123 |
| LF | 0.278 | 139 |
| LI | 0.322 | 69 |
| NLE | 0.367 | 128 |
| NLF | 0.104 | 229 |
| OVD | 0.016 | 73 |
| PCT | 0.000 | 76 |
| PRB | 0.188 | 43 |
| RAT | 0.000 | 84 |
| RTT1 | 0.458 | 12 |
| RTT2 | 0.078 | 15 |
| RTT3 | 0.405 | 14 |
| RTT4 | 0.048 | 7 |
| SYS | 0.393 | 100 |
| TVD | 0.082 | 63 |
| **OVERALL** | **0.215** | **1,618** |

Low overall Jaccard (0.215) indicates significant cluster divergence between audit and stored tags. This is likely due to: (a) independent derivation picking different solving-step decompositions, (b) the taxonomy having 283 clusters with many near-synonyms, and (c) cluster granularity differences in how each pass decomposed the solving steps.

---

## Metric 4 — Richness Gap (additional sub-skills found by audit)

Items where the audit tagged additional sub-skills beyond the stored single tag.

**752 / 1,618 = 46.5% of items had additional sub-skills found**

Top extra sub-skills the audit identified:

| Sub-skill | Items gained |
|-----------|-------------|
| NLF.3 | 52 |
| NLF.4 | 39 |
| LI.1 | 36 |
| NLF.1 | 30 |
| EE.2 | 26 |
| NLF.2 | 25 |
| LF.3 | 23 |
| RAT.6 | 22 |
| EE.3 | 21 |
| PRB.5 | 19 |
| LAT.4 | 18 |
| LAT.5 | 18 |
| LE1.2 | 17 |
| NLE.5 | 16 |
| SYS.4 | 16 |
| CIR1 | 16 |
| LI.3 | 14 |
| EE.1 | 13 |
| AV.5 | 13 |
| RTT2 | 13 |

The 46.5% richness gap confirms that many CB items genuinely test multiple sub-skills, which a single-tag system cannot capture. The most common co-tags are nonlinear function sub-skills (NLF.1–4), which frequently overlap in function-interpretation items.

---

## Metric 5 — Distractor Overlap

Compares distractor annotations (option_key + cluster_id pairs) between audit and stored.

| Measure | Value |
|---------|-------|
| Total annotations (union) | 4,726 |
| Matching pairs | 33 (0.7%) |
| Audit-only | 2,801 |
| Stored-only | 1,892 |
| Items with distractors (audit) | 977 |
| Items with distractors (stored) | 1,045 |

Very low overlap (0.7%) is expected: distractor cluster assignment is the most subjective tagging dimension, depending heavily on the tagger's model of *why* a student would choose each wrong answer. Both passes annotated distractors at similar density (~60-65% of items), but the specific cluster assignments diverged almost completely.

---

## Summary

| Metric | Result | Interpretation |
|--------|--------|----------------|
| 1. Skill-level match | 99.3% | Audit agrees with CB's own categorisation almost perfectly |
| 2. Primary sub-skill | 57.7% | Moderate agreement; disagreements are mostly within-family boundary calls |
| 3. Cluster Jaccard | 0.215 | Low; independent derivation picks different solving-step clusters |
| 4. Richness gap | 46.5% | Nearly half of items test multiple sub-skills the single-tag misses |
| 5. Distractor overlap | 0.7% | Near-zero; distractor reasoning is highly subjective |
