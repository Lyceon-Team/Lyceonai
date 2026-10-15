# LISA video library — record

Source: CC Brief "Video Library (ships now)", Karl, 2026-10-15. One row per video, no segmentation.
Extends `video_resources` (created by #1228; no second table).

## What is in the change

| Piece                                                                           | Where                                                                                                                               |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Migration (Karl applies)                                                        | `supabase/migrations/20261102000000_lisa_video_library.sql`                                                                         |
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
