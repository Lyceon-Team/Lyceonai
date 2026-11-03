# SCL Write-Pass Report — LE1 + LI + SYS
Taxonomy: scl-v1.0.0 | Date: 2026-11-03
Pass: WRITE (1 of 2)

## Coverage
| Skill | Questions | Expected |
|-------|-----------|----------|
| LE1   | 298       | 298      |
| LI    | 294       | 294      |
| SYS   | 298       | 298      |
| **Total unique** | **890** | **890** |

Cross-skill co-tagged: 0 questions

## Sub-skill distribution
| Sub-skill | Count |
|-----------|-------|
| LE1.1 | 233 |
| LE1.2 | 5 |
| LE1.4 | 45 |
| LE1.5 | 15 |
| LI.1 | 111 |
| LI.2 | 189 |
| LI.3 | 20 |
| LI.4 | 28 |
| SYS.1 | 106 |
| SYS.2 | 47 |
| SYS.3 | 77 |
| SYS.4 | 70 |

**Zero-tag sub-skills:** LE1.3, LI.5, SYS.5
- LE1.3 (translate context ↔ equation): may be absorbed into LE1.4 by workers; audit should check
- LI.5 (read inequality from graph): requires [FIGURE]; likely absent from text-only pool
- SYS.5 (solutions on graph): requires [FIGURE]; likely absent from text-only pool

## Multi-sub-skill questions: 56
Questions tagged with >1 sub-skill (co-tagging). Examples:
- SATM200U6DX: ['LI.1', 'LI.2']
- SATM206RZ1Z: ['LI.1', 'LI.2']
- SATM20RN4R8: ['LI.1', 'LI.2']
- SATM20W4N05: ['LI.1', 'LI.2']
- SATM215FYBC: ['LI.1', 'LI.2']

## Cluster usage
Distinct clusters used: 24 / 230

Top 15 clusters:
| Cluster | Count |
|---------|-------|
| CL.0047 | 715 |
| CL.0104 | 246 |
| CL.0034 | 228 |
| CL.0017 | 204 |
| CL.0003 | 147 |
| CL.0016 | 110 |
| CL.0060 | 103 |
| CL.0133 | 89 |
| CL.0089 | 82 |
| CL.0095 | 81 |
| CL.0201 | 80 |
| CL.0094 | 78 |
| CL.0080 | 40 |
| CL.0033 | 39 |
| CL.0081 | 34 |

## Distractors
Total distractor annotations: 1101
Average per question: 1.2

## Validation
- All sub-skill IDs: VALID (from taxonomy-sub-skills.json)
- All cluster IDs: VALID (from taxonomy-clusters.json)
- No retired CL.0231: CONFIRMED
- No bad JSON: CONFIRMED
- No missing required fields: CONFIRMED
- No duplicate question IDs: CONFIRMED

## Files
- tags-all.ndjson: 890 lines (combined, deduplicated)
- Source chunks: 12 files (4 LE1 + 4 LI + 4 SYS)
- Worker contract: tag-worker.md

## Next step
BLIND AUDIT pass: independent re-derivation by fresh workers, then reconciliation.
