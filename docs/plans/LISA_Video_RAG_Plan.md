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

Pull YouTube's timed-text where available. **Whisper where it is not.** Whisper gives word-level timestamps, so segment boundaries are better than fixed caption blocks.

Chunking per the external plan: **45–60 second windows, 10 second overlap.**

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
**Proof:** corpus exists with the locked four-field metadata schema.

### Step D — Ingestion
`scripts/rag/ingest-youtube.ts` — YouTube Data API metadata, timed-text where available, **Whisper fallback**, 45–60s windows with 10s overlap, raw JSONL to GCS.
`scripts/rag/map-skills.ts` — appends `skill_codes` (array, valid against the taxonomy), `provenance` in the namespaced form, `surface_gate`, `content_type: "video_transcript"`.
**Skill tags are reviewed, not trusted.**
**Proof:** items in the corpus, retrievable by direct query, metadata correct.

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
