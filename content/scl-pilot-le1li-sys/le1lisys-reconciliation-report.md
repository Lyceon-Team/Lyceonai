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

## Part C: LI Re-adjudication (294 questions)

- Agreements kept as-is: 142
- Co-tag ruling applied (LI.1+LI.2): 100
- LI.2 vs LI.4 resolved (stem-decidable): 48
- Flagged for Karl: 4

### Co-tag ruling breakdown

- write=LI.1+LI.2, audit=LI.2: 46 questions → LI.1+LI.2
- write=LI.2, audit=LI.1: 42 questions → LI.1+LI.2
- write=LI.1+LI.2, audit=LI.1: 12 questions → LI.1+LI.2

### LI.2 vs LI.4 resolution breakdown

- write=LI.2, audit=LI.4 → LI.2: 45 questions
- write=LI.4, audit=LI.2 → LI.4: 3 questions

### Flagged for Karl

- **SATM23YBTUL**: write=['LI.1', 'LI.2'], audit=['LI.2', 'LI.3'] → ['LI.1', 'LI.2', 'LI.3'] (Unexpected pattern LI.1+LI.2/LI.2+LI.3 — union applied, flag for Karl)
- **SATM29U5FIU**: write=['LI.4'], audit=['LI.1'] → ['LI.1', 'LI.4'] (Unexpected pattern LI.4/LI.1 — union applied, flag for Karl)
- **SATM2QUND52**: write=['LE1.5'], audit=['LI.1'] → ['LE1.5', 'LI.1'] (Unexpected pattern LE1.5/LI.1 — union applied, flag for Karl)
- **SATM2Y397CY**: write=['LE1.5'], audit=['LI.1'] → ['LE1.5', 'LI.1'] (Unexpected pattern LE1.5/LI.1 — union applied, flag for Karl)

## Part D: Apply SQL

- File: `content/scl-pilot-le1li-sys/apply-le1lisys-tags.sql`
- question_sub_skills rows: 999
- question_clusters rows: 2707
- distractor_clusters rows: 1051

## Final Statistics

- Total reconciled questions: 890
- Total sub-skill tags: 999
- Total unique clusters: 24
- Total distractor cluster rows: 1051

### Sub-skill distribution

| Sub-skill | Count |
|-----------|-------|
| LE1.1 | 233 |
| LE1.2 | 5 |
| LE1.4 | 45 |
| LE1.5 | 17 |
| LI.1 | 163 |
| LI.2 | 188 |
| LI.3 | 21 |
| LI.4 | 28 |
| SYS.1 | 106 |
| SYS.2 | 46 |
| SYS.3 | 77 |
| SYS.4 | 70 |

### Invariant checks

- LE2/LF contamination: none
- CL.0231 present: no
- All sub-skill IDs valid: yes (12 unique)
- All cluster IDs valid: yes (24 unique)
- All 890 question IDs present: yes
- No duplicate question IDs: yes
