# One watch, two outputs: Step 0 design and pilot

Owner brief "Rulings on content gaps (#1447), plus one watch, two outputs" (Karl, 2026-11-04).
Step 0 is design only. Nothing is built, written to a database, or retrieved.

The pilot spent **$0.557 of the $2 cap**. Its script is `scripts/rag/watch-writeup-pilot.ts`.
No fixed taxonomy counts appear here. Sizes are per video, per segment and per second.

## 1. The design

Every watch produces two outputs:

- segments and tags, as now;
- a teaching write-up per segment, which becomes curriculum-corpus chunks through LISA 1's chunk
  steps.

| Step                     | What runs                                                                                                                                                                                                                                                                                         | New or reused                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Pass 1                   | `segment-videos.ts` pass 1, as now, plus a WRITE-UP block in the prompt and a `writeup` field per segment: what is taught, the method, its steps, what to look at, the pitfalls the instructor names, and the worked examples. The mathematics is given exactly as shown; nothing else is quoted. | Prompt and schema extended                 |
| Pass 2                   | Unchanged. It is blind: it sees pass 1's times only, never its tags or write-up. It tags for agreement.                                                                                                                                                                                           | Unchanged                                  |
| Agreement and review     | `segment-agreement.ts` and Karl's segment review, unchanged                                                                                                                                                                                                                                       | Unchanged                                  |
| Write-up to unit         | The write-up of each **approved** segment is rendered as one unit in the markdown shape `book.ts` reads. The topic is the `## ` line; each worked example after the first is a `### ` block.                                                                                                      | New, small and pure (`renderUnit`)         |
| Short whole, long split  | `book.ts` `longRulesWhole` / `splitLongRules` at `SHORT_RULE_WORDS`, and `ruleOpening`: each cut piece carries the method as its opening. A segment is the unit, so a short one stays whole by construction.                                                                                      | Reused unchanged                           |
| Rewrite into our words   | `book-prompts.ts` REWRITE_SYSTEM and its schema, worded for a video source                                                                                                                                                                                                                        | Reused, with a source-kind wording         |
| Audit, drop-only         | `book-prompts.ts` AUDIT_SYSTEM, `auditFailure`, `auditUserMessage`, and the one repair from `ingest-book.ts`. **The audit watches the segment**, so the source is the video and not the write-up: the write-up is the model's own account, and auditing against it would be circular.             | Reused, with a source-kind wording         |
| Example check, drop-only | `book-prompts.ts` EXAMPLE_CHECK_SYSTEM, the narrowed one, and `exampleCheckFailure`: a contradiction drops the chunk, and it is never repaired                                                                                                                                                    | Reused unchanged                           |
| Embed and write          | `vertex.ts` `embedTexts` (text-embedding-005), then `curriculum_chunk_upsert`. Rows land `pending_review`.                                                                                                                                                                                        | Reused, with the writer extended (§3)      |
| Review                   | `book.ts` `toReviewCsv` / `parseBookReviewCsv`, then `apply-book-review.ts`. Karl reads a sample cold.                                                                                                                                                                                            | Reused, with the provenance filter widened |

Rules the design adds:

- **No chunk from an overview, a mixed or a non-teaching segment.** The one-topic rule already
  keeps these segments to clusters only. The pilot shows why it should also give them no chunk:
  Brain Buffs' opening overview (0:00–0:55) produced a thin, generic entry, and that entry needed
  the repair.
- **Already-approved segments are never re-cut.** On re-running pass 1, Lesson #10 drifted to a
  2:38 start, where the approved segment starts at 2:39. Re-cutting would clear Karl's approvals.
  The backfill therefore runs a write-up-only call on each approved span (`BACKFILL_SYSTEM` in the
  pilot) and feeds the same chunk steps.
- **A segment re-cut by a split file** gets a write-up-only call on its new span, for the same
  reason.
- **"Never a transcript copy."** No transcript exists anywhere in the system: Gemini watches, and
  R-14 blocks transcripts. Three layers stand against copying:
  1. the write-up is told never to quote or follow the speaker's wording;
  2. the rewrite re-words it;
  3. Karl's cold read is the gate.

  No mechanical check is possible, because there is no text to compare against. Kept from the
  video: the mathematics, as the book pipeline keeps worked examples concrete.

## 2. The modules reused, by name

There is no second chunking pipeline. Every chunk step is a function that already exists.

- **`scripts/rag/book.ts`:**
  - `longRulesWhole`, `splitLongRules`, `ruleOpening` and `SHORT_RULE_WORDS`;
  - `wordCount` and `sha256`;
  - `toReviewCsv`, `parseBookReviewCsv` and `BOOK_REVIEW_HEADER`.
- **`scripts/rag/book-prompts.ts`:**
  - the prompts REWRITE_SYSTEM, AUDIT_SYSTEM and EXAMPLE_CHECK_SYSTEM;
  - `rewriteResponseSchema` / `rewriteSchemaFor`, `auditResponseSchema` / `auditSchema`, and `exampleCheckResponseSchema` / `exampleCheckSchema`;
  - `auditUserMessage`, `rewriteRuleOpening`, `auditFailure` and `exampleCheckFailure`.
- **`scripts/rag/ingest-book.ts`:**
  - the per-unit loop (rewrite, audit, one repair for `REPAIRABLE`, example check), lines 548–660;
  - `cachedCall`.

  The build moves both into one exported function. `ingest-book.ts` and the video path then
  call the same code, with the book's cache keys unchanged.

- **`scripts/rag/segment-videos.ts`:** `segmentSystem`, `fixedSystem`, `vocabularyFor`,
  `vocabularyText`, `taxonomySchema` and the answer schemas. Pass 1 extends them, and pass 2 uses
  them unchanged.
- **`scripts/rag/vertex.ts`:** `generateJson` (video clips through `videoMetadata`), `embedTexts`,
  `withVertexRetry` and the usage accounting.
- **`scripts/rag/apply-book-review.ts`:** the approve path. Its `provenance LIKE 'book:%'` filter
  widens to video provenance.

The source-kind wording is the one change to LISA 1's prompts. In the pilot it is two exact,
asserted substitutions in each of the rewrite and audit prompts (`videoSourced` in the pilot):

- "a unit of an SAT preparation book" becomes "a written account of one segment of an SAT
  preparation video";
- the audit's SOURCE is "the video segment you are watching";
- its CONTEXT is the neighbouring segments' one-line summaries.

The build moves this into `book-prompts.ts` as a source-kind parameter. A test pins
`BOOK_PROMPT_VERSION` unchanged, so the book's prompts stay byte-identical and the Meltzer cache
stays valid.

The example check is not reworded. It is grammar-oriented, but its "which word or form appears"
pairs also fit mathematics: on Brain Buffs it checked 3 pairs, and all held.

## 3. Tags on chunks, and provenance to the segment

**Decision: the tag link tables belong with LISA 1's corpus, not here.**

- They describe `curriculum_chunks`, the one store, whatever its source. The Meltzer and College
  Board chunks need them too.
- One table pair, written once, serves all three sources.
- They land as a standalone foundation migration in `lisa` before any consumer. Whichever
  workstream builds first ships it, and the other consumes it, never a second copy.

The shape follows `question_sub_skills` (`tagged_by`, `tagged_at`) and `video_segment_*` (foreign
keys, RESTRICT on the vocabulary side, no rank):

```sql
CREATE TABLE public.curriculum_chunk_sub_skills (
  chunk_id         uuid NOT NULL REFERENCES public.curriculum_chunks(id) ON DELETE CASCADE,
  sub_skill_id     text NOT NULL REFERENCES public.sub_skills(id),
  taxonomy_version text NOT NULL,
  tagged_by        text NOT NULL,      -- e.g. 'video_segment' (inherited) or a tagging pass id
  tagged_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, sub_skill_id)
);
CREATE TABLE public.curriculum_chunk_clusters (
  chunk_id         uuid NOT NULL REFERENCES public.curriculum_chunks(id) ON DELETE CASCADE,
  cluster_id       text NOT NULL REFERENCES public.clusters(id),
  taxonomy_version text NOT NULL,
  tagged_by        text NOT NULL,
  tagged_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, cluster_id)
);
-- RLS on, no policies; service_role only, like the tables they mirror.
```

**The video side, in this workstream:**

- **Provenance to the segment.** `curriculum_chunks.segment_id uuid NULL REFERENCES
public.video_segments(segment_id) ON DELETE CASCADE`.
  - A chunk cannot outlive the segment it was written from.
  - `video_segments_set` keeps a segment's id while its start is unchanged.
- **Provenance text.** It stays Doc 03D §6.5 / SCL-231's `youtube:<video_id>:<start>-<end>`, with
  `.<n>` for the pieces of a split segment. A CHECK requires that format whenever `segment_id` is
  set.
- **Tags are inherited, not re-tagged.** A video chunk's rows are the approved segment's agreed
  tags, written in the same statement as the chunk (`tagged_by = 'video_segment'`).
  - A CI gate asserts that they equal the segment's tags.
  - A segment whose tags change loses its approval (`video_segments_set`). The chunk is then
    rewritten and drops back to `pending_review`, through the upsert's existing rule.
- **`skill_codes`.** The rewrite's skill codes must be the skills of the segment's sub-skills; a
  mismatch drops the chunk. All 3 pilot chunks matched (Equivalent Expressions).
  - `content_type` is the rewrite's: textbook, worked_example or strategy. It is never
    `video_transcript`, which is the thing this design rules out.
  - `methods` is the video's.
- **The writer.** `curriculum_chunk_upsert` gains `p_segment_id`, and the tag rows are set in the
  same transaction. Its last definition is `20261101010000_lisa_curriculum_chunks.sql`. Replacing
  it re-points every mutation in `scripts/ci/curriculum-chunks.mutations.sh` aimed at it, in the
  same change, with each one shown still reddening (CLAUDE.md).

**SCL entries.** The numbers were allocated under the hard override: the maximum across all
remote branches and open PRs on 2026-11-04 was SCL-273, and no open PR comes from a fork.

- **SCL-274: chunk tag link tables.** `curriculum_chunk_sub_skills` and
  `curriculum_chunk_clusters`, by foreign key to `sub_skills` and `clusters`. It amends Doc 03D
  §6.7, the metadata schema, as SCL-231 and SCL-259 did. It is the foundation migration, shared
  with LISA 1.
- **SCL-275: segment-derived chunks.** `curriculum_chunks.segment_id`, the provenance CHECK,
  inherited tags, and the extended upsert. It amends Doc 03D §6.5–§6.7, and covers how pass 1's
  write-up feeds the corpus.

A later allocation renumbers on collision, by the entry's own date.

## 4. Status and the gate

- **Every new chunk lands `pending_review`.** The table's CHECK already refuses `active` without a
  reviewer.
- **Nothing reaches LISA's prompt until G1-2 ships behind v5's boundary.**
  - `curriculum_chunks_search` returns only `active` rows, and nothing is approved before Karl's
    review.
  - The repo has no G1-2 row yet. It is cited here as Karl named it.
- **The quality gate is a cold read, as with Meltzer.** Karl reads a sample cold: the chunk alone,
  without the video, and judges it as a student would meet it. That review is
  `toReviewCsv` → Karl marks it → `apply-book-review.ts`.

**One open question for Karl (anti-leak).** A chunk's worked example carries the video's problem
and its answer. Lesson #10's is "24/(6x+42) is equivalent to 4/(x+b) … b = 7".

- If the question bank holds that item, a pre-submit chunk would reveal its answer.
- The rewrite marked Lesson #10's chunk `post_only`, but it is the model's judgement, not a rule.
- **Proposal:** a drop-only bank-match check before a chunk can be approved. The example's
  normalised mathematics would be compared with the bank's stems, and a match is forced to
  `post_only` or dropped. It would be built with G1-2, since nothing is retrieved before then.

## 5. The pilot, through LISA 1's audit

**Pilot 1: Lesson #10, 2:39–4:17 (EE.5; backfill path, write-up-only on the approved span).**
Kept. The audit, watching the segment, passed every check. Example check: 0 pairs. Unit: 246
words, kept whole. Rewrite: Equivalent Expressions, `strategy`, `post_only`, no repair.

> To find the value of an unknown constant that makes two rational expressions equivalent, you can graph both expressions in Desmos and use a slider to test the answer choices. First, enter the first expression as an equation starting with y =. Next, enter the second expression as an equation starting with y =, using the variable for the constant. When prompted by Desmos, click the button to create a slider for the constant variable. Finally, substitute each multiple-choice option into the slider for the constant and look at the two colored curves on the graph. The correct option is the one that makes the second graph perfectly align and merge with the first graph into a single curve. For example, suppose you need to find the value of b if the expression 24/(6x+42) is equivalent to 4/(x+b), where b is a constant and x > 0, with options A) 7, B) 10, C) 24, and D) 252. First, type y = 24/(6x+42) into Desmos. Next, type y = 4/(x+b) into Desmos and click the button to add a slider for b. Now, test the options. Set b = 7 and observe that the blue graph perfectly covers the red graph. If you set b = 10, b = 24, or b = 252, you will see that these values do not produce overlapping graphs. Therefore, option A is the correct answer.

**Pilot 2: Brain Buffs, "SAT Math: Operations with Rational Expressions" (`aDhs2BXFQUk`; new-source
path, pass 1 with the write-up).** Pass 1 cut it into 0:00–0:55, flagged an overview, and
0:55–3:18, the worked example.

The worked example (0:55–3:18) was kept. The audit, watching it, passed every check. Example
check: 3 pairs, all shown. Unit: 228 words, kept whole. Rewrite: Equivalent Expressions,
`textbook`, `pre_and_post`, no repair.

> To simplify a rational expression, you can factor both the numerator and the denominator and then cancel out any common factors. Once you have simplified the expression, you can use the Desmos graphing calculator to verify your work by ensuring that the graphs of the original expression and your simplified expression overlap perfectly. First, factor the quadratic expressions in both the numerator and the denominator. For example, if you need to simplify the expression (x^2 - 4) / (x^2 + 2x - 8), start by factoring the numerator. The numerator x^2 - 4 is a difference of squares, which factors into (x - 2)(x + 2). Next, factor the denominator x^2 + 2x - 8, which is a trinomial that factors into (x + 4)(x - 2). Second, rewrite the rational expression with these factored forms: ((x - 2)(x + 2)) / ((x + 4)(x - 2)). Identify the common binomial factor in both the numerator and the denominator. In this case, the common factor is (x - 2). Cancel this common factor from both parts of the fraction. This leaves you with the simplified expression (x + 2) / (x + 4). Third, verify your simplified expression using Desmos. Graph the original expression, (x^2 - 4) / (x^2 + 2x - 8), in one line of the calculator. In the next line, graph your simplified expression, (x + 2) / (x + 4). Look at the resulting graphs on the screen. If your simplification is correct, the two graphs will overlap perfectly, confirming that the expressions are equivalent.

The overview (0:00–0:55) was kept after one repair: the audit rejected the first rewrite, and
the second passed. Its entry is 125 words of generic advice ("look for common terms in the top and
bottom"). Under the design it would produce no chunk at all (§1).

What the pilot shows:

- **Pitfalls came back empty on all three segments.** That is the model reporting that the
  instructors name none. The audit, watching, did not call any entry incomplete. Whether
  instructors really name no traps in these videos is for Karl's cold read.
- **Watching is what caught the one failure.** On the overview's first rewrite the audit returned
  `faithful: false`. The entry had added things the video never says: "quadratic patterns", and
  that "any non-zero term divided by itself equals one". An audit against the write-up could not
  have seen this, because the write-up is the rewrite's own input. The one repair fixed it.
- **No piece reached the 400-word split rule.** One-topic segments run short, so the split rule
  will rarely fire. It stays, as the book's does.
- **The pass-1 tags matched Phase B on Lesson #10.** EE.3 then EE.5 then EE.5, with the same
  clusters. The write-up did not disturb them.

## 6. Costs

All rates are measured: the pilot on 2026-11-04, plus Phase B and Meltzer. The price is
gemini-3.5-flash at `vertex.ts` rates.

| Item                                      | Measured                                                                                                                                                                 | Rate used                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Added pass-1 output for the write-up      | Lesson #10 (398 s, 3 segments): 2,606 → 5,760 output tokens, **+$0.028**. Brain Buffs (198 s, 2 segments): 2,349 → 3,560, **+$0.011**. Prompt +~560 tokens, about $0.001 | **≈ $0.055–0.071 per 1,000 s of video**, the higher rate used |
| Backfill write-up only (an approved span) | $0.0318 for 98 s                                                                                                                                                         | $0.0185 per segment + $0.138 per 1,000 s                      |
| Rewrite                                   | $0.021–0.033 per call                                                                                                                                                    | $0.0246 per chunk                                             |
| Audit (watches the segment)               | $0.021–0.030                                                                                                                                                             | $0.0086 output per chunk + $0.138 per 1,000 s watched         |
| Example check                             | $0.007–0.029                                                                                                                                                             | $0.0152 per chunk                                             |
| One repair                                | 1 of 3 in the pilot; 8 of 36 on Meltzer                                                                                                                                  | Meltzer's 22%                                                 |
| Chunk steps, all in                       | $0.052–0.091 per kept chunk, against Meltzer's $0.0712                                                                                                                   | **$0.056 per segment + $0.169 per 1,000 s**                   |
| Embedding                                 | text-embedding-005, about 1,500 characters per chunk                                                                                                                     | under $0.0001 per chunk; nil                                  |

Thinking is most of the output: 80–99% across the chunk calls, and 90% on Meltzer. A lower
thinking level on the rewrite and example check is the obvious lever. It is not assumed, and it
would need its own pilot.

**New sources (A + B + C: 75 videos, 18,622 s).** The segment count comes from Phase B's yield:
410 segments over 41,671 s, of which 276 segments and 32,907 s were approved. That gives about
183 segments, of which about 123 (14,706 s) would be approved. Chunk steps run only on approved
segments.

| Part                                                                    | Estimate                                |
| ----------------------------------------------------------------------- | --------------------------------------- |
| Metadata, skill, method, segment passes ×2 (`content-gaps-step0.md` §5) | $13.73                                  |
| Added write-up output on pass 1                                         | $1.33                                   |
| Chunk steps on the approved segments                                    | $9.36                                   |
| **Total**                                                               | **$24.42; $26.86 with 10% for retries** |
| of which the write-up and chunks add                                    | $10.69; $11.76 with retries             |

**Backfill (the 276 approved segments, 32,907 s; approved only).**

| Part                                 | Estimate                                |
| ------------------------------------ | --------------------------------------- |
| Write-up-only call per approved span | $9.66                                   |
| Chunk steps                          | $20.95                                  |
| **Total**                            | **$30.60; $33.67 with 10% for retries** |

This is an upper bound, because overview, mixed and clusters-only segments get no chunk under §1.
The segment count is the 276 Karl approved, not a taxonomy size. A taxonomy that grows changes
pass 1's vocabulary cost (`content-gaps-step0.md` §5) and nothing here.

## 7. What Karl rules on

1. The design in §1, especially two choices:
   - the audit watches the segment;
   - overview, mixed and non-teaching segments get no chunk.
2. §3: the tag tables with LISA 1 as a shared foundation (SCL-274), and the segment link with
   inherited tags (SCL-275).
3. §4: the bank-match check, and whether it is built now or with G1-2.
4. §6: the new-source run (about $26.86) and the backfill (about $33.67), each with retries.

## 8. Rulings (Karl, 2026-11-04)

1. **The new-sources run is approved:** A + B + C, about $27 with retries. The run is recorded in
   `content-gaps-run-2026-11-04.md`.
2. **The backfill of the existing segments stays deferred.**
3. **Each teaching segment's write-up also records how the instructor explains, not just what:**
   - the order of the steps;
   - the phrases that make it click, paraphrased in our own words;
   - any analogy;
   - how the instructor checks the student is following.

   These feed LISA's gold responses and voice examples, so they matter as much as the facts. The
   rules are the same as for the facts: our own words, no transcript copy, the maths exact.

**Built.**

- **Pass 1 (`segment-tags-v5`).** `segment-videos.ts` adds `WRITEUP_RULES` and the `writeup`
  field to pass 1, in both the cut and the fixed (chaptered) modes. A teaching segment without a
  write-up fails its clip. Inside the write-up, `delivery` holds four fields: `step_order`,
  `click_phrases`, `analogies` and `understanding_checks`.
- **Pass 2.** Its prompt and schema are unchanged.
- **Where `delivery` goes.** It stays out of the chunk text, because the corpus chunk is the
  facts. It is kept with the segment, for the gold-response and voice work.
- **The pilot.** `watch-writeup-pilot.ts` stays as the Step 0 measurement, with its own earlier
  copy of the rules. The canonical rules are now in `segment-videos.ts`.
