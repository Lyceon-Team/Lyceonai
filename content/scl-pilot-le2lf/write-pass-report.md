# LE2 + LF Write Pass Report

**Date:** 2026-11-03
**Taxonomy version:** scl-v1.0.0
**Scope:** 594 questions (300 LE2 + 294 LF) — 448 MCQ + 146 grid-in
**Output:** `tagged-all.ndjson` (594 lines, one per question)

## Counts

| Metric | Count |
|---|---|
| Questions tagged | 594 |
| Sub-skill tags | 722 (1.22 per question) |
| Cluster tags | 1,261 (in `clusters` field; 2.12 per question) |
| Distractor tags | 1,344 |
| Single sub-skill questions | 469 |
| Multi sub-skill questions | 125 |
| Cross-skill tags | 1 |
| Suspected mis-skill | 0 |
| Invalid tag IDs | 0 |
| Unique sub-skills used | 7 of 10 |
| Unique clusters used | 26 of 230 |

## Sub-skill distribution

| ID | Name | Count |
|---|---|---|
| LE2.4 | Connect a line's equation, graph, table, slope and intercepts | 233 |
| LE2.5 | Relate a second line: parallel, perpendicular or translated | 94 |
| LF.1 | Evaluate or invert a given linear rule | 187 |
| LF.2 | Build a linear model from a verbal description | 37 |
| LF.3 | Determine a linear function from points, a table, values, or slope | 128 |
| LF.4 | Interpret slope, intercept, and constants in context | 35 |
| LF.5 | Intercepts and graph features of a linear function | 8 |

## Top clusters (by frequency)

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

(16 more clusters with counts 1-22; see validation script for full list.)

## Cross-skill tags

1 question tagged with sub-skills from both LE2 and LF families:

- **SATM2YANYDS**: `[LE2.5, LF.1, LF.3, LF.5]` — g(x)=f(x+3)-4 shift problem; genuinely tests function determination (LF.3), evaluation (LF.1), graph features (LF.5), and the translation relationship (LE2.5).

## Suspected mis-skill candidates

None. All 300 LE2 questions were correctly homed to LE2 sub-skills, and all 294 LF questions to LF sub-skills (with the single cross-skill exception above).

## Taxonomy coverage gap

**LE2.1, LE2.2, LE2.3 have zero tags.** All 300 LE2 questions are pure algebra — finding equations from points, computing slopes, matching graphs, parallel/perpendicular lines. None have real-world contextual stems (cost, rate, population, etc.), so:

- **LE2.1** (Model a situation with a linear equation) — requires a word-context stem. Zero applicable.
- **LE2.2** (Interpret parts of a contextual linear equation or graph) — requires contextual equation. Zero applicable.
- **LE2.3** (Find one quantity in context when the other is known) — requires context + given value. Zero applicable.

This is a **bank composition gap**, not a tagging error. The LE2 bank exercises only LE2.4 and LE2.5.

## Notation-boundary observations

- LE2 questions use `y = mx + b` notation exclusively (no `f(x)` notation in any LE2 stem).
- LF questions use `f(x)` notation predominantly, with some `g(x)`, `h(x)`.
- The notation split aligns cleanly with CB's skill_code assignment — no ambiguous-notation cases found.

## Off-spec patterns

None detected. All questions fit the taxonomy's inclusion tests without forcing.
