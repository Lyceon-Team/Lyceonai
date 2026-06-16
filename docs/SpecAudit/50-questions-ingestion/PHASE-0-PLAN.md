# Questions Ingestion Wave — Phase-0 Plan (PLAN MODE; no build, no inserts, no migration, no parsing-at-scale)

> Goal: populate the intentionally-empty genesis `public.questions` bank with **real official
> College Board content** (NOT AI-generated). The moat is *real CB questions + the owner's QA
> bar*. This document is the plan only. Nothing parses at scale, nothing inserts, nothing
> migrates until the owner rules on the HALTs below.
>
> HEAD `1aced52`. Grounded in the locked corpus (Doc 02A V6 §10/§14/§15/§16/§23/§27–§29,
> Doc 02 Preamble §12 INV-02-08/09, Doc 04A §7.3.1, Doc 04B V4.3) and the genesis baseline
> (`supabase/migrations/00000000000000_genesis.sql:465–490`), not summaries.
> Discipline inherited from `../30-genesis-recut/RESEED-MAPPING.md` (owner-run, staging-first,
> pre-flight gates, transactional, exit-proof, no `service_role` for agents).

---

## Central findings (they correct the task premise)

Three premises in the request are wrong or already-resolved. Surfacing before planning:

1. **The source material is NOT in the repo.** There is no `docs/SAT Questions S.D` (or any
   variant) anywhere — not on `claude/wonderful-bell-w8v5tv`, not on `cleanup`, not in git
   history, stashes, or as untracked/ignored files. A Drive sweep returned only spec/factory
   docs, **no corpus of CB questions**. The web container clones the repo fresh; if the owner
   added the folder locally it was never committed+pushed. **The source-format report below
   cannot be grounded on the real files — it is grounded instead on the spec's own description
   of the expected source (Doc 02A §10).** This is **HALT-1** and it blocks everything
   downstream. *Confront this first.*

2. **The canonical-ID CHECK already matches §14.** The task says the CHECK "was flagged at
   WS-1 as needing an update before any real insert." The genesis recut already landed the
   §14-exact regex; the lenient legacy constraint was **replaced, not deferred**. So this is a
   *verify*, not a *blocking migration*. Detail in §4.

3. **The genesis schema can only hold 4-option MCQs — it cannot represent SAT Math
   student-produced-response (grid-in) items**, which are ~25% of real Digital SAT Math and
   which the exam runtime (Doc 04A §7.3.1) and scoring (Doc 04B §) are *already built to
   handle* via a `correct_variants` array. The `questions` table has no item-type
   discriminator and no `correct_variants` column. This is **HALT-5** and it gates any Math
   ingestion that includes grid-ins. Detail in §2 + §3.

---

## 1. Source-format report (what's actually there)

**Direct finding:** the named folder does not exist in this checkout (HALT-1). Verification run:

- `git ls-files | grep -i 'sat|question|s\.d'` → only code/spec/blog hits; no question corpus.
- `git log --all --name-only | grep -i 'sat.?quest|s\.d|college.?board'` → nothing.
- `git status --ignored` → clean; no untracked/ignored question files.
- Drive `fullText contains 'SAT'` + folder search → 9 spec/factory docs, **0 question folders**.

**Expected format, per the spec (the contract the owner's folder is presumed to match).**
Doc 02A §10 (`Lyceon — Document 02A_… (V6).md:302–338`) describes the source the pipeline was
designed to ingest. Treat this as the *hypothesis* to confirm against the real files once they
land (HALT-1):

- **Heterogeneous inputs** — "PDFs, DOCX, images, CSV, JSON, plain text, structured
  spreadsheets, and folder-based legacy item drops" (§10:304). So the source may be
  **image-based (needs OCR)** or **extractable text** — *unknown until grounded*.
- **Metadata encoded in the filename** — the "Legacy Filename Contract" (§10:318–334):

  ```
  <Difficulty> - <Skill> - <Domain> - <Section> - <Legacy ID>
  Easy - Right triangles and trigonometry - Geometry and Trigonometry - Math-10
  Hard - Command of Evidence - Information and Ideas - Reading and Writing - 98
  ```
  Parser contract (§10:329–334): delimiter ` - ` (space-hyphen-space); `Easy→1 Medium→2
  Hard→3` (INV-02A-05); `Math→M`, `Reading and Writing→RW`; non-matching filenames route to a
  manual-review queue with the raw filename preserved. The owner's "organized by difficulty
  and skill" maps onto this — *if* the real folder follows it. **Confirm, don't assume.**
- **Within-doc structure the extractor must recover** (§10:306–316): passage, stem, options
  with key preservation, answer key, images/diagrams (→ `/processed/assets/`), tables, and
  "Formula capture (LaTeX where possible)."

**What this report cannot yet give** (because the files are absent): real file types
(PDF vs image), whether text is extractable or OCR-only, the true folder/tag encoding, and the
3–5 verbatim sample questions the task asks for. Those are the **first deliverable after
HALT-1 is cleared** — a ten-item hand-read, not a parser.

---

## 2. Source → genesis schema mapping

Authoritative target is the genesis DDL (`supabase/migrations/00000000000000_genesis.sql:465–490`),
mirrored by the Doc 02A §16 directional schema. **Note the real column names** — the task's
generic names differ: genesis uses `id` (not `canonical_id`), `section` (not `section_code`),
`skill_codes TEXT[]` (not `skill`), and has **no `question_type`**.

| genesis column | type / constraint | source of value (official CB) | gap / derivation |
|---|---|---|---|
| `id` | `TEXT PK CHECK ~ '^SAT(M\|RW)[12][A-Z0-9]{6}$'` | **minted at promotion** (§14), product-side, collision-checked | not from source; the filename "Legacy ID" goes to `source_lineage`, never to `id` |
| `section` | `TEXT CHECK IN ('M','RW')` | filename `<Section>` via §11 (`Math→M`, `Reading and Writing→RW`) | — |
| `source_type` | `INT CHECK IN (1,2)` | **fixed `1` ("Source-derived")** for this wave (official CB) | wave-level constant; provenance lever |
| `domain` | `TEXT NOT NULL` | filename `<Domain>` (e.g. "Geometry and Trigonometry") | needs §11 synonym→canonical-domain mapping table (**missing artifact**) |
| `skill_codes` | `TEXT[] NOT NULL` | filename `<Skill>` (e.g. "Command of Evidence") | needs CB-skill-name → Lyceon skill-code map; wrap single skill as 1-elem array (**missing artifact**) |
| `difficulty` | `INT CHECK 1–3` | folder/filename `<Difficulty>` via `Easy→1 Medium→2 Hard→3` | **confirm the source's difficulty scale is 3-level**, not CB's per-item IRT band (HALT-7) |
| `stem` | `TEXT NOT NULL` | extracted question text | math notation representation **unsolved** (§3, HALT-3) |
| `passage` | `TEXT` (nullable) | RW passage text; NULL for Math | truncation is a top-280 defect → QA rule QA-RW-PASSAGE (§5) |
| `options` | `JSONB NOT NULL` `[{key,text}]` | extracted A/B/C/D | **grid-in Math has no options** → cannot satisfy NOT NULL (HALT-5) |
| `correct_answer` | `TEXT NOT NULL` ('A'\|'B'\|'C'\|'D') | answer key | grid-in answer is a number/variant set, not a key → no column to hold it (HALT-5) |
| `explanation` | `TEXT NOT NULL` | CB rationale, **if present in source** | many CB drops carry no rationale → NOT NULL fails → owner-authored or not-promotable (HALT-4) |
| `option_metadata` | `JSONB` (nullable) | distractor `error_taxonomy` per §18 | **CB source does not carry distractor taxonomy** → leave null (gate §23 N/A for source-derived) or owner-derive |
| `assets` | `JSONB` (nullable) | figures/diagrams | **JSONB shape undefined even in Doc 02C** → representation unsolved (§3, HALT-2) |
| `status` | `TEXT CHECK draft\|qa\|published\|retired` | lifecycle: insert `draft`→`qa`→`published` | — |
| `version` | `INT default 1` | `1` | — |
| `created_at` | `TIMESTAMPTZ default now()` | now() | — |
| `source_lineage` | `JSONB` (nullable) | `{provenance:'College Board official', source_filename, legacy_id, page, extracted_at, parser_version}` | **this is where official provenance lives** — load-bearing for the moat |
| `generation_attribution` | `JSONB` (nullable) | N/A for source-derived | null (this is the AI-generation field, §15) |
| `estimated_time_seconds` | `INT` (nullable) | not in source | derive from section/difficulty defaults or owner-set; §23 metadata gate wants it (HALT-6) |
| `premium_flag` / `quality_score` / `issue_flags` | internal | owner/QA-set | — |

**Fields the source does not carry (need derivation or owner authorship):** canonical `id`
(minted), canonical `domain`/`skill_codes` mappings, `option_metadata`, `explanation` (when the
PDF lacks it), `estimated_time_seconds`, the `assets` JSONB shape — and a place to put a
**grid-in answer** (`correct_variants`), which has no column at all.

---

## 3. Math + diagram representation proposal (the hard part)

**Math notation.** The genesis schema has **no KaTeX/MathML/TeX column**; `stem`/`passage`/
`options.text` are plain `TEXT`. The only spec hook is extraction-side "Formula capture (LaTeX
where possible)" (§10:316). §15's candidate schema (`:509–539`) carries notation only as inline
strings. **Nothing locks the in-text encoding.** Proposal (for owner ruling, HALT-3):

- Encode math inline as **LaTeX delimited by `$…$` / `$$…$$`** inside `stem`/`passage`/
  `options.text`; render client-side with **KaTeX**. This keeps the column model unchanged and
  is the lowest-divergence option.
- Add one **machine gate** the moat can enforce: every `$…$` span must **parse under KaTeX in
  strict mode** (no `\color`, no raw HTML) → a candidate whose math doesn't render is rejected,
  not silently shipped. (Falsifiable; runs in the validator.)
- **Unsolved / flag:** whether the client surface already ships a KaTeX renderer (the WS-1 math
  deferral was never closed); whether to store a pre-rendered fallback. A question whose
  notation can't render faithfully **is not promotion-eligible**.

**Diagrams / figures.** `assets JSONB` exists in genesis (`:478`) and §16 — but its **internal
shape is undefined even in Doc 02C** (grep of Doc 02C for `assets|svg|figure|katex` → no
matches). §10 only says "Image and diagram capture to `/processed/assets/`." **§15's candidate
schema has no `assets` field at all** — so even the generation contract never modeled figures.
Proposal (for owner ruling, HALT-2):

- Define `assets` as a typed JSON array, single source-of-truth Zod in `packages/shared`:
  `[{ id, kind: 'image'|'svg'|'table', uri, alt, width?, height?, sha256 }]`, where `uri`
  points at owner-controlled storage (Supabase Storage / `/processed/assets/`), **never inline
  base64**, and `stem` references the asset by `{{asset:id}}`.
- **Machine gate:** every `{{asset:id}}` reference resolves to an `assets[].id`, and every
  `assets[].uri` resolves to a stored object (HEAD 200) with matching `sha256`. A figure-bearing
  question with a dangling/zero-byte asset is rejected (this is exactly §23's "no broken assets").
- **Unsolved / flag:** SVG sanitization policy (§23 "no unsafe content"), accessibility `alt`
  authorship (owner-eye), and whether figures are redrawn (license-clean) vs. captured from CB
  PDFs (provenance/IP question for the owner). **A question that can't faithfully represent its
  diagram can't be promoted.**

---

## 4. Canonical-ID + CHECK-constraint precondition status

- **Genesis CHECK** (`00000000000000_genesis.sql:466`):
  `id TEXT PRIMARY KEY CHECK (id ~ '^SAT(M|RW)[12][A-Z0-9]{6}$')`.
- **§14 format** (Doc 02A §14, `:416–502`): `SAT` + `{M|RW}` + `{1|2}` + 6× `[A-Z0-9]`,
  minted **product-side at promotion**, collision-checked against `public.questions.id`,
  never reused, never content-derived.
- **Verdict: MATCH — EXACT.** The precondition the task feared is **already satisfied in the
  committed baseline.** The lenient preBaseline constraint (`canonical_id ~ '^[A-Z0-9]{8,}$'`,
  `docs/SpecAudit/_legacy-migrations/…/20251222_add_canonical_id_to_questions.sql`) was
  **replaced** by the genesis recut, not deferred. **No precondition migration is required.**
- **Two precision notes for the owner:**
  1. The task wrote the format as `SAT(MT|RW)(1|2)…`. The locked section code is **`M`, not
     `MT`** (Doc 02A §14 "Section Codes (Locked): `M`=Math, `RW`=Reading & Writing"). Minting
     `SATMT…` would violate the CHECK. Use `M`.
  2. **One verify-only gate before the first insert (not a migration):** confirm the *live*
     Supabase `public.questions` reflects genesis and not a stale legacy CHECK. Owner-run,
     read-only:
     ```sql
     SELECT conname, pg_get_constraintdef(oid)
     FROM pg_constraint
     WHERE conrelid = 'public.questions'::regclass AND contype = 'c';
     -- expect the id check to be: (id ~ '^SAT(M|RW)[12][A-Z0-9]{6}$')
     ```

**Adjacent divergence to reconcile (not the CHECK, but it touches the insert/serve path):**
`shared/question-bank-contract.ts` (`projectStudentSafeQuestion`, `validateQuestionForPublish`)
keys on **legacy names** `canonical_id` / `section_code` / `question_type` (`:20–34, 145–224,
448–464`) that **genesis does not have** (`id` / `section`, no `question_type`). The existing
anti-leak projection would null-out genesis rows. Before serving ingested questions, the
serving/QA path must map genesis `id`/`section` → the contract shape (or the contract must be
reconciled to genesis). Flagged as **HALT-8** (precondition for the deferred serving probe to
mean anything).

---

## 5. The QA gate — the moat (falsifiable checklist)

Derived from the **§23 Automated QA Gate System** (`:881–919`) ∧ the **280-discard defect
taxonomy** (`../30-genesis-recut/RESEED-MAPPING.md:19–25`). The pipeline's job is to make slop
**structurally rejectable**: machine assertions first, owner-eye only where judgment is
irreducible. Every machine rule returns `{pass|reject|flag, reasons[]}` from a **pure validator**
run in CI on golden fixtures (§23:913–915).

### Machine-checkable (BLOCKING — reject the candidate)

| ID | Assertion | Source defect / gate |
|---|---|---|
| QA-SCHEMA | candidate parses the `packages/shared` Zod question schema | §23 schema validity |
| QA-ID | `id` matches `^SAT(M\|RW)[12][A-Z0-9]{6}$` (post-mint) | §14 / DB CHECK |
| QA-SECTION | `section ∈ {M,RW}` (rejects the `section_code='MATH'` defect) | 280 #6; DB CHECK |
| QA-SOURCE | `source_type = 1` for this wave (rejects SYNTH-as-1 confusion) | 280 #7 |
| QA-OPT-COUNT | exactly 4 options, keys A/B/C/D, all non-empty | §23 four-options |
| QA-OPT-DUP | 4 option texts distinct after whitespace+case normalization | 280 #1 dup options |
| QA-ONE-CORRECT | exactly one `option_metadata.role='correct'` **(if metadata present)** | §23 one-correct |
| QA-KEY | `correct_answer` = key of the correct option | §23 answer-key integrity |
| QA-DIFF | `difficulty ∈ {1,2,3}` | §23; DB CHECK |
| QA-EXPL-LEN | `explanation` non-empty, ≥20 chars | §23 explanation present |
| QA-RW-PASSAGE | `section=RW ⇒ passage NOT NULL`, ≥ min length, not truncated (no mid-token cut) | 280 #5 truncated/missing passages |
| QA-DUP-EXACT | normalized `stem+options` hash not equal to any live/staging item | 280 #3; §23 no-exact-dup |
| QA-DUP-NEAR | embedding similarity < 0.95 vs live+staging (route to dedup if ≥) | 280 #4; §23/§24 |
| QA-KEY-DIST | answer-key distribution across a batch not degenerate (rejects "40 clones all keyed C") | 280 #4 template clones |
| QA-TAXONOMY | every distractor `error_taxonomy ∈ §18 enum`, correct's is null **(if metadata present)** | §23 taxonomy valid |
| QA-MATH-RENDER | every `$…$` span parses under KaTeX strict | §3 proposal; §23 "no malformed formulas" |
| QA-ASSET-RESOLVE | every `{{asset:id}}` resolves; every `assets[].uri` HEAD-200 + sha256 match | §3 proposal; §23 "no broken assets" |
| QA-LEAK | pre-submit projection of the inserted row returns `correct_answer=null, explanation=null` | INV-02-08/09; the deferred probe (§6) |

### Owner-eye review (REQUIRED — machine cannot falsify)

- **Answer-key correctness** — the machine checks the key is *consistent*, never that it is
  *right*. The owner verifies the keyed answer is actually correct. (The 280 had garbage that
  passed structure.)
- **Distractor quality** — "unsimplified garbage" distractors (280 #2) and implausible options:
  partially heuristic (QA-OPT-GARBAGE could flag numeric non-simplified forms) but
  fundamentally owner judgment.
- **Explanation truth** — QA-EXPL-LEN proves length, not correctness; owner reads it.
- **Figure faithfulness** — does the `assets` figure actually represent the question (owner-eye).
- **Difficulty plausibility** and **SAT realism** (§21 anti-AI-tell is N/A for genuine CB, but
  realism/typo/scan-artifact review still applies).

> Source-derived caveat: §23's `QA-ONE-CORRECT`/`QA-TAXONOMY`/AI-tell/`generation_attribution`
> gates were written for AI candidates (source_type=2). For official ingestion (source_type=1)
> they apply only **if** `option_metadata` is present; the load-bearing source-derived gates are
> structure, dedup, passage-integrity, key-integrity, math-render, asset-resolve, and anti-leak.

---

## 6. The insert path (owner-run, SQL-editor, gated, reversible)

Same discipline as the reseed (`../30-genesis-recut/RESEED-MAPPING.md`): **owner pastes SQL in
the Supabase SQL editor; agents never hold `service_role`; staging-first; pre-flight gates HALT
on any failure; transactional; exit-proof; reversible.** Promotion-time ID minting per §14/§27.

1. **Stage.** Owner loads QA'd candidates into a throwaway `ingest_stage` schema (mirror of the
   genesis `questions` columns + a `staging_id uuid` and `legacy_filename text`). No canonical
   `id` yet (§15: candidates carry `staging_id`, never `id`).
2. **Validate.** Run the pure QA validator (§5) over `ingest_stage` → `{pass|reject|flag}` per
   row. Only `pass` rows continue; `reject`/`flag` stay staged with reasons for owner review.
3. **Pre-flight gates (HALT on any failure — do not promote):** QA-SECTION, QA-SOURCE,
   QA-OPT-COUNT/DUP, QA-DIFF, QA-EXPL-LEN, QA-RW-PASSAGE, QA-DUP-EXACT (vs `public.questions`),
   QA-DUP-NEAR, QA-ASSET-RESOLVE. Mirror the reseed's "MUST be 0 / MUST return no rows" shape;
   never coalesce a violation away.
4. **Mint IDs (§14, product-side, at promotion).** For each pass row:
   `id = 'SAT' || section || source_type || <6× [A-Z0-9] crypto-random>`, **collision-checked**
   against `public.questions.id` (retry on the ~1-in-2-billion clash). Never reuse, never derive
   from content.
5. **Promote in one transaction (batch all-or-none, §29:1156).**
   ```sql
   BEGIN;
   INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty,
     stem, passage, options, correct_answer, explanation, option_metadata, assets,
     status, source_lineage, estimated_time_seconds)
   SELECT <minted_id>, s.section, 1, s.domain, s.skill_codes, s.difficulty,
     s.stem, s.passage, s.options, s.correct_answer, s.explanation, s.option_metadata, s.assets,
     'qa', s.source_lineage, s.estimated_time_seconds
   FROM ingest_stage.candidates s WHERE s.qa_status = 'pass';
   -- owner reviews 'qa' rows in-DB, then a second explicit step flips approved rows to 'published'.
   COMMIT;
   ```
   Insert at `status='qa'` (not straight to `published`) so promotion ≠ publication; the owner
   QA-bar flip to `'published'` is a separate, deliberate step.
6. **Exit proof.**
   ```sql
   SELECT count(*) FROM public.questions WHERE status='published';   -- expected batch size
   -- anti-leak holds: anon/authenticated have no grant; serving projection nulls answers.
   ```
   Then **run the now-live anti-leak serving probe** (§6 below) — it was a no-op against the
   empty bank and becomes real once rows exist. Embed counts + probe output in a closure record.
7. **Reversible.** Items land as `qa`→`published`; retire via `status='retired'` (never hard
   delete — §14 "never reused even if retired"); a bad batch rolls back pre-COMMIT; minted IDs
   are never recycled. `DROP SCHEMA ingest_stage CASCADE;` on cleanup.

**The deferred serving probe becomes runnable.** `tests/ci/questions.anti-leak.ci.test.ts` is
"tolerant to empty data" (`:14, 289–297`) and `scripts/probe/ws0-probe.ts` proves anon cannot
read answer content (`ws0-probe-output.txt`: 86 assertions, 0 FAIL). Once real rows exist, the
probe asserts on actual payloads — **QA-LEAK is only meaningful post-insert**, so step 6 runs it
as the terminal gate. Precondition: HALT-8 (the serving projection must read genesis `id`/
`section`, not legacy `canonical_id`/`section_code`).

---

## 7. HALT list (numbered; owner ruling required before any build/insert)

1. **HALT-1 — source material absent.** `docs/SAT Questions S.D` is not in the repo (any
   branch/history/stash), not untracked, and not in Drive. **Nothing downstream can be grounded
   on real files.** Owner: commit+push the folder, or point to its real location (Drive folder
   id / storage bucket). The §1 report is spec-hypothesis until this clears.
2. **HALT-2 — `assets` representation undefined.** The JSON shape for figures is unspecified
   even in Doc 02C; §15 has no `assets` field. Ruling needed on the §3 proposal (typed array +
   storage URIs + `{{asset:id}}` refs + resolve/sha256 gate + SVG sanitization + redraw-vs-capture
   IP). Diagram-bearing questions cannot be promoted until this is locked.
3. **HALT-3 — math notation encoding.** No KaTeX/MathML/TeX column; the WS-1 math deferral was
   never closed. Ruling needed: adopt inline `$…$` LaTeX + KaTeX-strict render gate (§3), and
   confirm the client ships a renderer.
4. **HALT-4 — `explanation` is NOT NULL but CB drops may omit rationales.** Ruling: owner-author
   explanations as part of the QA bar, or mark explanation-less items not-promotable.
5. **HALT-5 — grid-in (student-produced-response) Math has no schema home.** `options` is NOT
   NULL, `correct_answer` is a single A–D key, there is **no item-type discriminator** and **no
   `correct_variants`** — yet Doc 04A §7.3.1 / Doc 04B already score SPR via `correct_variants`.
   Ruling: scope this wave to **4-option MCQ only** (defer grid-ins), **or** log an SP for a
   genesis-extending migration (add `item_type` + `correct_variants`, relax `options` NOT NULL)
   before any Math grid-in lands.
6. **HALT-6 — `estimated_time_seconds` not in source.** §23 metadata-completeness wants it.
   Ruling: per-(section,difficulty) default table, or owner-set, or drop from the source-derived
   gate.
7. **HALT-7 — difficulty scale.** Confirm the source encodes 3-level Easy/Medium/Hard (maps
   1/2/3) and not CB's per-item IRT band; define the mapping if it's a different scale.
8. **HALT-8 — contract keys on legacy column names.** `shared/question-bank-contract.ts`
   projects on `canonical_id`/`section_code`/`question_type`, which genesis lacks; the anti-leak
   serving projection would null genesis rows. Ruling: reconcile the contract to genesis
   `id`/`section` (or add a mapper) **before** serving ingested questions — precondition for the
   QA-LEAK probe to be meaningful.

---

## What Phase-0 deliberately did NOT do

No files parsed at scale, no rows inserted, no migration written or applied, no `service_role`
used, nothing pushed to the live bank. Off cleanup. The next step is an **owner ruling on the
eight HALTs** — HALT-1 first, since the source files must exist before a single real question
can be read, let alone promoted.
