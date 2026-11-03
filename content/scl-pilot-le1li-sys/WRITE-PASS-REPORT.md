# SCL Write-Pass Report — LE1 + LI + SYS

**Taxonomy:** scl-v1.0.0
**Date:** 2026-11-03
**Scope:** 890 published questions (298 LE1 + 294 LI + 298 SYS)
**Pass:** WRITE (blind audit + reconciliation still pending)

## Coverage

| Skill | Source count | Tagged count | Missing | Extra |
|-------|-------------|-------------|---------|-------|
| LE1   | 298         | 298         | 0       | 0     |
| LI    | 294         | 294         | 0       | 0     |
| SYS   | 298         | 298         | 0       | 0     |
| **Total** | **890** | **890**   | **0**   | **0** |

## Sub-skill distribution

| Sub-skill | Count | Notes |
|-----------|-------|-------|
| LE1.1     | 233   | Solve a linear equation — bulk of LE1 |
| LE1.2     | 5     | Determine the number of solutions |
| LE1.4     | 45    | Word problems (translate → solve) |
| LE1.5     | 15    | Solve for a constant given a condition |
| LI.1      | 111   | Solve a linear inequality |
| LI.2      | 189   | **Inflated — see Known Issues** |
| LI.3      | 20    | Compound inequalities |
| LI.4      | 28    | Word problems (inequality) |
| SYS.1     | 106   | Solve a system |
| SYS.2     | 48    | Determine solutions of a system |
| SYS.3     | 77    | Word problems (system) |
| SYS.4     | 70    | Identify equivalent systems / solution properties |

**Multi-sub-skill questions:** 57 (6.4%)

### Missing sub-skills

- **LE1.3** (0): Solve for one variable in terms of others — may be under-represented in the source bank or mis-tagged as LE1.1. Audit should check.
- **LI.5** (0): No-solution / all-solution inequalities — at least 2 questions (SATM2QUND52, SATM2Y397CY) should carry this. Audit should correct.

## Cluster distribution (24 distinct clusters)

| Cluster | Count | Description |
|---------|-------|-------------|
| CL.0047 | 715  | Isolate the variable |
| CL.0104 | 251  | Translate words → equation/inequality |
| CL.0034 | 227  | Distribute over every term |
| CL.0017 | 192  | Combine like terms |
| CL.0003 | 147  | Add/subtract equations to eliminate |
| CL.0016 | 110  | Clear fractions (multiply by LCD) |
| CL.0060 | 103  | Set up a system from context |
| CL.0133 | 95   | Compare coefficients/constants (count solutions) |
| CL.0095 | 84   | Substitute an expression |
| CL.0089 | 82   | Solve for a constant |
| CL.0201 | 80   | Translate 'at least/at most' → inequality symbol |
| CL.0094 | 46   | Substitute a value and evaluate |
| CL.0033 | 39   | Distribute a negative sign |
| CL.0080 | 39   | Read the solution from a simplified identity/contradiction |
| CL.0081 | 34   | Round to the whole number the context allows |
| CL.0009 | 21   | Check a point in the equation/inequality |
| CL.0005 | 16   | Apply operation to every part (compound inequality) |
| CL.0053 | 14   | Match coefficients |
| CL.0101 | 13   | Interpret system solution in context |
| CL.0004 | 6    | Add/subtract to both sides |
| CL.0029 | 6    | Use absolute value to express distance |
| CL.0024 | 6    | Factor out the GCF |
| CL.0040 | 1    | Graph the solution set on a number line |
| CL.0189 | 1    | Use unit rate in a proportion |

## Distractors

- **575 questions** (64%) have at least one distractor annotation
- **1,233 total** distractor annotations

## Known Issues (for audit pass to address)

1. **LI.2 over-assignment:** Workers used LI.2 ("Identify the solution set of a linear inequality") as a catch-all. Many LI.2-tagged questions should be LI.1 (basic solve), LI.4 (word problems), or LI.5 (no-solution). Expected LI.2 count after audit: ~100–120.

2. **LI.5 = 0:** At least two questions test "no solution / all real numbers" for inequalities. The audit should add LI.5 where the ASK is about solution existence.

3. **LE1.3 = 0:** "Solve for one variable in terms of others" may be hiding under LE1.1. The audit should split these out where the answer is an expression, not a number.

## File manifest

| File | Lines | Content |
|------|-------|---------|
| tagged-le1-{0,1,2,3}.ndjson | 75+75+75+73 = 298 | LE1 write-pass tags |
| tagged-li-{0,1,2,3}.ndjson | 74+74+74+72 = 294 | LI write-pass tags |
| tagged-sys-{0,1,2,3}.ndjson | 75+75+75+73 = 298 | SYS write-pass tags |
| tags-all.ndjson | 890 | Combined output |
| WRITE-PASS-REPORT.md | — | This file |
