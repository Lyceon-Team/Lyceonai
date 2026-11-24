# Verification report: apply-video-segment-tags-2026-11-22.sql

Independent verifier, 2026-11-22. Production access was read-only (project hncolwkccbbjkfithhlo, SELECT only). The file was never executed. Production state comes from full SELECT snapshots of `video_segments` (470), `video_resources` (305), `video_segment_sub_skills` (411), `video_segment_clusters` (887), `sub_skills` (181) and `clusters` (282), all taken on 2026-11-22.

**Verdict: safe to run after the 4 sub-skill rows in `verifier-exclude.json` are removed.** No syntax, constraint or id problems were found.

## 1. SQL validity

| Check | Method | Result |
|---|---|---|
| Parses as PostgreSQL | `pglast.parse_sql` (libpg_query, the real Postgres parser) | 13 statements: BEGIN, 3 DO, 7 INSERT, 1 SELECT, COMMIT |
| DO block bodies | `pglast.parse_plpgsql` on each body, plus each guard expression parsed on its own | all 3 parse |
| Quotes / dollar-quotes / parens | custom tokenizer (handles `''` escapes, `$$`, `--` comments) | 0 unterminated, final paren depth 0, no trailing text |
| Values per row | pglast `valuesLists` | 590 + 645 = 1,235 rows; every row has exactly 4 values |
| uuid casts | regex over every row | 1,235 of 1,235 have `'<lowercase uuid>'::uuid`; 0 malformed |
| Evidence length (CHECK 1–300) | computed after unescaping | min 18, max 222; 0 violations |
| taxonomy_version | every row | all `scl-v1.0.0`, which matches every existing tag and sub-skill row in production |
| Duplicate (segment, id) pairs in the file | count | 0 |
| ON CONFLICT targets | compared with `pg_constraint` | `(segment_id,sub_skill_id)` and `(segment_id,cluster_id)` match the two primary keys |
| Guards point at the right tables | inspection | segment guard checks `public.video_segments.segment_id::text`; sub-skill guard checks `public.sub_skills.id`; cluster guard checks `public.clusters.id`. Each raises an exception, so the transaction aborts |
| Guard arrays cover the file | set comparison | 466 segments, 140 sub-skills and 189 clusters, each exactly equal to the set of ids used in the INSERT rows |
| CSV matches SQL | set comparison of (table, segment, id) | 1,235 = 1,235, no differences either way (sources: 1,124 agreed, 111 adjudicated) |
| Triggers on the target tables | `pg_trigger` | none |
| Earlier excludes (`exclude.json`) | grep | efc3350e BND.4 and CL.0108 are absent; only CL.0129 remains for that segment |

## 2. Id existence (production)

All checked in one batched SELECT:

| Kind | Distinct ids in file | Missing in production |
|---|---|---|
| segment_id in `video_segments` | 466 | 0 |
| sub_skill_id in `sub_skills` | 140 | 0 |
| cluster_id in `clusters` | 189 | 0 |

The foreign keys from both tag tables to these tables will also hold.

## 3. New vs already present

| Domain | Sub-skill rows already present | Sub-skill rows new | Cluster rows already present | Cluster rows new |
|---|---|---|---|---|
| advanced-math | 90 | 32 | 144 | 11 |
| algebra | 67 | 32 | 94 | 25 |
| craft-structure | 27 | 1 | 13 | 3 |
| expression-ideas | 20 | 1 | 13 | 3 |
| geometry | 42 | 35 | 70 | 15 |
| information-ideas | 25 | 1 | 9 | 3 |
| psda | 55 | 75 | 70 | 71 |
| standard-english | 52 | 35 | 88 | 13 |
| **Total** | **378** | **212** | **501** | **144** |

- Of the 1,235 rows, 879 are already in production; ON CONFLICT will skip them.
- 356 rows are new: 212 sub-skill and 144 cluster.
- After the 4 exclusions: 208 new sub-skill rows and 144 new cluster rows.
- The 212 new sub-skill rows land on 172 segments. 70 of those segments already have at least one sub-skill in production (74 of the new rows); the other 102 segments currently have none.

## 4. Contradictions with production evidence

Method: I listed every segment that gets a new sub-skill and already has production sub-skills (70 segments, 74 new rows). For each, I read the production sub-skill evidence and cluster evidence next to the new tag's definition and inclusion test. I also scanned all 144 new cluster rows against their segment's sub-skills and clusters.

**4 conflicts found (all sub-skills; exclude them):**

| segment_id | kind | id | Reason |
|---|---|---|---|
| 5032e71f-7644-4d79-b40d-bb06daacb39c | sub_skill | NLF.5 | Production LE2.5 says "translate the linear equation 5x - 9y = 18". The new tag is the nonlinear-function transformation sub-skill; LE2.5 already covers a translated line. |
| 4d459d27-3bae-4245-b6a1-b53111224351 | sub_skill | NLF.1 | Production LF.1 says f(x) = x + 7 and g(x) = 7x "are linear functions". NLF.1 is defined for a nonlinear function. |
| 680f0374-9487-4e93-a0a9-582b5e4facdf | sub_skill | AV.3 | Production CL.0182 "cubes the linear scale factor of 3 to get 27" and CL.0004 "adds the ratio parts 27 and 1". AV.3's inclusion test excludes "a volume that is only given and scaled by k^3 without evaluating a formula". |
| 0bf1df9f-94c2-444f-a3e7-849a283a4468 | sub_skill | PCT.3 | PCT.3 is "single percent increase or decrease". Production PCT.5 and CL.0061 show two chained changes (0.75 x 1.08), already covered by PCT.5, PCT.12 and PCT.9. Low severity: the phrase "25% off" does literally match PCT.3's inclusion wording. |

**Checked and not flagged** (compatible, or not clearly in conflict):
- 62bed0cb NLF.4 next to production NLF.1. The quadratic is given as an equation and graphed in Desmos. NLF.4 only excludes a graph that is read directly in the stem.
- 1e7214dc NLF.1 next to NLF.4 (fitting a quadratic to a table): within NLF.1's "table whose points must match the function" clause.
- 35775f1e FSS.3 next to BND.1, and 10295430 / 6dcb74ef / 87866eeb EE.3 next to NLF.4.
- e67c5321 LE2.5, fed6fefe LF.3, c78d7f32 LF.2, and the TVD.12, OVD.13 and OVD.10 rows.
- New cluster CL.0129 on efc3350e and on d73abf51 (production BND.3, no punctuation). The cluster is the clause-check method that reaches "no punctuation", so it does not assert a mark. CL.0065's definition explicitly includes "no comma between just two coordinated items".
- 161174f4 CTC.5 next to production CTC.2 is **unclear**, not a conflict. Both sub-skills are defined by the question stem (a "relate" stem vs a "respond" stem), and neither the summary nor the production evidence quotes the stem. Karl can check it against the College Board items e5f76480/e4e2aeb3 named in the title.

No new cluster has an obvious conflict.

Observation, not a defect: several PSDA ids form parallel pairs (ESC1/ESC.1, ESC2/ESC.2, PRB.2/PRB.6, PRB.1/PRB.5, OVD.2/OVD.7/OVD.8, PCT.3/PCT.7/PCT.9, INFS.1/INFS.5, TVD.1/TVD.6, TVD.3/TVD.13). The file co-tags both members of a pair, which is consistent with the rule that every id is live. Separately, the inclusion tests of INFS.4 and INFS.5 refer to "INFS.1" and "INFS.2" in their own text. That is a taxonomy wording inconsistency, outside this file's scope.

## 5. Spot-check: 40 new sub-skill tags

The sample was stratified across all 8 domains (random seed 20261122): craft-structure 1, expression-ideas 1, information-ideas 1, advanced-math 7, algebra 7, geometry 8, psda 8, standard-english 7. Each tag was judged against the segment summary, the video title, and the sub-skill's definition and inclusion test.

**Result: 37 correct, 0 wrong, 3 unclear.**

| # | Domain | Segment | Sub-skill | Verdict | Reason |
|---|---|---|---|---|---|
| 1 | craft-structure | 161174f4 | CTC.5 | unclear | Stem-type sub-skill; the stem is not shown (production has CTC.2). See section 4. |
| 2 | expression-ideas | b30a638d | BND.1 | correct | Overview of coordinating conjunctions and conjunctive adverbs joining clauses. |
| 3 | information-ideas | 019f2a40 | INF.4 | unclear | Evidence cites the inclusion test's example ("the pricing model") rather than showing that the keyed answer generalizes. INF.5 and INF.3 not ruled out. |
| 4 | advanced-math | 219fabd0 | NLF.4 | correct | Finding a parabola's vertex. |
| 5 | advanced-math | ab0fd8ce | NLF.1 | correct | y-intercepts of rational functions from their equations. |
| 6 | advanced-math | 6dcb74ef | EE.3 | correct | "Which polynomial has a factor" is named in EE.3's inclusion test. |
| 7 | advanced-math | c512bb68 | NLE.3 | correct | Radical, rational and absolute-value equations. |
| 8 | advanced-math | 0bf748b9 | EE.4 | correct | Radicals and rational exponents. |
| 9 | advanced-math | 4be8dcca | NLF.4 | correct | Conversion between vertex and factored forms. |
| 10 | advanced-math | 73231aea | NLE.4 | correct | Number of intersection points of linear and quadratic systems. |
| 11 | algebra | fed6fefe | LF.3 | correct | Slope from two coordinate pairs. |
| 12 | algebra | cd0884b2 | LE2.4 | correct | Point-slope form, equation and graph. |
| 13 | algebra | 98f9b7ee | OVD.2 | correct | Mean and median of a list. |
| 14 | algebra | 62feeae9 | LE2.5 | correct | Vertical translations of a linear function. |
| 15 | algebra | c8bb357c | SYS.4 | correct | Setting up linear-system word problems. |
| 16 | algebra | 9118617f | LF.5 | correct | Graph of y = f(x) + k. |
| 17 | algebra | 90c7a963 | TVD.12 | correct | Counting points above the line of best fit. |
| 18 | geometry | d7ec5bc8 | AV.3 | correct | Cone volume formula. |
| 19 | geometry | fa1f6009 | LAT.5 | correct | Similar triangles and proportional sides. |
| 20 | geometry | 9f3da565 | AV.1 | correct | Works back from the perimeter to a side length. |
| 21 | geometry | f6302953 | RTT3 | correct | Trig ratios as side ratios (production CL.0126 supports this). |
| 22 | geometry | e986030d | RTT2 | correct | 45-45-90 and 30-60-90 triangles. |
| 23 | geometry | 55a05af5 | CIR5 | correct | Degree and radian conversion. |
| 24 | geometry | 5acb7417 | RTT1 | correct | Pythagorean theorem. |
| 25 | geometry | 38c512d7 | RTT4 | correct | Similar triangles share trig ratios, named in RTT4's inclusion test. |
| 26 | psda | 9c6a0db7 | OVD.8 | correct | Median from a histogram. |
| 27 | psda | ba7e9bbf | OVD.8 | correct | Median of a list. |
| 28 | psda | 999bf71c | PRB.5 | correct | Whole-group probability with coins and dice. |
| 29 | psda | a3c5bfbe | INFS.5 | correct | Scaling a sample ratio to a population, no margin of error. |
| 30 | psda | 6502ce52 | PRB.6 | correct | Denominator restricted to a row. |
| 31 | psda | 69b27c5e | PCT.5 | correct | Chained percent changes, so later bases are linked. |
| 32 | psda | e5adf9fc | PCT.15 | correct | Percentages computed from a two-way table. |
| 33 | psda | b565aa8c | ESC.2 | correct | Choosing an unbiased sampling method (production ESC2 agrees). |
| 34 | standard-english | 5e510f46 | FSS.2 | unclear | FSS.2's inclusion test requires all options to be finite. This segment is about mixed finite/nonfinite plus tense questions; it is acceptable at lesson level. |
| 35 | standard-english | a1485312 | BND.1 | correct | Hard punctuation between independent clauses. |
| 36 | standard-english | 60756d61 | BND.4 | correct | A colon resolves the comma splice. |
| 37 | standard-english | 0c4b1991 | FSS.4 | correct | Apostrophes on possessive nouns. |
| 38 | standard-english | d679e84e | BND.1 | correct | Semicolon and period join independent clauses. |
| 39 | standard-english | 5e510f46 | FSS.3 | correct | Finite vs nonfinite. |
| 40 | standard-english | 89108504 | BND.4 | correct | A colon must follow an independent clause. |

There are no spot-check "wrong" tags, so `verifier-exclude.json` contains only the 4 contradictions from section 4.

## 6. Coverage after apply

| | Before | After (file as-is, or with the 4 exclusions) |
|---|---|---|
| Segments with at least 1 sub-skill | 361 / 470 | 463 / 470 (+102) |
| Segments with at least 1 cluster | 466 / 470 | 469 / 470 (+3) |

The 102 segments gaining their first sub-skill: geometry 25, standard-english 23, advanced-math 22, algebra 21, psda 9, expression-ideas 1, information-ideas 1. The 4 excluded rows are all on segments that already have production sub-skills, so coverage is the same either way.

**Segments still without any sub-skill (7).** All 7 match the generator's `untagged.csv`, and its reasons hold.

| segment_id | Video | Summary | Clusters |
|---|---|---|---|
| 1c277158-3986-4d96-a202-0fdfe8c451d5 | 1-2-3: The Most Frequent Pattern on SAT Inference Questions | The 1-2-3 pattern on a philosophy question about Stoicism and happiness | CL.0190 |
| 925eb974-3b8d-451b-8e5a-72bb0ed9165e | SAT Math: Data Representations | Qualitative graph-matching (motion of a spring) | CL.0161 |
| 9d4657c4-bc55-4de7-bdea-d003d5ed5b79 | Formula 25 - Sum of Angles | Interior-angle sum of an n-sided polygon | CL.0094 |
| a3f15554-464a-4a13-a90b-be55c6ac8baa | Formula 4 - Midpoint Formula | Midpoint formula | CL.0115 |
| b9243e41-7fc4-4f98-b4f8-460aa5b737d2 | Formula 5 - Distance Formula | Distance formula | CL.0094, CL.0113 |
| bb99ed9a-7ff0-4ea5-b2cc-49053fcc0f3a | 5 Tips ... SAT Writing & Language: May 2022 | Transition/relevance question, linked back to the "Rosa Parks" comparison | CL.0141 |
| e7e17cb5-3871-4ac6-a80c-6281867a1799 | 5 Tips ... SAT Writing & Language: May 2022 | Add/delete-sentence question judged on historical significance | CL.0010 |

**Segment still without any cluster (1):** 73cabb90-3e7c-4216-9ae4-3fdaa8fa768b, "Standard Form of a Line | DSAT Math Flashcards". Summary: examples of the standard-form slope formula. It has LE2.4 in production. A slope cluster such as CL.0160 would fit, but the file adds none.

## Headline numbers

- The file is valid: 1,235 rows, 0 syntax, quoting, cast or evidence-length errors, and 0 missing ids (466 segments, 140 sub-skills, 189 clusters).
- 879 rows already exist and will be skipped; 356 are new (212 sub-skill, 144 cluster).
- 4 contradictions, all sub-skills: 5032e71f NLF.5, 4d459d27 NLF.1, 680f0374 AV.3, 0bf1df9f PCT.3. With them removed, 208 sub-skill and 144 cluster rows are new.
- Spot-check of 40: 37 correct, 0 wrong, 3 unclear.
- Coverage: segments with a sub-skill go from 361 to 463 of 470 (7 left without one). Segments with a cluster go from 466 to 469 (1 left without one).
