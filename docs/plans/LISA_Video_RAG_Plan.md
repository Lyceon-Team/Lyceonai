# LISA Video RAG — Build Plan

**Basis:** external plan (Gemini), reconciled against `main` at `f7e004b` and production, with Karl's rulings applied.
**Governing spec:** Doc 03D V1.2 §6. **This implements the spec. It does not redesign it.**

**Standing principle for this build: minimum change. Nothing already built gets rebuilt. No second path.**

---

## 1. Rulings — settled

### 1.1 The corpus metadata schema does not change

Doc 03D §6.7 locks it: `skill_codes`, `provenance`, `surface_gate`, `content_type`. **It stays exactly as locked.** No SCL, no re-import risk, no new fields.

*Amended 2026-10-15 by SCL-231 (PROPOSED), storage only: the four fields are unchanged and now live as columns of `curriculum_chunks` (pgvector), not as corpus metadata. That SCL amends §6.6/§6.7's naming of Vertex AI RAG Engine as the store. It does not change this field list.*

**`provenance` already carries structured data by convention.** The provisioning script's own example is `"textbook:isbn:chapter"`. Video uses the same shape:

```
youtube:<video_id>:<start_seconds>-<end_seconds>
e.g. youtube:AB1234567:142-195
```

Video id and segment bounds, inside the existing field. Title, channel and formatted time are **not corpus metadata** — they are looked up or derived at render time.

**The external plan's eight-field flat schema is rejected.** It drops `surface_gate` and `content_type` (both locked) and uses singular `skill_id` where the question bank uses **`skill_codes` as an array**.

### 1.2 Transcripts — two tiers

*Superseded by the reworked Step D (2026-10-13): transcripts are read once at build time to generate descriptions, and are never stored. Chapter markers segment when present, fixed windows when not. No Whisper fallback; a video with no obtainable transcript is skipped.*

### 1.3 Embedding model — one check outstanding

The ruling (`text-embedding-005`) is from 2026-08-20. The provisioning script's own pre-flight says to **stop and report if `gemini-embedding-001` has since been added to RAG Engine's supported model list.**

This is the **last irreversible decision** — the embedding model is locked to the corpus at creation and changing it means recreating and re-importing everything. Check before Step C:
`https://cloud.google.com/vertex-ai/docs/generative-ai/rag/rag-supported-models`

*Revised 2026-10-15 (pgvector, Steps C and F; SCL-231 PROPOSED): there is no corpus, so the model is not locked to one. Changing it means re-embedding rows. The output dimension is what's fixed in the schema: `text-embedding-005` returned **768** values from the live model on 2026-10-15, and `curriculum_chunks.embedding` is `vector(768)`.*

---

## 2. The one type fix — not a schema change

`packages/shared/tutor-rag-types.ts` line 88: `RetrievalRequest` carries a caller-supplied `is_pre_submit: z.boolean()`.

**§6.3 forbids this outright** — pre-submit state is derived server-side from the item's submission state and is never supplied by the caller. "A caller-supplied boolean gating a safety decision is a boolean an attacker sets."

Remove the field. It is in the **request** type, not the corpus metadata, so nothing locked is touched. **The file has zero importers**, so removal is free.

The stale comment in that file referencing the reversed SCL-060 should be corrected at the same time.

---

## 3. Corrected file paths

Every path in the external plan except one was wrong.

| External plan | Actual |
|---|---|
| `server/routes/tutor-context.ts` | **`server/services/tutor-context.ts`** |
| `server/routes/tutor-output-serializer.ts` | **`server/services/tutor-output-serializer.ts`** |
| `apps/workers/tutor-orchestrator/prompts/…` | **`apps/workers/tutor-orchestrator/src/prompts/…`** |
| `apps/workers/tutor-orchestrator/render-state-blocks.ts` | **`…/src/prompts/render-state-blocks.ts`** |
| `shared/tutor-rag-types.ts` | **`packages/shared/tutor-rag-types.ts`** |
| `shared/tutor-orchestrator-wire.ts` | correct |

---

## 4. Retrieval goes at Step 13d, not 9b

**The external plan's Step 9b is a safety defect.** In the real handler, Step 9 runs **before Step 10 (input sanitization and injection scan)** and **before Step 13a (the crisis classifier)**.

Placing retrieval there would send the student's **raw unsanitized message** to Vertex as a search query, and fire a retrieval round trip on crisis turns that currently short-circuit before any model call.

**Correct placement — Step 13d:** after crisis (13a), after the Model Armor input scan (13b), after the crisis-flag branch (13c), immediately before orchestration (Step 14).

- Query text is the **sanitized** message
- A crisis turn never reaches it
- Skill-filtered: ~~CEL on `skill_codes`~~ a SQL `WHERE skill_codes && $skills` inside the retrieval statement *(revised 2026-10-15, pgvector)*
- `surface_gate` evaluated **after** retrieval, **before** the prompt (§6.8) — a failing item is dropped silently
- **Fails open**: a retrieval error logs at ERROR and the turn proceeds with no video block

---

## 5. The model never emits a video identifier

The external plan has the model emit `recommend_video` carrying `video_id`, `start_seconds`, `video_title`, `channel_name`, `formatted_time`, then validates them downstream.

**That inverts the pattern already shipped.** `start_practice` has the model emit a bare marker; the worker strips it; the **server** attaches the payload.

**Same here.** The model emits `recommend_video` with at most an index into the turn's retrieved set. The BFF attaches provenance from that set. A hallucinated identifier becomes structurally impossible rather than caught after the fact.

**Keep the serializer URL check as a second layer** — scan the reply for `youtube.com` / `youtu.be`, redact anything not in the turn's retrieved set. Consistent with the existing chokepoint.

---

## 6. Steps

### Step A — Embedding-model pre-flight
Check the supported-models page. Report before provisioning.

### Step B — Remove `is_pre_submit` from `RetrievalRequest`
Plus the stale SCL-060 comment. Zero importers, so free. **Before Step C.**

### Step C — The store: `curriculum_chunks` + `video_resources` *(revised 2026-10-15, Karl: pgvector, replacing Vertex AI RAG Engine; SCL-231 PROPOSED)*

**Why.** RAG Engine corpus creation failed four times across two modes and four regions. In Spanner mode it was allowlist-gated or failed `INTERNAL`. In Serverless mode it hit an undisclosed API prerequisite, then failed three times with *"No available indexing project found in us-central1"*, the last 32 minutes after the API was enabled. That is an undocumented Google-side capacity error, and no setting on our side changes it. The record is in closure plan R-11. **Storage changes. The design does not**: skill-filtered retrieval, server-side verification, insertion at Step 13d, fail-open, and no model-emitted identifiers are all unchanged.

**What improves.** The skill filter becomes a real `WHERE` with a GIN index, in the same database as `questions` and the skill taxonomy. It is not a CEL expression that R-2 found silently ignored on list fields. One fewer service sits in the turn path. Changing the embedding model means re-embedding rows, not recreating a corpus. RLS, migrations, backups and CI schema gates already exist. **What we give up:** Vertex's managed chunking and embedding orchestration. Step D already writes its own text, so this is one embedding call per segment at build time.

**The migration** is `supabase/migrations/20261101000000_lisa_curriculum_chunks.sql`. pgvector is already installed: genesis creates `vector` in schema `extensions`.

- `curriculum_chunks`:
  - Columns: `id`, `content`, `skill_codes text[]`, `provenance` (`youtube:<video_id>:<start>-<end>`), `surface_gate`, `content_type`, `embedding vector(768)` (text-embedding-005, dimension confirmed against the live model 2026-10-15), `status`, `reviewed_by`, `reviewed_at`, `created_at`, `updated_at`.
  - `skill_codes text[]` matches `questions.skill_codes` exactly. It has no FK: genesis note A7 deliberately has no closed skills table.
  - Indexes: GIN on `skill_codes`, HNSW `vector_cosine_ops` on `embedding` (no training data needed, better recall, small corpus), a partial index on `status = 'active'`, and `unique (provenance)`, which makes ingestion idempotent.
- `video_resources` (Step D §A): `video_id`, `title`, `channel_name`, `duration_seconds`, `status`, `last_checked_at`. It is joined at render time, not stored per chunk.
- **RLS:** on for both tables, with **zero policies** and no anon/authenticated privilege. The BFF reads with the service role. This is the question-bank posture (genesis A4). No student-facing policy is needed; if one ever is, stop and report.
- Functions, both service-role only:
  - `curriculum_chunk_upsert(...)`, the one ingestion writer.
  - `curriculum_chunks_search(embedding, skill_codes, limit)`, the Step F query.

**Changed from the brief's DDL** (closure plan R-12; each is caught by a CI gate):
- `cardinality(skill_codes) >= 1`, not `array_length(...) >= 1`, which lets an empty array through.
- `status` is `pending_review | active | retired`, defaulting to `pending_review`, with `CHECK (status <> 'active' OR reviewed_by/reviewed_at set)`. This enforces §6's "no chunk active without `reviewed_by`" in the schema.
- CHECKs on the §6.7 `surface_gate` and `content_type` enums, as listed in `ragCorpusMetadataSchema`. A contract test keeps the two lists equal.
- A `youtube:` provenance format check for `video_transcript`.
- `curriculum_chunk_upsert` sends a *changed* segment back to `pending_review`, so an edit is never live on an old approval.

**Proof:**
- The table and all four indexes exist in production, with `\d curriculum_chunks` output pasted into the closure plan (owner-run).
- CI: `scripts/ci/curriculum-chunks-gates.sql` in the `pg` job, and the genesis snapshot.

### Step D — Ingestion *(reworked, Karl 2026-10-13; replaces the original Step D)*

Fully automated. No manual video watching.

#### D.1 Why this shape

Two facts from the audit decide it.

**Transcripts cannot be fetched from production.** YouTube gates `/api/timedtext` behind a PoToken as of April 2026, and datacenter IPs get "Sign in to confirm you're not a bot" on caption fetches. Every library and managed API works around this by scraping internal endpoints via the ANDROID InnerTube client. A Vercel or Cloud Run process calling any of them is a production dependency on a scraped, actively-defended endpoint.

**Transcript text is poor retrieval material anyway.** Spoken speech is filler-heavy, has no sentence boundaries that match concept boundaries, and auto-captions mangle exactly the technical terms that matter — "sine" / "sign", "x squared" / "x-squared". Chunking it on 45-second windows produces embeddings for half-sentences.

So the transcript is an input, not the product. It is read once, at build time, to generate a clean teaching description. The corpus stores the description. The transcript is discarded.

This is automated end to end, it retrieves better, and nothing third-party is stored or served.

#### D.2 The pipeline

Build-time only. Runs on a workstation, not in any deployed runtime.

```
channel/playlist/video list
  → A. metadata        (YouTube Data API v3 — official, keyed)
  → B. transcript      (build-time fetch, discarded after C)
  → C. content gate → segmentation + description  (Gemini batch)
  → D. skill tagging   (Gemini, constrained to the 29 taxonomy names)
  → E. review sample   (automated checks + at least 5 per skill)
  → F. one file per segment to GCS → import → attach metadata (v1beta1)
```

**A. Metadata — `scripts/rag/fetch-video-metadata.ts`**

YouTube Data API v3, official and keyed: title, channel, duration, publish date, chapter markers where present. Writes to a Postgres table, not the corpus (R-3).

```sql
video_resources (
  video_id text primary key,
  title text not null,
  channel_name text not null,
  duration_seconds int not null,
  status text not null default 'active',   -- active | unavailable
  last_checked_at timestamptz,
  approved_by uuid,
  approved_at timestamptz
)
```

This is what Step I's link-rot job updates and what the client joins at render time.

**B. Transcript — `scripts/rag/fetch-transcripts.ts`**

Build-time, local, rate-limited, cached to disk so a video is fetched once.

Chapter markers are the better segmentation signal where a video has them — a creator-authored chapter is a concept boundary, which a 45-second window is not. Use chapters when present, fixed windows when not.

The transcript cache is working material. It is not committed, not uploaded to GCS, and not imported. Step C consumes it and it is deleted.

If a transcript cannot be obtained for a video, that video is skipped. No partial entries.

**C. Segmentation and description — `scripts/rag/generate-descriptions.ts`**

The step that makes this work.

**Content gate first** *(Karl, 2026-10-13)*. Before any description is generated, the model answers one question for the segment: *does this segment teach SAT content a student would practise?* A **no** drops the segment there. No description is generated and no skill tag is attempted. This catches what the `null` rule below doesn't: a district-partnership webinar, a channel promo, an admissions-strategy aside. Each of those can be "self-contained" and still isn't practice content. The gate's answer and a one-line reason are logged with the segment's provenance, so a systematic drop (a whole channel gated out) shows up in the run report.

For each segment that passes the gate, a Gemini call takes the transcript window plus the video title and returns:

- `description` — two to four sentences stating what this segment teaches, written as instructional content, not as a summary of someone talking. No "the speaker explains", no "in this video". Just the concept, the method, and the condition under which it applies.
- `concepts` — a short list of named concepts covered
- `boundary_confidence` — whether the window starts or ends mid-explanation

Prompt rules: never quote the transcript verbatim beyond a technical term; never attribute to the speaker; write as though explaining the concept directly; if the segment teaches nothing self-contained, return `null` and the segment is dropped.

Merge adjacent segments where `boundary_confidence` says an explanation spans a window edge. A segment that ends mid-derivation is useless to a student.

This is the corpus content. Lyceon-authored text, generated from a read of the source, embedding cleanly because it is written to be read.

**D. Skill tagging — `scripts/rag/map-skills.ts`**

Gemini, constrained to the canonical taxonomy — the model picks from an enumerated list of valid `skill_codes` and cannot emit anything else. Invalid codes fail the row rather than being coerced.

**The enumerated list is the 29 full skill names in `content/canonical/taxonomy.json` `skills`** (e.g. `"Linear Equations in One Variable"`). These are the same strings the question bank stores in `questions.skill_codes`. Production holds zero code-shaped values, per the owner's report of 2026-10-13. There are no short codes. The list is read from `taxonomy.json` at run time, never typed. Only segments that passed the content gate reach this step.

Multi-tag allowed; `skill_codes` is an array.

**E. Review — automated, with a sample**

Not manual watching. Automated gates:

- every `skill_code` valid against the taxonomy
- `start_seconds < end_seconds`, both within `duration_seconds`
- description length within bounds, no transcript verbatim above a threshold
- no segment shorter than 20s or longer than 180s
- no duplicate `provenance`

Then a review sample surfaced for your eye — description against the actual timestamp. **The sample is a minimum count per skill, not a percentage** *(Karl, 2026-10-13)*: at least 5 segments for every skill tagged in the run, or every segment where a skill has fewer than 5. Selection is seeded and recorded, so the sample can be reproduced. A flat 5% of a small seed set is a handful of segments in total, and a low but real error rate in one skill would slip through it. Enough to catch a systematic failure, not enough to be a job.

**F. Embed and upsert** *(revised 2026-10-15, Karl: pgvector; replaces the GCS / `RagFile` import of 2026-10-13, R-7)*

After description generation and skill tagging, embed the description with `text-embedding-005` and write the row through `public.curriculum_chunk_upsert(provenance, content, skill_codes, surface_gate, content_type, embedding)`, with the service role. It is the same model and the same text, upserted on `provenance`. There is no GCS bucket and no corpus import. Each segment's four fields:

```json
{
  "skill_codes": ["Linear Equations in One Variable", "Linear Functions"],
  "provenance": "youtube:AB1234567:142-195",
  "surface_gate": "pre_and_post",
  "content_type": "video_transcript"
}
```

These are the four locked fields with values from the locked enums (`packages/shared/tutor-rag-types.ts`, `ragCorpusMetadataSchema`, and the table's CHECKs). `skill_codes` are taxonomy names. Title and channel come from `video_resources` at render time.

Rows land `pending_review`. A row becomes `active` only when `reviewed_by` and `reviewed_at` are set (CHECK), after the per-skill sample in E. Re-running a segment updates it in place. A changed segment drops back to `pending_review`. A retired row stays retired. One statement writes the row and its four fields together, so a segment never exists without metadata.

#### D.3 What this costs

Gemini Flash for description and tagging, on segments rather than whole videos. A 10-minute video is roughly 12 segments. A hundred videos is a few dollars. The bottleneck is wall-clock on the transcript fetch, not money.

#### D.4 Proof

1. `video_resources` populated for the seeded set
1a. Content-gate report: segments dropped by the gate, by channel, with reasons
2. `curriculum_chunks` rows present, retrievable through `curriculum_chunks_search`, every row valid under the table's CHECKs
3. The per-skill review sample (at least 5 per tagged skill) reviewed by Karl — descriptions match what is actually at those timestamps
4. Zero transcript text in `curriculum_chunks` — asserted against the cached transcripts **before the cache is deleted**
5. Every `skill_code` in the corpus valid against the taxonomy

#### D.5 Out of scope

Hosting or re-publishing video. Serving transcript text to anyone. Any production-time transcript fetch. Khan Academy text specifically — CC BY-NC-SA, the non-commercial clause excludes it from a paid product, though embedding and linking their videos is fine.

#### D.6 Push back

If chapter markers turn out to be rare across the chosen channels, say so — fixed windows with merge-on-low-confidence still work, it just means more segments get merged.

If a description generated from a bad auto-caption is confidently wrong about the mathematics, that is the failure mode that matters and the per-skill review sample is what catches it. If the sample shows it happening at any rate above noise, stop and report before scaling the corpus.

### Step E — Retrieval quality, before generation *(a gate, per §6.7)*
Query set per skill, inspect results, confirm the gate drops what it should.
*Revised 2026-10-15 (pgvector):* the filter runs in the database, so the "how many of 20 survive" measurement is dropped. Report p50/p95 for the **query embedding call** and for the **SQL** separately. If the embedding call pushes retrieval past roughly 300 ms, report it. Caching embeddings for repeated queries is the next lever, because in review the query is often the same question's text. The first sample (2026-10-15, from the CC container through the egress proxy, not Vercel) was a 339 ms p50 over 12 calls (closure plan R-13).
**Proof:** reviewed by Karl. Bad retrieval produces bad tutoring regardless of model.

### Step F — Envelope *(retrieval revised 2026-10-15, Karl: pgvector)*
`retrieved_video_resources` on the wire, unchanged shape, so Steps G and H need no change. Query at **13d**, in `server/routes/tutor-runtime.ts`, between the end of the 13c branch and Step 14.

1. **Embed the query.** Make one `text-embedding-005` call on the **sanitized** message, in the BFF, before the SQL. It is the only network hop in the retrieval path, so bound it with an explicit timeout.
2. **One statement.** `select * from curriculum_chunks_search($embedding, $active_skill_codes, 3)`. The skill filter is `skill_codes && $2` inside the statement, over active rows only, ranked by exact cosine distance with `id` breaking ties. `limit 3` returns three on-skill chunks whenever three exist (CI gate R3), so there is no over-fetch.
3. **`surface_gate` after retrieval, before prompt assembly** (§6.8). A failing item is dropped silently.
4. **Fail open.** An embedding error or timeout, or an SQL error, logs at ERROR (no content) and the turn proceeds with no knowledge block.
5. **The model never sees `provenance`.** It stays server-side until the client card.

**Tests.** The SQL-level tests are already in Step C's CI gates:
- a skill-X query never returns a chunk tagged only Y;
- `retired` (and `pending_review`) never returned;
- identical requests return identical rows in identical order;
- re-ingesting updates rather than duplicates.

Step F adds these with its code:
- an embedding failure gives no block, an ERROR log, and a completed turn;
- an SQL failure behaves the same;
- `provenance` never appears in the assembled prompt.

No change to mastery, scoring, selection, the pre-submit gate or the serializer.
**Proof:** an assembled system instruction showing the video block for a real turn.

### Step G — Worker *(needs a Cloud Build)*
`lisa-default-v3` **composing v2** (v1 frozen, v2 composes v1). `renderVideoResourcesBlock()` in `src/prompts/render-state-blocks.ts` — facts paired with directives (§7.4), placed late (§7.2).
**BFF deploys before the worker**, or the BFF rejects a worker response carrying an unknown action type.
**Proof:** the action is emitted, the marker is stripped, no identifier in visible text.

### Step H — Client
`TutorVideoModal.tsx`, `VideoRecommendationCard`, `useTutorTurn.ts` handling the action.
**`youtube-nocookie.com`** embed with `start` and `end`. `rel=0` no longer disables related videos — it restricts them to the same channel, which is why the player closes at segment end.
**Proof:** a student in review is offered a video, opens it, it plays from the right timestamp.

### Step I — Link rot
Scheduled check against the YouTube Data API marking deleted or privated videos unavailable so the resolver skips them. Reuse the existing Cloud Scheduler pattern.

---

## 7. Unchanged by this work

The pre-submit gate. The output serializer as mandatory chokepoint. The crisis short-circuit before orchestration. Mastery, scoring, selection. Entitlement ordering. The question bank path.

**Retrieval is additive.** Returns nothing, and the turn behaves exactly as it does today.
