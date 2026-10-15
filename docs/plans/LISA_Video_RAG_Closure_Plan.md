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
| **A** | Embedding-model pre-flight | *Revised 2026-10-15 (pgvector, SCL-231 PROPOSED): there is no RAG Engine supported-models list to read; the check is the dimension.* `text-embedding-005`'s output dimension, read from the live model: **768**, 2026-10-15, one `:predict` call on `us-central1-aiplatform.googleapis.com` (`200`, `dims=768`). `curriculum_chunks.embedding` is `vector(768)`. Karl's go or stop on `text-embedding-005` is recorded here. It is still the decision that costs a re-embed of every row to change | Karl | OPEN — dimension confirmed; Karl's go owed |
| **B** | Remove caller-supplied `is_pre_submit` from `RetrievalRequest`; correct the stale SCL-060 comment | **Closed 2026-10-13, #1226 (merged `b274bc69`).** On `lisa`: `git grep -n is_pre_submit -- packages/shared/tutor-rag-types.ts` returns nothing. The one SCL-060 mention left is the corrected comment, which records SCL-060 as reversed by SCL-144. Outside the file, `tutor-rag-types` is named only by `tests/ci/tutor-rag-types.contract.test.ts` and these two plan docs, so there are no runtime importers. The contract test passed 3/3, and with the field planted back it fails 3/3. `pnpm -s run build` exit 0; `pnpm test` exit 0, `Test Files 460 passed \| 70 skipped (530)`, `Tests 5953 passed \| 972 skipped (6925)`. Regression guard: the contract test | CC | CLOSED |

**A blocks C.** B also goes before C.

---

## Wave 2 — The store *(revised 2026-10-15: pgvector, not Vertex AI RAG Engine; SCL-231 PROPOSED)*

| ID | Item | Proof | Owner | Status |
|---|---|---|---|---|
| **C** | The store: `curriculum_chunks` + `video_resources` in Postgres with pgvector (plan Step C, revised 2026-10-15). Migration `supabase/migrations/20261101000000_lisa_curriculum_chunks.sql`: the table, GIN on `skill_codes`, HNSW cosine on `embedding`, the partial active index, `unique (provenance)`; RLS on with zero policies and no anon/authenticated privilege; `curriculum_chunk_upsert` (the one writer) and `curriculum_chunks_search` (the Step F query) | (1) In production, the table and all four indexes exist: `\d curriculum_chunks` output pasted here. (2) `video_resources` exists. (3) `has_table_privilege('authenticated', 'public.curriculum_chunks', 'SELECT')` is `false`. CI already proves the shape and behaviour on every push: `scripts/ci/curriculum-chunks-gates.sql` (S1–S3, R1–R4, U1) in the `pg` job, the genesis snapshot, and `scripts/ci/curriculum-chunks.mutations.sh` in `ci-full` (seven plants, each red on its named gate; 8/8 locally 2026-10-15) | Karl applies the migration (owner-run); CC authored it | IN PROGRESS — migration and gates in #1228; production apply owed. The Vertex path this row used to describe is retired: see R-11 |

**C is Karl's to apply.** Production writes are owner-run (CLAUDE.md). The dimension in A is the one thing that can't be changed cheaply afterwards.

---

## Wave 3 — Content, then quality

| ID | Item | Proof | Owner | Status |
|---|---|---|---|---|
| **D** | Ingestion, reworked (plan Step D, 2026-10-13; sub-step F revised 2026-10-15): build-time pipeline A–F. `fetch-video-metadata.ts` → `video_resources`; `fetch-transcripts.ts` (local cache, discarded); content gate + `generate-descriptions.ts`; `map-skills.ts` (29 taxonomy names); automated gates; embed each description with `text-embedding-005` and write it through `curriculum_chunk_upsert` (no GCS, no import) | The proofs in plan §D.4: (1) `video_resources` rows for the seeded set; (1a) the content-gate report, segments dropped by channel with reasons; (2) `curriculum_chunks` rows retrievable through `curriculum_chunks_search`, every row valid under the table's CHECKs (they refuse anything else); (3) the per-skill sample, at least 5 per tagged skill, reviewed by Karl, each description against its timestamp, and only reviewed rows `active`; (4) zero transcript text in `curriculum_chunks`, asserted against the cache **before** it is deleted; (5) every `skill_codes` value is one of the 29 names in `content/canonical/taxonomy.json` | CC builds, Karl reviews sample | IN PROGRESS — sub-step A (sources + metadata) in #1228 |
| **E** | Retrieval quality gate (§6.7) | For each skill in the query set: the query, the top-K returned with provenance, and Karl's verdict. Include one **negative control** per skill: a query whose filter names skill X returns no segment tagged only with skill Y. Without this control, an ignored filter looks like a working one (it is also proved at the SQL level in CI, gate R1). Also include one gated item that the gate is shown to drop. **Latency** *(revised 2026-10-15: the skill filter runs in the database, so the over-fetch yield measurement is dropped)*: p50/p95 for the query embedding call and for the `curriculum_chunks_search` SQL, **reported separately**. If the embedding call pushes retrieval past ~300ms, report it; caching query embeddings is the next lever (R-13) | Karl | OPEN |

**E is a gate.** If results are poor, the fix is chunking or skill tags. A prompt instruction is not a fix. F does not start until E is closed.

---

## Wave 4 — Into the turn

| ID | Item | Proof | Owner | Status |
|---|---|---|---|---|
| **F** | Envelope: `retrieved_video_resources`, queried at 13d *(retrieval revised 2026-10-15: embed the sanitized message, then `curriculum_chunks_search`; no over-fetch)* | A production turn's assembled system instruction showing the video block, with the turn ID. More turns on the same deployment: (a) a crisis turn, where logs show no embedding or retrieval call; (b) a turn with the embedding call forced to fail, and (c) one with the SQL forced to fail: each logs at ERROR and completes with no video block. Step F's own tests: embedding failure, SQL failure, and `provenance` absent from the assembled prompt | CC | OPEN |
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
| **R-1** | **Where the four metadata keys get created.** Ruled 2026-10-13 (Karl): Serverless mode, `us-central1`, no `RagDataSchema` keys. **Superseded 2026-10-15** by the pgvector revision (SCL-231, PROPOSED): the four fields are columns of `curriculum_chunks`, with CHECKs carrying the enums. The probe (`scripts/rag/probe-rag-data-schema.ts`) is deleted with the Vertex path; its findings are recorded in R-11 | — | CLOSED — superseded (pgvector) |
| **R-2** | **Skill filtering.** Ruled 2026-10-13 (Karl): BFF in-memory `skill_codes` check after an over-fetch of N=20, because Serverless mode had no metadata filter (and a CEL filter on a list field was silently ignored). **Superseded 2026-10-15** by the pgvector revision: the filter is `skill_codes && $skills` inside the retrieval statement, on the GIN index. No over-fetch, no in-memory filter, no N to set | — | CLOSED — superseded (pgvector) |
| **R-3** | **Title, channel and availability have no home.** Resolved in design by the reworked Step D: a `video_resources` Postgres table, read by Step I and joined at render time. **Migration authored 2026-10-15** in `20261101000000_lisa_curriculum_chunks.sql` (RLS on, zero policies, service role only; the client gets these through the BFF, never by querying the table). Still owed: the production apply, and a ruling on who writes it. The writer is a workstation script, and per CLAUDE.md production writes are owner-run | Doesn't touch the corpus schema | DESIGNED — migration authored (#1228), apply OPEN |
| **R-4** | **Transcript sourcing.** Ruled 2026-10-13 (Karl): **go.** The build-time transcript fetch proceeds, read once and deleted (plan §D.2 B) | — | CLOSED — ruling |
| **R-5** | **The §D.2 F example values weren't valid under the locked enums.** Ruled 2026-10-13 (Karl): `surface_gate: "pre_and_post"` and `content_type: "video_transcript"`. Applied in plan §D.2 F | — | CLOSED — ruling applied |
| **R-6** | **Skill codes are skill strings, not short codes.** Ruled 2026-10-13 (Karl): `skill_codes` are the 29 full names in `content/canonical/taxonomy.json`. Production holds zero code-shaped values, per the owner's report of 2026-10-13. Applied in plan §D.2 D and F | — | CLOSED — ruling applied |
| **R-7** | **Metadata is per `RagFile`, not per chunk.** Ruled 2026-10-13 (Karl): one file per segment, with metadata attached after import. **Superseded 2026-10-15**: there are no `RagFile`s. One `curriculum_chunks` row per segment carries its four fields as columns, written in one statement, so no window exists in which a segment has no metadata | — | CLOSED — superseded (pgvector) |
| **R-8** | **Chapter-marker frequency. Answered 2026-10-14** by `fetch-video-metadata.ts` across all 18 sources (YouTube credential as `X-Goog-Api-Key`; no transcripts fetched). 192 listed, 175 available (169 in Tiers 1–3), 25 with chapters, 53.2 hours. Chapters are rare: Tutorllini 1/23, Scalar Masterclass 12/28 (43%), every other playlist 0–33%, and four of six Tier 5 singles. **Segmentation: fixed windows with merge-on-low-confidence is the default for every source; chapters are used per video where present** (plan §D.2 B already decides this per video). Other findings: PrepPros "SAT Math Course" is 13/14 **private** (a closed course; 1 usable video). 17 items are unavailable in total, and none of the 175 is non-embeddable | — | CLOSED — report run |
| **R-9** | **Terraform can't express Serverless mode.** Resolved 2026-10-14 as a documented one-time manual step: Karl PATCHed `ragEngineConfig` to `{"serverless":{}}` at 22:52 UTC (operation `2225455665407590400`). **Moot 2026-10-15**: RAG Engine is retired (R-11). The manual config is still live on `replit-cop` and holds no data; `infra/terraform/README.md` records it | — | CLOSED — moot |
| **R-10** | **Spanner billing after the switch.** Google's docs don't say whether a Spanner-mode instance stops billing when the project switches to Serverless. The only documented way to stop it is the Spanner `unprovisioned` tier, which deletes that mode's data; the provider supports `unprovisioned`. Whether a billable Spanner instance exists now (`spanner.basic` is configured, no corpora exist) can't be read with the Vertex-only credential. Karl to check Billing for Spanner / RAG Engine charges before and after the switch | Independent of C since 2026-10-15 (RAG Engine retired) | OPEN — owner check |

| **R-11** | **Vertex AI RAG Engine path retired** (Karl, 2026-10-15; SCL-231 PROPOSED). The record, kept for anyone who proposes RAG Engine again. **Spanner mode** (2026-10-13): allowlist-gated in `us-central1`; `INTERNAL` or *"No available indexing project"* in `us-east5`, `us-south1` and `us-west1`; one failed create in `us-east5` left four corpora behind. **Serverless mode, `us-central1`** (2026-10-14, Karl approved `--execute`): ~23:09 UTC `PERMISSION_DENIED`, an undocumented prerequisite, `vectorsearch.googleapis.com` (Karl enabled it); 23:22, 23:24 and 23:56 UTC *"No available indexing project found in us-central1. Please create new indexing projects."* The last attempt was 32 minutes after the API was enabled, so not propagation, and no setting on our side changes it. No corpus was ever created. **Deleted 2026-10-15:** `scripts/provisioning/rag-corpus-create.ts`, `scripts/rag/probe-rag-data-schema.ts`, `RAG_CORPUS_RESOURCE_NAME` / `ragEnvSchema` (never merged), and `google_project_service.vectorsearch` (never merged; nothing else uses the API). Left on `replit-cop` by hand, for Karl to disable if wanted: the Vector Search API and the Serverless `ragEngineConfig` | — | CLOSED — retired |
| **R-12** | **Three defects in the revised Step C DDL, found by its own gates** (2026-10-15). (a) `CHECK (array_length(skill_codes, 1) >= 1)` accepts an empty array: `array_length('{}', 1)` is NULL, and a NULL CHECK passes. Now `cardinality(skill_codes) >= 1`. (b) The bare `WHERE skill_codes && $2 ORDER BY embedding <=> $1 LIMIT $3` does **not** guarantee n on-skill rows: under an HNSW plan, pgvector filters the index's `ef_search` candidates after the scan. Gate R3 planted that exact form, and it returned 1 row of 3. `curriculum_chunks_search` materialises the on-skill active rows first, then sorts them exactly by distance, with `id` breaking ties (determinism). The HNSW index still exists, as specified. (c) `status default 'active'` contradicts "no chunk active without `reviewed_by`". Now `pending_review \| active \| retired`, default `pending_review`, and `CHECK (status <> 'active' OR reviewed_by and reviewed_at set)`. Re-ingesting a changed segment drops it back to `pending_review` | — | APPLIED — for Karl's review |
| **R-13** | **Query-embedding latency.** First sample 2026-10-15, 12 `text-embedding-005` `:predict` calls from the CC container through the egress proxy (**not** Vercel, so not the production number): p50 **339 ms**, max 780 ms. That is above the ~300 ms flag in the revised plan. Step E measures it from production. If it holds there, caching embeddings for repeated queries is the next lever: in review the query is often the same question's text | Before F reaches students | OPEN — measure at E |
