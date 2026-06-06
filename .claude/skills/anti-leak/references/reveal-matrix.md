# Reveal Matrix — per-surface field reference

**Authoritative source:** Preamble V3 §12 (cross-cutting reveal matrix). **Runtime enforcement arm:** Doc 02B §20 ("Reveal Matrix and Enforcement"). This file is a cited convenience copy — when in doubt, read the owning section, which wins.

> Read the spec before relying on this. The values below trace to specific sections; if this file and the spec disagree, the spec is correct and this file is stale.

## Absolute prohibition (Doc 02B §20)

> "Pre-submit client-facing surfaces must never contain correct answers, explanations, internal option metadata, or distractor taxonomy labels. This rule is absolute. No feature flag, environment setting, debug mode, or runtime toggle may override it." — Doc 02B §20

Enforced by `INV-02B-01` (Doc 02B §10), which elaborates `INV-02-08` / `INV-02-09`.

## Per-endpoint enforcement (Doc 02B §20, "Per-Endpoint Enforcement")

| Surface / endpoint | Returns | Never returns |
|---|---|---|
| Practice next-question | stem, passage, options (keys + text), assets, ordinal | `correct_answer`, `explanation`, `option_metadata` |
| Practice answer-submission response | correctness, correct answer key, explanation | `option_metadata` |
| Exam active-session question | stem, passage, options, assets, remaining time | `correct_answer`, `explanation`, `option_metadata`, Module 2 variant label |
| Exam review-phase (after **review-unlock**) | correct answers, explanations, per-question correctness, diagnostics | `option_metadata` |
| Review pre-submission question | stem, passage, options, assets | `correct_answer`, `explanation`, `option_metadata` |
| Review post-submission response | correctness, correct answer key, explanation | `option_metadata` |
| Tutor (practice post-submit / exam-review) | may reference & elaborate the canonical explanation | — |
| Tutor (review pre-submit) | question context + options + student reasoning | `correct_answer`, `explanation` (architectural withholding, CR-02B-29) |
| Tutor (active exam) | warning-nudge only; content not provided | all question content |
| Guardian analytics | aggregate only | question-level content, correct answers, student answers, internal metadata |

Full-length exam pre-submit additionally excludes `domain`, `skill_code`, and `difficulty` (Doc 04A §10.2 anti-leak projection; §4 invariant #8).

## Exam reveal gating (Doc 04C §2.5, §2.7)

Review mode (post-completion question + explanation visibility) MUST NOT unlock until 04B has written a successful `score_runs` row. Chain: 04A writes completion outbox → 04B writes `score_runs` → 04C gates review unlock on `score_runs` presence/success. Completion alone does **not** unlock reveal.

## Review-item access cross-check (Doc 04C §195, §2.6)

- Cross-check any client-supplied `question_id` against `test_form_items (test_form_id, section, module, ordinal, question_id)` before serving a review item. Never trust an arbitrary client `question_id`.
- Access classification runs FIRST. A "never existed / no relationship" requester gets HTTP 403 with no state-bearing body (anti-enumeration — existence is not revealed).

## Canonical IDs (Doc 02A §14, §19)

Opaque, immutable, locked format; assigned product-side at promotion. Internal `option_metadata` / distractor taxonomy is internal-only and never reaches any client-facing surface (runtime enforcement is Doc 02B's job; Doc 02A §19 defines the internal/external split).
