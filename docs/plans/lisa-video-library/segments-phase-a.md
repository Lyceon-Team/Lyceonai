# Video segments by sub-skill and cluster: Phase A (design and pilot)

**Brief:** "Video segments tagged by sub-skill and cluster", Karl, 2026-10-29. Lane: video. This PR is Phase A only: design, a three-video pilot, no production writes.

**Status: STOPPED on a stop condition.** Two-pass sub-skill agreement is below 70% for several skills in the pilot (§8). The main cause is a taxonomy fit question (§9, Q1), raised for Karl rather than worked around. Phase B waits on the answers.

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
  tagged_by         text NOT NULL,                     -- 'segment-tags-v1 gemini-3.5-flash 2-pass'
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

- **One pass:**
  - Gemini (`gemini-3.5-flash`, temperature 0, response schema, Zod-parsed) watches the video.
  - Over 15 minutes, it watches 10-minute clips (`clipsOf`, as in the Desmos extraction), each cached on its own.
  - It splits at topic changes and is given the creator's chapters as hints (`scripts/rag/.cache/metadata.json`).
  - Segments tile the video and must parse and tile, or the pass fails loudly.
- **The closed list:**
  - The prompt carries the sub-skills and clusters of the video's section only: math is 89 sub-skills and 164 clusters, 18,496 tokens; Reading and Writing is 46 and 69, 9,659 tokens.
  - Each sub-skill appears with its id, skill, name, definition and inclusion test. `display_name` is a hint only.
  - Any id the model returns that is not on the list is rejected and reported (`rejected_ids`), never kept. The pilot had 0.
- **`method_in`.** A cluster the model tags in its own `method_in` skill goes to `method_in_defaults`, not to the tags.
- **Evidence.** One line per tag, in our own words. The model is told never to quote the speaker.
- **`not_in_taxonomy`.** For any segment, the model reports what it teaches that no listed id expresses. This is the "doesn't fit" signal (§9).
- **Two passes, kept by agreement.** This is the earlier runs' method, "a value is kept only when both runs saw it".
  - Pass 2 lists the vocabulary in reverse order, so a tag that depends on list position shows up as a disagreement.
  - Boundaries agree when the other pass cuts within ±15 s; clip edges don't count.
  - Segments pair one-to-one at IoU ≥ 0.5.
  - Per skill, agreement is the Jaccard index of the paired tags; unpaired segments count against it.
  - A kept segment keeps the shared tags, with the earlier start and the later end.
  - Unit tests: `tests/ci/video-segment-tagging.contract.test.ts` (6 tests).

## 4. Retrieval contract (design only; Phase C builds it)

**One SQL function replaces the call inside `retrieveOfferedVideos`, so both entry points change together.** It is `video_segments_for_question(p_question_id, p_skill_codes, p_limit, p_method)`, one statement, at most 3 rows:

- **Untagged question (no `question_sub_skills` rows):** the body returns exactly `video_resources_for_skills(p_skill_codes, p_limit, p_method)`. It calls the existing function, so the behaviour is identical by construction. Every question is in this state until the questions team's tags land.
- **Tagged question.** Candidates are approved segments of approved, `available` videos whose `skill_codes` overlap the question's. The skill gate stays a `WHERE`. The best segment per video, at most 3, ordered by:
  1. the number of shared sub-skills;
  2. the number of shared clusters, counting a `method_in` cluster of the question's skill as present on both sides;
  3. the requested method;
  4. format priority;
  5. segment length;
  6. `video_id`.
- It returns the segment's `start_seconds`, so playback starts at the segment, plus `matched_sub_skills` and `matched_clusters` (counts) for the `video_retrieval` timing block (ids and counts only).

**Push-back on the order. The requested method should come before cluster count, for the Desmos tap.**

- `pickIntentVideo` serves "Desmos video" only if the **top** row is a Desmos video; otherwise it answers "no video".
- With clusters before method, an algebraic segment that shares more clusters can outrank a Desmos segment for the same sub-skill. The tap then says "no video" although a matching Desmos segment exists.
- Proposed order: sub-skill matches, then the requested method, then shared clusters, then the rest. Alternatively, the Desmos tap could pass the method as a filter. Karl's call (§9, Q3).

**Open: a tagged question with no segment that shares a sub-skill.** Either:

- (a) fall back to today's skill-only ranking, which could again serve FOIL for a rational-expressions question; or
- (b) serve no video ("I don't have a video for this yet").

Karl's call (§9, Q4).

## 5. Karl's review step

`segment-agreement.ts --csv` writes one row per segment, pre-marked:

- `approve`: paired, the passes agree on every tag.
- `retag`: paired, but some tag is disputed (only shared tags are kept), or no sub-skill survived.
- `drop`: not teaching, or unpaired.

Every `retag` and `drop` row carries a one-line reason.

Columns are `approve` (prefilled `yes` on `approve`), `proposal`, `reason`, `video_id`, `start_s`, `end_s`, `sub_skills`, `clusters`, `disputed_sub_skills`, `disputed_clusters`, `summary` and `not_in_taxonomy`. Karl edits the file, and the file is what gets written (Phase B), as in the library expansion.

The pilot's file is `docs/plans/lisa-video-library/segments-pilot-review.csv`.

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
- **A re-pilot first.** If the §9 fixes are taken, a second pilot on the same three videos costs about $1.15, as this one did.

## 7. SCL entries this needs (named; numbered by the register rule when written)

The highest allocated so far is SCL-256. Numbers are taken at the moment each entry is written, by the hard-override scan.

1. **Doc 03D §6.7** (the metadata schema, as amended by SCL-248): library videos are retrieved by **segment**, and a segment carries `sub_skill_ids` and `cluster_ids` from the SCL-256 vocabulary, by foreign key.
2. **Doc 03D §6.4 and §6.8** (retrieval scope, ranking and the contract, as amended by SCL-249): the §4 ranking, the segment start as the playback start, and the untagged fallback.
3. Possibly **Doc 03B §20.2** (as amended by SCL-254): the video an intent serves starts at its segment. Needed only if the client-visible `start_seconds` meaning is spelled out there.

No Doc 03 §14.2 entry is needed: this is not student data.

## 8. Pilot results (3 Equivalent Expressions videos, $1.15 of the $2 cap, no production writes)

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

## 9. Questions for Karl (the stop)

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

- **`lisa` must merge `main` first.** `lisa` has neither the taxonomy file, nor `sub_skills` / `clusters`, nor the SCL-256 migration, so the foreign keys need it. The pilot read the taxonomy from `origin/main`.
- **The SCL-256 migration starts with `DROP TABLE IF EXISTS public.sub_skills CASCADE` (and `clusters`).**
  - Once segment tags reference those tables, re-running it would silently drop the segment tables' foreign keys.
  - Worth guarding before Phase B: for example, the migration refuses to run when the tables are non-empty.
  - That is the questions lane's file, so it is raised here, not changed.
- **Migration timestamps.** The range is crowded. A fresh scan finds `20261117000000` used twice on different branches (`scl_consolidated` on `main`, `qotd_day_04utc` on two others): a live collision for whoever merges second. Phase B rescans every branch and open PR first.
