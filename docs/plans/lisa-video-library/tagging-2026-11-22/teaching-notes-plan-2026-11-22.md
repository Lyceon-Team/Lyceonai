# Teaching notes from every video: what exists and what's left

Karl's ruling (2026-11-22): create our own teaching notes from every library video for LISA's RAG. Don't store creator transcripts verbatim.

## This is already designed and partly built
"One watch, two outputs" (Karl, 2026-11-04; `docs/plans/lisa-video-library/watch-writeup-step0.md`) is the same idea.

- **The watch pass writes our notes.** Gemini watches each segment and writes a Lyceon-authored write-up: the facts and steps, plus a `delivery` block covering step order, the phrases that make it click (paraphrased), analogies, and how the instructor checks understanding.
- **Our own words, never the script.** The rules allow no transcript copy and require exact maths.
- **Transcripts are only a working step.** They are read once at build time and deleted afterwards (closure ruling R-4). Nothing verbatim is stored.
- **The chunk steps turn write-ups into `curriculum_chunks` rows.** They rewrite, run an audit that re-watches the segment, check the example and embed (`chunk-segments.ts`, `chunk-unit.ts`). Rows go in as `pending_review`; the schema refuses an active row without a reviewer.

## Where it stands (checked 2026-11-22)
| Item | State |
|---|---|
| Write-ups for the 175 gap-run teaching segments | Done: `docs/plans/lisa-video-library/writeups-2026-11-04.jsonl` |
| Chunk steps for those | Parked. About $7.83 is left of the $32 cap you approved |
| Write-ups for the older segments | Not done. You deferred the backfill on 2026-11-04 (estimated then at $33.67 for 276 segments) |
| `curriculum_chunks` rows | 0 |
| Segments today | 470 (53,910 s), 412 approved; 466 after tonight's approval file |

## What you rule on
1. **Unpark the chunk steps for the 175 existing write-ups.** They're within the approved cap.
2. **Lift the backfill deferral:** write-ups plus chunk steps for the older approved segments. At the 2026-11-04 rates this is about $35–40 with retries. The older segments run longer than the 276-segment estimate, so this figure gets re-measured before the run.
3. **Who reviews chunks before they go live:** you, or a check against the College Board baseline questions once those are tagged.

## Then the video lane runs it (Cloud Shell, where YouTube and Vertex are reachable)
1. Backfill pass: segment-videos.ts in write-up-only mode on each approved segment span that has no write-up.
2. `chunk-segments.ts` over all write-ups. Overview, mixed and clusters-only segments get no chunk.
3. Embed and upsert as `pending_review`. Review, then set active.
4. Keep `delivery` with the segment for gold responses and voice examples. It stays out of the chunk text.

New sources (James Lu, Khan Academy) go through the same single watch: segments, tags and write-up together.
