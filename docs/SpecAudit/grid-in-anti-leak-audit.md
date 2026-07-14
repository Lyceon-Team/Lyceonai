# Grid-In Anti-Leak Audit — Gap-Closure Plan

> **Audit date:** 2026-07-08 · **Status:** READ-ONLY audit complete, awaiting owner review
> **Scope:** Practice serve + grade paths for `item_type = 'grid_in'` against the anti-leak invariant (INV-02)
> **Companion contract:** `contracts/mcfr-coexistence.contract.md` (HALT-4 lane)

---

## Executive summary

The anti-leak serializer is **structurally sound today** — `correct_variants` is type-absent
from `StudentSafeQuestionDTO` (compile error to add it), and `correct_answer`/`explanation` are
hard-nulled at two layers. However, **grid-in is non-functional end-to-end on the practice path**:
items can be served (DTO is grid-in-aware) but cannot be graded (the submit handler is MCQ-only
and will 422 on any grid-in item). The anti-leak HTTP test proves MCQ only; grid-in has zero
integration-test coverage.

**No live leak exists today.** The 10 published grid-in questions can enter a practice session
via `select_practice_pool_random`, but grading will fail with a 422 before any answer data could
be exposed. The gap is **missing functionality + missing proof**, not an active leak.

---

## Surface 1 — SERVE PATH (`/next`, `/state`, resume)

### What a grid_in `/next` payload contains today

A grid-in item served through `/next` produces this `StudentSafeQuestionDTO`:

```
{
  sessionItemId: "...",
  stem: "...",
  section: "M",
  questionType: "grid_in",       // ← from projectStudentSafeQuestion
  itemType: "grid_in",
  inputMode: "numeric_entry",    // ← grid-in surface marker
  options: [],                   // ← forced empty for grid-in (line 666)
  difficulty: ...,
  correct_answer: null,          // ← HARD NULL (line 668)
  explanation: null              // ← HARD NULL (line 669)
}
```

**Evidence chain (file:line):**

| Step | File:line | What happens |
|------|-----------|--------------|
| DTO type definition | `practice-canonical.ts:57-68` | `correct_answer: null` and `explanation: null` are literal `null` types; `correct_variants` is absent from the type (comment at line 54) |
| Serializer | `practice-canonical.ts:635-671` | `toStudentSafeQuestionDTO` hard-sets both to `null` (lines 668-669); for grid-in, `options: []` (line 666) |
| Projection layer | `shared/question-bank-contract.ts:464-513` | `projectStudentSafeQuestion` nulls `correct_answer` (line 510) and `explanation` (line 511); never reads/emits `correct_variants` (comment at line 502) |

**`correct_variants` flow:** Read from `questions` table at session creation time by `toCanonicalQuestionForServing` (line 551). Stored on the server-side `CanonicalQuestionForServing` record (line 580). **Never passed to `toStudentSafeQuestionDTO`** — the function's input type (`CanonicalQuestionForServing`) carries it, but the output type (`StudentSafeQuestionDTO`) does not have the field. The serializer never copies it.

**`/state` endpoint** (`practice-canonical.ts:2358-2437`): returns only session metadata (`sessionId`, `state`, counters). No question content at all. **SAFE.**

**Resume path**: serves a question via the same `toStudentSafeQuestionDTO` (line 2081). **Same strip, same safety.**

### Gap

The serve path is structurally safe but **unproven for grid-in** — no integration test seeds a grid-in item and asserts the response body contains no `correct_variants`, no accepted forms, and no answer value.

---

## Surface 2 — GRADE PATH (answer submit)

### How grid-in correctness is computed today: IT ISN'T

The submit handler `submitPracticeAnswer` (`practice-canonical.ts:2472-2892`) is **MCQ-only**.

**Trace:**

1. **Line 2569:** `toCanonicalQuestionFromSessionItem(sessionItem)` reconstructs the question from the `practice_session_items` snapshot.
2. **Line 605:** This function **hardcodes `item_type: "mcq"`** and **`correct_variants: null`** (line 620). Comment at line 587: "Genesis schema is MCQ-only (no grid-in columns yet)."
3. **Line 2591:** `normalizeAnswerKey(canonicalQuestion.correct_answer)` — only accepts `A|B|C|D`. For a grid-in value like `"0.2"`, returns `null`.
4. **Lines 2594-2599:** `if (!correctAnswerKey)` → returns **422 "missing an answer key"**.
5. **Line 2659:** `chosen === correctAnswerKey` — pure MCQ key-match. `gridInResponseMatches` is never imported or called by this file.

**Where does the grading function exist?** `gridInResponseMatches` is defined in `shared/question-ingestion-qa.ts:436-444`. It is imported only by ingestion QA tests, never by the practice handler. The planned `gradeAnswer(item_type, submitted, key)` function (documented in `contracts/mcfr-coexistence.contract.md:62`) does not exist yet.

### Answer source at submit time

The submit handler reads ONLY from `practice_session_items` (the denormalized snapshot). It does **not** query back to `questions` at submit time. Since `practice_session_items` has no `question_item_type` or `question_correct_variants` columns, grid-in grading data is unavailable.

### Gap

Grid-in grading is **broken/unimplemented**. A grid-in item reaching the submit handler will always 422. This is a functionality gap, not a leak — but it means the 10 published grid-in questions cannot be answered in practice.

---

## Surface 3 — `correct_variants` invariant (INV-02 family)

### Every read site for `correct_variants` in production code

| File:line | Read/Write | Context | Client-reachable? |
|-----------|-----------|---------|-------------------|
| `practice-canonical.ts:551` | READ | `toCanonicalQuestionForServing` parses from `questions` row at session creation | NO — server-side record only |
| `practice-canonical.ts:580` | WRITE | Sets on `CanonicalQuestionForServing` return object | NO — stays server-side |
| `practice-canonical.ts:620` | WRITE | `toCanonicalQuestionFromSessionItem` hardcodes `null` | NO |
| `shared/question-bank-contract.ts:502` | — | Comment: "never read here" in `projectStudentSafeQuestion` | NO |
| `server/routes/questions-runtime.ts:25` | — | Excluded from `QUESTION_SAFE_SELECT` | NO — never queried for student paths |
| `supabase/migrations/20260628010000_grid_in_schema_extension.sql:20` | DDL | `ALTER TABLE questions ADD COLUMN correct_variants TEXT[]` | N/A |

**Verdict:** `correct_variants` is **never serialized to the client on any path** (serve, state, resume, submit response). The `StudentSafeQuestionDTO` type makes it a compile error. The `QUESTION_SAFE_SELECT` excludes it from DB queries on student-facing paths. **INVARIANT HOLDS.**

---

## Surface 4 — PARALLEL-PATHS check (MCQ vs grid-in structural comparison)

### How the two paths differ today

| Layer | MCQ | Grid-in |
|-------|-----|---------|
| **Selection** (`select_practice_pool_random`) | Returns `correct_answer`, `explanation` | Same — but does NOT return `item_type` or `correct_variants` |
| **Prepopulation** (`practice-canonical.ts:1448-1483`) | Inserts all MCQ columns | Same insert — but `question_correct_answer` gets the grid-in canonical value (e.g. `"0.2"`), and there is no `question_item_type` or `question_correct_variants` column |
| **Serving** (`toStudentSafeQuestionDTO`) | `options: safeOptions`, `inputMode: "choice"` | `options: []`, `inputMode: "numeric_entry"` — **SHARED serializer, same strip** |
| **Grading** (`submitPracticeAnswer`) | `normalizeAnswerKey` → key-match | **BROKEN** — `normalizeAnswerKey("0.2")` → `null` → 422 |
| **Anti-leak strip** | `correct_answer: null`, `explanation: null` | Same null strip — `correct_variants` absent from type | 

### Structural assessment

The serve path already uses **one serializer** for both item types — `toStudentSafeQuestionDTO` delegates to `projectStudentSafeQuestion`, which handles both MCQ and grid-in. This is the correct shape. Grid-in can be brought onto the same structural strip as MCQ with **zero changes to the serializer**.

The grade path is where the parallel-paths problem lives. MCQ grading is inline in the submit handler; grid-in grading needs to branch on `item_type` and delegate to `gridInResponseMatches`. Per the MCFR contract (line 62), the fix shape is a single `gradeAnswer(item_type, submitted, key)` function.

---

## Proposed fix shape (no code — structure only)

### 1. DB migration (OWNER-RUN)

Add to `practice_session_items`:
- `question_item_type TEXT NOT NULL DEFAULT 'mcq' CHECK (question_item_type IN ('mcq', 'grid_in'))`
- `question_correct_variants TEXT[]` (nullable — null for MCQ, populated for grid-in)
- Relax `question_options NOT NULL` → nullable (grid-in has no options)

This matches the shape documented in `contracts/mcfr-coexistence.contract.md:25` and `57-58`.

**FLAG: MIGRATION — Karl applies, not agent.**

### 2. RPC extension

`select_practice_pool_random` must return `item_type` and `correct_variants` so prepopulation can persist them.

**FLAG: MIGRATION — Karl applies.**

### 3. Prepopulation update

`insertRows` (line 1448) must populate `question_item_type` and `question_correct_variants` from the RPC output.

### 4. Session-item reconstruction

`toCanonicalQuestionFromSessionItem` (line 588) must read `question_item_type` and `question_correct_variants` from the row instead of hardcoding `"mcq"` and `null`.

### 5. Unified grader

Extract a `gradeAnswer(itemType, submitted, correctAnswer, correctVariants)` function:
- MCQ: `normalizeAnswerKey(submitted) === normalizeAnswerKey(correctAnswer)`
- Grid-in: `gridInResponseMatches(submitted, parseGridInValue(correctAnswer))` — consuming the existing shared normalizer, no second equivalence implementation

The submit handler branches on `item_type` from the reconstructed question and calls the unified grader.

### 6. Submit response shape

For grid-in, the response must NOT include `correctOptionId` (there are no options). It should include `isCorrect`, `explanation`, `feedback`. `correct_variants` must NOT appear in the response — same as MCQ's strip.

---

## The proof test

A new test file: `tests/ci/practice.next-http-anti-leak-grid-in.ci.test.ts`

**Fixture:** A `practice_session_items` row with:
- `question_item_type: "grid_in"`
- `question_correct_answer: "0.2"` (or `"2/5"`)
- `question_correct_variants: ["1/5", ".2", "0.2", "0.20"]`
- `question_options: null` (or `"[]"`)

**Assertions:**

1. **Serve anti-leak:** `GET /next` response has `correct_answer: null`, `explanation: null`. `JSON.stringify(body)` does not contain `"correct_variants"`, does not contain any value from the accepted-forms set, does not contain the correct answer string.
2. **Input mode:** Response has `inputMode: "numeric_entry"`, `options: []`, `itemType: "grid_in"`.
3. **Grade correctness:** `POST /answer` with `selectedAnswer: "0.2"` returns `isCorrect: true`. Same with `".2"` and `"1/5"`.
4. **Grade rejection:** `POST /answer` with `selectedAnswer: "0.3"` returns `isCorrect: false`.
5. **Response strip:** Submit response does NOT contain `correct_variants` anywhere in the serialized body.
6. **Idempotency:** Replay of the same `clientAttemptId` returns cached result with `idempotentRetried: true`.

This mirrors the MCQ HTTP anti-leak test (`practice.next-http-anti-leak.ci.test.ts`) but with a grid-in fixture.

---

## Owner questions

1. **RPC filter:** `select_practice_pool_random` currently selects ALL published questions regardless of `item_type`. With 10 grid-in items live, they can enter MCQ-only sessions today (grading will 422). Should we add an `item_type` filter to the RPC so grid-in items are excluded until grading lands, or is the 422 an acceptable fail-safe?

2. **Migration sequencing:** The MCFR contract says this lane is built "after this PR's re-audit clears." Is the grid-in schema extension migration (`20260628010000_grid_in_schema_extension.sql`) already applied to production, or is it pending? If applied, the `questions` table has `item_type` + `correct_variants` but `practice_session_items` does not — confirming the gap.

3. **`question_options NOT NULL` relaxation:** The contract calls for relaxing this constraint (line 25). Grid-in items have no options. Should `question_options` become nullable, or should we store `'[]'::jsonb` (empty array) for grid-in items? The current prepopulation writes `JSON.stringify([])` for grid-in options from `toCanonicalQuestionForServing`, so storing `'[]'::jsonb` may be sufficient without a constraint change.

4. **Review + full-length surfaces:** The MCFR contract (lines 26-27) extends grid-in to review and full-length session items tables. This audit scoped practice only. Should the grid-in anti-leak proof cover all three session types in one lane, or is practice-first acceptable?

5. **Server-side lookup vs. snapshot for grading:** Two viable shapes for grid-in grading:
   - **(a) Snapshot:** Store `correct_variants` in `practice_session_items` at prepopulation. Grading reads from snapshot. Pro: no second DB query at submit time, consistent with MCQ pattern. Con: requires migration + backfill for any in-flight sessions.
   - **(b) Lookup:** At submit time, query `questions.correct_variants` by `question_id`. Pro: no migration needed for the items table. Con: creates a second answer-data path the MCQ anti-leak proof doesn't cover; couples grading to the live `questions` row (if a question is updated mid-session, grading changes).
   The snapshot shape (a) is recommended per the parallel-paths principle. Confirm?

---

## Summary

| Finding | Severity | Status |
|---------|----------|--------|
| No live leak — `correct_variants` never reaches client | — | **CONFIRMED SAFE** |
| Grid-in grading is non-functional (422 on submit) | Functional gap | **KNOWN** (MCFR contract) |
| Anti-leak HTTP test has zero grid-in coverage | Proof gap | **NEEDS FIX** |
| `select_practice_pool_random` missing `item_type` + `correct_variants` | Functional gap | **NEEDS MIGRATION** |
| `practice_session_items` missing grid-in columns | Functional gap | **NEEDS MIGRATION** |
| Serve path serializer already handles grid-in correctly | — | **CONFIRMED** |
| `correct_variants` never serialized on any path | — | **CONFIRMED** |
