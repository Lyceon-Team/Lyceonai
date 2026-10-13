# LISA Video RAG — Closure Plan

**Design:** `docs/plans/LISA_Video_RAG_Plan.md`. **Governing spec:** Doc 03D V1.2 §6.
**Shape:** follows `docs/plans/LISA_Closure_Plan.md`. One row per plan step, A–I.
**Base:** `main` at `f7e004b`. `lisa` is 1,404 commits behind `main`, and its `ci-known-gaps` check is red on an expired entry (`typecheck-ci-tsconfig`, expired 2026-10-01). Karl has not cleared it.

---

## The rules

These are the rules of `LISA_Closure_Plan.md`, applied here unchanged.

1. **A row closes only on its named proof observed in production.** A merged PR, green CI or a passing test does not close it.
2. **The proof is written before the work starts.** The proofs below are those proofs. A row whose proof can't be stated isn't ready to start.
3. **The PR that closes a row updates this file**, with the proof output pasted in and the date.
4. **Status is `OPEN`, `IN PROGRESS` or `CLOSED`.** There is no partial.
5. **A new finding becomes a row.** It does not get chased.
6. **One PR per step.** Each PR closes one row.

---

## Wave 1 — Before anything is provisioned

| ID | Item | Proof | Owner | Status |
|---|---|---|---|---|
| **A** | Embedding-model pre-flight | The supported-embedding-models page for RAG Engine, read on the day of provisioning. Paste the model list and the date, and say whether `gemini-embedding-001` appears. Karl's go or stop on `text-embedding-005` is recorded here | Karl | OPEN |
| **B** | Remove caller-supplied `is_pre_submit` from `RetrievalRequest`; correct the stale SCL-060 comment | `packages/shared/tutor-rag-types.ts` on `main` has no `is_pre_submit` field and no SCL-060 reference. `git grep -n "tutor-rag-types"` outside the file returns nothing, so there are still zero importers. Build and tests pass. There is no production observation for a type with no consumers, so the merged diff plus `git grep` output is the proof, and that is stated here up front | CC | OPEN |

**A blocks C.** B also goes before C.

---

## Wave 2 — Irreversible

| ID | Item | Proof | Owner | Status |
|---|---|---|---|---|
| **C** | Provision the corpus | (1) `ragCorpora.get` on the resource name returns the corpus with `text-embedding-005` as its embedding model. (2) `ragDataSchemas.list` on the corpus returns exactly four keys: `skill_codes`, `provenance`, `surface_gate`, `content_type`. (3) `RAG_CORPUS_RESOURCE_NAME` is in the env schema and set in Vercel Production. Paste all three | Karl | OPEN |

**C is Karl's to run.** Proof (2) depends on finding R-1 below, which must be resolved first.

---

## Wave 3 — Content, then quality

| ID | Item | Proof | Owner | Status |
|---|---|---|---|---|
| **D** | Ingestion: `scripts/rag/ingest-youtube.ts`, `scripts/rag/map-skills.ts` | For a named sample of ingested segments, show each segment's `ragMetadata`: `skill_codes` is a non-empty array whose codes all exist in the taxonomy; `provenance` matches `^youtube:[A-Za-z0-9_-]{11}:\d+-\d+$`; `content_type` is `video_transcript`. A direct `retrieveContexts` query returns those segments. The skill-tag review record is attached | CC builds, Karl reviews tags | OPEN |
| **E** | Retrieval quality gate (§6.7) | For each skill in the query set: the query, the top-K returned with provenance, and Karl's verdict. Include one **negative control** per skill: a query whose filter names skill X returns no segment tagged only with skill Y. Without this control, an ignored filter looks like a working one. Also include one gated item that the gate is shown to drop | Karl | OPEN |

**E is a gate.** If results are poor, the fix is chunking or skill tags. A prompt instruction is not a fix. F does not start until E is closed.

---

## Wave 4 — Into the turn

| ID | Item | Proof | Owner | Status |
|---|---|---|---|---|
| **F** | Envelope: `retrieved_video_resources`, queried at 13d | A production turn's assembled system instruction showing the video block, with the turn ID. Two more turns on the same deployment: (a) a crisis turn, where logs show no retrieval call; (b) a turn with retrieval forced to fail, which logs at ERROR and completes with no video block | CC | OPEN |
| **G** | Worker: `lisa-default-v3` composing v2, plus `renderVideoResourcesBlock()` | A production turn on the v3 worker revision where the model emits `recommend_video`. The worker strips the marker, the BFF attaches provenance from the turn's retrieved set, and the visible reply contains no video identifier or URL. The BFF revision is deployed and live **before** the worker revision; paste both revision IDs and their times | CC builds; Cloud Build | OPEN |

**G: the BFF deploys before the worker.** Otherwise the BFF rejects a worker response that carries an unknown action type.

---

## Wave 5 — The student sees it

| ID | Item | Proof | Owner | Status |
|---|---|---|---|---|
| **H** | Client: `TutorVideoModal.tsx`, `VideoRecommendationCard`, `useTutorTurn.ts` | In production, a student in review is offered a video, opens it, and it plays from the segment start on `youtube-nocookie.com` and closes at the segment end. Screenshots, plus the §5 UI-standards checklist | CC | OPEN |
| **I** | Link rot | A forced run of the scheduled check marks a known-deleted or privated video unavailable, and the next turn's resolver skips it. Paste the log line and the turn | CC | OPEN |

---

## Standing items

| ID | Item | Owner | Status |
|---|---|---|---|
| **S-1** | **Doc 03D §6.3 amendment owed by SCL-144.** The owner action ("amend Doc 03D §6.2, §6.3, §6.6 to 'explanation is delivered post-submit only'; mark SCL-060 superseded") is still open. The locked §6.3 table still says what SCL-144 reversed. Out of scope here; recorded so it isn't lost | Karl | OPEN |
| **S-2** | **Same-skill explanation retrieval is not being reinstated** (Karl, 2026-10-13). No deterministic path, no `retrieved_curriculum`, no new SCL. The question bank stays out of retrieval. Explanations still reach the model as they do today: the active question's, post-submit, by direct column read. Recorded so a later edit doesn't rebuild what `47ffffd7` deleted | — | RULING |

---

## Findings to resolve before C

These are rows under rule 5. Each needs a ruling, not a chase.

| ID | Finding | Why before C | Status |
|---|---|---|---|
| **R-1** | **The provisioning script creates no metadata schema.** `rag-corpus-create.ts` calls `createRagCorpus` with only an embedding-model config, then *prints* the four fields. In RAG Engine, metadata keys are separate `RagDataSchema` child resources, created on an existing corpus. Metadata search is Preview, `v1beta1` only, and not supported in serverless mode. Chunking is not in the create call either. So "run the script unchanged in schema" means running a script with no schema in it. Either the script gains a `ragDataSchemas:batchCreate` for the four locked keys, or Step D creates them. That choice decides what C's proof (2) observes | C's proof can't be observed without it | OPEN |
| **R-2** | **Skill filtering on a list key is undocumented.** The docs list a `LIST` type but give neither its element type nor a list-membership filter syntax. If `skill_codes` can't be filtered as a list, the plan's skill-scoped filter fails, and E's negative control is what catches it | If this needs a different key type, it has to be chosen before keys exist | OPEN |
| **R-3** | **Title, channel and availability have no home.** The plan keeps them out of corpus metadata. Step I has to "mark unavailable" somewhere the resolver reads, and four locked fields leave no room. Two options, both outside the corpus schema: a Postgres table keyed by `video_id` (a migration the plan doesn't list), or deleting the `RagFile` on rot | Doesn't widen the schema, but the plan should name it | OPEN |
| **R-4** | **Transcript sourcing for third-party videos.** `captions.download` in the YouTube Data API serves captions only to the video's owner. The Whisper fallback needs the audio file, which YouTube's terms don't permit downloading from someone else's video. Cost is not the issue: about $0.006/min for `whisper-1`, so about $360 per 1,000 hours of video. Latency is irrelevant for batch ingestion. Under managed-service-first, the GCP equivalent is Speech-to-Text (Chirp) | Reported before D, as the brief asks | OPEN |
