# Video segments by sub-skill and cluster: Phase B (short videos)

**Brief:** "Video segments tagged by sub-skill and cluster", Phase B, approved by Karl on 2026-10-29:

- videos up to 15 minutes, a $30 cap;
- both passes, and the corrected gate judged per skill across the set;
- no split round;
- long videos deferred (closure plan R-20);
- no production writes by CC.

Phase C, the retrieval switch-over, waits for the questions team's Phase 2 tags. Until then the segments are tagged, reviewed and stored, and nothing reads them. The design is in `segments-phase-a.md`.

**Status: tagged; Karl's rulings of 2026-10-29 on the review applied (§5); ready for his spot-check (§5.1).** The gate does not pass for 2 of the 25 judged skills (§3). Rows in those two skills stay held for review, with none pre-marked yes. Every other judged skill passes.

**Rulings on the review (Karl, 2026-10-29):**

1. Inferences and Rhetorical Synthesis stay held: their rows stay `retag`.
2. The rows where only clusters are disputed are marked `yes`, keeping the agreed sub-skills and only the clusters both passes agree on; the disputed clusters are dropped (the same intersection rule). Rows with a disputed sub-skill, rows in a skill below the gate, and `drop` rows are unchanged.
3. The review CSV and the apply SQL are regenerated from the result (§5).
4. Karl spot-checks a 20-row random sample of approved segments, spread across skills (§5.1), not every row.
5. After #1369 merges: `main` into `lisa`, then `lisa` into #1364 and #1370.

## 1. What ran

- **Set:** the 131 approved library videos of 15 minutes or less, 41,671 s in all: 71 math and 60 Reading and Writing.
  - 2 have chapters, so both passes ran in fixed mode on them.
  - For the other 129, pass 1 cut the video and pass 2 tagged pass 1's segments.
- **Method:** `segment-tags-v4`, run as `scripts/rag/segment-videos.ts --pass 1,2 --max-seconds 900 --concurrency 4`.
  - It uses the mapping rule (Phase A ruling 1) and the closed vocabulary `scl-v1.0.0`: 135 sub-skills, 230 clusters.
  - Both passes run per video, back to back. Pass 2 tags pass 1's segments without seeing pass 1's tags, with the vocabulary reversed.
  - **Both passes judge `overview`.** Cut mode now asks it too, so "either pass" holds on chapterless videos. Fixed mode also judges `mixes_topics`.
  - There is no split round: a segment either pass flags as mixed or an overview keeps clusters only (rule 2).
- **Retries:** 5 videos failed the first run, and all 5 re-ran clean:
  - 3 proxy `fetch failed` errors;
  - 1 non-JSON answer;
  - 1 answer that covered 180 s of a 780 s video, which the tiling check refused. Its cache was deleted before the retry so the bad answer could not be reused.

## 2. Spend: $22.85 measured, under the $30 cap

| Item                                                | Amount               |
| --------------------------------------------------- | -------------------- |
| Pass 1, 131 videos                                  | $11.48, plus retries |
| Pass 2, 131 videos                                  | $10.74, plus retries |
| **Measured, both passes (usage recorded per call)** | **$22.85**           |
| Not measured, upper bound                           | about $1.20 (below)  |

The unmeasured spend:

- up to 4 calls in flight when the first run was restarted as `--pass 1,2`: at most $0.60;
- the refused answer whose cache was deleted: about $0.15;
- 3 proxy-failed calls, if Vertex billed them: at most about $0.45.

Notes:

- **Per video:** about $0.17 for both passes, against $0.18 estimated. The Phase A doc estimated $23.9 for this set.
- **Caching:** the implicit cache covered 7% of input across both passes (795,601 of 11,330,775 prompt tokens), against the first pilot's 81%. The estimate doesn't count on it.
- **The cap check never fired.** Each call's estimate was reserved before the call started, so the 4 concurrent calls could not pass the cap between them.

## 3. The gate, per skill

The gate is 70% agreement on sub-skills, judged only for skills with 3 or more tagged segments.

**Gate: not passed. 23 of 25 judged skills pass; Inferences and Rhetorical Synthesis do not.**

| Skill                                                | Tagged segments | Sub-skill agreement | Gate     |
| ---------------------------------------------------- | --------------- | ------------------- | -------- |
| Area and Volume                                      | 4               | 100% (4/4)          | pass     |
| Boundaries                                           | 20              | 80% (20/25)         | pass     |
| Circles                                              | 4               | 100% (5/5)          | pass     |
| Command of Evidence                                  | 22              | 100% (22/22)        | pass     |
| Cross-Text Connections                               | 7               | 100% (7/7)          | pass     |
| Equivalent Expressions                               | 8               | 100% (8/8)          | pass     |
| Evaluating Statistical Claims                        | 7               | 100% (7/7)          | pass     |
| Form, Structure, and Sense                           | 35              | 92% (33/36)         | pass     |
| Inference from Sample Statistics and Margin of Error | 4               | 100% (4/4)          | pass     |
| **Inferences**                                       | 8               | **60% (6/10)**      | **fail** |
| Linear Equations in One Variable                     | 3               | 100% (3/3)          | pass     |
| Linear Functions                                     | 7               | 86% (6/7)           | pass     |
| Linear Inequalities in One or Two Variables          | 5               | 100% (5/5)          | pass     |
| Nonlinear Equations and Systems                      | 17              | 95% (21/22)         | pass     |
| Nonlinear Functions                                  | 20              | 85% (23/27)         | pass     |
| One-Variable Data                                    | 11              | 92% (11/12)         | pass     |
| Percentages                                          | 8               | 88% (7/8)           | pass     |
| Probability and Conditional Probability              | 5               | 80% (4/5)           | pass     |
| **Rhetorical Synthesis**                             | 12              | **67% (8/12)**      | **fail** |
| Systems of Two Linear Equations                      | 11              | 91% (10/11)         | pass     |
| Text Structure and Purpose                           | 16              | 100% (16/16)        | pass     |
| Transitions                                          | 10              | 70% (7/10)          | pass     |
| Two-Variable Data                                    | 8               | 100% (8/8)          | pass     |
| Words in Context                                     | 5               | 100% (5/5)          | pass     |

Reported, not gated (fewer than 3 segments):

- Central Ideas and Details: 67% (2/3), 2 segments;
- Linear Equations in Two Variables: 50% (1/2), 2 segments;
- Lines, Angles, and Triangles: 100% (3/3), 2 segments;
- Right Triangles and Trigonometry: 100% (1/1), 1 segment.

**Where the two failures come from:**

- **Inferences:** in both disputed segments the passes chose different sub-skills within the skill:
  - INF.3 against INF.5 (`9UjGEN1akXU`, 6:09–10:20);
  - INF.3 against INF.4 (`ECkeeyvgiy0`, 0:00–2:33).

  The skill is agreed; the question type inside it is not.

- **Rhetorical Synthesis:** all four disputed segments come from one video, `V5l5-sgkCgE`, a full Reading and Writing walk-through. One pass gave RS.5 and the other did not.

**What the review file does about it:** no row in a skill below the gate is pre-marked yes. The 5 rows that would have been `approve` are `retag`, with the reason "… is below the gate (N% sub-skill agreement); held for review" (`holdFailedSkills`). Karl can still approve them in the file.

## 4. Clusters-only share

- **73 of 332 teaching segments (22%), or 13% of teaching time.** On the survey lesson it was 60% of teaching time (R-20), so short videos are mostly focused.
- **By reason:** overview 57, mixed topics 13, calculator technique (no sub-skill in either pass) 3.
- **Who flagged them:** both passes for 47, one pass for 23. The 3 calculator-technique segments have no flag.
- **The set-aside sub-skills:** had they counted, they would have scored anywhere from 0% to 100% by skill. Examples: Linear Functions 0/2, Two-Variable Data 0/1, Boundaries 14/21; `segment-agreement.ts` prints them all. Rule 2 moved those tags out; it did not resolve them.

## 5. The review file

`docs/plans/lisa-video-library/segments-phase-b-review.csv`: 410 rows, one per segment. These are the totals after rulings 1 and 2; ruling 2 is `approveClusterOnlyDisputes` and runs before the hold, `holdFailedSkills`, so a promoted row in a held skill is held again.

| Proposal                | Rows | Why                                                                                                |
| ----------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| approve (prefilled yes) | 276  | every tag agrees, or only clusters were disputed (ruling 2); 220 with sub-skills, 56 clusters-only |
| retag                   | 56   | see the breakdown below                                                                            |
| drop                    | 78   | neither pass calls it teaching                                                                     |

Before the rulings it was 149 approve, 183 retag and 78 drop. Ruling 2 found 136 rows where only clusters were disputed. 127 were approved; the other 9 are in Inferences or Rhetorical Synthesis and stay held (ruling 1).

Why the 56 retag rows are retag:

| Reason                                    | Rows |
| ----------------------------------------- | ---- |
| a sub-skill is disputed                   | 21   |
| clusters-only, with no shared cluster     | 17   |
| held: skill below the gate                | 14   |
| the passes disagree on whether it teaches | 4    |

- Every row carries the evidence lines for its tags, kept and disputed, in the `evidence` column. The apply SQL is built from the file alone.
- A row approved by ruling 2 keeps its disputed clusters listed in `disputed_clusters` for the record. They are not stored: the apply writes `sub_skills` and `clusters` only.

### 5.1 Karl's spot-check: 20 approved segments

`docs/plans/lisa-video-library/segments-phase-b-sample.csv`, with an empty `ok` column for Karl to fill.

- The sample is drawn from approved rows that carry sub-skills, spread across skills. Skills are taken in turn, one segment each, so the 20 rows cover 20 different skills (`spotCheckSample`).
- The draw is random but reproducible: a seeded generator, seed 20261029.
- Each link opens the video at the segment's start.
- Inferences and Rhetorical Synthesis are not in the sample: nothing in them is approved.

| #   | Skill                                                                         | Video, start                                                             | Sub-skills         | Evidence                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Area and Volume                                                               | [`KQpliPT8ZTs` 3:30](https://www.youtube.com/watch?v=KQpliPT8ZTs&t=210s) | AV.3               | AV.3: The question asks for the volume of a sphere given its radius.                                                                                                                                                                            |
| 2   | Boundaries                                                                    | [`vWOnLq6lNOs` 1:30](https://www.youtube.com/watch?v=vWOnLq6lNOs&t=90s)  | BND.4              | BND.4: The speaker teaches how to use semicolons to separate items in a complex list.                                                                                                                                                           |
| 3   | Central Ideas and Details                                                     | [`NgJhXOfA3rw` 0:48](https://www.youtube.com/watch?v=NgJhXOfA3rw&t=48s)  | CID.1              | CID.1: The question asks for the main idea of the informational text.                                                                                                                                                                           |
| 4   | Command of Evidence                                                           | [`xhDGA2vO_Vs` 0:00](https://www.youtube.com/watch?v=xhDGA2vO_Vs&t=0s)   | COE.3              | COE.3: The question asks which finding would most directly support the student's hypothesis.                                                                                                                                                    |
| 5   | Cross-Text Connections                                                        | [`xruJh5TOl-k` 5:34](https://www.youtube.com/watch?v=xruJh5TOl-k&t=334s) | CTC.4              | CTC.4: The question asks what statement both authors would most likely agree with.                                                                                                                                                              |
| 6   | Equivalent Expressions                                                        | [`6gLSbX3uKCg` 0:00](https://www.youtube.com/watch?v=6gLSbX3uKCg&t=0s)   | EE.2               | EE.2: The segment demonstrates how to expand and multiply a squared binomial, (x + 3)^2.                                                                                                                                                        |
| 7   | Evaluating Statistical Claims: Observational Studies and Experiments          | [`yxedDWHDvzI` 0:00](https://www.youtube.com/watch?v=yxedDWHDvzI&t=0s)   | ESC2               | ESC2: The question asks if a sample of seventh graders during one lunch period represents the whole middle school.                                                                                                                              |
| 8   | Form, Structure, and Sense                                                    | [`lgo1iHUCIUU` 0:50](https://www.youtube.com/watch?v=lgo1iHUCIUU&t=50s)  | FSS.2              | FSS.2: The question asks to choose the correct verb tense 'measures' based on the habit indicator 'regularly'.                                                                                                                                  |
| 9   | Inference from Sample Statistics and Margin of Error                          | [`auBIKG1Uj7c` 4:18](https://www.youtube.com/watch?v=auBIKG1Uj7c&t=258s) | INFS.1             | INFS.1: The question asks for the approximate number of people who cycle to work in a population of 50,000 based on a sample.                                                                                                                   |
| 10  | Linear Functions                                                              | [`QjEZuxPfKaE` 1:33](https://www.youtube.com/watch?v=QjEZuxPfKaE&t=93s)  | LF.1               | LF.1: The question asks for the value of g(x) when x = 8 for a linear function g(x) = 10x + 8.                                                                                                                                                  |
| 11  | Lines, Angles, and Triangles                                                  | [`TtVwM6Doydg` 2:26](https://www.youtube.com/watch?v=TtVwM6Doydg&t=146s) | LAT.2, LAT.4, RTT2 | LAT.2: He calculates the third angle of the right triangle using the 180-degree sum. / LAT.4: He uses the similarity of the triangles to find the measure of angle B. / RTT2: He notes that the triangles are 45-45-90 special right triangles. |
| 12  | Nonlinear Equations in One Variable and Systems of Equations in Two Variables | [`ZYDcmWtfLkk` 0:47](https://www.youtube.com/watch?v=ZYDcmWtfLkk&t=47s)  | NLE.3              | NLE.3: The question asks to solve a rational equation with x in the denominators.                                                                                                                                                               |
| 13  | Nonlinear Functions                                                           | [`TIC6oYtvBGU` 2:25](https://www.youtube.com/watch?v=TIC6oYtvBGU&t=145s) | NLF.4, NLF.5       | NLF.4: The question asks for the value of x where the quadratic function reaches its minimum. / NLF.5: The question involves a translated function g(x) = f(x+5).                                                                               |
| 14  | One-Variable Data: Distributions and Measures of Center and Spread            | [`V9Bpv0qcv7c` 3:05](https://www.youtube.com/watch?v=V9Bpv0qcv7c&t=185s) | OVD.2              | OVD.2: The segment shows how to compute the mean and median of a list of numbers.                                                                                                                                                               |
| 15  | Percentages                                                                   | [`52vWohHiyAQ` 7:42](https://www.youtube.com/watch?v=52vWohHiyAQ&t=462s) | PCT.5              | PCT.5: The segment teaches how to write an expression for a 128% increase followed by a 29% increase.                                                                                                                                           |
| 16  | Probability and Conditional Probability                                       | [`G39Ae3bgoDM` 1:43](https://www.youtube.com/watch?v=G39Ae3bgoDM&t=103s) | PRB.4              | PRB.4: The speaker calculates the probability of rolling a number that is not a multiple of three.                                                                                                                                              |
| 17  | Systems of Two Linear Equations in Two Variables                              | [`szu6vufYqmA` 8:17](https://www.youtube.com/watch?v=szu6vufYqmA&t=497s) | SYS.3              | SYS.3: The question asks for the value of r that makes the system of two linear equations have no solution.                                                                                                                                     |
| 18  | Transitions                                                                   | [`92GaKBgEG7E` 2:13](https://www.youtube.com/watch?v=92GaKBgEG7E&t=133s) | TRN.4              | TRN.4: The segment teaches how to solve a transition question where the correct answer is 'specifically'.                                                                                                                                       |
| 19  | Two-Variable Data: Models and Scatterplots                                    | [`w9vTseYuwpU` 1:23](https://www.youtube.com/watch?v=w9vTseYuwpU&t=83s)  | TVD.1              | TVD.1: The student reads a specific temperature value on Day 9 from a line graph.                                                                                                                                                               |
| 20  | Words in Context                                                              | [`2j1EpSyucyU` 0:00](https://www.youtube.com/watch?v=2j1EpSyucyU&t=0s)   | WIC.4              | WIC.4: The segment works through an SAT question asking for the meaning of 'a singular' in a story by Nathaniel Hawthorne.                                                                                                                      |

## 6. The shopping list: no focused segment

A focused segment is a teaching row that both passes gave the sub-skill to, whether proposed approve or retag. **77 of 135 sub-skills and 28 of 29 skills have one.**

- **The one skill with no focused segment at all:** Ratios, Rates, Proportional Relationships, and Units (math).
- **The 58 sub-skills with none**, by skill:
  - Area and Volume: AV.1, AV.2, AV.5
  - Boundaries: BND.5
  - Central Ideas and Details: CID.2, CID.3, CID.4
  - Circles: CIR3, CIR4, CIR5
  - Command of Evidence: COE.1
  - Cross-Text Connections: CTC.3, CTC.5
  - Equivalent Expressions: EE.1
  - Evaluating Statistical Claims: Observational Studies and Experiments: ESC3
  - Inference from Sample Statistics and Margin of Error: INFS.2, INFS.3
  - Inferences: INF.4, INF.5
  - Linear Equations in One Variable: LE1.2, LE1.3, LE1.4
  - Linear Equations in Two Variables: LE2.1, LE2.2, LE2.3, LE2.5
  - Linear Functions: LF.2, LF.4
  - Linear Inequalities in One or Two Variables: LI.1, LI.2, LI.3, LI.5
  - Lines, Angles, and Triangles: LAT.1, LAT.3, LAT.5
  - Nonlinear Equations in One Variable and Systems of Equations in Two Variables: NLE.1
  - Nonlinear Functions: NLF.2, NLF.3
  - One-Variable Data: Distributions and Measures of Center and Spread: OVD.5
  - Percentages: PCT.1, PCT.2
  - Probability and Conditional Probability: PRB.3
  - Ratios, Rates, Proportional Relationships, and Units: RAT.1, RAT.2, RAT.3, RAT.4, RAT.5
  - Rhetorical Synthesis: RS.4
  - Right Triangles and Trigonometry: RTT1, RTT3, RTT4
  - Systems of Two Linear Equations in Two Variables: SYS.4, SYS.5
  - Transitions: TRN.2, TRN.5
  - Two-Variable Data: Models and Scatterplots: TVD.2, TVD.5
  - Words in Context: WIC.3

Together with the miss log from Phase A ruling 4 (`video_segment_misses`, built in Phase C), this is the list for the next library expansion.

## 7. Deliverables and Karl's steps

1. **Merge #1369** (the genesis snapshot reorder) into `main`. Then merge `main` into `lisa`, and `lisa` into #1364 (ruling A).
2. **Apply the migration** `supabase/migrations/20261124000000_lisa_video_segments.sql` by hand, then confirm it from the catalog:
   ```sql
   SELECT relname, relrowsecurity FROM pg_class
   WHERE relname IN ('video_segments', 'video_segment_sub_skills', 'video_segment_clusters');
   SELECT proname FROM pg_proc WHERE proname IN ('video_segments_set', 'video_segments_approve');
   ```
3. **Check the vocabulary is loaded** (`scl-v1.0.0`, 135 sub-skills):
   ```sql
   SELECT count(*) FROM public.sub_skills WHERE taxonomy_version = 'scl-v1.0.0';
   ```
   If the count isn't 135, run `scripts/scl-taxonomy-loader.ts --apply` first. The apply SQL checks this and refuses to run otherwise.
4. **Spot-check** the 20 rows of `segments-phase-b-sample.csv` (§5.1). If you change anything, change it in `segments-phase-b-review.csv`:
   - set `approve` to `yes`, or leave it blank;
   - edit `sub_skills` or `clusters` where a tag is wrong. An id added in review is stored with the evidence "added in review".
5. **Regenerate the apply SQL from the reviewed file**, or ask CC to:
   ```
   pnpm exec tsx scripts/rag/apply-video-segments.ts --csv docs/plans/lisa-video-library/segments-phase-b-review.csv --out docs/plans/lisa-video-library/segments-phase-b-apply.sql
   ```
   The committed `segments-phase-b-apply.sql` reflects the file after rulings 1 and 2: 129 videos, 309 segments written, 276 approved.
6. **Paste it into the SQL editor**, after replacing `REPLACE-WITH-YOUR-USER-ID` (in one place, near the end) with your user id. Left as it is, the uuid cast fails and the whole transaction rolls back.
7. **Confirm:**
   ```sql
   SELECT count(*), count(approved_by), count(DISTINCT video_id) FROM public.video_segments;
   ```
   For the committed file this returns 309, 276, 129.

**Proven locally**, on Postgres 16 with the full pipeline, the real taxonomy and the 131 videos:

- With the placeholder left in, the transaction fails and writes nothing (0 rows).
- Filled in, it writes 309 segments across 129 videos, 276 approved, with 257 sub-skill tags and 506 cluster tags. (The tags are the same as before the rulings, because the clusters stored were always the agreed ones; ruling 2 changes approvals only.)
- Run a second time, the result is the same 309 and 276: an unchanged segment keeps its approval.

## 8. SCL

SCL-259 (Doc 03D §6.7: segment storage) is in the register. The retrieval entry belongs to Phase C and is written when Phase C is built. It covers Doc 03D §6.4 and §6.8: the Phase A §4 ranking, the taxonomy version match, no video for a tagged question with no matching segment, and the miss log.
