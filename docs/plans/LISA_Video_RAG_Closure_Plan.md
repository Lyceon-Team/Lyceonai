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
| **B** | Remove caller-supplied `is_pre_submit` from `RetrievalRequest`; correct the stale SCL-060 comment | `packages/shared/tutor-rag-types.ts` on `lisa` has no `is_pre_submit` field and no SCL-060 reference. `git grep -n "tutor-rag-types"` outside the file returns only its contract test, so there are no runtime importers. `tests/ci/tutor-rag-types.contract.test.ts` passes, and planting the field back reddens all three cases. Build and tests pass. There is no production observation for a type with no consumers, so the merged diff plus this output is the proof, as stated up front | CC | IN PROGRESS — branch `claude/lisa-video-rag-step-b` |

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
| **D** | Ingestion, reworked (plan Step D, 2026-10-13): build-time pipeline A–F. `fetch-video-metadata.ts` → `video_resources`; `fetch-transcripts.ts` (local cache, discarded); content gate + `generate-descriptions.ts`; `map-skills.ts` (29 taxonomy names); automated gates; one `RagFile` per segment, metadata attached after import | The proofs in plan §D.4: (1) `video_resources` rows for the seeded set; (1a) the content-gate report, segments dropped by channel with reasons; (2) corpus items retrievable by direct `retrieveContexts`, every file carrying all four `ragMetadata` keys with values from the locked enums; (3) the per-skill sample, at least 5 per tagged skill, reviewed by Karl, each description against its timestamp; (4) zero transcript text in the corpus, asserted against the cache **before** it is deleted; (5) every `skill_codes` value in the corpus is one of the 29 names in `content/canonical/taxonomy.json` | CC builds, Karl reviews sample | OPEN |
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
| **R-1** | **The provisioning script creates no metadata schema.** **Proposed resolution, 2026-10-13 (awaiting Karl's ruling):** (1) **Where:** in Step C, by the provisioning script, straight after `createRagCorpus`. A v1beta1 `ragDataSchemas:batchCreate` creates the four keys: `skill_codes` LIST, `provenance` STRING, `surface_gate` STRING, `content_type` STRING. Not Step D: the keys must exist before any file gets metadata, and C's proof (2) observes them. (2) **Mode:** metadata search isn't supported in Serverless mode, and Spanner mode is the project default when no mode was chosen ([deployment modes](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/rag-engine/deployment-modes)). The mode is project-level (`GetRagEngineConfig` / `UpdateRagEngineConfig`), so Step A's pre-flight adds: `GetRagEngineConfig` must report Spanner mode. Spanner mode's Basic tier is a provisioned instance billed while it exists, and Karl should check its price before C. (3) **The script can't run as written:** `@google-cloud/aiplatform` isn't a dependency (absent from `package.json`). Calling the v1beta1 REST endpoints with an ADC token avoids a dependency change. (4) **If list filtering fails at E (R-2):** filter `skill_codes` in our retrieval service after retrieval, where `surface_gate` is already evaluated (§6.8). Retrieve a larger candidate set and drop the off-skill items. The schema doesn't change | Decides Step C | PROPOSED — awaiting ruling |
| **R-2** | **Skill filtering on a list key is undocumented.** The docs list a `LIST` type but give neither its element type nor a list-membership filter syntax. If `skill_codes` can't be filtered as a list, the plan's skill-scoped filter fails, and E's negative control is what catches it | If this needs a different key type, it has to be chosen before keys exist | OPEN |
| **R-3** | **Title, channel and availability have no home.** Resolved in design by the reworked Step D: a `video_resources` Postgres table, read by Step I and joined at render time. Still owed: the migration (with RLS, server-read only; the client gets these through the BFF, never by querying the table), and a ruling on who writes it. The writer is a workstation script, and per CLAUDE.md production writes are owner-run | Doesn't touch the corpus schema | DESIGNED — migration OPEN |
| **R-4** | **Transcript sourcing.** The rework drops the production dependency and Whisper: transcripts are fetched at build time on a workstation, read once and deleted. What remains is that the fetch still goes through the endpoints §D.1 describes as scraped and actively defended (InnerTube / timedtext). Moving it to a workstation changes *where* it runs, not whether YouTube's terms allow it. The terms question is Karl's to rule on before §D.2 B runs at scale | Before D | OPEN — needs ruling |
| **R-5** | **The §D.2 F example values weren't valid under the locked enums.** Ruled 2026-10-13 (Karl): `surface_gate: "pre_and_post"` and `content_type: "video_transcript"`. Applied in plan §D.2 F | — | CLOSED — ruling applied |
| **R-6** | **Skill codes are skill strings, not short codes.** Ruled 2026-10-13 (Karl): `skill_codes` are the 29 full names in `content/canonical/taxonomy.json`. Production holds zero code-shaped values, per the owner's report of 2026-10-13. Applied in plan §D.2 D and F | — | CLOSED — ruling applied |
| **R-7** | **Metadata is per `RagFile`, not per chunk.** Ruled 2026-10-13 (Karl): one file per segment, with metadata attached after import via v1beta1 `ragMetadata:batchCreate`. Applied in plan §D.2 F, with a completeness check so no file is left without metadata | — | CLOSED — ruling applied |
| **R-8** | **Chapter-marker frequency is unknown until the channel list exists.** §D.6 asks for it, and it can't be measured without the seed channels and playlists. Once Karl names them, `fetch-video-metadata.ts` can report the share of videos with chapters before any transcript is fetched | Before D runs | OPEN — needs the seed list |
