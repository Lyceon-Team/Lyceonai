# Video segments by sub-skill and cluster: Phase B (short videos)

**Brief:** "Video segments tagged by sub-skill and cluster", Phase B, approved by Karl on 2026-10-29:

- videos up to 15 minutes, a $30 cap;
- both passes, and the corrected gate judged per skill across the set;
- no split round;
- long videos deferred (closure plan R-20);
- no production writes by CC.

Phase C, the retrieval switch-over, waits for the questions team's Phase 2 tags. Until then the segments are tagged, reviewed and stored, and nothing reads them. The design is in `segments-phase-a.md`.

**Status: tagged and ready for Karl's review. The gate does not pass for 2 of the 25 judged skills (§3).** Rows in those two skills are held for review, with none pre-marked yes. Every other judged skill passes.

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

`docs/plans/lisa-video-library/segments-phase-b-review.csv`: 410 rows, one per segment.

| Proposal                | Rows | Why                                                                                                                         |
| ----------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------- |
| approve (prefilled yes) | 149  | every tag agrees: 107 with sub-skills, 42 clusters-only (overview, mixed or calculator technique, with the clusters agreed) |
| retag                   | 183  | see the breakdown below                                                                                                     |
| drop                    | 78   | neither pass calls it teaching                                                                                              |

Why the 183 retag rows are retag:

| Reason                                       | Rows |
| -------------------------------------------- | ---- |
| sub-skills agree; only clusters are disputed | 136  |
| a sub-skill is disputed                      | 21   |
| clusters-only, with no shared cluster        | 17   |
| held: skill below the gate                   | 5    |
| the passes disagree on whether it teaches    | 4    |

- Every row carries the evidence lines for its tags, kept and disputed, in the `evidence` column. The apply SQL is built from the file alone.
- **Most retag rows are cheap to approve.** In 136 of them the sub-skills agree; the shared clusters are kept, and only the disputed ones are left out. Retrieval matches sub-skills first.

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
4. **Review** `segments-phase-b-review.csv`:
   - set `approve` to `yes`, or leave it blank;
   - edit `sub_skills` or `clusters` where a tag is wrong. An id added in review is stored with the evidence "added in review".
5. **Regenerate the apply SQL from the reviewed file**, or ask CC to:
   ```
   pnpm exec tsx scripts/rag/apply-video-segments.ts --csv docs/plans/lisa-video-library/segments-phase-b-review.csv --out docs/plans/lisa-video-library/segments-phase-b-apply.sql
   ```
   The committed `segments-phase-b-apply.sql` reflects the file as pre-marked: 129 videos, 309 segments written, 149 approved.
6. **Paste it into the SQL editor**, after replacing `REPLACE-WITH-YOUR-USER-ID` (in one place, near the end) with your user id. Left as it is, the uuid cast fails and the whole transaction rolls back.
7. **Confirm:**
   ```sql
   SELECT count(*), count(approved_by), count(DISTINCT video_id) FROM public.video_segments;
   ```
   For the pre-marked file this returns 309, 149, 129.

**Proven locally**, on Postgres 16 with the full pipeline, the real taxonomy and the 131 videos:

- With the placeholder left in, the transaction fails and writes nothing (0 rows).
- Filled in, it writes 309 segments across 129 videos, 149 approved, with 257 sub-skill tags and 506 cluster tags.
- Run a second time, the result is the same 309 and 149: an unchanged segment keeps its approval.

## 8. SCL

SCL-259 (Doc 03D §6.7: segment storage) is in the register. The retrieval entry belongs to Phase C and is written when Phase C is built. It covers Doc 03D §6.4 and §6.8: the Phase A §4 ranking, the taxonomy version match, no video for a tagged question with no matching segment, and the miss log.
