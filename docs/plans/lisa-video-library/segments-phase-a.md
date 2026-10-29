# Video segments by sub-skill and cluster: Phase A (design and pilot)

**Brief:** "Video segments tagged by sub-skill and cluster", Karl, 2026-10-29. Lane: video. This PR is Phase A only: design, a three-video pilot, no production writes.

**Status: STOPPED again, after the re-pilot.** Karl ruled on Q1–Q6 on 2026-10-29 (§9). The re-pilot applied rulings 1 and 5 to the same three videos, for $1.40 of the $1.50 cap (§8.2). The two short videos agree 100%, but the 35-minute survey lesson still has skills below 70%. Per ruling 1, a `teaching_test` field now goes to the questions team, who own the taxonomy (§11). Phase B does not start.

## 1. Why the FOIL clip was served

Today every video entry point ends in `video_resources_for_skills(skills, limit, method)` (`server/services/tutor-video-library.ts` `retrieveOfferedVideos`). Both of these call it:

- Step 13d;
- the guided-choice taps, through `pickIntentVideo` in `server/services/tutor-guided-choices.ts`.

The ranking order is:

1. the requested method;
2. format (`formula` first);
3. the shortest video;
4. `video_id`.

"Explanation video" asks for `algebraic`. On any Equivalent Expressions question, Formula 30 – FOILing (`qQzeFyLYt1A`: algebraic, a formula, 48 s) wins every time, whatever the question needs. Skill is the finest key retrieval has.

## 2. Storage design

Three tables follow the pattern the question tag tables already use (`question_sub_skills`, `question_clusters`; SCL-256, `supabase/migrations/20261117000000_scl_consolidated.sql` on `main`). Tags are foreign keys to `sub_skills(id)` and `clusters(id)`: no second vocabulary and no second validation.

```sql
CREATE TABLE public.video_segments (
  segment_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id          text NOT NULL REFERENCES public.video_resources(video_id) ON DELETE CASCADE,
  start_seconds     integer NOT NULL CHECK (start_seconds >= 0),
  end_seconds       integer NOT NULL,
  summary           text NOT NULL,                     -- our own words; never instructor text
  taxonomy_version  text NOT NULL,                     -- the version the tags were made against
  tagged_by         text NOT NULL,                     -- 'segment-tags-v2 gemini-3.5-flash 2-pass'
  tagged_at         timestamptz NOT NULL,
  approved_by       uuid,
  approved_at       timestamptz,
  CHECK (end_seconds > start_seconds),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  UNIQUE (video_id, start_seconds)
);

CREATE TABLE public.video_segment_sub_skills (
  segment_id        uuid NOT NULL REFERENCES public.video_segments(segment_id) ON DELETE CASCADE,
  sub_skill_id      text NOT NULL REFERENCES public.sub_skills(id),
  evidence          text NOT NULL,                     -- one line, our own words
  taxonomy_version  text NOT NULL,
  tagged_by         text NOT NULL,
  tagged_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (segment_id, sub_skill_id)
);

CREATE TABLE public.video_segment_clusters (       -- the same shape, with cluster_id
  segment_id        uuid NOT NULL REFERENCES public.video_segments(segment_id) ON DELETE CASCADE,
  cluster_id        text NOT NULL REFERENCES public.clusters(id),
  evidence          text NOT NULL,
  taxonomy_version  text NOT NULL,
  tagged_by         text NOT NULL,
  tagged_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (segment_id, cluster_id)
);
```

**The miss record (ruling 4).** When a tagged question finds no matching segment, the miss is recorded with ids only. Those records become the shopping list for the next library expansion.

```sql
CREATE TABLE public.video_segment_misses (
  sub_skill_id      text NOT NULL REFERENCES public.sub_skills(id),
  question_id       uuid NOT NULL,                     -- the question row; no student, conversation or turn id
  taxonomy_version  text NOT NULL,
  miss_count        integer NOT NULL DEFAULT 1 CHECK (miss_count > 0),
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sub_skill_id, question_id, taxonomy_version)
);
```

- One row per question sub-skill with no segment, upserted (`miss_count + 1`, `last_seen_at`) by `video_segment_miss_record(question_id, sub_skill_ids, version)`.
- `retrieveOfferedVideos` calls it after an empty tagged result. Retrieval itself stays a read.
- It fails open, like retrieval: a write error is logged with codes only and never blocks the turn.
- It is not student data: it carries no student, conversation or turn id, and no text. So there is no Doc 03 §14.2 row. The count is a shopping-list signal, not a metric, and nothing student-facing reads it.

**Rules:**

- **Several tags, no primary.** Neither tag table has a rank column.
- **`end_seconds <= duration_seconds`.** `duration_seconds` lives in `video_resources`, so a `CHECK` can't see it. The write function enforces it.
- **Writes go through two functions, like the library's.**
  - `video_segment_tag(video_id, start, end, summary, version, tagged_by, sub_skills jsonb, clusters jsonb)` replaces a segment's tags. If the times, the sub-skill set or the cluster set change, it clears the segment's approval, as `video_resource_tag` does for a video's skills, methods and format.
  - `video_segments_approve(segment_ids, approver)` approves.
  - The apply script runs both from the reviewed CSV in one transaction.
- **`method_in`.** A cluster's `method_in` skill is never written as a tag on a segment of that skill. The tagger moves it aside; see §3. Absence is never read as "not used" (§4).
- **Grants.** RLS on with no policies, `service_role` only, like `sub_skills` and `clusters`. Retrieval runs as the service role, as today.
- **Retention and deletion.** This is library content, not student data, so there is no Doc 03 §14.2 row (`video_resources` has none either).
  - Deleting a video cascades its segments, and a segment's tags cascade from it.
  - The taxonomy foreign keys are `RESTRICT` (the default). The loader deletes a sub-skill or cluster that has left the canonical file, so a delete of one still in use fails loudly instead of orphaning tags. This matches `question_sub_skills`.
  - An `unavailable` video stays stored and is excluded at retrieval, as today.

## 3. Segmentation and tagging (built: `scripts/rag/segment-videos.ts`, `scripts/rag/segment-agreement.ts`)

As amended by Karl's rulings of 2026-10-29: 1 is the mapping rule, 2 is clusters only for calculator technique, and 5 is fixed boundaries with tag-only agreement. The output is `segment-tags-v2`. The v1 pilot's files are kept under `scripts/rag/.cache/segments/segment-tags-v1/` (gitignored).

- **One pass:**
  - Gemini (`gemini-3.5-flash`, temperature 0, response schema, Zod-parsed) watches the video.
  - Over 15 minutes, it watches clips of at most 10 minutes, each cached on its own.
- **Boundaries (ruling 5):**
  - **A video with YouTube chapters:** the chapters are the segments in both passes. `chapterClips` packs whole chapters into clips of at most 10 minutes and breaks only at chapter starts, so a clip edge never cuts a chapter. A chapter longer than 10 minutes is split at 10-minute marks. A chapter list that doesn't tile the video falls back to pass 1's cuts.
  - **A video without chapters:** pass 1 cuts it at topic changes ("cut" mode). Pass 2 reads pass 1's cuts from its output file (`clipsFromPass1`).
  - **Pass 2 always tags given segments** ("fixed" mode). It sees their times only, never pass 1's tags or summaries. A cached answer is reused only for the same spans.
  - **Boundary check, separately:** in fixed mode each segment carries `mixes_topics` and a one-line note. Pass 2's flags go to Karl's review CSV. They don't count toward tag agreement.
- **The mapping rule (ruling 1).** It is one general rule, the same for every sub-skill: _tag a sub-skill when a question carrying it is the kind of question this segment teaches the student to solve._ The inclusion tests are applied as written, to those questions. It is a mapping rule, not a reinterpretation of any sub-skill, so the taxonomy stays the only vocabulary.
- **Calculator technique (ruling 2).** A segment that teaches a technique but no kind of question gets clusters only. It can't be reached by sub-skill today (closure row R-15). Cluster-based retrieval later will reach it.
- **The closed list:**
  - The prompt carries the sub-skills and clusters of the video's section only: math is 89 sub-skills and 164 clusters, 18,496 tokens; Reading and Writing is 46 and 69, 9,659 tokens.
  - Each sub-skill appears with its id, skill, name, definition and inclusion test. `display_name` is a hint only.
  - Any id the model returns that is not on the list is rejected and reported (`rejected_ids`), never kept. Both pilots had 0.
- **`method_in`.** A cluster the model tags in its own `method_in` skill goes to `method_in_defaults`, not to the tags.
- **Evidence.** One line per tag, in our own words. The model is told never to quote the speaker.
- **`not_in_taxonomy`.** For any segment, the model reports what it teaches that no listed id expresses.
- **Agreement, on tags only (ruling 5):**
  - Both passes tag the same segments, aligned one to one by identical spans (`alignPasses`). Files whose spans differ are refused.
  - Pass 2 lists the vocabulary in reverse order, so a tag that depends on list position shows up as a disagreement.
  - Per skill, agreement is the Jaccard index of the tags. A segment only one pass calls teaching counts its tags against agreement.
  - Clusters on a segment neither pass gave a sub-skill count under `(clusters only)`.
  - A segment keeps the shared tags.
  - Unit tests: `tests/ci/video-segment-tagging.contract.test.ts` (S1–S7).

## 4. Retrieval contract (design only; Phase C builds it)

As ruled on 2026-10-29: 3 sets the order and the Desmos tap's direct ask, 4 serves no video on a miss, and 6 matches versions.

**One SQL function replaces the call inside `retrieveOfferedVideos`, so both entry points change together.** It is `video_segments_for_question(p_question_id, p_skill_codes, p_limit, p_method, p_method_required)`, one statement, at most 3 rows.

- **Untagged question (no `question_sub_skills` rows at the current taxonomy version):** the body returns exactly `video_resources_for_skills(p_skill_codes, p_limit, p_method)`, today's skill-only ranking. It calls the existing function, so the behaviour is identical by construction. Every question is in this state until the questions team's tags land.
- **Version match (ruling 6).** A question's tags match a segment's tags only when both carry the same `taxonomy_version`. A segment at another version is not a candidate. If no segment of the question's skills carries the question's version, the question counts as untagged and gets today's skill ranking until the segments are retagged. Ruling 4's "no video" applies only when versions match and still nothing shares a sub-skill.
- **Tagged question.** Candidates are approved segments, at the question's version, of approved, `available` videos whose `skill_codes` overlap the question's. The skill gate stays a `WHERE`. A candidate must share at least one sub-skill. The best segment per video, at most 3, is ordered by (ruling 3):
  1. the number of shared sub-skills;
  2. the requested method;
  3. the number of shared clusters, counting a `method_in` cluster of the question's skill as present on both sides;
  4. format priority;
  5. segment length;
  6. `video_id`.
- **The Desmos tap asks for Desmos directly (ruling 3).** `pickIntentVideo` passes `p_method = 'desmos'` with `p_method_required = true`, so only Desmos segments or videos are candidates, and the top one is served. It no longer checks whether the top row of an unfiltered ranking happens to be Desmos.
  - On the untagged path this gives the same result as today. Method is already the first sort key, so the top row is Desmos exactly when any Desmos video exists for the skill.
  - "Explanation video" keeps `algebraic` as a preference, not a filter.
- **A tagged question with no segment sharing a sub-skill: no video (ruling 4).** Relevance beats availability; falling back to skill-only ranking is how FOIL got served.
  - A guided tap answers with its existing `VIDEO_INTENT_NO_MATCH` reply.
  - On Step 13d, the model-made offer offers nothing.
  - The miss is recorded (§2, `video_segment_misses`), ids only.
- It returns the segment's `start_seconds`, so playback starts at the segment, plus `matched_sub_skills` and `matched_clusters` (counts) for the `video_retrieval` timing block (ids and counts only).

## 5. Karl's review step

`segment-agreement.ts --csv` writes one row per segment, pre-marked:

- `approve`: the passes agree on every tag. Either sub-skills are kept, or neither pass gave a sub-skill and they share clusters (ruling 2, reason "clusters only").
- `retag`: some tag is disputed (only shared tags are kept), nothing is shared, or the passes disagree on whether the segment teaches.
- `drop`: neither pass calls it teaching.

Every `retag` and `drop` row carries a one-line reason. `boundary_flag` carries pass 2's mixed-topic note (ruling 5) for Karl's boundary review.

Columns are `approve` (prefilled `yes` on `approve`), `proposal`, `reason`, `video_id`, `start_s`, `end_s`, `sub_skills`, `clusters`, `disputed_sub_skills`, `disputed_clusters`, `boundary_flag`, `summary` and `not_in_taxonomy`. Karl edits the file, and the file is what gets written (Phase B), as in the library expansion.

The files:

- the first pilot: `docs/plans/lisa-video-library/segments-pilot-review.csv` (v1 columns);
- the re-pilot: `docs/plans/lisa-video-library/segments-repilot-review.csv`.

## 6. Cost of the full run (both passes, 150 approved videos)

- **Scope:** 77,309 s of video. 19 videos run over 15 minutes, so 198 calls per pass: 128 math, 70 Reading and Writing.
- **Rates, measured:**
  - The pilot's own calls: 92 video tokens per second, about 19k fixed tokens per math call, about 500 output tokens per minute of video.
  - The Desmos extraction (27 videos): $0.19 per 1,000 s excluding the vocabulary. It agrees.

| Item                                                                   | Per pass                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------- |
| Video input: 77,309 s × 92 tok/s × $1.50/M                             | $10.67                                                |
| Vocabulary and instructions: 128 × 19.0k + 70 × 10.2k tokens × $1.50/M | $4.72                                                 |
| Output: 1,288 min × ~500 tok × $9.00/M                                 | $5.79                                                 |
| **Per pass**                                                           | **$21.2**                                             |
| **Both passes**                                                        | **$42.4**, about $47 with a 10% allowance for retries |

- **Caching:** this assumes none. Pass 2 of the long pilot video got an implicit cache hit on 81% of its input, so the real figure may be lower; the estimate does not count on it.
- **Prices:** third-party list prices (`scripts/rag/vertex.ts`).
- **The re-pilot's rates match.** Pass 1 on the survey lesson cost $0.57, as v1's did. Five chapter-aligned clips replace four fixed ones, so the extra fixed-token cost is small. The estimate stands, but it is not up for approval: the re-pilot did not clear (§8.2).

## 7. SCL entries this needs (named; numbered by the register rule when written)

The highest allocated so far is SCL-256. Numbers are taken at the moment each entry is written, by the hard-override scan.

1. **Doc 03D §6.7** (the metadata schema, as amended by SCL-248): library videos are retrieved by **segment**, and a segment carries `sub_skill_ids` and `cluster_ids` from the SCL-256 vocabulary, by foreign key.
2. **Doc 03D §6.4 and §6.8** (retrieval scope, ranking and the contract, as amended by SCL-249): the §4 ranking (ruling 3), the version match and its untagged fallback (ruling 6), no video for a tagged question with no matching segment (ruling 4), and the segment start as the playback start.
   - The miss record (§2) is part of the same entry. It is library-planning data with ids only, not student data.
3. Possibly **Doc 03B §20.2** (as amended by SCL-254): the video an intent serves starts at its segment. Needed only if the client-visible `start_seconds` meaning is spelled out there.

No Doc 03 §14.2 entry is needed: this is not student data.

## 8. Pilot results

### 8.1 First pilot (v1: 3 Equivalent Expressions videos, $1.15 of the $2 cap, no production writes)

| Video                                                       | Segments, pass 1 / pass 2 | Boundaries agreed | Review rows                      |
| ----------------------------------------------------------- | ------------------------- | ----------------- | -------------------------------- |
| `qQzeFyLYt1A` Formula 30 – FOILing (48 s)                   | 1 / 1                     | —                 | retag (EE.2 kept; EE.1 disputed) |
| `a1QNaRnn6cE` Desmos Lesson #10 (6:38)                      | 5 / 5                     | 4/4               | 3 approve, 2 drop (intro, outro) |
| `UDJ2RHMFax8` All of SAT Desmos in 35 Minutes (14 chapters) | 16 / 22                   | 12/18             | 3 approve, 9 retag, 11 drop      |

**What worked:**

- On the incident, Desmos Lesson #10 separates rational expressions (EE.5, two segments at 2:38 and 4:17) from factoring (EE.3, 0:14) in both passes.
- FOIL is EE.2 ("Expand and multiply"), never EE.5. With sub-skill ranking, a rational-expressions question would get the Lesson #10 segment at 2:38, not the FOIL clip.
- No invented ids, in either pass.

**Agreement per skill, sub-skills.** The brief's metric pairs segments one-to-one. "Overlap" re-scores each segment against all of the other pass's tags in the same span, which removes the granularity effect.

| Skill                            | One-to-one | Overlap     |
| -------------------------------- | ---------- | ----------- |
| Equivalent Expressions           | 60% (6/10) | 78% (14/18) |
| Systems of Two Linear Equations  | 100% (3/3) | 100% (6/6)  |
| Linear Inequalities              | 100% (1/1) | 100% (2/2)  |
| Percentages                      | 100% (1/1) | 100% (2/2)  |
| Two-Variable Data                | 100% (1/1) | 100% (2/2)  |
| Linear Equations in One Variable | 75% (3/4)  | 67% (6/9)   |
| Linear Functions                 | 29% (2/7)  | 50% (7/14)  |
| Nonlinear Equations / Systems    | 50% (1/2)  | 50% (2/4)   |
| One-Variable Data                | 50% (1/2)  | 50% (2/4)   |
| Circles                          | 25% (1/4)  | 40% (4/10)  |
| Nonlinear Functions              | 18% (2/11) | 26% (6/23)  |
| Right Triangles and Trigonometry | 0% (0/1)   | 0% (0/2)    |

- **Clusters agree better:** 50% to 100% per skill.
- **Every low skill comes from the 35-minute survey lesson.** Each of those skills appears there in one or two short segments, so the counts are small and the percentages swing.

### 8.2 Re-pilot (v2: rulings 1 and 5, the same 3 videos, $1.40 of the $1.50 cap, no production writes)

Spend:

- Pass 1: $0.72.
- Pass 2: $0.68.
- Pass 2 stopped before the survey lesson's last clip, 32:19–35:20 (one chapter, "When to Use Desmos"), because the cap check's estimate for it ($0.13) would pass the cap. Pass 1's actual cost for that clip was $0.064.

That chapter is excluded from the figures below. Pass 1 called it not teaching (general advice), so it can't flip the verdict. If pass 2 also calls it not teaching, nothing changes. If pass 2 calls it teaching, its tags count only against agreement.

| Video                                                 | Boundaries               | Teaching segments both passes | Review rows                          |
| ----------------------------------------------------- | ------------------------ | ----------------------------- | ------------------------------------ |
| `qQzeFyLYt1A` Formula 30 – FOILing (48 s)             | pass 1's cuts (1)        | 1                             | 1 approve (EE.2)                     |
| `a1QNaRnn6cE` Desmos Lesson #10 (6:38)                | pass 1's cuts (4)        | 3                             | 3 approve (EE.3; EE.5; EE.5), 1 drop |
| `UDJ2RHMFax8` All of SAT Desmos in 35 Minutes (35:20) | 14 chapters, 13 compared | 11                            | 4 approve, 7 retag, 2 drop           |

**Sub-skill agreement per skill** (Jaccard over the same segments; v1 one-to-one figures for comparison):

| Skill                                | Re-pilot      | v1         |
| ------------------------------------ | ------------- | ---------- |
| Equivalent Expressions               | 100% (7/7)    | 60% (6/10) |
| Linear Equations in One Variable     | 100% (3/3)    | 75% (3/4)  |
| Systems of Two Linear Equations      | 100% (2/2)    | 100% (3/3) |
| Circles                              | 100% (2/2)    | 25% (1/4)  |
| Linear Inequalities                  | 100% (1/1)    | 100% (1/1) |
| Nonlinear Equations / Systems        | 100% (1/1)    | 50% (1/2)  |
| **Linear Functions**                 | **40% (2/5)** | 29% (2/7)  |
| **Nonlinear Functions**              | **29% (2/7)** | 18% (2/11) |
| **One-Variable Data**                | **0% (0/2)**  | 50% (1/2)  |
| **Percentages**                      | **0% (0/1)**  | 100% (1/1) |
| **Right Triangles and Trigonometry** | **0% (0/1)**  | 0% (0/1)   |
| **Two-Variable Data**                | **0% (0/1)**  | 100% (1/1) |

The two short videos agree on every tag. The survey lesson does not clear 70%. Every skill below 70% comes from it, and from three of its chapters:

- **Desmos Basics, 5:27–9:44.** Pass 1 applied ruling 2 and gave clusters only. Pass 2 tagged the six topics the chapter demos (OVD.2, OVD.3, PCT.1, RTT3, LF.5, NLF.1) and flagged it as mixing topics. This one chapter accounts for three of the four 0% skills (One-Variable Data, Percentages, Right Triangles) and one tag in each of Linear and Nonlinear Functions. The two passes disagree on whether a whirlwind tour of calculator features "teaches the student to solve" each kind of question it touches.
- **Function Basics, 1:50–5:27.** A concept chapter. Both passes kept LF.4. Pass 1 added LF.3, NLF.3 and NLF.4; pass 2 added TVD.5, the fourth 0% skill (Two-Variable Data). Same disagreement as in v1: which question types a concept overview serves.
- **Two single-tag misses:**
  - Functions, 14:37–16:11: pass 2 added LF.1.
  - Regression with a Table, 24:49–29:49: NLF.4 (pass 1) vs NLF.1 (pass 2).

Without Desmos Basics, Linear Functions would still be 50% (2/4) and Nonlinear Functions 33% (2/6). So this is not one outlier chapter.

**Clusters:** 40–100% per skill on the survey lesson. No segment came out clusters-only in both passes, so the `(clusters only)` bucket is empty in this run.

**Boundary flags (pass 2, for Karl's review; in the CSV's `boundary_flag`):**

| Chapter                                 | Pass 2's note, in brief                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Desmos Basics, 5:27–9:44                | arithmetic and fractions, list statistics (6:28), percentages (7:00), trig (7:16), sliders (7:53), graph features (8:56) |
| Systems of Equations, 11:21–12:49       | linear systems, then linear–nonlinear systems at about 11:53                                                             |
| Functions, 14:37–16:11                  | evaluating functions, then transformations at about 14:57                                                                               |
| Regression without a Table, 16:11–24:49 | identities and systems, then a linear identity (18:00) and an exponent equation (22:55)                                  |
| Regression with a Table, 24:49–29:49    | linear and quadratic regression to 28:23, then circle regression                                                         |

Pass 1 flagged two of the same chapters (Regression without a Table and Regression with a Table) on its own. The flags are a boundary question, separate from tags. Several of the low-agreement tags sit in flagged chapters, so splitting them may raise agreement. Whether to split is Karl's review call, not something the tagger changes.

**What this says:** the mapping rule fixed the short, single-topic videos. Equivalent Expressions went from 60% to 100% and Circles from 25% to 100%. The remaining spread is on survey and concept chapters, where "the kind of question this teaches" is itself ambiguous. That is what a per-sub-skill `teaching_test` would settle (§11).

## 9. Questions for Karl after the first pilot, and the rulings (2026-10-29)

**Rulings (Karl, 2026-10-29):**

1. **Q1:** the prompt changes to the single mapping rule (§3), then a re-pilot. If agreement is still below 70%, stop: a `teaching_test` field goes to the questions team, who own the taxonomy. _Re-piloted (§8.2): still below 70%, so stopped (§11)._
2. **Q2:** calculator-technique segments are kept, with clusters only (closure row R-15). Cluster-based retrieval will reach them later.
3. **Q3:** the order is shared sub-skills, then the requested method, then shared clusters, then format, then length, then `video_id`. The Desmos tap asks for a Desmos result directly (§4).
4. **Q4:** a tagged question with no matching segment gets no video. The guided tap uses its existing no-video reply; the model-made offer offers nothing. Each miss is recorded, ids only (§2, §4).
5. **Q5:** this deliberately changes the "two independent passes" method. Boundaries come from YouTube chapters, or else pass 1's cuts. Pass 2 tags those segments without seeing pass 1's tags, and agreement is measured on tags only. Pass 2 flags mixed-topic segments for Karl's review (§3).
6. **Q6:** a match needs the same taxonomy version on both sides. A mismatch counts as untagged (today's skill ranking) until the segment is retagged (§4).

The questions as asked follow, kept for the record.

**Q1. The inclusion tests describe questions, not teaching.** This is the main cause of disagreement.

- Most sub-skill tests read the question:
  - NLF.2: "Tag if the answer choices are verbal context statements";
  - LF.2: "Tag when the stem gives NO equation…";
  - CIR4: "Tag if CB's rationale states 'radii are congruent'…".
- A segment that teaches "regression from a table" or "what a function is" has no stem, choices or rationale. Each pass guesses which question type the teaching serves, and they guess differently. That is the Nonlinear Functions and Linear Functions spread.
- Options, none of which adds a vocabulary:
  - (a) **Prompt only:** tag a sub-skill when "a question carrying it is the kind of question this segment teaches the student to solve". Same ids, same tests, read through the question the segment prepares for.
  - (b) **Taxonomy:** add a `teaching_test` field per sub-skill to the canonical file, written by the taxonomy owner. Same ids, so still no second vocabulary, but it is a taxonomy change, so it is not the video lane's to make.
- I recommend (a), re-piloted first (about $1.15).

**Q2. Calculator-technique segments have no sub-skill.** Both passes flagged them `not_in_taxonomy`:

- "Desmos basics" (fractions, sliders, percent), 5:27–9:44;
- "regression with list notation for systems with constants", 16:11–20:00.

The Desmos clusters (CL.0212–CL.0230) cover the technique, but no sub-skill says "this technique, for any skill". Should such a segment:

- be stored with clusters and no sub-skill, so it is only reachable by cluster match?
- or be dropped?

The design allows (stores) a segment with zero sub-skills, but the review would mark it `retag` today.

**Q3. Ranking order:** method before cluster count, for the Desmos tap (§4)?

**Q4. A tagged question with no segment that shares a sub-skill:** fall back to skill-only, or serve no video (§4)?

**Q5. Survey videos.** The two-pass method separates granularity from tagging badly on a 35-minute, 14-chapter survey. One pass keeps a chapter whole and the other splits it into five.

- Proposal: pass 1 proposes the segments, and pass 2 tags **pass 1's segments** independently.
- Boundary agreement is then checked by a separate cheap pass that only cuts, so tag agreement measures tagging alone.
- This changes the brief's "two independent passes" method, so it is Karl's call.

**Q6. Taxonomy version changes.** Tags carry `taxonomy_version`. When the taxonomy moves to a new version, should retrieval:

- use only segments tagged at the current version, which needs a re-tag on every version?
- or use any version whose ids still exist?

The question tags have the same question.

## 10. Before Phase B

- **`lisa` must merge `main` first (Karl, 2026-10-29), and the PR records that merge.** `lisa` has neither the taxonomy file, nor `sub_skills` / `clusters`, nor the SCL-256 migration, so the foreign keys need it. The pilot read the taxonomy from `origin/main`.
- **The SCL-256 migration starts with `DROP TABLE IF EXISTS public.sub_skills CASCADE` (and `clusters`).**
  - Once segment tags reference those tables, re-running it would silently drop the segment tables' foreign keys.
  - Worth guarding before Phase B: for example, the migration refuses to run when the tables are non-empty.
  - That is the questions lane's file, so it is raised here, not changed.
- **Migration timestamps.** The range is crowded. A fresh scan finds `20261117000000` used twice on different branches (`scl_consolidated` on `main`, `qotd_day_04utc` on two others): a live collision for whoever merges second. Phase B rescans every branch and open PR first.

## 11. The stop, and what goes to the questions team

Ruling 1's stop applies: after the re-pilot the survey lesson still has six skills below 70% (§8.2). A per-sub-skill `teaching_test` goes to the questions team, who own `content/canonical/subskill-cluster-taxonomy.json`. The video lane doesn't write it.

What the request would say, for the questions team to accept, reshape or refuse:

- **What:** an optional `teaching_test` string per sub-skill, beside `inclusion_test`. It says when a piece of teaching (a segment, a worked example, an explanation) prepares a student for questions carrying that sub-skill. The ids, the skill tree and the `inclusion_test` stay as they are, so there is still one vocabulary.
- **Why, with the evidence:**
  - The pilots' disagreements sit on concept and survey teaching: Function Basics, Desmos Basics, regression chapters.
  - The `inclusion_test`s read a question's stem, choices and CB rationale, which teaching doesn't have.
  - Without a teaching test, two careful readings of the same chapter pick different sub-skills (LF.3/NLF.3/NLF.4 vs TVD.5 on Function Basics).
- **Where it matters most:** Linear Functions and Nonlinear Functions. They and the four single-tag skills (three from Desmos Basics, one from Function Basics) hold every sub-skill disagreement left.
- **Open, for Karl:** whether the boundary flags (§8.2) are resolved first. Splitting the five flagged chapters at the points pass 2 names is a boundary change, not a taxonomy one. It may lift agreement without a taxonomy change. A re-pilot after the splits would cost about $1.10 (the survey lesson's two passes, at this run's rates).

Phase B does not start. The Phase B cost (about $42–47, §6) is not put up for approval, because the re-pilot did not clear.
