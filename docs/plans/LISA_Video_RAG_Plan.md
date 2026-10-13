# LISA Video RAG — Build Plan

**Basis:** external plan (Gemini), reconciled against `main` at `f7e004b` and production, with Karl's rulings applied.
**Governing spec:** Doc 03D V1.2 §6. **This implements the spec. It does not redesign it.**

**Standing principle for this build: minimum change. Nothing already built gets rebuilt. No second path.**

---

## 1. Rulings — settled

### 1.1 The corpus metadata schema does not change

Doc 03D §6.7 locks it: `skill_codes`, `provenance`, `surface_gate`, `content_type`. **It stays exactly as locked.** No SCL, no re-import risk, no new fields.

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
- Skill-filtered: CEL on `skill_codes`
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

### Step C — Provision the corpus *(irreversible)*
Run `scripts/provisioning/rag-corpus-create.ts` **unchanged in schema**. Set `RAG_CORPUS_RESOURCE_NAME` in the env schema and Vercel.

*Updated 2026-10-13 (R-1 ruling, Karl): Serverless mode, `us-central1`. The script was rewritten for it: REST, a mode pre-flight, a dry run by default, and no metadata keys. Serverless mode has no metadata search, so the four fields travel inside each record and the BFF checks `skill_codes` after retrieval, over-fetching N=20 to start (R-2).*
**Proof:** corpus exists with the locked four-field metadata schema.

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

**F. Import** *(corrected 2026-10-13: R-5, R-6, R-7)*

**One `RagFile` per segment.** RAG Engine attaches metadata to a file and filters at file level, not per chunk. A file holding many segments would give them all one `provenance`. So each segment is written as its own small text file, `gs://<bucket>/segments/<video_id>_<start>-<end>.txt`, whose whole content is the generated description. They're imported with `ragFiles:import`, using a chunk size well above a description's length so each file stays one chunk. Then each file's metadata is attached **after import** with v1beta1 `ragMetadata:batchCreate`, against the four keys Step C created. Each segment's metadata:

```json
{
  "skill_codes": ["Linear Equations in One Variable", "Linear Functions"],
  "provenance": "youtube:AB1234567:142-195",
  "surface_gate": "pre_and_post",
  "content_type": "video_transcript"
}
```

The four locked metadata fields, unchanged, with values from the locked enums (`packages/shared/tutor-rag-types.ts`, `ragCorpusMetadataSchema`). `skill_codes` are taxonomy names. Title and channel come from `video_resources` at render time.

**Metadata is attached after import, so there is a window where a file has no metadata.** A filtered query never matches such a file, so it can't leak into a skill-scoped turn. An unfiltered query could still see it. The import run therefore checks that every imported file carries all four keys before it reports success. A file that fails that check is deleted, not left behind.

#### D.3 What this costs

Gemini Flash for description and tagging, on segments rather than whole videos. A 10-minute video is roughly 12 segments. A hundred videos is a few dollars. The bottleneck is wall-clock on the transcript fetch, not money.

#### D.4 Proof

1. `video_resources` populated for the seeded set
1a. Content-gate report: segments dropped by the gate, by channel, with reasons
2. Corpus items present, retrievable by direct query, metadata valid
3. The per-skill review sample (at least 5 per tagged skill) reviewed by Karl — descriptions match what is actually at those timestamps
4. Zero transcript text in the corpus — asserted against the cached transcripts **before the cache is deleted**
5. Every `skill_code` in the corpus valid against the taxonomy

#### D.5 Out of scope

Hosting or re-publishing video. Serving transcript text to anyone. Any production-time transcript fetch. Khan Academy text specifically — CC BY-NC-SA, the non-commercial clause excludes it from a paid product, though embedding and linking their videos is fine.

#### D.6 Push back

If chapter markers turn out to be rare across the chosen channels, say so — fixed windows with merge-on-low-confidence still work, it just means more segments get merged.

If a description generated from a bad auto-caption is confidently wrong about the mathematics, that is the failure mode that matters and the per-skill review sample is what catches it. If the sample shows it happening at any rate above noise, stop and report before scaling the corpus.

### Step E — Retrieval quality, before generation *(a gate, per §6.7)*
Query set per skill, inspect results, confirm the gate drops what it should.
**Proof:** reviewed by Karl. Bad retrieval produces bad tutoring regardless of model.

### Step F — Envelope
`retrieved_video_resources` on the wire. Query at **13d**. Skill-filtered, gated, capped, fail-open.
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
