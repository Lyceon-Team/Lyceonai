# Content gaps, Step 0: the shopping list, ranking, sources and cost

Owner brief "Close the content gaps", Step 0, report only (Karl, 2026-11-04). Nothing here has been
run against production, and nothing is fetched, tagged or approved. **Karl picks the sources.**

Why now: in production on 2026-11-04, "Explanation video" on NLF.4 served Desmos because NLF.4 has
no algebraic segment (`segments-phase-c.md` §7).

No fixed taxonomy counts appear here. The repo figures are a snapshot of the committed review files
at `1a2f71e9` (2026-11-04). Production is the authority, through the owner-run queries in §2.

## 1. The shopping list, from the committed files

Sources:

- the approved segments in `segments-phase-b-review.csv`;
- the approved videos and their `methods` in `video-tags-review.csv`;
- sub-skill names from `content/canonical/subskill-cluster-taxonomy.json`.

A segment's method is its video's `methods`, as retrieval reads it.

At this snapshot, the library holds 150 approved videos. Its 276 approved segments cover 69
sub-skills, and every other sub-skill in the taxonomy file has no approved segment.

- **"Desmos only"** means "Explanation video" serves Desmos, as on NLF.4.
- **"No Desmos"** means the Desmos tap finds nothing (`p_method_required`), and the student sees the miss.

| Section | Skill                                                                         | No approved segment                                                                                                                                                                                                                                                                                                | Desmos only (no algebraic)                                                                                                                                                    | No Desmos                                                                                                                                                          |
| ------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M       | Equivalent Expressions                                                        | EE.1 Add, subtract, and combine like terms; EE.6 Divide polynomials by long division                                                                                                                                                                                                                               | EE.3 Factor polynomials (and rewrite quadratic forms); EE.4 Exponents and radicals; EE.5 Rational expressions                                                                 | EE.2 Expand and multiply                                                                                                                                           |
| M       | Nonlinear Equations in One Variable and Systems of Equations in Two Variables | NLE.1 Rearrange a formula to isolate a variable                                                                                                                                                                                                                                                                    | NLE.4 Determine the number of real solutions; NLE.5 Solve a system of a linear and a nonlinear equation                                                                       | —                                                                                                                                                                  |
| M       | Nonlinear Functions                                                           | NLF.2 Interpret a nonlinear function in context; NLF.3 Exponential growth and decay structure                                                                                                                                                                                                                      | NLF.4 Quadratic and polynomial structure and models; NLF.5 Transformations of functions                                                                                       | —                                                                                                                                                                  |
| M       | Linear Equations in One Variable                                              | LE1.2 Find the value of an expression or an equivalent equation without stopping at the variable; LE1.3 Translate between a context and a linear equation or expression; LE1.4 Solve a context problem for an unknown quantity                                                                                     | LE1.1 Solve a linear equation for its variable                                                                                                                                | —                                                                                                                                                                  |
| M       | Linear Functions                                                              | LF.2 Build a linear model from a verbal description; LF.4 Interpret slope, intercept, and constants in context                                                                                                                                                                                                     | LF.1 Evaluate or invert a given linear rule; LF.3 Determine a linear function from points, a table, values, or slope; LF.5 Intercepts and graph features of a linear function | —                                                                                                                                                                  |
| M       | Linear Equations in Two Variables                                             | LE2.1 Model a situation with a linear equation; LE2.2 Interpret parts of a contextual linear equation or graph; LE2.3 Find one quantity in context when the other is known; LE2.4 Connect a line's equation, graph, table, slope and intercepts; LE2.5 Relate a second line: parallel, perpendicular or translated | —                                                                                                                                                                             | —                                                                                                                                                                  |
| M       | Systems of Two Linear Equations in Two Variables                              | SYS.4 Model a context with a system; SYS.5 Solutions shown on a graph                                                                                                                                                                                                                                              | SYS.1 Solve a system algebraically; SYS.2 Value of an expression from a system; SYS.3 Number of solutions and conditions on constants                                         | —                                                                                                                                                                  |
| M       | Linear Inequalities in One or Two Variables                                   | LI.1 Model a situation with a one-sided inequality or system; LI.2 Solve for a boundary value (maximum / minimum); LI.3 Two-sided ranges (compound inequalities); LI.5 Read an inequality from its graph                                                                                                           | LI.4 Test solutions of a given inequality or system                                                                                                                           | —                                                                                                                                                                  |
| M       | Area and Volume                                                               | AV.1 Polygon perimeter and area; AV.2 Circle area and circumference; AV.5 Similarity and scaling between figures                                                                                                                                                                                                   | —                                                                                                                                                                             | AV.3 Volume of solids; AV.4 Surface area of solids                                                                                                                 |
| M       | Lines, Angles, and Triangles                                                  | LAT.1 Angle relationships at intersecting and parallel lines; LAT.3 Isosceles and equilateral triangles; LAT.5 Similar figures: proportional side lengths                                                                                                                                                          | LAT.2 Triangle angle sum and exterior angles; LAT.4 Congruence and similarity: correspondence, criteria, and angle preservation                                               | —                                                                                                                                                                  |
| M       | Right Triangles and Trigonometry                                              | RTT1 Pythagorean theorem: missing side; RTT3 Right-triangle trig ratios (SOH-CAH-TOA); RTT4 Trig-ratio relationships: complements and similarity                                                                                                                                                                   | RTT2 Special right triangles (45-45-90, 30-60-90)                                                                                                                             | —                                                                                                                                                                  |
| M       | Circles                                                                       | CIR3 Arcs, central angles and circumference; CIR4 Radius-built triangles and tangent segments; CIR5 Radian measure and the unit circle                                                                                                                                                                             | CIR1 Circle equation: center and radius; CIR2 Points and lines relative to a circle in the xy-plane                                                                           | —                                                                                                                                                                  |
| M       | Ratios, Rates, Proportional Relationships, and Units                          | RAT.1 Unit conversion (linear units); RAT.2 Ratios and proportional scaling; RAT.3 Rates between different quantities; RAT.4 Density and per-area/per-volume rates; RAT.5 Converting squared or cubed units                                                                                                        | —                                                                                                                                                                             | —                                                                                                                                                                  |
| M       | Percentages                                                                   | PCT.1 Percent of a quantity; PCT.2 Unknown percent or unknown whole                                                                                                                                                                                                                                                | —                                                                                                                                                                             | PCT.3 Apply or undo a single percent increase or decrease; PCT.4 Percent change between two values; PCT.5 Chained percents (percent of a percent result)           |
| M       | One-Variable Data: Distributions and Measures of Center and Spread            | OVD.5 Compare measures across data sets or after a change                                                                                                                                                                                                                                                          | OVD.2 Find a measure of center from data; OVD.4 Use the mean-total relationship                                                                                               | OVD.1 Read and interpret a data display; OVD.3 Measures of spread: range and standard deviation                                                                    |
| M       | Two-Variable Data: Models and Scatterplots                                    | TVD.2 Predict with a fitted model and compare data to it; TVD.5 Classify linear vs exponential relationships                                                                                                                                                                                                       | —                                                                                                                                                                             | TVD.1 Read data and changes from a graph; TVD.3 Linear model: direction, slope, intercept, equation, interpretation; TVD.4 Nonlinear model fitted to a scatterplot |
| M       | Probability and Conditional Probability                                       | PRB.3 Find a count from a probability or from totals                                                                                                                                                                                                                                                               | —                                                                                                                                                                             | PRB.1 Probability of an event in the whole group; PRB.2 Conditional probability (restricted sample space); PRB.4 Complement and exclusion events                   |
| M       | Inference from Sample Statistics and Margin of Error                          | INFS.2 Interpret an estimate with a margin of error; INFS.3 What the sampling design supports                                                                                                                                                                                                                      | —                                                                                                                                                                             | INFS.1 Estimate a population count from a sample                                                                                                                   |
| M       | Evaluating Statistical Claims: Observational Studies and Experiments          | ESC3 Sampling variability: a sample result is not a certainty                                                                                                                                                                                                                                                      | —                                                                                                                                                                             | ESC1 Scope of generalization: the largest population the results apply to; ESC2 Detect a biased (non-representative) sample                                        |
| RW      | Words in Context                                                              | WIC.3 Inferred-relationship blank                                                                                                                                                                                                                                                                                  | n/a                                                                                                                                                                           | n/a                                                                                                                                                                |
| RW      | Text Structure and Purpose                                                    | —                                                                                                                                                                                                                                                                                                                  | n/a                                                                                                                                                                           | n/a                                                                                                                                                                |
| RW      | Cross-Text Connections                                                        | CTC.3 Predict a supportive or applied response; CTC.5 Describe the difference or relationship between the texts                                                                                                                                                                                                    | n/a                                                                                                                                                                           | n/a                                                                                                                                                                |
| RW      | Rhetorical Synthesis                                                          | RS.1 Compare or contrast two or more items; RS.2 Fit the sentence to a stated audience; RS.3 Report a research study; RS.4 Generalize, define, or give an example; RS.5 Focus on one named feature of one subject                                                                                                  | n/a                                                                                                                                                                           | n/a                                                                                                                                                                |
| RW      | Transitions                                                                   | TRN.2 Cause, result and purpose; TRN.5 Time, sequence and place                                                                                                                                                                                                                                                    | n/a                                                                                                                                                                           | n/a                                                                                                                                                                |
| RW      | Central Ideas and Details                                                     | CID.2 Retrieve an explicitly stated key detail; CID.3 Draw a conclusion the details support but do not state; CID.4 Characterize a person's feelings, traits or attitudes in a literary text                                                                                                                       | n/a                                                                                                                                                                           | n/a                                                                                                                                                                |
| RW      | Command of Evidence                                                           | COE.1 Read data accurately from a table or graph                                                                                                                                                                                                                                                                   | n/a                                                                                                                                                                           | n/a                                                                                                                                                                |
| RW      | Inferences                                                                    | INF.1 Draw a conclusion from a comparison; INF.2 Chain stated premises to a consequence; INF.3 Weigh new evidence against a stated claim; INF.4 Generalize from specific cases; INF.5 Infer a person's view or motive                                                                                              | n/a                                                                                                                                                                           | n/a                                                                                                                                                                |
| RW      | Boundaries                                                                    | BND.5 End-of-sentence punctuation (direct vs indirect question)                                                                                                                                                                                                                                                    | n/a                                                                                                                                                                           | n/a                                                                                                                                                                |
| RW      | Form, Structure, and Sense                                                    | —                                                                                                                                                                                                                                                                                                                  | n/a                                                                                                                                                                           | n/a                                                                                                                                                                |

Notes on the table:

- **Rhetorical Synthesis and Inferences have no segments because Karl held them in Phase B.** Both
  failed the sub-skill agreement gate (`segments-phase-b.md` §3). The videos exist. Closing these
  gaps is a tagging fix, not a sourcing one, and is not proposed here.
- **Two skills have every sub-skill covered:** Text Structure and Purpose, and Form, Structure, and
  Sense.
- **The 19 videos over 15 minutes are not segmented** (closure plan R-20, deferred by ruling).
  Some of the content they hold may fill a row above. They stay deferred.

## 2. Owner-run queries (read-only, production)

Run each one in the SQL editor. Each is one read-only transaction, and none writes. The statements
were checked against the migrated schema on a local database.

### 2.1 The shopping list and the ranking

This query gives, per sub-skill:

- the tagged questions;
- the approved segments, and the videos they come from;
- the segments per method.

```sql
BEGIN READ ONLY;
WITH tagged AS (
  SELECT sub_skill_id, count(DISTINCT question_id) AS tagged_questions
  FROM public.question_sub_skills GROUP BY 1),
seg AS (
  SELECT t.sub_skill_id,
         count(DISTINCT s.segment_id) AS segments,
         count(DISTINCT s.video_id)   AS videos,
         count(DISTINCT s.segment_id) FILTER (WHERE 'desmos'    = ANY (v.methods)) AS desmos_segments,
         count(DISTINCT s.segment_id) FILTER (WHERE 'algebraic' = ANY (v.methods)) AS algebraic_segments,
         count(DISTINCT s.segment_id) FILTER (WHERE 'backsolve' = ANY (v.methods)) AS backsolve_segments
  FROM public.video_segment_sub_skills t
  JOIN public.video_segments  s USING (segment_id)
  JOIN public.video_resources v ON v.video_id = s.video_id
  WHERE s.approved_by IS NOT NULL AND v.approved_by IS NOT NULL AND v.status = 'available'
  GROUP BY 1)
SELECT ss.skill_code, ss.id AS sub_skill_id,
       coalesce(t.tagged_questions, 0)    AS tagged_questions,
       coalesce(seg.segments, 0)          AS segments,
       coalesce(seg.videos, 0)            AS videos,
       coalesce(seg.desmos_segments, 0)   AS desmos,
       coalesce(seg.algebraic_segments, 0) AS algebraic,
       coalesce(seg.backsolve_segments, 0) AS backsolve
FROM public.sub_skills ss
LEFT JOIN tagged t ON t.sub_skill_id = ss.id
LEFT JOIN seg ON seg.sub_skill_id = ss.id
ORDER BY tagged_questions DESC, ss.skill_code, ss.id;
ROLLBACK;
```

Reading the result:

- **A gap** is a row with `segments = 0`, or with `algebraic = 0` or `desmos = 0` on a Math row.
- **The ranking** is the row order: tagged questions, most first. Misses (§2.3) break ties.
- **Untagged sub-skills** have `tagged_questions = 0`, and their skill appears in §2.2.

### 2.2 Skills the questions team has not tagged

These skills are listed apart and not ranked.

```sql
BEGIN READ ONLY;
SELECT ss.skill_code, count(DISTINCT q.question_id) AS tagged_questions
FROM public.sub_skills ss
LEFT JOIN public.question_sub_skills q ON q.sub_skill_id = ss.id
GROUP BY 1
ORDER BY 2, 1;
ROLLBACK;
```

A skill with `tagged_questions = 0` cannot be measured. It goes in the unranked list (§3.2).

### 2.3 Misses from the retrieval log

A miss is the BFF's INFO line with `event: "video_segment_miss"`
(`server/services/tutor-video-library.ts`). It means a tagged question had no approved matching
segment and got no video. The line carries:

- `data.subSkillIds`;
- `data.method`;
- `data.methodRequired` (true on the Desmos tap).

It carries ids and flags only.

1. Export the BFF's runtime logs for the window since the 2026-11-04 deploy as JSON lines, filtered
   on `video_segment_miss`. This is Vercel's log export for the BFF, or Cloud Logging if its stdout
   is routed there.
2. Tally them with:

```bash
jq -r 'select(.event=="video_segment_miss")
       | .data as $d | ($d.subSkillIds // [])[]
       | [., ($d.method // "none"), ($d.methodRequired|tostring)] | @tsv' misses.jsonl \
  | sort | uniq -c | sort -rn
```

Each line is `count  sub_skill  method  method_required`.

- A row with `method_required = true` is a Desmos tap that found nothing.
- Otherwise the row is an "Explanation video" that found nothing.

## 3. Ranking

### 3.1 Measurable from the repo

The only question tags committed to the repo are the EE pilot's (`content/scl-pilot-ee/ee-reconcile.sql`).
Production tags NLF too, as the 2026-11-04 NLF.4 report shows, but how many is not in the repo. So
this is a partial ranking. §2.1 gives the full one.

| Rank | Sub-skill                                             | Tagged questions (EE pilot file) | Gap                                       |
| ---- | ----------------------------------------------------- | -------------------------------- | ----------------------------------------- |
| 1    | EE.3 Factor polynomials (and rewrite quadratic forms) | 161                              | Desmos only: no algebraic segment         |
| 2    | EE.5 Rational expressions                             | 156                              | Desmos only                               |
| 3    | EE.2 Expand and multiply                              | 105                              | no Desmos segment (the Desmos tap misses) |
| 4    | EE.1 Add, subtract, and combine like terms            | 88                               | no approved segment                       |
| 5    | EE.4 Exponents and radicals                           | 56                               | Desmos only                               |
| 6    | EE.6 Divide polynomials by long division              | 12                               | no approved segment                       |
| —    | NLF.4 Quadratic and polynomial structure and models   | in production; count from §2.1   | Desmos only (observed 2026-11-04)         |

Notes:

- **Misses:** none can be measured from here. §2.3 reorders ties.
- **The counts are approximate.** The pilot file's counts are tag rows at the time it was written.
  Production may differ, for example after the 15 cube-factoring retirements, whose rows stay
  tagged but are no longer served.

### 3.2 Not ranked: no question tags visible here

These are every skill except Equivalent Expressions and Nonlinear Functions. Their gaps are in
§1's table, and §2.2 says which of them production has tagged. These have no approved segment at
all:

- **Linear Equations in Two Variables:** every sub-skill.
- **Ratios, Rates, Proportional Relationships, and Units:** every sub-skill.
- **Rhetorical Synthesis and Inferences:** held in Phase B (§1).

## 4. Proposed sources (for Karl to pick)

All proposals are in `gaps-2026-11-04-proposal.csv`, one line per video. Each line has a `group`,
a `proposal` (propose, flag or reject), a `target_gap` where the title points to one (a guess until the skill pass runs), and a note.

They were measured on 2026-11-04 through the YouTube Data API: `search.list` per top gap, then
`playlistItems.list` and `videos.list` on two channels. That used 624 quota units and no Vertex
calls.

Every row passes the same filters:

- published since 2023-03-01 (the Digital SAT);
- "SAT" or "DSAT" in the title, and not PSAT or ACT;
- 1 to 15 minutes long;
- embeddable and public;
- not already in the library.

| Group | Source                                              | Videos                             | Seconds          | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----- | --------------------------------------------------- | ---------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | **Brain Buffs Tutoring**, "SAT Math:" series (2025) | 37                                 | 11,065           | One short lesson per College Board topic, 2.6–9.9 min, worked by hand. It hits most top gaps directly: "Factoring Quadratic and Polynomial Expressions" (EE.3), "Operations with Rational Expressions" (EE.5), "Radicals and Rational Exponents" (EE.4), "Operations with polynomials" (EE.1, EE.6), "Quadratic Graphs" and "Solving Quadratic Equations" (NLF.4), "Exponential Graphs" (NLF.3), plus ratios, unit conversion, linear word problems, inequalities and percentages. **A new channel: judge teaching quality** (tier 5, strict, as with Dr. TestPrep). |
| A-RW  | Brain Buffs Tutoring, "SAT Reading:" series (2024)  | 12                                 | 3,738            | The same format for Central Ideas, Command of Evidence, Cross-Text, Words in Context, Transitions, Inferences and Rhetorical Synthesis. Optional: RW's gaps are thinner, and RS and INF are a tagging hold.                                                                                                                                                                                                                                                                                                                                                          |
| B     | **Tutorllini Test Prep**, "DSAT Math Flashcards"    | 31                                 | 4,485            | An existing source (its Desmos course is in the library), so already vetted. One topic per card, 1–3 min, which is the cleanest shape to tag. Covers EE.3 by hand (AC method, grouping, a = 1, GCF, difference of squares, completing the square), EE.4 (exponents and radicals), EE.5 (vertical asymptotes), percent multipliers and geometry facts.                                                                                                                                                                                                                |
| C     | Singles, from the per-gap searches                  | 7 proposed, 16 flagged, 9 rejected | 3,072 (proposed) | Proposed: `mJlPNOswHN4` and `yNgvhz7fQh4` (EE.6, polynomial division); `wkLGsN6zeK8`, `P6fkZwGTAhA` (Penguin, an existing source) and `8A56N7Aw-nQ` (NLF.4, algebraic); `Fkr0CyTuKaA` (EE.5); `fW7dfJ7_PkE` (EE.4). Flagged: single worked questions, and small channels with few views. Rejected: Desmos videos for algebraic gaps, off-topic results, and a YouTube Short.                                                                                                                                                                                         |

Notes:

- **Recommended: A and B, plus C's seven.** That is 75 videos and 18,622 s. Each top gap gets at least
  two algebraic candidates, from two channels.
- **EE.1 is the thinnest.** Searches return mostly single worked questions, so its best candidate
  is Brain Buffs' "Operations with polynomials".
- **NLF.2 and NLF.3 are covered only by Brain Buffs' exponential lessons.** Nothing else turned up.
- **What still decides fit:** the skill and method passes. A video whose methods come back Desmos
  doesn't close an algebraic gap, and is reported as such.

## 5. Cost

Each stage below uses a rate measured on this library, and the sizing is per video and per second.

| Stage                                | Rate                                                             | Measured on                                                                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metadata (`fetch-video-metadata.ts`) | $0. YouTube quota only: 1 unit per 50 videos, and 100 per search | —                                                                                                                                                                                                         |
| Skill tagging                        | $0.0070 per video                                                | Expansion 2026-10-27: $0.467 for 67 videos (README "Expansion")                                                                                                                                           |
| Method and format tagging            | $0.027 per video                                                 | Same run: $1.759 for 66 rows. 18 needed the video watched, so cost tracks how many come back unclear from text                                                                                            |
| Segment tagging, both passes         | $0.06 per video + $0.36 per 1,000 s                              | Phase B: $22.85 measured for 131 videos, 41,671 s. The $0.06 is the vocabulary sent on two calls; the $0.36 is the rest of Phase B's spend over its seconds. The flat Phase B average was $0.17 per video |

Notes:

- **The fixed part of segment tagging is the vocabulary.** The sub-skill and cluster list is sent
  on every call: about $0.0285 per pass at today's size (`segments-phase-a.md` §6). It grows as the
  taxonomy grows, so the $0.06 does too.
- **Short videos cost more per second.** The fixed part dominates there, so the Tutorllini cards
  cost proportionally more than their length.

For a set of N videos and S seconds:

**cost ≈ N × $0.094 + S × $0.36 / 1,000, plus 10% for retries.**

| Choice                     | Videos | Seconds | Estimate | With 10%   |
| -------------------------- | ------ | ------- | -------- | ---------- |
| A (Brain Buffs Math)       | 37     | 11,065  | $7.45    | $8.20      |
| A-RW (Brain Buffs Reading) | 12     | 3,738   | $2.47    | $2.72      |
| B (Tutorllini flashcards)  | 31     | 4,485   | $4.52    | $4.97      |
| C (seven singles)          | 7      | 3,072   | $1.76    | $1.94      |
| **Recommended: A + B + C** | 75     | 18,622  | $13.73   | **$15.10** |
| **Everything proposed**    | 87     | 22,360  | $16.20   | $17.82     |

Each row covers all four stages. Videos dropped at the skill or method pass skip segment tagging,
so the estimate is an upper bound for the set Karl picks.

## 6. What happens after Karl picks

These are not started. The steps follow the expansion precedent (README "Expansion"):

1. Add the chosen sources to `sources.json`.
2. Run the metadata, skill and method passes on the new rows only, and append them to
   `video-tags-review.csv` for review.
3. Run the Phase B segment tooling on the approved new videos, both passes, and append its rows to
   the segment review CSV.
4. Karl approves the segments.
5. Rerun §2.1 to show each closed gap.
