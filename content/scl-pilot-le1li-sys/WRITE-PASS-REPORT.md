# SCL Write-Pass Report — LE1 + LI + SYS

**Taxonomy**: scl-v1.0.0  
**Date**: 2026-11-03  
**Pass**: WRITE (pass 1 of 2)  
**Scope**: Algebra domain — 890 serving questions  

## Coverage

| Skill | Questions | Chunks | Status |
|-------|-----------|--------|--------|
| LE1 (Linear Equations in One Variable) | 298 | 4 (75+75+75+73) | Done |
| LI (Linear Inequalities) | 294 | 4 (74+74+74+72) | Done |
| SYS (Systems of Two Linear Equations) | 298 | 4 (75+75+75+73) | Done |
| **Total** | **890** | **12** | **Done** |

## Validation

- **890 / 890** questions tagged (100%)
- **890 unique question IDs** — zero duplicates
- **All sub-skill IDs** validated against `taxonomy-sub-skills.json` — zero unknown
- **All cluster IDs** validated against `taxonomy-clusters.json` — zero unknown
- **CL.0231** (retired) — not used anywhere
- **Zero cross-skill co-tags** in this batch (all questions single-skill)
- **572 / 890** (64%) have distractor annotations

## Sub-skill Distribution

| Sub-skill | Count | Description |
|-----------|-------|-------------|
| LE1.1 | 233 | Solve linear equation (procedural) |
| LE1.2 | 5 | Interpret solution in context |
| LE1.4 | 45 | Set up equation from word problem |
| LE1.5 | 17 | Equations with no/infinitely many solutions |
| LI.1 | 118 | Solve linear inequality (procedural) |
| LI.2 | 188 | Model or interpret inequality |
| LI.3 | 20 | Compound inequality / AND-OR |
| LI.4 | 28 | Inequality word problem |
| SYS.1 | 106 | Solve for variable(s) |
| SYS.2 | 46 | Evaluate expression from system |
| SYS.3 | 77 | No/infinitely many solutions (find k) |
| SYS.4 | 70 | System word problem |

**Note**: LE1.3, LI.5, SYS.5 have zero tags — these sub-skills do not appear in the current serving pool. This is a coverage gap finding for the audit pass.

## Top Clusters Used

| Cluster | Count | Method |
|---------|-------|--------|
| CL.0047 | 714 | Isolate variable |
| CL.0104 | 251 | Translate words to equation/inequality |
| CL.0034 | 191 | Distribute / expand |
| CL.0017 | 159 | Combine like terms |
| CL.0003 | 147 | Add/subtract equations |
| CL.0016 | 112 | Move terms across equals sign |
| CL.0133 | 95 | Compare coefficients/constants |
| CL.0201 | 92 | Interpret inequality on number line / set |
| CL.0089 | 84 | Solve for unknown constant |
| CL.0060 | 80 | Rate × quantity pattern |

24 distinct clusters used across 890 questions.

## Output Files

```
tags-all.ndjson          — 890 lines (combined canonical output)
tagged-le1-{0,1,2,3}.ndjson — 75+75+75+73 = 298 lines
tagged-li-{0,1,2,3}.ndjson  — 74+74+74+72 = 294 lines
tagged-sys-{0,1,2,3}.ndjson — 75+75+75+73 = 298 lines
```

## Boundary Rulings Applied

- **SYS vs LE1**: Two equations/two unknowns → SYS, even if final step is single-variable algebra
- **LI vs LE1**: Inequality symbol (≥, ≤, >, <) → LI; equals sign → LE1
- **SYS.4 vs SYS.2**: Word problems asking for an expression (e.g. "find r−t") → SYS.4 only (setup is the cognitive demand); SYS.2 reserved for symbolically-given systems

## Next Step

**BLIND AUDIT PASS** — independent re-derivation of all 890 questions, then reconciliation.
