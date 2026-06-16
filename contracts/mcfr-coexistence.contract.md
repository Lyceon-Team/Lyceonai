# MC + FR Coexistence — Contract (HALT-4; contract-first, follow-on lane — NOT this PR)

> Registered 2026-06-15 from the owner's HALT-4 ruling. Grid-ins are **non-functional
> end-to-end without this lane**: this PR's seam (QI-BLOCK-003) made the _questions feed +
> practice serving_ genesis-native and grid-in-aware, but free-response (FR = grid_in / SPR)
> items cannot yet be persisted or graded through any session type. This contract is the
> named requirement; it is planned and built **after this PR's combined Codex re-audit clears**.
>
> Naming: the owner's "MC / FR" = the schema's `item_type ∈ {'mcq','grid_in'}`. MC = multiple
> choice (4 options A–D + a key). FR = free response / student-produced response (no options;
> a numeric answer matched against the CB-accepted variant set).

## The single load-bearing rule

`item_type` must flow **unbroken** through every layer, and FR must be **anti-leak-safe** and
**graded by the same normalizer ingestion uses** — never a second, divergent equivalence check.

## Scope — four serving surfaces, three session types, one grader

| Layer                                        | MC today                                                     | FR requirement (this lane)                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.questions`                           | ✓ (`grid-in-extension.sql`: `item_type`, `correct_variants`) | already grid-in-ready (this PR)                                                                                                                |
| Questions feed (`questions-runtime.ts`)      | ✓ genesis-native (this PR)                                   | already serves both (this PR)                                                                                                                  |
| Practice serving (`practice-canonical.ts`)   | ✓ genesis-native (this PR)                                   | DTO already grid-in-aware (this PR)                                                                                                            |
| **`practice_session_items`** (DB)            | ✓                                                            | **add** `question_item_type` + `question_correct_variants`; **relax** `question_options NOT NULL` (it is MCQ-only today — flagged by the seam) |
| **Review session items** (DB + serving)      | ✓                                                            | extend the same: item_type column, answer-set column, grid-in-aware student projection                                                         |
| **Full-length session items** (DB + serving) | ✓                                                            | same                                                                                                                                           |

## Requirement (a) — anti-leak holds for FR on ALL FOUR student-serving projections

The seam fix made `correct_variants` **type-absent** from the practice/feed student projection
(adding it is a compile error; it is never selected into a student payload). This lane **extends
the identical posture to review and full-length** student projections. For every session type,
the pre-submit student payload carries: no `correct_answer`, no `explanation`, no
`option_metadata`, and **no `correct_variants`** (FR's answer-bearing set). FR serves `options:
[]` + an input-mode marker (`numeric_entry`); the accepted-answer set stays server-side.
Carry the deferred anti-leak probe (`tests/ci/questions.anti-leak.ci.test.ts`) onto each surface.

## Requirement (b) — ONE grader, consume-don't-fork (the spine)

The FR grading branch **consumes the same CB-equivalence normalizer the ingestion validator
uses** — `gridInResponseMatches` / `gridInAcceptedForms` in `shared/question-ingestion-qa.ts`
(QI-BLOCK-002). There must be **no second equivalence implementation** anywhere in the grading
path. Ingestion and grading therefore agree on correctness by construction: the same exhaustive
CB set (`2/3 → {2/3,.666,0.666,.667,0.667}`) that QA validates a question against is the set a
student response is graded against.

## Requirement (c) — every session type grades both

- **MC:** key-match — submitted key (`A|B|C|D`) `===` `correct_answer`.
- **FR:** `gridInResponseMatches(submittedString, exactValue)` (value + 4th-digit grid-fill),
  equivalently membership in the stored `correct_variants`.
- Practice, review, AND full-length each branch on `item_type` and handle both.

## Shape of the lane (plan when scheduled)

DB + runtime, contract-first: (1) DB migration adding `question_item_type` /
`question_correct_variants` (+ relax `question_options NOT NULL`) on
`practice_session_items`, the review-items table, and the full-length-items table — owner-run,
reversible, validates against the empty bank; (2) runtime: extend the genesis→serving mapper +
student projection to review + full-length (reuse `mapGenesisQuestionRow` /
`projectStudentSafeQuestion` — no fork); (3) grading: a single `gradeAnswer(item_type, submitted,
key)` that delegates FR to `gridInResponseMatches`; (4) tests: anti-leak probe per surface +
grade-equivalence (ingestion-accepted ⇔ grading-accepted) on the CB fixtures.

## Status

Registered as a named requirement. **Grid-ins are non-functional end-to-end until this lands.**
Built after this PR's re-audit clears. Owner-run DB steps, same discipline as the reseed.
