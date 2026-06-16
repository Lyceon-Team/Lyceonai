# Questions Ingestion — Logic (contract-first; the artifact Codex audits before any question .sql)

> Populating the genesis `public.questions` bank with **real College Board content**
> (`docs/SAT Qeustions S.D/`, owner's spelling). This file + the two artifacts beside it are
> the logic to audit FIRST. Once approved: CC produces question `.sql`, Codex audits question
> quality, owner approves, then the owner runs the insert. **No questions parsed at scale, no
> question `.sql` produced, no inserts here.**
>
> HEAD on `cleanup`. Companion artifacts in this folder:
>
> - `../50-questions-ingestion/grid-in-extension.sql` — the genesis-extending migration (written, not applied)
> - `../../../shared/question-ingestion-qa.ts` — the pure QA validator (the moat)
> - `../../../tests/question-ingestion-qa.contract.test.ts` — its contract tests
>
> Grounded in the **real files** (hand-read + `pdftotext`/`pdfimages`/`pdfinfo`, 2026-06-14),
> not the Doc 02A §10 hypothesis the Phase-0 plan had to use.

---

## 0. The live precondition (run-only-once, done)

Read-only verify against project **MVP** (`hncolwkccbbjkfithhlo`), 2026-06-14 — the live
`public.questions` carries the §14 id CHECK exactly:

```
questions_id_check        CHECK ((id ~ '^SAT(M|RW)[12][A-Z0-9]{6}$'))   -- §14, EXACT
questions_difficulty_check CHECK ((difficulty >= 1) AND (difficulty <= 3))
questions_section_check    CHECK ((section = ANY (ARRAY['M','RW'])))
questions_source_type_check CHECK ((source_type = ANY (ARRAY[1,2])))
questions_status_check     CHECK ((status = ANY (ARRAY['draft','qa','published','retired'])))
```

No canonical-id precondition migration is needed. The live table is still **MCQ-only** (no
`item_type`, no `correct_variants`, `options NOT NULL`) — which is exactly what the grid-in
extension (§3) fixes.

---

## 1. Source-format report (grounded in the real files)

**Path:** `docs/SAT Qeustions S.D/` — 87 PDFs. **Scale:** ~**3,752 questions** total (sum of
pages; `pdfinfo`). Difficulty is balanced **29 Easy / 29 Medium / 29 Hard** files; **57 Math /
30 RW** files. So the corpus is thousands of items — "no parsing at scale" is load-bearing.

**The file is a bank, not a question.** Each PDF holds **N questions** for ONE (difficulty,
skill, domain, section) cell — N ranges ~10 to ~176 (e.g. the Easy/Algebra/Linear-equations
file = 59 questions; the Hard/RW/Command-of-Evidence file = 176). The filename encodes the
**cell**; each question inside carries its own opaque **CB Question ID** (8 hex, e.g.
`fa80893a`, `0adbe034`) printed as "Question ID …". That CB id is **provenance** → it goes to
`source_lineage`, never to `id` (which is minted §14). CB ids are **not unique across files**
either (the filename "Math-39" index repeats across cells), confirming the legacy index is not
a key.

**Filename encoding — the §10 contract holds, with a real Math/RW asymmetry:**

- RW: `<Difficulty> - <Skill> - <Domain> - Reading and Writing - <idx>.pdf` (5 `-` fields).
- Math: `<Difficulty> - <Skill> - <Domain> - Math[-<idx>].pdf` (section+idx fused as
  `Math-28`, sometimes bare `Math`). The parser must special-case the Math tail; non-matching
  names route to manual review (per §10).
- Maps confirmed: `Easy/Medium/Hard → 1/2/3`; `Math → M`, `Reading and Writing → RW`. Domains
  observed: Algebra, Advanced Math, Geometry and Trigonometry, Problem-Solving and Data
  Analysis (Math); Information and Ideas, Craft and Structure, Expression of Ideas, Standard
  English Conventions (RW). **HALT-7 resolved:** the source uses the 3-level Easy/Medium/Hard
  scale, not an IRT band.

**File type & extractability — heterogeneous, the hard surprise.** All PDFs, but content is
largely **rendered as images**, not text:

- The algebra file has **178 embedded images** for 59 questions; `pdftotext` on its first
  question returns only `Question ID fa80893a` + the metadata-table labels — **the stem,
  options, and math are NOT in the text layer.** Naive text extraction loses the question.
- Math-as-image is **not uniform**: the Right-triangles file has **0 images** (math is
  text/vector there). You cannot assume either per file.
- **Geometry/data files carry real figures as images** (Hard/Area-and-volume: 98 images;
  Two-variable-data/scatterplots: 75) — these are the diagrams §4 must represent.
- **RW files have 0 images** → passages, questions, options, and rationale are fully
  text-extractable (incl. embedded data tables, e.g. the "Gemini Mission Menus" table).

→ **Extraction must be OCR / vision-model, not a text parser**, for Math; RW can be text-first.
This is the single biggest correction to the Phase-0 plan and it drives the QA gate (every
extracted field is owner-verifiable because extraction is fallible).

**Explanations: PRESENT (owner's "yes" confirmed).** Every item has a full **Rationale**
(worked solution) AND per-distractor rationales ("Choice A is incorrect. This is the value of
x, not 3x+8."). So `explanation NOT NULL` is satisfiable from source — **HALT-4 resolved.**

**Grid-ins: PRESENT, intermixed, and the equivalence set is IN-SOURCE.** Within the single
Linear-equations file, MCQ items (`Correct Answer: C`) sit next to grid-ins
(`Correct Answer: 17` / `130` / `40`). Multi-form grid-ins carry the accepted set verbatim:
CB item `2f0a43b2` → `Correct Answer: .2, 1/5` with rationale _"Note that 1/5 and .2 are
examples of ways to enter a correct answer."_ We therefore **do not invent** grid-in
equivalence — we match CB's, and the source even hands us the variant list (§3).

**5 grounded sample shapes** (CB ids, from the Linear-equations file):
| CB id | item_type | stem (abridged) | answer in source | notes |
|---|---|---|---|---|
| `0adbe034` | mcq | If $4x-28=-24$, value of $x-7$? | `C` (= $-6$) | 4 options A–D + per-distractor rationale |
| `fa80893a` | grid_in | If $2x+3=9$, value of $6x-1$? | `17` | no options; single integer |
| `2f0a43b2` | grid_in | If $\frac{x}{8}=5$, value of $\frac{8}{x}$? | `.2, 1/5` | **multi-form variant set in-source** |
| `6105234d` | mcq | John paid \$165 … which equation? | `C` | word problem, \$ + variable |
| `997bec28` | grid_in | isosceles perimeter 83, sides 24 … third side? | `35` | word problem, integer answer |

---

## 2. Source → genesis schema transform (real column names)

Target = the live/genesis DDL (`supabase/migrations/00000000000000_genesis.sql:465`), **after**
the §3 extension. Real names: `id` (minted), `section` (M/RW), `skill_codes TEXT[]`,
`item_type` (new), `correct_variants` (new). The candidate shape the QA validator parses is
`ingestionCandidateSchema` in `shared/question-ingestion-qa.ts`.

| genesis column           | from the source                       | rule                                                                                                                                           |
| ------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | —                                     | **minted at promotion** (§14), `'SAT'‖section‖source_type‖6×[A-Z0-9]`, collision-checked. CB id never lands here.                              |
| `item_type`              | observed shape                        | options+A–D key ⇒ `mcq`; no options + numeric/multi-form answer ⇒ `grid_in`                                                                    |
| `section`                | filename `Math`/`Reading and Writing` | `→ M / RW` (canonical normalizer)                                                                                                              |
| `source_type`            | fixed                                 | **`1`** (official CB) for this whole wave                                                                                                      |
| `domain`                 | filename `<Domain>`                   | map synonyms → canonical domain                                                                                                                |
| `skill_codes`            | filename `<Skill>`                    | map CB skill name → Lyceon skill code; wrap as 1-elem array                                                                                    |
| `difficulty`             | filename `<Difficulty>`               | `Easy/Medium/Hard → 1/2/3`                                                                                                                     |
| `stem`                   | extracted (OCR/vision for Math)       | math as inline `$…$` LaTeX (§4)                                                                                                                |
| `passage`                | RW passage/table text                 | NULL for Math; required+integrity-checked for RW (§5)                                                                                          |
| `options`                | A–D options (mcq only)                | `[{key,text}]`; **NULL for grid_in**                                                                                                           |
| `correct_answer`         | CB "Correct Answer"                   | mcq: the `A–D` key; grid_in: the canonical value (e.g. `0.2`)                                                                                  |
| `correct_variants`       | CB variant list / single value        | grid_in only; the accepted set incl. `correct_answer` (§3)                                                                                     |
| `explanation`            | CB **Rationale**                      | present in-source; ≥20 chars (§5)                                                                                                              |
| `option_metadata`        | per-distractor rationales             | OPTIONAL for source-derived; prose, not §18 error_taxonomy (CB carries no taxonomy labels) — leave null or owner-derive                        |
| `assets`                 | embedded figures (geometry/data)      | typed JSON array (§4); NULL when no figure                                                                                                     |
| `source_lineage`         | **CB id + file**                      | `{provenance:'College Board official', cb_question_id, source_filename, source_page, extracted_at, extractor_version}` — the moat's provenance |
| `generation_attribution` | —                                     | NULL (this is the AI-gen field; N/A for source_type=1)                                                                                         |
| `estimated_time_seconds` | not in source                         | per-(section,difficulty) default or owner-set (HALT-6 ruling: defaults)                                                                        |
| `status`                 | lifecycle                             | insert `qa` → owner promotes `published`                                                                                                       |

**Not in the source / derived:** `id` (minted), canonical `domain`/`skill_codes` maps,
`option_metadata` taxonomy, `assets` JSON, `estimated_time_seconds`. All other student-facing
and answer fields come straight from CB.

---

## 3. Grid-in (SPR) extension + the response normalizer (HALT-5 = b)

**Schema:** `grid-in-extension.sql` adds `item_type` (`mcq|grid_in`) + `correct_variants TEXT[]`,
relaxes `options NOT NULL`, and adds the discriminated `questions_item_type_shape` CHECK. It is
**written, not applied** — owner-run after audit, reversible (DOWN section), validates against
the empty bank. `correct_variants` is **answer-bearing** → added to the never-serve-pre-submit
set (§6).

**Normalizer (`shared/question-ingestion-qa.ts`, the most-scrutinized code — QI-BLOCK-002):**

- `parseGridInValue(s)` → exact reduced **rational** (`bigint`). Accepts integers, signed
  decimals (incl. `.2`, `0.20`), fractions `a/b`; rejects mixed numbers (`3 1/2`), percents,
  separators, divide-by-zero, blanks — exactly the non-grid entries.
- `gridInAcceptedForms(value)` → the **EXHAUSTIVE** set of CB-accepted surface forms, generated
  from the exact value per the published Digital SAT rules: field budget **5 chars (6 for a
  negative, sign included)**; fraction form; the exact decimal when it terminates and fits;
  otherwise the 4th-digit **TRUNCATED and ROUNDED** decimals (both leading-zero spellings). So
  `2/3 → {2/3, .666, 0.666, .667, 0.667}` — the rounded AND truncated forms CB's own directions
  enumerate ("0.6666666 could be entered as 0.666 (truncated) or 0.667 (rounded)"). Not invented,
  not partial. **Proven (exact shipped algorithm, run 2026-06-14):** 2/3, 1/3 (truncate==round,
  no spurious `.334`), 1/5, 1/2, 1/16 (`.0625` exact, fits), 17, −2/3 — all match CB exactly.
- `normalizeGridInKey(exactAnswer, storedVariants)` → generates the exhaustive set and **requires
  the stored `correct_variants` to BE that set** — a partial set is rejected, never shipped
  (QI-BLOCK-002 fail-closed). `gridInResponseMatches(response, value)` is the Doc 04B runtime
  matcher (accepts the 4th-digit forms + value-equality for zero-padding).

---

## 4. Math + diagram representation (SAT-grade, fail-closed)

**Math — resolved, zero divergence.** The client **already ships a self-hosted KaTeX renderer**
(`client/src/components/MathRenderer.tsx`, `katex ^0.16.45`, postbuild guard
`scripts/check-no-cdn-katex.js`) that renders `$…$` / `$$…$$` / `\(…\)` / `\[…\]`. So the
representation is **inline `$…$` LaTeX in `stem`/`passage`/`options.text`** — the exact
convention already in production. The **WS-1 math deferral is closed.**

- **Fail-closed gate:** the runtime renderer is deliberately lenient (`strict:'warn',
throwOnError:false` → falls back to raw text). The **ingestion gate is strict**: every `$…$`
  span must parse under the _same_ `katex` with `strict:true, throwOnError:true`, else the item
  is **rejected, not shipped** (`QA-MATH-RENDER`, run as the IO probe folded into the
  validator). The pure validator also rejects unbalanced `$` delimiters intrinsically.

**Diagrams — HALT-2 ruled: regenerate as owner-authored SVG (path a), never capture (path b).**
A diagram is _geometry, not text_ — OCR can read a figure's labels but cannot "rerender" a
triangle or scatterplot. "Rerender via OCR" therefore forks, and only one branch clears the IP:

- **Path (a) — IP-clean (the ruling):** a vision model reads the original CB figure's content
  ("right triangle, legs 3 and 4, right angle at B, hypotenuse labeled x") and the owner
  **regenerates it as a fresh SVG** (or an owner-authored data `table`). The output is the
  owner's artwork; CB's raster never ships.
- **Path (b) — the trap, banned:** crop CB's raster and OCR-index it. The OCR costume does **not**
  clear the IP — it still ships CB's actual artwork. CC must build (a) explicitly, because the
  easy implementation is (b).

Lock `assets JSONB` as a typed array (Zod `assetSchema`) that makes (b) **structurally
unrepresentable**: `{ id, kind: svg|table, provenance: owner-regenerated-svg|owner-authored-table,
source_ref, faithfulness_verified, uri, alt, sha256, width?, height? }`, referenced as
`{{asset:id}}`. There is intentionally **no `image`/raster kind** — a captured CB figure cannot
even be expressed (proven: `QA-SCHEMA` reject test). Rules:

- **URIs only, never inline base64** (`QA-ASSET-REF` rejects `data:`).
- **`QA-ASSET-IP`:** `kind` ↔ `provenance` must agree (owner-authored only); any other pairing
  is rejected.
- **`QA-ASSET-FAITHFUL` (non-skippable owner-eye):** vision-extraction of a diagram is the
  **highest-error-risk step in the whole pipeline** — a misread angle or transposed coordinate
  is a figure that _looks right but is wrong_, and a wrong figure is a wrong question. The
  machine verifies the SVG **renders + resolves** (`QA-ASSET-RESOLVE`: every `{{asset:id}}`
  resolves; every `uri` HEAD-200 + `sha256` match; dangling/broken/zero-byte = reject, §23);
  only the **owner-eye verifies faithfulness** vs `source_ref`. Until `faithfulness_verified`,
  the item is **`flag` (route to owner), never auto-promoted** — it stages but does not promote.
- **Fallback (quality is the moat):** if vision-extraction proves too unreliable for a figure,
  it falls back to **manual redraw**, or the question **stays unpromoted**. Better an unpromoted
  question than a wrong one.

---

## 5. The QA gate — the moat (falsifiable, machine + owner-eye)

`evaluateIngestionCandidate(candidate, context)` → `{ pass | reject | flag, reasons[],
advisory_flags[], fingerprint }`. Pure: verdict is a deterministic function of the candidate +
injected IO-probe results. **FAIL-CLOSED (QI-BLOCK-001):** a required probe (dedup, KaTeX-strict,
asset resolve+media) that did not run, or whose results don't cover every target the candidate
carries, is a **REJECT** — "couldn't verify" is never a pass. Each machine gate maps 1:1 to a
§23 gate and/or a 280-discard defect:

| validator code      | asserts                                                              | §23 / 280 source             |
| ------------------- | -------------------------------------------------------------------- | ---------------------------- |
| `QA-SCHEMA`         | candidate parses the Zod shape                                       | §23 schema validity          |
| `QA-SOURCE`         | `source_type === 1` (official)                                       | 280 #7 (SYNTH-as-1)          |
| `QA-SECTION`        | section ∈ {M,RW}                                                     | 280 #6 (`section='MATH'`)    |
| `QA-DIFF`           | difficulty ∈ {1,2,3}                                                 | §23 difficulty range         |
| `QA-OPT-COUNT`      | mcq: 4 options A–D, non-empty                                        | §23 four-options             |
| `QA-OPT-DUP`        | mcq: 4 distinct option texts                                         | 280 #1 (dup options)         |
| `QA-KEY`            | mcq: key ∈ option keys                                               | §23 answer-key integrity     |
| `QA-ONE-CORRECT`    | mcq: ≤1 `role:correct` if metadata present                           | §23 one-correct              |
| `QA-GRID-SHAPE`     | grid_in: no options, value (not A–D) key                             | HALT-5 shape                 |
| `QA-GRID-VARIANTS`  | grid_in: stored set IS the exhaustive CB set (not partial)           | QI-BLOCK-002; §3             |
| `QA-TAXONOMY`       | option_metadata distractor labels ∈ §18 enum; correct's is null      | QI-BLOCK-006; §18/§23        |
| `QA-RW-PASSAGE`     | RW: passage present, ≥ floor; **truncation → reject** (not advisory) | QI-BLOCK-006; 280 #5         |
| `QA-EXPL-LEN`       | explanation ≥ 20 chars                                               | §23 explanation present      |
| `QA-MATH-RENDER`    | `$…$` balanced + KaTeX-strict; **missing probe ⇒ reject**            | QI-BLOCK-001; §23            |
| `QA-ASSET-REF`      | `{{asset:id}}` resolves; no inline base64                            | §23 "no broken assets"       |
| `QA-ASSET-RESOLVE`  | uri HEAD-200 + sha256; **missing probe ⇒ reject**                    | QI-BLOCK-001; §23            |
| `QA-ASSET-MEDIA`    | **SNIFFED** media type matches kind (raster-as-svg → reject)         | QI-BLOCK-005                 |
| `QA-ASSET-IP`       | figure is owner-authored (kind ↔ provenance); no CB raster           | HALT-2 path (a)              |
| `QA-ASSET-FAITHFUL` | figure pending owner-eye faithfulness → **flag**, route to owner     | HALT-2 (riskiest extraction) |
| `QA-DUP-EXACT`      | dedup ran AND no live/staging hit; **missing probe ⇒ reject**        | QI-BLOCK-001; 280 #3         |
| `QA-DUP-NEAR`       | embedding sim < 0.95 → **flag**, route to dedup                      | 280 #4; §23/§24              |

**Owner-eye (machine checks consistency; owner checks correctness):** answer-key _correctness_
(the machine proves the key is consistent, never that it is _right_), explanation _truth_,
distractor plausibility, figure faithfulness, difficulty plausibility, realism. SAT-grade is
the bar; quality is the moat. Proven by `tests/question-ingestion-qa.contract.test.ts`
(typechecks clean under repo `tsc`; runs in CI — the grid-in core ran green here).

---

## 6. HALT-8 reconciliation — serving contract keys on legacy names

`shared/question-bank-contract.ts` projects student-safe payloads keyed on **`canonical_id` /
`section_code` / `question_type`** (`projectStudentSafeQuestion`), which **genesis lacks** —
genesis is **`id` / `section`**, and now **`item_type`**. Left unreconciled, the anti-leak
projection nulls genesis rows and the deferred serving probe is meaningless. Mapping to wire
before serving ingested questions (or fold into the contract):

| contract field (legacy)         | genesis source                                         |
| ------------------------------- | ------------------------------------------------------ |
| `canonical_id`                  | `id`                                                   |
| `section_code`                  | `section`                                              |
| `question_type`                 | `item_type` (`mcq` → `multiple_choice`; add `grid_in`) |
| `correct_answer` (pre-submit)   | **null** (unchanged)                                   |
| `explanation` (pre-submit)      | **null** (unchanged)                                   |
| `correct_variants` (pre-submit) | **null — NEW answer-bearing field, MUST be nulled**    |

**Anti-leak addition (load-bearing):** `correct_variants` joins `{correct_answer, explanation,
option_metadata}` in the never-serve-pre-submit set (Doc 02 Preamble §12 INV-02-08). The
post-insert anti-leak probe (`tests/ci/questions.anti-leak.ci.test.ts`) must add an assertion
that no pre-submit payload carries `correct_variants`. This is the precondition for the probe
to be meaningful once real rows exist.

---

## 7. The insert path (owner-run, staging-first, gated, reversible)

Same discipline as the reseed (`../30-genesis-recut/RESEED-MAPPING.md`): **owner pastes SQL in
the Supabase SQL editor; agents never hold `service_role`; staging-first; gates HALT on any
failure; transactional; exit-proof; reversible.** Runbook shape (not executed):

1. **Apply the extension** — owner runs `grid-in-extension.sql` (§3) once. Verify the new CHECK
   exists (read-only).
2. **Stage** — load QA'd candidates into a throwaway `ingest_stage` schema mirroring the genesis
   columns + `staging_id uuid`. No canonical `id` yet (§14/§15: candidates carry `staging_id`).
3. **Validate** — run `evaluateIngestionCandidate` over staging with the IO probes
   (dedup, KaTeX-strict, asset-resolve) wired. Only `pass` rows advance; `reject`/`flag` stay
   staged with reasons for owner review.
4. **Pre-flight gates (HALT on any failure):** `QA-SECTION`, `QA-SOURCE`, `QA-OPT-*`, `QA-DIFF`,
   `QA-EXPL-LEN`, `QA-RW-PASSAGE`, `QA-GRID-*`, `QA-DUP-EXACT` (vs live), `QA-ASSET-RESOLVE`.
   Mirror the reseed's "MUST be 0 / MUST return no rows" shape; never coalesce a violation away.
5. **Mint ids (§14, product-side, at promotion):** `id = 'SAT'‖section‖source_type‖
<6×[A-Z0-9] crypto-random>`, collision-checked against `public.questions.id` (retry on the
   ~1-in-2-billion clash). Never reuse, never content-derive.
6. **Promote in one transaction (batch all-or-none):** INSERT into `public.questions` at
   `status='qa'` with `source_type=1`, `item_type`, `correct_variants` (grid_in), `assets`,
   `source_lineage` (CB provenance). Owner reviews `qa` rows in-DB, then a **separate** explicit
   step flips approved rows to `published` (promotion ≠ publication).
7. **Exit proof:** counts; then run the now-live **anti-leak serving probe** (§6) against the
   new rows — it was a no-op against the empty bank and becomes real once rows exist. Embed
   counts + probe output in a closure record.
8. **Reversible:** rows land `qa`→`published`; retire via `status='retired'` (never hard delete,
   §14 "never reused even if retired"); a bad batch rolls back pre-COMMIT; minted ids never
   recycle; `DROP SCHEMA ingest_stage CASCADE` on cleanup.

**Order:** logic approved (this file + the two artifacts, Codex-audited) → CC produces question
`.sql` → Codex audits question quality → owner approves → owner runs steps 1–8. Nothing past
step "logic approved" happens in this wave.

---

## 8. HALT status after this wave

| HALT                         | Phase-0 status | now                                                                                                                                                                                    |
| ---------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HALT-1 source absent         | blocking       | **resolved** — committed at `docs/SAT Qeustions S.D/`                                                                                                                                  |
| HALT-2 diagram repr          | unsolved       | **ruled (path a)** — vision-extract → owner-regenerated SVG → owner-eye faithfulness; path (b) raster capture structurally unrepresentable; fallback = manual redraw / stay unpromoted |
| HALT-3 math repr             | unsolved       | **resolved** — `$…$` LaTeX + shipped KaTeX + strict ingestion gate                                                                                                                     |
| HALT-4 explanation NOT NULL  | risk           | **resolved** — rationales present in-source                                                                                                                                            |
| HALT-5 grid-ins              | blocking       | **resolved** — `grid-in-extension.sql` + normalizer (this wave)                                                                                                                        |
| HALT-6 estimated_time        | open           | ruling = per-(section,difficulty) defaults                                                                                                                                             |
| HALT-7 difficulty scale      | open           | **resolved** — 3-level Easy/Medium/Hard                                                                                                                                                |
| HALT-8 contract legacy names | precondition   | **mapping specified (§6)**; wire before serving                                                                                                                                        |

No open HALT rulings remain. The one recurring gate before each figure-bearing promotion is the
**per-figure owner-eye faithfulness check** (HALT-2 path a): the machine renders/resolves the
regenerated SVG; only the owner confirms it faithfully matches the original CB figure.
