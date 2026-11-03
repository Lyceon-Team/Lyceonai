# LE2+LF Write Pass Report

**Date:** 2026-11-03
**Taxonomy:** scl-v1.0.0
**Branch:** claude/batch-005-launch-gw211p

## Summary

| Metric | Count |
|---|---|
| Total questions tagged | 594 |
| LE2 (Linear Equations in Two Variables) | 300 |
| LF (Linear Functions) | 294 |
| MCQ (with distractor tags) | 448 |
| Grid-in (no options, empty distractors) | 146 (79 LE2, 67 LF) |
| Unique question IDs | 594 |
| Cross-skill tagged | 1 |
| Mis-skill suspects | 0 |
| Notation-boundary ambiguous | 1 |

## Sub-skill Distribution

### LE2 Sub-skills

| ID | Name | Count |
|---|---|---|
| LE2.1 | Model a situation with a linear equation | 0 |
| LE2.2 | Interpret parts of a contextual linear equation or graph | 0 |
| LE2.3 | Find one quantity in context when the other is known | 0 |
| LE2.4 | Connect a line's equation, graph, table, slope and intercepts | 233 |
| LE2.5 | Relate a second line: parallel, perpendicular or translated | 94 |

### LF Sub-skills

| ID | Name | Count |
|---|---|---|
| LF.1 | Evaluate or invert a given linear rule | 187 |
| LF.2 | Build a linear model from a verbal description | 37 |
| LF.3 | Determine a linear function from points, a table, values, or slope | 128 |
| LF.4 | Interpret slope, intercept, and constants in context | 35 |
| LF.5 | Intercepts and graph features of a linear function | 8 |

**Total sub-skill tags:** 722 (avg 1.22 per question)

## Cluster Distribution (top 15)

| ID | Name | Count |
|---|---|---|
| CL.0128 | write y = mx + b from slope and a point | 239 |
| CL.0024 | compute slope from two points | 201 |
| CL.0047 | isolate the variable | 175 |
| CL.0094 | substitute a value and evaluate | 147 |
| CL.0084 | set a variable to zero to find an intercept or initial value | 107 |
| CL.0080 | rewrite in slope-intercept form | 101 |
| CL.0116 | use the negative-reciprocal slope for a perpendicular line | 82 |
| CL.0160 | read slope and intercept from the equation | 40 |
| CL.0104 | translate words into an equation or inequality | 36 |
| CL.0154 | match a number in the model to its meaning in context | 33 |
| CL.0089 | solve for the constant | 22 |
| CL.0009 | check a point in the equation or inequality | 11 |
| CL.0172 | recognize parallel lines have equal slopes | 10 |
| CL.0095 | substitute an expression | 9 |
| CL.0004 | add the parts to get the whole, or subtract to find a part | 9 |

**Unique clusters used:** 26 of 42 available for LE2/LF
**Total cluster tags:** 1261 (avg 2.12 per question)

## Distractor Cluster Distribution (top 10)

| ID | Name | Count |
|---|---|---|
| CL.0094 | substitute a value and evaluate | 244 |
| CL.0047 | isolate the variable | 209 |
| CL.0128 | write y = mx + b from slope and a point | 189 |
| CL.0024 | compute slope from two points | 183 |
| CL.0116 | use the negative-reciprocal slope for a perpendicular line | 89 |
| CL.0084 | set a variable to zero to find an intercept or initial value | 84 |
| CL.0154 | match a number in the model to its meaning in context | 82 |
| CL.0104 | translate words into an equation or inequality | 66 |
| CL.0160 | read slope and intercept from the equation | 57 |
| CL.0080 | rewrite in slope-intercept form | 27 |

**Unique distractor clusters:** 24
**Total distractor tags:** 1344

## Cross-skill Tagging

1 question tagged with both LE2.x and LF.x sub-skills:

- **SATM2YANYDS**: `[LF.3, LF.1, LF.5, LE2.5]` — LF question that also involves parallel-line relationship (LE2.5)

## Notation Boundary

1 ambiguous case flagged (SATM2YANYDS, same as cross-skill above).

No systematic notation-boundary mis-tagging detected. LE2 questions consistently use y= / slope-intercept notation; LF questions consistently use f(x) / function notation.

## Mis-skill Suspects

None detected. All questions appear correctly assigned to their home skill.

## Taxonomy Gaps

17 of 42 LE2/LF-relevant clusters went unused:

- **CL.0032** (convert units with a conversion factor)
- **CL.0040** (find a common denominator)
- **CL.0055** (match the function input to the given argument)
- **CL.0098** (take a percent of a quantity)
- **CL.0106** (turn a percent change into a multiplier)
- **CL.0150** (interpret a function statement f(a) = b)
- **CL.0156** (match equation parameters to graph features)
- **CL.0161** (read the title, axes, key, and scale before the data)
- **CL.0213–CL.0230** (9 Desmos-specific clusters)

The Desmos clusters (CL.0213–CL.0230) are expected to be unused — these questions are tagged by solving method, not calculator strategy. The remaining unused clusters (CL.0032, CL.0040, CL.0055, CL.0098, CL.0106, CL.0150, CL.0156, CL.0161) represent methods that don't appear as primary steps in this question set.

## Content Observations

1. **LE2 pool is heavily algebraic** (272/300 abstract, 28 contextual) — LE2.1/2/3 require word-problem context which is rare in this set. This is a pool composition characteristic, not a tagging gap.
2. **LE2.4 dominates** at 233/300 — expected given the algebraic focus on connecting equations, graphs, tables, slopes, and intercepts.
3. **LF pool shows broader coverage** across all 5 sub-skills, with LF.1 (evaluate/invert) and LF.3 (determine from points) as the most common.
4. **Grid-in questions** are roughly evenly split (79 LE2, 67 LF) and have empty distractors as expected.
5. **No off-spec patterns** detected — all questions follow standard SAT question structure.

## Validation

- All sub-skill IDs valid against taxonomy: YES
- All cluster IDs valid against taxonomy: YES
- No duplicate question IDs: YES
- All 594 questions have required fields (id, sub_skills, clusters, distractors): YES
- 594 source questions → 594 tagged lines: YES
