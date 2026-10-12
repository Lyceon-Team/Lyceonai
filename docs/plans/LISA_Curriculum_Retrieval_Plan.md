# LISA Curriculum Retrieval — Plan

**Status:** planning. Grounded in a read-only audit of `main` at `f7e004b` and production.
**Spec:** Doc 03D V1.2 §6 is locked and specifies this in full. **This plan implements the spec. It does not redesign it.**
**Register check (2026-10-12):** §6 below records three register entries and one deleted implementation that bear on Step 1. Step 1 cannot start as written until Karl rules on §6.5.

---

## 1. What the audit found

**The design is done.** Doc 03D §6 specifies two retrieval paths, the surface gate, the retrieval contract, and the corpus decisions that are expensive to reverse.

**The scaffold is written and nothing imports it:**

| Artifact | State |
|---|---|
| `packages/shared/tutor-rag-types.ts` | `RetrievedItem`, `RetrievalRequest`, `RetrievalResponse`, corpus metadata schema — **zero importers** |
| `scripts/provisioning/rag-corpus-create.ts` | Creates the Vertex RAG corpus. Marked "DO NOT EXECUTE — for Karl." **Never run** |
| `RAG_CORPUS_RESOURCE_NAME` | Referenced only in that script's comments. **Not in any env schema, not set anywhere** |
| Vertex RAG corpus | **Does not exist** |
| pgvector in Supabase | Installed, **zero vector columns** — not the chosen path, §6.6 puts the semantic path on Vertex |
| `tutor-context.ts` (1,502 lines) | **No retrieval hook of any kind.** No mention of retrieval, RAG, or expansion |
| Wire schema | Carries no `retrieved[]` field |

**Neither path is built.** Not the deterministic one, not the semantic one. The envelope carries the active question, mastery, friction and memory — nothing retrieved.

This is the same class as Model Armor and `TutorConfig.loadAll()`: designed carefully, written partially, never called.

---

## 2. What the spec locks (not open for discussion)

- **Two paths.** Question explanations by direct Postgres query on `skill_codes`. Textbooks, video transcripts, strategy content, worked examples via Vertex RAG Engine. One merged ranked set. (§6.6)
- **Explanations never travel the probabilistic path.** A similarity search can surface the active question's explanation pre-submit even with metadata filters. The most dangerous payload in the system stays on a `WHERE` clause. (§6.6)
- **`surface_gate` evaluated after retrieval, before prompt assembly.** A failing item is dropped silently — the model never sees it, nothing narrates around it. (§6.8)
- **Pre-submit is derived server-side** from submission state, never caller-supplied. (§6.3)
- **Scope to the active skill**, small K, hard token budget, rank by skill match then exposure recency. (§6.4)
- **Provenance in metadata only** — never in text the model can echo. (§6.5)
- **Embedding model, chunking strategy and metadata schema are locked at corpus creation.** Changing any requires recreating the corpus and re-importing everything. (§6.7)
- **Retrieval quality is tested before generation is wired to it.** (§6.7)

---

## 3. The steps

Each step ships and is proven before the next begins.

### Step 1 — Deterministic path only

Question explanations retrieved by skill from Postgres, surface-gated, into the envelope and the prompt.

**Why first:** no corpus, no embeddings, no new GCP service. It exercises the whole contract — `RetrievedItem`, the gate, the merge interface, the prompt block — against content that already exists and is already authored. If the contract is wrong, it is wrong here, cheaply.

Builds: the retrieval service returning `RetrievedItem[]`; the Postgres query scoped to active skill, prior items only, pre-submit excluded; `surface_gate` evaluation; the wire field; the worker block.

**Proof:** an assembled system instruction for a real pre-submit turn showing prior same-skill explanations and **not** the active question's; the same turn post-submit showing the active explanation present.

### Step 2 — Corpus provisioning

Karl runs `rag-corpus-create.ts` after its pre-flight check on the embedding model. `RAG_CORPUS_RESOURCE_NAME` goes into the env schema and Vercel.

**This is the irreversible step.** Embedding model, chunking and metadata schema lock here.

**Proof:** the corpus exists, named, with the §6.7 metadata schema.

### Step 3 — Ingestion

Video segments and documents into the corpus with `skill_codes`, `provenance`, `surface_gate`, `content_type`.

For video, the ingested text describes what the segment teaches. Transcripts are filler-heavy and most channels license nothing; the segment's timestamps live in `provenance`.

**Proof:** items in the corpus, retrievable by a direct query, carrying correct metadata.

### Step 4 — Retrieval quality, before generation

Per §6.7, test retrieval on its own. A query set per skill, inspect what comes back, confirm the gate drops what it should.

**Proof:** results reviewed by Karl. **This is a gate, not a formality** — bad retrieval produces bad tutoring regardless of model.

### Step 5 — Merge semantic into the envelope

The semantic path joins the deterministic one. Same contract, one ranked set.

**Proof:** an assembled prompt carrying items from both paths, gate applied, cap respected.

### Step 6 — Surfacing video to the student

Only now does anything appear in the UI. Out of scope until Step 5 is proven.

---

## 4. What is not in this plan

Video players, cards, "want to watch a video?", the review panel, embedding versus linking out. All of it is Step 6 and none of it is designed yet.

---

## 5. Open for Karl

1. **Step 1 alone first, or Steps 1–2 together?** Step 2 is the irreversible one and does not depend on Step 1 succeeding.
2. **The embedding-model pre-flight.** The script says to stop and report if `gemini-embedding-001` is now supported by RAG Engine, since the ruling predates it. That check happens at Step 2 and the answer may change a locked decision.
3. **Who authors the video segment descriptions**, and for which skills first.

---

## 6. Register and history check (2026-10-12)

Doc 03D V1.2 §6 is the locked text, but it is not the whole of what governs this. The SCL register and the `lisa` branch history carry rulings made after V1.2. Checked against `main` at `f7e004b`.

### 6.1 Step 1 was built once, and Karl deleted it

Commit `47ffffd7` (2026-08-28, "fix(lisa): AUDIT-001 — … delete parallel retrieved_curriculum path") removed exactly what Step 1 proposes to build:

- `server/services/tutor-retrieval.ts` — `retrieveDeterministic()` (the same-skill Postgres scope filter) and a `retrieveSemantic()` stub;
- a `retrieved_curriculum` field on both wire schemas (shared and the worker copy);
- `resolveCurriculumSafe` in `tutor-context.ts` and `renderCurriculumBlock` in `render-state-blocks.ts`.

The commit records the reason as a Karl ruling: it **rejects the `retrieved_curriculum` approach as "parallel paths carrying the same content with different gates"**. §1's "neither path is built" is accurate today. What it leaves out is that the deterministic path was built, wired, and taken out by ruling.

### 6.2 SCL-060 (RULING, 2026-08-28) dropped the same-skill provision

`docs/SpecAudit/SPEC_CHANGES_LOG.md:303-308`, verbatim:

> Dropped: the "previously seen same-skill questions" provision from the original SCL-060. It was unwireable — `question_content` is single-item and multi-item delivery would require a parallel wire path that does not exist. More importantly it is not needed … If same-skill history proves necessary later, that is a new SCL with a real use case.

Step 1's content — prior same-skill explanations in the envelope — is that dropped provision. Under the standing ruling, building it needs **a new SCL with a real use case first**. No SCL number is allocated here; that happens when the entry is drafted, under the allocation rule in `CLAUDE.md`.

### 6.3 SCL-144 (PROPOSED, owner ruling 2026-09-25) already governs the active explanation

SCL-144 reverses SCL-060: the active question's explanation reaches the model **post-submit only**, on every surface. "Possession is the control, not a prompt instruction." The code already does this. `resolveQuestionContent` (`server/services/tutor-context.ts:361-367`, `:372-375`) does not select `question_explanation` pre-submit, and `tests/ci/tutor-explanation-presubmit.contract.test.ts` pins it.

What follows for Step 1's proof:

- **Pre-submit, active explanation absent**: already true and already tested. Step 1 adds nothing here.
- **Post-submit, active explanation present**: already delivered on `question_content.explanation`. If a new retrieval path delivered it too, that would be the "same content, different gates" pattern §6.1 records as rejected.

So the only new behaviour Step 1 would prove is *prior same-skill explanations pre-submit*, which is the provision §6.2 dropped.

### 6.4 The scaffold contradicts the spec it cites

`packages/shared/tutor-rag-types.ts` has zero importers, which is the only reason none of this is live:

| Line | What it says | Conflict |
|---|---|---|
| `retrievalRequestSchema.is_pre_submit: z.boolean()` (`:87-88`) | Caller supplies pre-submit state | Doc 03D §6.3: "never supplied by the caller". This is the boolean whose removal §6.3 itself records. The server derivation already exists (`isPreSubmitForSurface`, `server/services/tutor-antileak.ts:72`) |
| `active_question_canonical_id` comment (`:90`) | "INCLUDED in pre-submit retrieval per SCL-060" | SCL-060 has been reversed by SCL-144 |
| `retrievedItemSchema.provenance: z.string()` (`:44-53`) | Documented as a source-class label (`"textbook"`, `"video_transcript"` …), which duplicates `content_type` | §6.5 puts the question ID in provenance. Step 3 of this plan puts video timestamps there. A free string with a label convention can carry neither in a structured way |
| `ragCorpusMetadataSchema` (`:141-151`) | Same `provenance: z.string()` | This shape **locks at Step 2** (§6.7). Fixing it afterwards means recreating the corpus and re-importing everything |

The last row is a direct answer to §5 Q1. Whatever Step 1's fate, **the metadata schema has to be corrected before Step 2 runs**.

### 6.5 Owner decisions this adds

1. **Is same-skill prior-explanation retrieval wanted at all?** If yes, it needs a new SCL with the use case (§6.2). It also needs a single wire path that does not duplicate `question_content` (§6.1). If no, the deterministic path in §6.6 has no content class at V1, and the plan starts at Step 2.
2. **Gate edge case if it is wanted.** "Prior items only" has to mean *submitted*, not *seen*. An item answered wrong in practice can come back pre-submit in the review queue. Retrieved there as "prior same-skill", its explanation would reach the model while the student is working that same item, which SCL-144 forbids. The `WHERE` clause has to exclude any question that is pre-submit on *any* of the student's open surfaces, not just the active session.
3. **Correct `tutor-rag-types.ts` before Step 2:** remove `is_pre_submit` from the request (derive it server-side); drop the SCL-060 comment; make `provenance` a structured object (question ID, or source + segment timestamps) so the locked corpus metadata can carry what Steps 1 and 3 need. If this goes on the `lisa` branch it is a `packages/shared` change with no consumers, so it is cheap now and can't be done after Step 2.
4. **Spec amendments owed.** SCL-144's owner action ("amend Doc 03D §6.2, §6.3, §6.6 to 'explanation is delivered post-submit only'") is still open, so the locked §6.3 table and the live code disagree. This plan cites §6 as locked, which means it cites the unamended text.

### 6.6 Revised sequencing, pending those rulings

- **If 6.5.1 is "no":** fix the scaffold (6.5.3) → Step 2 → 3 → 4 → 5, with only the semantic path. The merge interface is still built, with the deterministic arm empty.
- **If 6.5.1 is "yes":** new SCL ruled → scaffold fix → Step 1 with one wire path and the 6.5.2 gate → Step 2 onward as written.

Either way, the scaffold fix comes before Step 2, which settles §5 Q1: do not run Step 2 before it.
