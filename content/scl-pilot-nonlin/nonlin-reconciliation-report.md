# Reconciliation Report — NLE + NLF SCL Tagging (scl-v1.0.0)

**Date:** 2026-11-04
**Pass:** Reconciliation (write pass + blind audit → final tag set)
**Scope:** 682 questions — 346 NLE (Nonlinear Equations) + 336 NLF (Nonlinear Functions)
**Taxonomy:** scl-v1.0.0 (10 sub-skills: NLE.1–5, NLF.1–5; 230 clusters: CL.0001–CL.0230)
**Tagged by:** `reconciled-v1`
**Output:** `content/scl-pilot-nonlin/apply-nonlin-tags.sql`

---

## Summary

| Metric | Value |
|---|---|
| Total questions reconciled | 682 |
| Validation errors | 0 |
| Contradictions requiring Karl | 0 |
| question_sub_skills rows | 894 |
| question_clusters rows | 1,887 |
| distractor_clusters rows | 1,695 |

---

## Per-Sub-Skill Counts (Final)

| Sub-skill | Count | % of bank | Notes |
|---|---|---|---|
| **NLE.1** (formula rearrangement) | 0 | 0% of NLE | Confirmed bank gap — no rearrangement questions exist |
| **NLE.2** (solve quadratic/polynomial) | 224 | 64.7% of NLE | Up from write=171/audit=157 due to NLE.2+NLE.5 ruling |
| **NLE.3** (radical/rational/absolute value) | 53 | 15.3% of NLE | Union of both passes |
| **NLE.4** (solution count/discriminant) | 88 | 25.4% of NLE | Stable across passes |
| **NLE.5** (nonlinear systems) | 106 | 30.6% of NLE | Stable |
| **NLF.1** (evaluate/IO/find constants) | 128 | 38.1% of NLF | Union added 4 |
| **NLF.2** (interpret in verbal context) | 12 | 3.6% of NLF | Union added 7 (from 5 in audit) |
| **NLF.3** (exponential growth/decay) | 64 | 19.0% of NLF | Union added 5 |
| **NLF.4** (quadratic/polynomial structure) | 192 | 57.1% of NLF | Stable |
| **NLF.5** (transformations/shifts) | 25 | 7.4% of NLF | Stable |
| **Total tags** | **892** | — | 1.31 tags/question avg |

Note: 894 rows includes the 2 mis-skilled questions (SATM2CIQ1LY, SATM2V4R0JM) which carry both NLE.2 and NLF.1 in their reconciled tags (they remain in the NLE bank per ruling).

---

## NLE.2 + NLE.5 Co-Tags Created by Ruling

**Karl's ruling:** When a question is a linear–nonlinear SYSTEM (NLE.5) AND the decisive work is solving a quadratic/polynomial equation (NLE.2), tag BOTH.

**49 co-tags created** where one pass had NLE.2 and the other NLE.5. These questions now carry both sub-skills.

---

## NLF Union Decisions (13)

All 13 NLF disagreements were resolved as UNION (both tags individually defensible, complementary not contradictory):

| Question ID | Write pass | Audit pass | Final |
|---|---|---|---|
| SATM20A9WV1 | NLF.5 | NLF.4 | NLF.4, NLF.5 |
| SATM20CV1CS | NLF.2 | NLF.4 | NLF.2, NLF.4 |
| SATM20IM6GB | NLF.3 | NLF.1 | NLF.1, NLF.3 |
| SATM20YZBDZ | NLF.2 | NLF.4 | NLF.2, NLF.4 |
| SATM214XU2A | NLF.1 | NLF.4 | NLF.1, NLF.4 |
| SATM216LIWK | NLF.2 | NLF.3 | NLF.2, NLF.3 |
| SATM21S0APG | NLF.3 | NLF.1 | NLF.1, NLF.3 |
| SATM22DL190 | NLF.1 | NLF.4 | NLF.1, NLF.4 |
| SATM23NJSZF | NLF.5 | NLF.4 | NLF.4, NLF.5 |
| SATM23X4LHX | NLF.3 | NLF.1 | NLF.1, NLF.3 |
| SATM252UMHC | NLF.1 | NLF.4 | NLF.1, NLF.4 |
| SATM2W0W79P | NLF.1 | NLF.4 | NLF.1, NLF.4 |
| SATM2ZSWRYX | NLF.3 | NLF.1 | NLF.1, NLF.3 |

**Contradictions: 0** — no cases where both tags were incompatible.

---

## Mis-Skills Surfaced (2) — NOT Retagged

Per ruling: surface only, do NOT change skill_codes.

| Question ID | Current bank | Reconciled tags | Reason |
|---|---|---|---|
| SATM2CIQ1LY | NLE | NLE.2, NLF.1 | f(3a−1) = 2^(3a−1) = 32 — function evaluation, not polynomial solve |
| SATM2V4R0JM | NLE | NLE.2, NLF.1 | f(a) = 32 where f(x) = 2^x — find input from output |

SATM2G1KDCJ stays NLE per ruling (exponential base-rewriting yields a linear equation).

---

## Confirmations

- **NLE.1 empty:** ✅ 0 questions (confirmed bank gap, no formula-rearrangement questions)
- **No CL.0231:** ✅ 0 references to any cluster outside CL.0001–CL.0230
- **No retired-ID tags:** ✅ 0 rows for the 6 retired IDs (SATM2031QKC, SATM287MWOT, SATM28MJGD6, SATM2I2YLEK, SATM2PM4UOF, SATM2TW2BYH)
- **No cross-domain co-tags:** ✅ 0 questions with both NLE and NLF sub-skills (except the 2 mis-skilled questions which legitimately have both)
- **Scratch Postgres test:** ✅ run-once and idempotent re-run both produce 894 / 1,887 / 1,695 rows
- **No prod writes:** ✅ Karl applies, then I verify

---

## Apply SQL

`content/scl-pilot-nonlin/apply-nonlin-tags.sql`

Structure:
1. `BEGIN`
2. Delete existing tags for the 682 question IDs from all 3 tables
3. Insert reconciled `question_sub_skills` (894 rows, 5 columns)
4. Insert reconciled `question_clusters` (1,887 rows, 5 columns)
5. Insert reconciled `distractor_clusters` (1,695 rows, 4 columns — no `tagged_by`)
6. Sanity `SELECT` counts
7. `COMMIT`
