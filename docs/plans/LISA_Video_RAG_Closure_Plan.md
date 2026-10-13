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
| **B** | Remove caller-supplied `is_pre_submit` from `RetrievalRequest`; correct the stale SCL-060 comment | **Closed 2026-10-13, #1226 (merged `b274bc69`).** On `lisa`: `git grep -n is_pre_submit -- packages/shared/tutor-rag-types.ts` returns nothing. The one SCL-060 mention left is the corrected comment, which records SCL-060 as reversed by SCL-144. Outside the file, `tutor-rag-types` is named only by `tests/ci/tutor-rag-types.contract.test.ts` and these two plan docs, so there are no runtime importers. The contract test passed 3/3, and with the field planted back it fails 3/3. `pnpm -s run build` exit 0; `pnpm test` exit 0, `Test Files 460 passed \| 70 skipped (530)`, `Tests 5953 passed \| 972 skipped (6925)`. Regression guard: the contract test | CC | CLOSED |

**A blocks C.** B also goes before C.

---

## Wave 2 — Irreversible

| ID | Item | Proof | Owner | Status |
|---|---|---|---|---|
| **C** | Provision the corpus: Serverless mode, `us-central1`, `text-embedding-005` (R-1 ruling 2026-10-13) | (1) `ragEngineConfig` for `us-central1` reads `serverless`. (2) `ragCorpora.get` on the resource name shows `ragManagedVertexVectorSearch` and `text-embedding-005`, and exactly one corpus carries the display name `lyceon-lisa-curriculum-v1`. (3) `RAG_CORPUS_RESOURCE_NAME` is in the env schema (`packages/shared/src/env.ts`) and set in Vercel Production. Paste all three. No metadata keys are created: Serverless mode has none | Karl approves; CC runs `scripts/provisioning/rag-corpus-create.ts --execute` | OPEN |

**C is Karl's to run.** Proof (2) depends on finding R-1 below, which must be resolved first.

---

## Wave 3 — Content, then quality

| ID | Item | Proof | Owner | Status |
|---|---|---|---|---|
| **D** | Ingestion, reworked (plan Step D, 2026-10-13): build-time pipeline A–F. `fetch-video-metadata.ts` → `video_resources`; `fetch-transcripts.ts` (local cache, discarded); content gate + `generate-descriptions.ts`; `map-skills.ts` (29 taxonomy names); automated gates; one `RagFile` per segment, metadata attached after import | The proofs in plan §D.4: (1) `video_resources` rows for the seeded set; (1a) the content-gate report, segments dropped by channel with reasons; (2) corpus items retrievable by direct `retrieveContexts`, every file carrying all four `ragMetadata` keys with values from the locked enums; (3) the per-skill sample, at least 5 per tagged skill, reviewed by Karl, each description against its timestamp; (4) zero transcript text in the corpus, asserted against the cache **before** it is deleted; (5) every `skill_codes` value in the corpus is one of the 29 names in `content/canonical/taxonomy.json` | CC builds, Karl reviews sample | IN PROGRESS — sub-step A (sources + metadata) in #1228 |
| **E** | Retrieval quality gate (§6.7) | For each skill in the query set: the query, the top-K returned with provenance, and Karl's verdict. Include one **negative control** per skill: a query whose filter names skill X returns no segment tagged only with skill Y. Without this control, an ignored filter looks like a working one. Also include one gated item that the gate is shown to drop. **Retrieval latency and yield** (owner 2026-10-13): for each query, record the retrieve call's wall-clock time and the BFF skill-filter time, with p50/p95 per N tried (starting at N=20). Also record **yield**: how many of the N survive the skill filter on a typical query, per skill. These set N before it reaches students | Karl | OPEN |

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
| **R-1** | **Where the four metadata keys get created.** **Ruled 2026-10-13 (Karl): Serverless mode, `us-central1`.** No `RagDataSchema` keys exist, so the key-spelling problem (keys allow only `/a-z-/`) is moot. `skill_codes`, `provenance`, `surface_gate` and `content_type` stay as fields inside each record and are read by the BFF after retrieval. Basis: the throwaway-corpus test found Spanner mode allowlist-gated in `us-central1` and failing `INTERNAL` / *"No available indexing project"* in `us-east5`, `us-south1` and `us-west1`; waiting on an allowlist is an indefinite block. Probe kept (`scripts/rag/probe-rag-data-schema.ts`), with its cleanup of every corpus carrying the run's display name | — | CLOSED — ruling |
| **R-2** | **Skill filtering.** **Ruled 2026-10-13 (Karl):** there is no Vertex-side metadata filter in Serverless mode. The BFF's in-memory `skill_codes` check is the only skill filter. Over-fetch and filter: retrieve the top N semantically (start N=20), keep the items whose `skill_codes` include the active skill, take the best few. Step E's latency and yield numbers set the real N | — | CLOSED — ruling |
| **R-3** | **Title, channel and availability have no home.** Resolved in design by the reworked Step D: a `video_resources` Postgres table, read by Step I and joined at render time. Still owed: the migration (with RLS, server-read only; the client gets these through the BFF, never by querying the table), and a ruling on who writes it. The writer is a workstation script, and per CLAUDE.md production writes are owner-run | Doesn't touch the corpus schema | DESIGNED — migration OPEN |
| **R-4** | **Transcript sourcing.** Ruled 2026-10-13 (Karl): **go.** The build-time transcript fetch proceeds, read once and deleted (plan §D.2 B) | — | CLOSED — ruling |
| **R-5** | **The §D.2 F example values weren't valid under the locked enums.** Ruled 2026-10-13 (Karl): `surface_gate: "pre_and_post"` and `content_type: "video_transcript"`. Applied in plan §D.2 F | — | CLOSED — ruling applied |
| **R-6** | **Skill codes are skill strings, not short codes.** Ruled 2026-10-13 (Karl): `skill_codes` are the 29 full names in `content/canonical/taxonomy.json`. Production holds zero code-shaped values, per the owner's report of 2026-10-13. Applied in plan §D.2 D and F | — | CLOSED — ruling applied |
| **R-7** | **Metadata is per `RagFile`, not per chunk.** Ruled 2026-10-13 (Karl): one file per segment, with metadata attached after import via v1beta1 `ragMetadata:batchCreate`. Applied in plan §D.2 F, with a completeness check so no file is left without metadata | — | CLOSED — ruling applied |
| **R-8** | **Chapter-marker frequency.** The seed list is in `scripts/rag/sources.json` (#1228), and `fetch-video-metadata.ts` reports video count, availability and chapter coverage per source before any transcript is fetched. **Blocked 2026-10-13 on credential injection:** requests to `youtube.googleapis.com` get proxy `502 injection failed ("YouTube Data API")`; requests to `www.googleapis.com` get the GCP token and YouTube answers 403 *"Request had insufficient authentication scopes"*. The script uses `youtube.googleapis.com` and reports that 502 as a credential problem | Before D runs | OPEN — needs the YouTube secret's injection fixed |
