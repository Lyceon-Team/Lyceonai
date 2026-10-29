# Video segments, Phase C: retrieval switch-over

Owner brief "Phase C: retrieval switch-over" (Karl, 2026-10-29). SCL-260 (Doc 03D §6.4) and
SCL-261 (Doc 03D §6.8). Builds on Phase B's tables (SCL-259) and the EE question tags.

## 1. What changed

One switch point: `retrieveOfferedVideos` (`server/services/tutor-video-library.ts`), which Step 13d
and both video taps already call.

| The item | Function | Result |
|---|---|---|
| has any `question_sub_skills` row | `video_segments_for_question` (new) | the approved segment that teaches what it asks, opening at the segment's start; nothing if none |
| has none | `video_resources_for_skills` (unchanged, same arguments) | today's result, exactly |

No version comparison (ruling Q6, revised). No wire, client, worker or prompt change: the segment's
start rides `start_seconds`, the field the player already uses, and the row is projected back to
the library shape before it leaves the retrieval.

## 2. The ranking (ruling Q3)

One statement, at most 3 videos, one segment per video (its best; ties to the earlier segment).

Candidates: approved segments of approved, `available` videos whose skills overlap the item's,
sharing at least one sub-skill with it. With `p_method_required` (the Desmos tap), only videos
tagged with the method.

1. shared sub-skills, more first;
2. the requested method;
3. shared clusters, where a cluster that is a `method_in` default of the item's skill counts as
   present on both sides;
4. format, in the order passed as `p_format_priority` (the BFF passes `VIDEO_FORMAT_PRIORITY`, so the
   statement holds no copy of the format vocabulary);
5. segment length, shorter first;
6. `video_id`.

## 3. Misses (ruling Q4)

A tagged item with no matching approved segment gets no video. It never falls back to the
skill-only ranking.

- The tap answers with its no-video sentence (`VIDEO_INTENT_NO_MATCH`).
- On Step 13d the model is offered nothing.

The BFF logs `TUTOR_RUNTIME video_segment_miss` with ids only: `conversationId`, `questionRowId`,
`subSkillIds`, `method`, `methodRequired`. The Phase A sketch had a miss table; the brief chose a
log line.

## 4. Timing line

`route_timing.video_retrieval` gains:

- `path`: `segment`, `skill`, or null when no retrieval ran;
- `matched_sub_skill_ids`;
- `shared_clusters`;
- `segment_id`;
- `miss`.

The segment fields describe the first row: the video a tap serves, or the first offered on 13d.
They are ids and counts only. A sub-skill id is kept only if it looks like a tag id, and the segment
id only if it is a UUID.

## 5. Proofs

| Proof | Where |
|---|---|
| EE.5 question → the rational segment first, at its start (Lesson #10 shape, 159 s) | gate R1; `video-retrieval-timing.contract.test.ts` |
| EE.2 question → the expand-and-multiply segment | gate R2; same test file |
| Desmos tap → a Desmos segment even when an algebraic one shares more | gate R3; `guided-choices.route.contract.test.ts` |
| Tagged, no approved match → nothing, miss logged | gate R4; both test files |
| Untagged → today's output (snapshot taken on the pre-change schema) | gate R5; `video-retrieval-timing.contract.test.ts` |
| Unapproved segments and videos never returned | gate R6; mutations P1, P2 |
| `method_in` defaults counted on both sides | gate R7; mutation P4 |
| Not executable by anon or authenticated | gate R8; mutation P7 |

`scripts/ci/video-segment-retrieval.mutations.sh` plants seven defects, and each one reddens its
named gate.

## 6. Deploy order

1. Karl applies `supabase/migrations/20261125000000_lisa_segment_retrieval.sql`. The live BFF does not
   call the new function yet.
2. No worker deploy is needed, because the worker wire is unchanged.
3. Merge to `main`: the BFF.

Production proof, after the deploy:

- On an EE review question, a video tap serves a segment whose sub-skills match the question's
  tags, at the segment's start.
- `route_timing` shows `path: "segment"`.
- On a non-EE question, behaviour is unchanged (`path: "skill"`).
