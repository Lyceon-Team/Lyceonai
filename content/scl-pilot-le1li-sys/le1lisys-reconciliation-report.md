# LE1+LI+SYS Reconciliation Report

**Date:** 2026-11-04
**taxonomy_version:** scl-v1.0.0
**tagged_by:** reconciled-v1
**Total questions:** 890 (LE1: 298, LI: 294, SYS: 298)

## Part A: LE1 + SYS Reconciliation (596 questions)

- Sub-skill agreements: 596
- Sub-skill disagreements: 0
- Cluster agreements: 398
- Cluster unions (write ∪ audit): 198

## Part B: LI Inclusion-Test Edits

Edited `content/canonical/subskill-cluster-taxonomy.json`:

### LI.1 inclusion_test
**Added:** "LI.1 and LI.2 are INCLUSIVE co-tags: when the stem describes a situation in words AND asks for a maximum/minimum/greatest/least value, tag BOTH LI.1 and LI.2."

### LI.2 inclusion_test
**Changed:** "CB's rationale reaches it by isolating" → stem-decidable language ("solving requires isolating a variable")
**Added:** Co-tag note with LI.1, mutual exclusion with LI.4
**Added:** "LI.2 = the stem asks for THE boundary value (solve by isolating); LI.4 = the stem asks WHICH point/value SATISFIES a printed inequality (solve by testing/substituting)"

### LI.4 inclusion_test
**Added:** Mutual exclusion with LI.2: "LI.4 = asks WHICH point/value satisfies; LI.2 = asks for THE boundary value itself"

### LI.6 (NEW sub-skill)
**Added:** "Determine a parameter for no-solution / all-solution conditions"
- Stems that ask for the value of a constant making an inequality/system have no solution, all solutions, or specified solution behavior
- Distinct from LI.2 (solving for the variable's bound) and LI.4 (testing given points)
- Low-evidence exception (Lyceon-original only): SATM2QUND52, SATM2Y397CY

## Part C: LI Re-adjudication (294 questions)

- Agreements kept as-is: 142
- Co-tag ruling applied (LI.1+LI.2): 100
- LI.2 vs LI.4 resolved (stem-decidable): 48
- Originally flagged for Karl: 4 → resolved with LI.6 + retag (see below)

### Co-tag ruling breakdown

- write=LI.1+LI.2, audit=LI.2: 46 questions → LI.1+LI.2
- write=LI.2, audit=LI.1: 42 questions → LI.1+LI.2
- write=LI.1+LI.2, audit=LI.1: 12 questions → LI.1+LI.2

### LI.2 vs LI.4 resolution breakdown

- write=LI.2, audit=LI.4 → LI.2: 45 questions
- write=LI.4, audit=LI.2 → LI.4: 3 questions

### Flagged questions — resolved

| Question | Original tags | Retag | Rationale |
|----------|--------------|-------|-----------|
| SATM2QUND52 | LE1.5+LI.1 (union) | **LI.6** | "For what value of k does the inequality have no solution?" — parameter controls solution existence |
| SATM2Y397CY | LE1.5+LI.1 (union) | **LI.6** | "Find a so ax+7>3x+19 has no solution" — parameter controls solution existence |
| SATM29U5FIU | LI.1+LI.4 (union) | **LI.4** | "What must be true for (a,b) in system" — tests which conditions a point satisfies in a printed system |
| SATM23YBTUL | LI.1+LI.2+LI.3 (union) | **LI.1+LI.3** | Two-sided weight constraint modeled from words; LI.2 dropped (not asking for THE max/min value, asking for max count within a two-sided bound) |

## Part D: Apply SQL

- File: `content/scl-pilot-le1li-sys/apply-le1lisys-tags.sql`
- **PREREQUISITE:** LI.6 must exist in `public.sub_skills` before running this SQL
- **Apply order:** (a) load LI.6 into `sub_skills`, then (b) run `apply-le1lisys-tags.sql`
- question_sub_skills rows: 995
- question_clusters rows: 2707
- distractor_clusters rows: 1051

## LI.6 CB Evidence Search

No matching College Board 8-hex evidence IDs found for "no-solution / parameter-condition" inequality questions. This question type (asking for the value of a constant that eliminates a solution set) appears to be a Lyceon-original edge type. LI.6 is listed on the single/low-evidence exception list alongside EE.6, with evidence_ids populated by Lyceon-original question IDs (SATM2QUND52, SATM2Y397CY) and an `evidence_note` field in the taxonomy entry.

## Final Statistics

- Total reconciled questions: 890
- Total sub-skill tags: 995
- Total unique sub-skills: 13
- Total unique clusters: 24
- Total distractor cluster rows: 1051

### Sub-skill distribution

| Sub-skill | Count |
|-----------|-------|
| LE1.1 | 233 |
| LE1.2 | 5 |
| LE1.4 | 45 |
| LE1.5 | 15 |
| LI.1 | 160 |
| LI.2 | 187 |
| LI.3 | 21 |
| LI.4 | 28 |
| LI.6 | 2 |
| SYS.1 | 106 |
| SYS.2 | 46 |
| SYS.3 | 77 |
| SYS.4 | 70 |

### Invariant checks

- LE2/LF contamination: none
- CL.0231 present: no
- All sub-skill IDs valid: yes (13 unique, including new LI.6)
- All cluster IDs valid: yes (24 unique)
- All 890 question IDs present: yes
- No duplicate question IDs: yes
- LI.6 FK dependency noted: apply SQL will fail if LI.6 not loaded first
