---
name: anti-leak
description: Anti-leak rules for serving canonical questions, practice items, exam items, and tutor content. Use whenever code reads from the question bank, serves an item to a client, builds a pre-submit or post-submit response, designs a question/answer payload shape, or touches canonical question IDs. Covers what must NEVER appear before submit and the exact reveal rules per surface.
---

# Anti-Leak (Coding Standards §5, §17 · canonical: docs/Spec)

The single most important product invariant. A leak is a correctness failure, never a tradeoff.

## The rule

Any endpoint or function that serves a question **before** the answer is submitted MUST return:

```ts
{ correct_answer: null, explanation: null }
```

This is not optional and has no exceptions. The answer and explanation are stripped at the serialization boundary — not "hidden in the UI," not "filtered client-side."

## Reveal rules per surface

| Surface | Pre-submit | Post-submit |
|---|---|---|
| Practice | `correct_answer: null`, `explanation: null` | reveal correct answer + explanation |
| Full-length exam | never reveal — not answer, not explanation, not correctness | reveal ONLY in the review phase after the whole test completes |
| Tutor (LISA) | inherits canonical anti-leak; never surfaces a canonical answer for an unsubmitted item | same as the underlying surface |

The full-length exam never reveals correctness mid-test, even for a single submitted item — review is a post-completion phase only.

## Canonical IDs

- Canonical question IDs are **opaque and immutable**. The format is locked — never invent an alternate ID scheme.
- Internal canonical IDs are never displayed to students (tutor UI included).

## How to build a safe read path

1. Serve items through the canonical anti-leak retrieval view, not a raw `questions` select.
2. Type the pre-submit DTO so `correct_answer` / `explanation` are literally `null` — make the unsafe shape unrepresentable, don't rely on remembering to strip.
3. Filter to presented items only so stale/non-presented rows can't leak. (The exam-scoring path does this via a `test_form_items` join in Doc 04B; confirm the canonical presented-item mechanism for the practice path against its owning spec section before relying on it here.)

## Self-check before done

- [ ] No code path returns a non-null answer/explanation before submit, on any surface.
- [ ] Full-test correctness is unavailable until the review phase.
- [ ] Canonical IDs are not serialized to the student client.
- [ ] A route test exists asserting the null pre-submit shape (see `testing-audit`).

## Proving mechanism

Route test that submits-then-reads and asserts `null` answer/explanation pre-submit for each surface. Any change to a question-serving path REQUIRES an added/extended anti-leak route test (Coding Standards §14).
