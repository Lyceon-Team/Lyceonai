# LISA video library — record

Source: CC Brief "Video Library (ships now)", Karl, 2026-10-15. One row per video, no segmentation.
Extends `video_resources` (created by #1228; no second table).

## What is in the change

| Piece                                                                           | Where                                                                                                                               |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Migration (Karl applies)                                                        | `supabase/migrations/20261104010000_lisa_video_library.sql`                                                                         |
| Gates (CI `pg` job)                                                             | `scripts/ci/video-library-gates.sql` (L1, L2, R1, R2, T1)                                                                           |
| Tagging (Gemini, title + description + chapters)                                | `scripts/rag/tag-videos.ts` → `video-tags-review.csv`                                                                               |
| Write the reviewed file (owner-run)                                             | `scripts/rag/apply-video-library.ts`                                                                                                |
| Step 13d retrieval, index → video, fail open                                    | `server/services/tutor-video-library.ts`, `server/routes/tutor-runtime.ts`                                                          |
| Redaction of unlisted YouTube links                                             | `server/services/tutor-output-serializer.ts`                                                                                        |
| Prompt `lisa-default-v3` (v2 + video rule), `[VIDEOS]` block, `[OFFER_VIDEO n]` | `apps/workers/tutor-orchestrator/src/prompts/`                                                                                      |
| Wire: `offered_videos` (strict, no id), `recommend_video` + `video_index`       | `shared/tutor-orchestrator-wire.ts` (+ generated copy)                                                                              |
| Card and modal (youtube-nocookie embed)                                         | `client/src/components/tutor/VideoRecommendationCard.tsx`, `TutorVideoModal.tsx`                                                    |
| CSP `frame-src https://www.youtube-nocookie.com`                                | `vercel.json`                                                                                                                       |
| Link-rot check (daily, OIDC)                                                    | `server/services/video-link-check.ts`, `POST /api/internal/video-link-check`, `infra/terraform/cloud-scheduler-video-link-check.tf` |

## Owner-run steps, in order

1. Apply the migration; paste `\d video_resources` (proof 1).
2. Review `video-tags-review.csv`: put `yes` in `approve` for each row to go live. You can
   correct a row's `skills` in the file: the file is what gets written, not a fresh model answer.
3. Dry run, then write (one transaction; it fails the whole file on any bad cell):
   ```bash
   pnpm exec tsx scripts/rag/apply-video-library.ts --approver <your auth.users id>
   DATABASE_URL=... pnpm exec tsx scripts/rag/apply-video-library.ts --approver <id> --execute
   ```
4. Deploy the BFF (Vercel) **before** the worker (Cloud Build). The BFF must accept
   `recommend_video` before the worker can send it. Until the worker is on v3, nothing changes.
5. Link check: provision `YOUTUBE_DATA_API_KEY` (restricted to the YouTube Data API v3).
   `terraform apply`; then set `VIDEO_LINK_CHECK_OIDC_AUDIENCE` from the
   `video_link_check_oidc_audience` output. Both are in `infra/secret-class-inventory.yaml`.
   Unset, the route refuses with 500 and an ERROR log, and marks nothing.

## Tagging run (2026-10-15)

163 unique videos from the 17 sources; 174 listings minus 11 duplicates across sources.

| Count | Result                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------ |
| 116   | tagged                                                                                           |
| 47    | no SAT skill (score reveals, predictions, practice-test walkthroughs without chapters, webinars) |
| 0     | failed                                                                                           |

- **Cost:** 164 calls, about $1.45.
- **Failure fixed:** one row first failed because the model mapped a chapter on a video with
  no chapters. Fixed in `toRow`, and the row was re-tagged.
- **YouTube status:** a `videos.list` check through the link-check code on the same day found
  all 163 playable and embeddable.

**Formula Bible (the brief's §12 concern): the tagging is not thin.** Scalar titles every
video by its formula ("Formula 6 – Length of an Arc", "Sum of Solutions for a Quadratic"),
and each maps to one skill cleanly. No next step (chapter titles, first 30 s) is needed for
math.

**Gaps (as of this run):**

- **No video at all** for 4 skills: Inference from Sample Statistics; Evaluating Statistical
  Claims; Cross-Text Connections; Rhetorical Synthesis.
- **Thin verbal coverage:** 1–7 videos per skill.
- **Mostly long videos:** 10 of 116 tagged videos have a chapter start.
- **Very long videos tagged broadly:** the 2–4 hour marathons carry up to 8 skills each.
  Shortest-first ordering ranks them last, but reject them at review if they shouldn't be
  offered at all.

## Method tags (2026-10-27)

Brief "Video retrieval: method tags" (Karl, 2026-10-27), Step 0 ruled; SCL-248 (the §6.7
field) and SCL-249 (the ranking and the contract). Why: a student asked "can you show me how to
do this on desmos" on an Equivalent Expressions item and was offered three formula shorts,
because nothing recorded how a video solves.

**Vocabulary** (`packages/shared/src/video-methods.ts`, the one definition; the SQL CHECKs, the
wire and the keyword map are checked against it in CI):

| `methods`   | Means                                                             | Approved videos       |
| ----------- | ----------------------------------------------------------------- | --------------------- |
| `desmos`    | the answer comes from something typed into Desmos and read back   | 29                    |
| `algebraic` | by hand: rewriting, a formula applied by hand, symbolic reasoning | 44                    |
| `backsolve` | the answer choices, or chosen numbers, are tried in the question  | 4 (in: three or more) |

| `format`         | Means                                                            | Approved videos |
| ---------------- | ---------------------------------------------------------------- | --------------- |
| `formula`        | one formula or rule, about two minutes or less, no full question | 36              |
| `worked_example` | organised around particular questions, each solved               | 14              |
| `lesson`         | a topic or technique taught in general                           | 32              |
| `strategy`       | a list of tips or hacks                                          | 3               |

Reading and Writing videos carry no method. Retrieval order: skill match (required), the
requested method, then format in the order above, then shortest, then id.

**How the 85 were tagged** (`tag-videos.ts --methods`, columns `methods`, `format`,
`method_evidence`, `method_source` at the end of each review row; no other cell changed):
70 from title, description and chapters; **15 needed the video** (Gemini watched the clip the
student would see, twice; a method is kept only when both runs saw it):
`Me3IEHAtESo`, `5VdaJ6HYbD8`, `86LYq7ue-IA`, `52vWohHiyAQ`, `OKGrV3e9aZk`, `I9e7zd1TiDo`, `H3okEuiCaXE`, `uLYm9UC4Wis`, `nLLwupYkfCo`, `YbIToNjrWBE`, `gdaX-8LP1rw`, `qLEVgoVO65U`, `6GLUNxyNuhI`, `JwiaqsMWyfc`, `CnPWdS42whA`.
A video with a start is tagged for the chapter the student lands on. Cost: $4.36 across two
passes (the first pass's prompt let a formula short carry no method and tagged one problem from
its description alone; both fixed, then re-run).

**Owner-run, in order:**

1. Apply `supabase/migrations/20261116000000_lisa_video_methods.sql` (the live BFF keeps
   calling the 2-argument retrieval function).
2. Deploy the worker (its `offered_videos` accepts the optional `methods` and `format`).
3. Deploy the BFF. Never before the worker: the older worker's strict schema refuses the new
   fields.
4. `DATABASE_URL=... pnpm exec tsx scripts/rag/apply-video-library.ts --approver <your id> --execute`.
   Writing methods and format clears every approval; the same transaction approves the 85
   `yes` rows again. Dry run first: `163 rows to tag (121 with skills, 73 with methods, 85 with
a format), 85 to approve`.
5. The closing proof: closure plan R-18.

## Scope calls for Karl

- **Standalone chat** is general mode: there is no item, so there is no skill to match, and
  the server offers no video there. The client renders the card in `/chat` whenever the
  server attaches one. Keying standalone videos on something else (a skill the student names)
  would need a ruling.
- **Practice** is not offered videos. The brief names the review panel and standalone chat,
  and a worked video on the item's skill while the item is unanswered is your call, not a
  default. `VIDEO_SURFACES` in `tutor-video-library.ts` holds the set.
- **A substituted reply** loses its video offer: the BFF anti-leak scan in `orchestrateTurn`
  and the serializer both drop it.
- **SCL question:** Doc 03C V3 §6.7 locks `suggested_action.type` as `none |
offer_similar_question | offer_broader_coaching | offer_stay_focused`. This change adds
  `recommend_video`. `start_practice` was added earlier without an SCL entry. Does the enum
  (and the `lisa-default-v3` artifact) need an SCL entry? No number has been allocated.
- **CSP:** `frame-src` gains `https://www.youtube-nocookie.com`, a third-party frame on
  student pages. The brief names the nocookie embed; this records the CSP widening for
  explicit sign-off.

## UI standards check (DESIGN.md §5)

- [x] One filled primary per screen: Watch is an outline control.
- [x] Nothing below 14px: text uses `text-lyc-body` throughout.
- [x] Tokens only, no raw hex: `lyc-sheet`, `lyc-rule`, `lyc-ink*`, `lyc-hover`.
- [x] Long labels clamp to two lines: the title uses `ClampedLabel`.
- [x] Empty, loading and error states: no video renders no card. Any error fails open to no
      card. The iframe mounts only when the modal is open.
- [ ] Screenshots: to attach once the migration is applied and rows are approved (proofs 3–4).

## Expansion (2026-10-27)

Brief "Expand the video library" (Karl, 2026-10-27). Step 0 (coverage and sources) ruled: the
recommended set, 67 videos, cap $8. Why: no approved video for Inference from Sample Statistics,
Evaluating Statistical Claims, Central Ideas, Command of Evidence, Cross-Text Connections,
Rhetorical Synthesis or Text Structure; probability, area and volume and every other RW skill
thin.

**Sources** (58 new `sources.json` entries, all published 2023–2026, all embeddable):

| Group | Source                                                                                  | Videos | Tier       |
| ----- | --------------------------------------------------------------------------------------- | ------ | ---------- |
| A     | Scalar Learning, "Digital SAT Math on Khan Academy" (6 picks)                           | 6      | 2          |
| B     | Penguin SAT Prep: Information & Ideas, Craft & Structure, Expression of Ideas + 4 picks | 16     | 5 (strict) |
| C     | 3-4-5 Tutoring (20 picks; its playlists mix likely members-only and 18–52 min videos)   | 20     | 3          |
| D     | Settele Tutoring (19 picks: Question Bank exercises, a probability lesson, grammar)     | 19     | 3          |
| E     | Dr. TestPrep (6 math picks). **Tier 5, a small channel: judge teaching quality**        | 6      | 5 (strict) |

Dr. TestPrep's 3 RW unit playlists are left out (depth, no new gaps). Its rows' `source` cell
carries the tier-5 flag, so it shows in the review file itself.

**How it ran** (no pipeline code changed): `fetch-video-metadata.ts` for all 75 sources; the tag
pass on a metadata file holding only the 67 new videos (the pass rewrites the whole review file
from its own rows, which would have reset the 163 reviewed ones), its rows appended under the
committed file; then `tag-videos.ts --methods` on the proposed approvals, with the 2026-10-27
methods cache, so the 85 already approved were answered from cache. The 163 existing rows are
byte-identical to before.

| Pass           | Calls | Cost   | Result                                                     |
| -------------- | ----- | ------ | ---------------------------------------------------------- |
| Skill tags     | 67    | $0.467 | 66 tagged, 1 with no SAT skill, 0 failed                   |
| Methods/format | 102   | $1.759 | 66 rows; 48 from text, 18 needed the video (watched twice) |
| **Total**      |       | $2.23  | cap $8                                                     |

**The proposal** (`expansion-2026-10-27-proposal.csv`, one line per new row): `approve` is
pre-filled `yes` on the 65 proposed approvals, blank on the other two.

- **Drop (1):** `eCmWcSdjt7E` Penguin "MUST KNOW SAT Reading Hacks": no single SAT skill, so
  retrieval could never offer it.
- **Retag (1):** `ljryBGiTLkM` Dr. TestPrep Area and Volume: `desmos` came from a line every
  Dr. TestPrep description carries ("shows how to use the Desmos calculator"), not from the video.
  The other five Dr. TestPrep videos were watched and are mostly algebraic. Its method cells are
  cleared; the skill tag is right.
- **Narrow (0):** the two two-skill rows hold up ("All of SAT Grammar in 7 Minutes": Boundaries and
  Form, Structure, and Sense; 3-4-5's "Three Main Types of Transition Words": Transitions and
  their punctuation).

**Coverage once approved as proposed** (150 approved): every one of the 29 skills has a video.
Probability 1 → 4, Inference from Sample Statistics 0 → 2, Evaluating Statistical Claims 0 → 2,
Area and Volume 3 → 4, Two-Variable Data 5 → 7, One-Variable Data 4 → 6; Central Ideas 0 → 5,
Command of Evidence 0 → 9, Cross-Text 0 → 5, Rhetorical Synthesis 0 → 4, Text Structure 0 → 6,
Inferences 1 → 5, Words in Context 3 → 6, Transitions 5 → 8, Boundaries 3 → 12, Form, Structure,
and Sense 2 → 9.

**Owner-run, after review:** change `approve` where the proposal is wrong, then

```bash
pnpm exec tsx scripts/rag/apply-video-library.ts --approver <your auth.users id>   # dry run
DATABASE_URL='<Session pooler connection string>' pnpm exec tsx scripts/rag/apply-video-library.ts --approver <id> --execute
```

Use the Session pooler connection string (Supabase: Connect → Session pooler), not
`db.<ref>.supabase.co`, which fails on IPv4 networks. The dry run on the proposal reads
`230 rows to tag (187 with skills, 84 with methods, 150 with a format), 150 to approve`. A row
approved without methods (the retag, if approved as is) needs `tag-videos.ts --methods` first.
