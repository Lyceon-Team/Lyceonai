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
| **D** | Ingestion, reworked (plan Step D, 2026-10-13): build-time pipeline A–F. `fetch-video-metadata.ts` → `video_resources`; `fetch-transcripts.ts` (local cache, discarded); `generate-descriptions.ts`; `map-skills.ts`; automated gates; import | The five proofs in plan §D.4: (1) `video_resources` rows for the seeded set; (2) corpus items retrievable by direct `retrieveContexts`, `ragMetadata` valid against the four keys; (3) the 5% sample reviewed by Karl, each description against its timestamp; (4) zero transcript text in the corpus, asserted **against the cache before the cache is deleted** (§D.2 deletes it after C, and §D.4 asserts against it, so the order has to be fixed); (5) every `skill_codes` value in the corpus is a skill string in `content/canonical/taxonomy.json` | CC builds, Karl reviews sample | OPEN |
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

## Findings to resolve (before C or D, as each row says)

These are rows under rule 5. Each needs a ruling, not a chase.

| ID | Finding | Why before C | Status |
|---|---|---|---|
| **R-1** | **The provisioning script creates no metadata schema.** `rag-corpus-create.ts` calls `createRagCorpus` with only an embedding-model config, then *prints* the four fields. In RAG Engine, metadata keys are separate `RagDataSchema` child resources, created on an existing corpus. Metadata search is Preview, `v1beta1` only, and not supported in serverless mode. Chunking is not in the create call either. So "run the script unchanged in schema" means running a script with no schema in it. Either the script gains a `ragDataSchemas:batchCreate` for the four locked keys, or Step D creates them. That choice decides what C's proof (2) observes | C's proof can't be observed without it | OPEN |
| **R-2** | **Skill filtering on a list key is undocumented.** The docs list a `LIST` type but give neither its element type nor a list-membership filter syntax. If `skill_codes` can't be filtered as a list, the plan's skill-scoped filter fails, and E's negative control is what catches it | If this needs a different key type, it has to be chosen before keys exist | OPEN |
| **R-3** | **Title, channel and availability have no home.** Resolved in design by the reworked Step D: a `video_resources` Postgres table, read by Step I and joined at render time. Still owed: the migration (with RLS, server-read only; the client gets these through the BFF, never by querying the table), and a ruling on who writes it. The writer is a workstation script, and per CLAUDE.md production writes are owner-run | Doesn't touch the corpus schema | DESIGNED — migration OPEN |
| **R-4** | **Transcript sourcing.** The rework drops the production dependency and Whisper: transcripts are fetched at build time on a workstation, read once and deleted. What remains is that the fetch still goes through the endpoints §D.1 describes as scraped and actively defended (InnerTube / timedtext). Moving it to a workstation changes *where* it runs, not whether YouTube's terms allow it. The terms question is Karl's to rule on before §D.2 B runs at scale | Before D | OPEN — needs ruling |
| **R-5** | **The §D.2 F example values aren't valid under the locked enums.** `surface_gate: "any"` isn't in `pre_and_post \| post_only \| review_only`, and `content_type: "video_segment"` isn't in `textbook \| video_transcript \| strategy \| worked_example` (`packages/shared/tutor-rag-types.ts`, `ragCorpusMetadataSchema`). Keeping the schema locked means using `pre_and_post` and `video_transcript`. Any other value is a schema change | Values are fixed at import | OPEN |
| **R-6** | **Skill codes are skill strings, not short codes.** The bank writes `skill_codes` as `ARRAY[q.skill]`, taking the skill name from `content/canonical/taxonomy.json` (for example `"Linear Equations in One Variable"`; `scripts/assemble-batch.ts:922`). `"ALG-LIN-01"` doesn't exist. §D.2 D's enumerated list is therefore `taxonomy.json` `skills`. Older test fixtures use `"LIN"` / `"ALG"`, so whether every production question carries taxonomy strings is unverified from here. Owner-run check: `select distinct unnest(skill_codes) from questions;`. A question with a non-taxonomy code would never match a corpus tag, and the miss would be silent | Tags are fixed at import | OPEN |
| **R-7** | **The import shape: metadata is per `RagFile`, not per chunk.** RAG Engine attaches `ragMetadata` to a file and filters at file level ([docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/rag-engine/use-metadata-search)). It documents no JSONL import with per-record metadata. So a JSONL file holding many segments gets one set of metadata for all of them, and each segment's `provenance` is lost. Each segment has to be its own `RagFile`, small enough to stay one chunk, with its metadata attached by `ragMetadata:batchCreate`. Combined with R-1, that settles what F actually does | Decides the importer before D is built | OPEN |
| **R-8** | **Chapter-marker frequency is unknown until the channel list exists.** §D.6 asks for it, and it can't be measured without the seed channels and playlists. Once Karl names them, `fetch-video-metadata.ts` can report the share of videos with chapters before any transcript is fetched | Before D runs | OPEN — needs the seed list |
