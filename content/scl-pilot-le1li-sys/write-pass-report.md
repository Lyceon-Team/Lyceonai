# Write-Pass Report — LE1 + LI + SYS SCL Tagging

Date: 2026-11-03 | taxonomy: scl-v1.0.0 | tagged_by: write-pass-v1

## Scope

| Skill | Questions | Source |
|-------|----------:|--------|
| Linear Equations in One Variable (LE1) | 298 | questions-le1.ndjson |
| Linear Inequalities (LI) | 294 | questions-li.ndjson |
| Systems of Two Linear Equations (SYS) | 298 | questions-sys.ndjson |
| **Total** | **890** | |

## Validation

- Unique question IDs: 890
- Duplicate IDs: 0
- Invalid sub_skill IDs: 0
- Invalid cluster IDs: 0
- CL.0231 (retired) anywhere: 0
- All sub_skill IDs valid: yes
- All cluster IDs valid: yes

## Per-sub-skill counts

| Sub-skill | Count |
|-----------|------:|
| LE1.1 | 233 |
| LE1.2 | 5 |
| LE1.3 | 0 |
| LE1.4 | 45 |
| LE1.5 | 15 |
| LI.1 | 111 |
| LI.2 | 189 |
| LI.3 | 20 |
| LI.4 | 28 |
| LI.5 | 0 |
| SYS.1 | 106 |
| SYS.2 | 47 |
| SYS.3 | 77 |
| SYS.4 | 70 |
| SYS.5 | 0 |
| **Total tags** | **946** |

### Zero-tag sub-skills (expected)

- **LE1.3** (translate context to equation): answer choices must be equations/expressions
- **LI.5** (read inequality from graph): requires [FIGURE] with boundary line + shaded region
- **SYS.5** (solutions on graph): requires graph of intersecting lines

## Row counts

| Table | Rows |
|-------|-----:|
| question_sub_skills | 946 |
| question_clusters | 2375 |
| distractor_clusters | 1101 |

## Cluster top 20

| Cluster | Uses |
|---------|-----:|
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
| CL.0053 | 30 |
| CL.0009 | 21 |
| CL.0005 | 16 |
| CL.0101 | 13 |
| CL.0004 | 6 |

## Unique clusters used: 24

## Method

- Questions pulled from Supabase `questions` table (status=published, skill_codes matching)
- Split into 12 chunks (4 per skill, ~75 questions each)
- Each chunk tagged independently by a fork worker using the SCL taxonomy
- Workers solved each question from scratch, identified sub-skills via inclusion_test, clusters via solving steps, distractors where clear
- Canonical chunk outputs combined into tags-all.ndjson (890 lines)
- Mini-chunk outputs retained for reference but not included in canonical combined file

## Next step

Blind audit pass (independent re-derivation), then reconciliation.
