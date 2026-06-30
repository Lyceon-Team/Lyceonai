# WS-0 Question Bank — Gap-Closure Plan

**Generated:** 2026-06-27  
**Scope:** Read-only audit → gap-closure plan (Step 1 of 7-step build)  
**Branch:** `cleanup` @ `b4f12b2`  
**Audit evidence:** `audit-out/ws0_questionbank_audit_20260627T215900Z.md`  
**Spec corpus:** Doc 02 Preamble V3, Doc 02A V6, Doc 02B V4, Doc 05 Parent V1.0, Doc 05A V1.0  
**Ingestion docs:** PHASE-0-PLAN.md, INGESTION-LOGIC.md  

---

## 5.1 Gap Register

| Gap ID | Surface | Spec says (Doc §) | Live + code says (file:line / DDL) | Divergence class | Severity | Proposed closure | Owner Q? |
|--------|---------|--------------------|------------------------------------|------------------|----------|------------------|----------|
| G-01 | `questions.domain` — no CHECK, no FK | Doc 02A §14: 8 canonical domains (4 Math + 4 RW). INGESTION-LOGIC §2: "needs synonym→canonical-domain mapping table (**missing artifact**)". | Genesis DDL: `domain TEXT NOT NULL` — free text, no CHECK, no registry table. Live value: `Algebra`. `practice-topics-routes.ts:13-17` hardcodes 8 strings inline. | `missing-enforcement` | **High** — silent mismatch between questions.domain and student_skill_mastery.domain breaks mastery attribution | `add-constraint/registry` — add `canonical_domains` reference table with CHECK or FK. 8 rows, one-time. | Q1: Confirm the 8 canonical strings (see §5.3) |
| G-02 | `questions.skill_codes` — no CHECK, no FK, holds prose | Doc 02A §14: skill codes mapped from CB skill names → Lyceon skill codes. INGESTION-LOGIC §2: "needs CB-skill-name → Lyceon skill-code map (**missing artifact**)". | Genesis DDL: `skill_codes TEXT[] NOT NULL` — free text array. Live value: `{Linear equations and inequalities}` (prose, not a code). `student_skill_mastery.skill` is also prose. | `missing-enforcement` | **High** — same as G-01; convention-only match between questions ⇄ mastery | `add-constraint/registry` — add `canonical_skills` reference table. Skill-per-domain structure. Cross-dependency with Track 2 content set. | Q2: Who authors the canonical skill string set? |
| G-03 | `sourceTypeSchema` in `packages/shared` allows 0,1,2,3 | Doc 02A §14: source_type ∈ {1=Source-derived, 2=AI-generated}. Genesis DDL: `CHECK (source_type = ANY (ARRAY[1,2]))`. | `packages/shared/src/validate.ts`: `sourceTypeSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])`. `packages/shared/src/types.ts`: `SourceType = 0 | 1 | 2 | 3`. | `spec-vs-DB-name-divergence` | **Medium** — Zod accepts values DB rejects; inserts would fail at DB layer but upstream code could silently pass invalid values | `harden-code` — narrow `sourceTypeSchema` to `z.union([z.literal(1), z.literal(2)])` to match genesis CHECK. No SCL needed — spec already says 1,2. | — |
| G-04 | `packages/shared` uses legacy field names (`canonical_id`, `section_code`, `question_type`, `answer_text`) | Genesis DDL uses native names (`id`, `section`, `item_type` [planned], `correct_answer`). INGESTION-LOGIC §6 HALT-8: "contract keys on legacy column names… precondition for the QA-LEAK probe to be meaningful." | `packages/shared/src/validate.ts`: `canonicalQuestionSchema` uses `canonical_id`, `section_code`, `question_type`. `shared/question-bank-contract.ts:350-395`: `mapGenesisQuestionRow()` bridges genesis→legacy names. | `spec-vs-DB-name-divergence` | **Medium** — mapper exists and works, but two naming conventions create maintenance burden | `accept-as-is` — the mapper (`mapGenesisQuestionRow`) is the canonical bridge. Both naming layers are load-bearing (genesis DDL is locked; legacy names are in the serving contract). Unifying would require spec amendment. | — |
| G-05 | No `item_type` column in genesis DDL | Doc 02A V6 does not document grid-in. INGESTION-LOGIC §3: planned `grid-in-extension.sql` adds `item_type TEXT CHECK (item_type IN ('mcq','grid_in'))` + `correct_variants TEXT[]`. PHASE-0 HALT-5: "Grid-in Math has no schema home." | Genesis DDL: no `item_type` column. `question-bank-contract.ts:25`: `CANONICAL_ITEM_TYPES = ["mcq", "grid_in"]` — code supports it, DB doesn't. | `missing-artifact` | **Medium** — blocks grid-in ingestion but MCQ-only launch is viable | `revise-spec-down (SCL)` for launch: MCQ-only. Grid-in extension deferred to post-launch ingestion wave. Extension migration is already drafted (`grid-in-extension.sql`). | Q3: Confirm MCQ-only for launch wave |
| G-06 | `practice-topics-routes.ts:50` over-fetches `correct_answer` in SELECT | Doc 02 Preamble §12 INV-02-08: "Pre-submit client-facing surfaces must never receive correct answers." Defense-in-depth: don't fetch what you don't serve. | `practice-topics-routes.ts:50`: SELECT includes `correct_answer`. Projection at line 74 (`projectStudentSafeQuestion()`) hard-nulls it → response is safe. `questions-runtime.ts:28-38` (`QUESTION_SAFE_SELECT`) correctly excludes answer fields. | `anti-leak-hole` | **Medium** — safe in practice due to projection, but violates defense-in-depth. The row carries the answer in memory between SELECT and projection. | `harden-code` — remove `correct_answer` from the SELECT at `practice-topics-routes.ts:50` to match `QUESTION_SAFE_SELECT` pattern. One-line fix. | — |
| G-07 | No dedicated retrieval view for question serving | Doc 02B §20: "absolute prohibition" on pre-submit answer reveal. No explicit mandate for a DB-level view — the anti-leak posture is code-level. | Genesis DDL: RLS enabled, zero policies, service-role-only grants. No view. All serving goes through `projectStudentSafeQuestion()` in code. | `over-spec/simplifiable` | **Low** — code-level strip via canonical serializer is the accepted posture. A view would add a DB artifact for the same guarantee. | `accept-as-is` — `projectStudentSafeQuestion()` is the single canonical serializer used by all 6 serve paths. Hard-typed `correct_answer: null, explanation: null`. Adding a view would be redundant. | — |
| G-08 | Diagnostic eligibility — 40 baseline items (8 domains × 5) | Doc 05 Parent §10.1: 8 domains × 5 = 40 questions for diagnostic baseline. No explicit `diagnostic_eligible` flag mentioned. | No column, flag, or derived mechanism exists. The 40-item set would need to be `domain + difficulty=3 + status=published` or an explicit flag. | `missing-artifact` | **Low** (pre-launch; diagnostic is a later vertical) | `revise-spec-down (SCL)` — diagnostic eligibility is a derived query (`domain × hardest-tier × published`), not a stored flag. Defer column addition until diagnostic vertical is built. | Q4: Confirm derived-query approach vs explicit flag |
| G-09 | `answerKeySchema` is MCQ-only (`A|B|C|D`) | Doc 02A V6: MCQ correct_answer is single letter A–D. Grid-in uses numeric/fraction. | `packages/shared/src/validate.ts`: `answerKeySchema = z.enum(["A", "B", "C", "D"])`. `question-bank-contract.ts:86-119`: `parseCorrectVariants()` handles grid-in accepted-answer sets. | `already-aligned` | **None** (for MCQ-only launch) | `accept-as-is` — MCQ-only launch uses A–D. Grid-in extension will add `correct_variants` and the `parseCorrectVariants()` normalizer is already built. | — |
| G-10 | Difficulty representation alignment | Doc 02A §17 INV-02A-05: difficulty locked to integer 1-3 (Easy/Medium/Hard). | Genesis DDL: `CHECK (difficulty BETWEEN 1 AND 3)`. `packages/shared/src/validate.ts`: `difficultySchema = z.union([z.literal(1), z.literal(2), z.literal(3)])`. Doc 05 §6.1: `difficulty_weight` uses `difficulty_value ∈ {1,2,3}`. | `already-aligned` | **None** | `accept-as-is` — fully aligned end-to-end. | — |

---

## 5.2 Anti-Leak Surface Ruling

Every path that reads a question or its `correct_answer`/`explanation` was traced. Verdict: **can this path return `correct_answer`/`explanation` in a pre-submit response?**

| # | File | Line(s) | Path description | Pre-submit leak? | Reason |
|---|------|---------|------------------|-------------------|--------|
| 1 | `server/routes/practice-canonical.ts` | 54-65 (DTO type) | Pre-submit DTO definition | **NO** | Hard-typed `correct_answer: null, explanation: null` — cannot be assigned any other value at compile time |
| 2 | `server/routes/practice-canonical.ts` | 1648+ (`/next`) | Serve next practice question | **NO** | `toStudentSafeQuestionDTO()` calls `projectStudentSafeQuestion()` (lines 2558-2573) which hard-returns `correct_answer: null, explanation: null` |
| 3 | `server/routes/practice-canonical.ts` | 1464-1504 | Session creation prepopulation | **NO** | Answer snapshot persisted to `practice_session_items` for server-side grading only. Comment at line 1465: "denormalized snapshot… never projected to the student" |
| 4 | `server/routes/practice-canonical.ts` | 2307+ | Answer submission endpoint | **NO** | Post-submit path. Grading server-side; answer/explanation revealed only after submission confirmed |
| 5 | `server/routes/questions-runtime.ts` | 28-38 (SELECT) | Safe column select list | **NO** | `QUESTION_SAFE_SELECT` explicitly excludes `correct_answer`, `explanation`, `option_metadata`, `correct_variants`. Comment at lines 23-27: "NO answer-bearing fields… the row never carries them" |
| 6 | `server/routes/questions-runtime.ts` | all endpoints | All question-serving functions | **NO** | Chain: safe SELECT → `mapGenesisQuestionRow()` → `isStudentSafeRuntimeQuestion()` → `projectStudentSafeQuestion()`. Cannot leak what isn't fetched. |
| 7 | `server/routes/review-session-routes.ts` | 386+ (buildState) | Pre-submit review session state | **NO** | `projectStudentSafeQuestion()` called at lines 449-464 with explicit `correct_answer: null, explanation: null`. DTO at lines 488-490 carries nulls. |
| 8 | `server/routes/review-session-routes.ts` | 954+ (submitAnswer) | Post-submit answer reveal | **NO** (post-submit) | Explanation returned at line 1445 only after item status changed to `"answered"` at line 1253. Correct gate. |
| 9 | `server/routes/practice-topics-routes.ts` | 50 (SELECT) | Topic-filtered question fetch | **NO** (but over-fetches) | SELECT includes `correct_answer` — **defense-in-depth violation**. However, projection at line 74 via `projectStudentSafeQuestion()` hard-nulls it before response. Response is safe; SELECT should be trimmed (see G-06). |
| 10 | `server/routes/practice-topics-routes.ts` | 71-82 | Projection and response | **NO** | `isCanonicalPublishedMcQuestion(row)` filter at line 72 → `projectStudentSafeQuestion(row)` at line 74 → hard-null answers. |
| 11 | `apps/api/src/routes/rag-v2.ts` | 16-31 | RAG/tutor question sanitization | **NO** | `sanitizeQuestionForStudent()` explicitly nulls `correctAnswer: null`, `explanation: null`, and iterates sensitive key list to null all answer-bearing fields. |
| 12 | `apps/api/src/routes/rag-v2.ts` | 33-66 | RAG response wrapping | **NO** | `sanitizeRagResponseForStudent()` applies sanitizer to primaryQuestion and all supportingQuestions. `studentProfile` (server-only mastery) never exposed. |
| 13 | `apps/api/src/services/fullLengthExam.ts` | 2501-2573 | Active exam question serving | **NO** | SELECT at line 2501 excludes all answer fields. Projection at lines 2558-2573 calls `projectStudentSafeQuestion()` with explicit `correct_answer: null, explanation: null`. |
| 14 | `apps/api/src/services/fullLengthExam.ts` | 3749-3791 | Pre-completion exam review projection | **NO** | `projectSafeQuestionFields()` hard-nulls `correct_answer: null, explanation: null` at lines 3765-3766. Additionally strips domain/skill_code/difficulty per Doc 04A §10.2. |
| 15 | `apps/api/src/services/fullLengthExam.ts` | 3799-3823, 3908 | Post-completion exam review | **NO** (post-submit) | `projectFullQuestionFields()` re-adds answers only when `session.status === "completed"` (gate at line 3908). Correct per Doc 02 Preamble §12 reveal matrix. |

### Anti-Leak Ruling Summary

**All 15 serve paths are SAFE.** One defense-in-depth issue exists (G-06: `practice-topics-routes.ts:50` over-fetches `correct_answer` in SELECT) but the projection guarantee holds. The single canonical serializer `projectStudentSafeQuestion()` (`shared/question-bank-contract.ts:479-504`) is used by all pre-submit paths.

**Strengths:**
- Single canonical serializer — no second inline shape
- Hard-typed null fields in TypeScript DTOs — compile-time guarantee
- `QUESTION_SAFE_SELECT` pattern excludes answer fields at DB layer (used by 2 of 3 main serve files)
- Explicit post-submit gates in review and exam logic

**One fix needed:** Remove `correct_answer` from SELECT at `practice-topics-routes.ts:50` (G-06).

---

## 5.3 Canonical-Tagging Reconciliation

### Domain

| System | Representation | Source |
|--------|---------------|--------|
| `questions.domain` | Free text, e.g. `"Algebra"` | Genesis DDL — `domain TEXT NOT NULL`, no CHECK |
| `student_skill_mastery.domain` | Free text, e.g. `"Algebra"` | Genesis DDL — `domain TEXT`, no CHECK |
| `practice-topics-routes.ts:13-17` | 8 hardcoded strings | Inline constant `SAT_TOPICS` |
| INGESTION-LOGIC §1 (real corpus) | 8 observed domain names from CB PDFs | Math: Algebra, Advanced Math, Geometry and Trigonometry, Problem-Solving and Data Analysis. RW: Information and Ideas, Craft and Structure, Expression of Ideas, Standard English Conventions |

**Mismatch:** The hardcoded strings in `practice-topics-routes.ts:13` use `"Problem Solving & Data Analysis"` and `"Geometry & Trigonometry"` (ampersand, no hyphen), while the CB source corpus uses `"Problem-Solving and Data Analysis"` and `"Geometry and Trigonometry"` (hyphenated, "and"). If questions are ingested with CB-native domain strings, the practice filter will silently return zero results for those domains.

**Breaks silently at:** Practice topic filtering (`practice-topics-routes.ts:62`: `.eq("domain", domain)`) — a mismatch between the hardcoded filter value and the ingested question value produces an empty result set with no error.

### Skill

| System | Representation | Source |
|--------|---------------|--------|
| `questions.skill_codes` | `TEXT[]` of prose strings, e.g. `{"Linear equations and inequalities"}` | Genesis DDL |
| `student_skill_mastery.skill` | `TEXT` of prose string | Genesis DDL |

**Mismatch:** Both are free text matched by convention. No canonical skill registry exists. INGESTION-LOGIC §2 notes this as a **missing artifact**. The ingestion pipeline needs a synonym→canonical mapping table before questions can be reliably linked to mastery records.

### Difficulty

| System | Representation | Source |
|--------|---------------|--------|
| `questions.difficulty` | `INTEGER CHECK (BETWEEN 1 AND 3)` | Genesis DDL |
| `packages/shared` | `z.union([z.literal(1), z.literal(2), z.literal(3)])` | `validate.ts` |
| Doc 05 §6.1 mastery | `difficulty_value ∈ {1,2,3}` | Spec + `apply_mastery_event` RPC |
| Doc 02A §17 | Integer 1/2/3 (Easy/Medium/Hard), INV-02A-05 locked | Spec |

**Status: ALIGNED.** Difficulty is consistent end-to-end. No mismatch.

---

## 5.4 Proposed SCL Entries

### SCL-017 — `sourceTypeSchema` narrowed from {0,1,2,3} to {1,2} (match genesis CHECK)

| Field | Value |
|-------|-------|
| **Doc/Section** | Doc 02A §14 (`source_type` semantics) |
| **Status** | PROPOSED (Karl promotes) |
| **What changed** | `packages/shared/src/validate.ts` `sourceTypeSchema` accepts `z.literal(0)` and `z.literal(3)` which are outside the genesis CHECK constraint `(source_type = ANY (ARRAY[1,2]))` and have no spec-defined semantics. Narrow to `z.union([z.literal(1), z.literal(2)])`. Same for `SourceType` in `types.ts`. |
| **Why** | Code should not accept values the DB rejects. source_type 0 and 3 have no defined meaning in any spec document. |
| **Divergence class** | `spec-vs-DB-name-divergence` |
| **Build impact** | Two-line change in `validate.ts` + `types.ts`. No migration. |

### SCL-018 — Grid-in (`item_type` + `correct_variants`) deferred to post-launch; MCQ-only for launch wave

| Field | Value |
|-------|-------|
| **Doc/Section** | Doc 02A V6 (no grid-in section exists), INGESTION-LOGIC §3 |
| **Status** | PROPOSED (Karl promotes) |
| **What changed** | Doc 02A V6 does not document grid-in question handling. PHASE-0 HALT-5 identifies that genesis DDL has no `item_type` discriminator and no `correct_variants` column. The grid-in extension migration (`grid-in-extension.sql`) is drafted but not applied. For launch, scope to 4-option MCQ only. |
| **Why** | Simplest correct surface for launch. Grid-in normalizer and extension migration are already built — they ship when the Math grid-in content wave lands post-launch. |
| **Divergence class** | `over-spec/simplifiable` |
| **Build impact** | No migration for launch. `question-bank-contract.ts` grid-in support remains dormant. Extension migration applies with the first grid-in ingestion wave. |

### SCL-019 — Domain/skill canonical strings: hardcoded constants diverge from CB source corpus

| Field | Value |
|-------|-------|
| **Doc/Section** | Doc 02A §14 (domain/skill taxonomy), INGESTION-LOGIC §2 |
| **Status** | PROPOSED (Karl promotes) |
| **What changed** | `practice-topics-routes.ts:13-17` hardcodes domain strings using ampersands (`"Problem Solving & Data Analysis"`, `"Geometry & Trigonometry"`). The CB source corpus uses `"Problem-Solving and Data Analysis"` and `"Geometry and Trigonometry"`. No canonical domain registry table exists — the string set is unenforceable. |
| **Why** | A mismatch between ingested question domain values and hardcoded filter strings would silently produce empty practice result sets. A reference table locks the canonical strings and makes the mismatch detectable at insert time. |
| **Divergence class** | `missing-enforcement` |
| **Build impact** | Track 1: create `canonical_domains` and `canonical_skills` reference tables (8 domain rows + ~40 skill rows). Add FK or CHECK from `questions.domain` → registry. Update hardcoded strings in `practice-topics-routes.ts` to match. Track 2 cross-dependency: Karl/content team confirms the exact canonical string set. |

---

## 5.5 Track Split Recommendation

### Track 1 — Schema/Anti-Leak Hardening (Engineering, CC-implementable, deterministic)

| Item | Gap ID | Work |
|------|--------|------|
| Narrow `sourceTypeSchema` to {1,2} | G-03 | 2-line code change |
| Remove `correct_answer` from `practice-topics-routes.ts:50` SELECT | G-06 | 1-line code change |
| Create `canonical_domains` reference table (8 rows) | G-01 | Migration + FK/CHECK on `questions.domain` |
| Create `canonical_skills` reference table (~40 rows per domain) | G-02 | Migration + FK/CHECK on `questions.skill_codes` elements |
| Reconcile hardcoded domain strings to match registry | G-01 | Update `practice-topics-routes.ts:13-17` |

**Prerequisite:** Track 2 confirms canonical string set before Track 1 creates the registry tables.

### Track 2 — Content Authoring (Moat-quality, Karl-owned, pipeline + QA)

| Item | Gap ID | Work |
|------|--------|------|
| Confirm 8 canonical domain strings (CB-native vs Lyceon-native) | G-01 | Karl ruling |
| Author canonical skill string set per domain | G-02 | Karl + content team |
| Confirm MCQ-only for launch wave | G-05 | Karl ruling |
| Confirm diagnostic eligibility approach (derived vs flag) | G-08 | Karl ruling |
| Ingestion wave 1: 50 MCQ questions via PHASE-0-PLAN pipeline | — | Content pipeline |

### Cross-dependency

Track 1's registry tables (G-01, G-02) need Track 2's canonical string set. **Sequence:** Karl confirms strings → Track 1 creates registry → Track 2 ingests content with FK enforcement.

**Recommendation confirmed:** This split is correct. Track 1 is a short, deterministic engineering sprint (5 items, all mechanical). Track 2 is content-authoring work that requires human judgment on the canonical taxonomy. The cross-dependency is small and well-defined.

---

## 5.6 Open Owner Questions

These are questions the spec genuinely does not resolve. Everything the spec answers has been resolved from spec above.

**Q1 — Canonical domain strings:** The CB source corpus uses `"Problem-Solving and Data Analysis"` and `"Geometry and Trigonometry"` (hyphenated, "and"). The codebase uses `"Problem Solving & Data Analysis"` and `"Geometry & Trigonometry"` (no hyphen, ampersand). Which set is canonical for Lyceon? The registry table needs one locked answer.

**Q2 — Skill string set authorship:** INGESTION-LOGIC §2 identifies a "CB-skill-name → Lyceon skill-code map" as a **missing artifact**. Who authors the ~40 canonical skill strings (one per domain-skill combination)? Are they the CB-native names verbatim, or Lyceon-adapted?

**Q3 — MCQ-only launch confirmation:** PHASE-0 HALT-5 asks: scope launch wave to 4-option MCQ only (defer grid-in), or extend genesis schema first? The grid-in extension migration is drafted but grid-in is absent from Doc 02A V6. Recommend: MCQ-only for launch, grid-in post-launch.

**Q4 — Diagnostic eligibility: derived query vs stored flag:** Doc 05 Parent §10.1 specifies 8 domains × 5 = 40 diagnostic questions. Should eligibility be a derived query (`domain + difficulty=3 + published + LIMIT 5 per domain`) or an explicit `diagnostic_eligible BOOLEAN` column? Recommend: derived query — simpler, no column, no sync concern.

---

## Appendix: Evidence Index

| Evidence | Location |
|----------|----------|
| Audit report | `audit-out/ws0_questionbank_audit_20260627T215900Z.md` |
| Genesis DDL (`questions` table) | `supabase/migrations/00000000000000_genesis.sql:460-581` |
| Canonical serializer | `shared/question-bank-contract.ts:479-504` (`projectStudentSafeQuestion`) |
| ID builder | `shared/question-bank-contract.ts:406-436` (`buildCanonicalId`) |
| Genesis→legacy mapper | `shared/question-bank-contract.ts:350-395` (`mapGenesisQuestionRow`) |
| Zod schemas | `packages/shared/src/validate.ts` |
| TypeScript types | `packages/shared/src/types.ts` |
| Hardcoded domains | `server/routes/practice-topics-routes.ts:10-18` |
| Safe SELECT pattern | `server/routes/questions-runtime.ts:28-38` |
| Over-fetching SELECT | `server/routes/practice-topics-routes.ts:50` |
| Grid-in normalizer | `shared/question-bank-contract.ts:86-119` (`parseCorrectVariants`) |
| Doc 02 Preamble reveal matrix | `docs/Spec/Lyceon — Document 02 Preamble…(V3 Final).md` §12 |
| Doc 02A canonical ID/difficulty | `docs/Spec/Lyceon — Document 02A…(V6).md` §14, §17 |
| INGESTION-LOGIC domain/skill gaps | `docs/SpecAudit/50-questions-ingestion/INGESTION-LOGIC.md` §2 |
| PHASE-0 HALT-5 grid-in | `docs/SpecAudit/50-questions-ingestion/PHASE-0-PLAN.md` §7.5 |
