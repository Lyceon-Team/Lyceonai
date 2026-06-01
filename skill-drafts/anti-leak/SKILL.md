---
name: anti-leak
description: Enforces Lyceon's anti-leak / reveal-matrix invariant on any code that serves question content — practice, review, full-length exam, or tutor. Use whenever code reads from the question bank, builds a question/answer payload, writes or serves a `session_items` snapshot, designs a pre-submit or post-submit DTO, gates an exam review surface, constructs tutor context, or touches canonical question IDs — even if the request never says "anti-leak" and just asks to "serve the next question," "return feedback," "show results," or "pass the question to the tutor." A leak is a correctness defect, never a tradeoff.
---

# Anti-Leak (Reveal Matrix Enforcement)

The single most important cross-cutting runtime rule. A leaked answer on practice undermines practice; a leaked answer during an exam destroys the exam's trust-anchor value. This is a hard stop (Coding Standards §17), never a feature tradeoff.

**Canonical owners — cite these, do not restate their contents:**
- **Preamble V3 §12** — the authoritative reveal matrix (cross-cutting source of truth for what is revealed where).
- **Doc 02B §20** (Reveal Matrix and Enforcement) — the runtime enforcement arm; `INV-02B-01` (§10).
- **Coding Standards §5** (Canonical Content Rules — Anti-Leak) and §17 (hard stops).
- Per-surface detail with citations lives in `references/reveal-matrix.md` — read it when you need the exact per-endpoint field list.

## The invariant (INV-02B-01, enforcing INV-02-08 / INV-02-09)

Before a student submits the answer for a question, **no** client-facing surface may receive:
`correct_answer`, `explanation`, internal `option_metadata`, or distractor-taxonomy labels.
For full-length exams the pre-submit exclusion also covers `domain`, `skill_code`, `difficulty`, and any Module 2 variant label (server-only state). See Doc 02B §20 and Doc 04A §10.2.

This rule is **absolute**: Doc 02B §20 states no feature flag, environment setting, debug mode, or runtime toggle may override it. Any violation is a critical defect.

## Why the rule is shaped this way — build a path that *can't* leak

The reveal decision is **server-side only** (Doc 02B §20 "Server-Side Enforcement"). The reason matters: a client-side "should we show the answer?" check is bypassable by an adversarial student — server-constructed payloads are not. So the goal is never "remember to strip the answer"; it is "make the unsafe payload unrepresentable."

Two patterns carry this:

1. **Serve from the prefilled snapshot, not a raw `questions` select.** When a question is assigned to a session item, the runtime writes a denormalized snapshot (stem, options, `correct_answer`, `explanation`, `option_metadata`, …) to `session_items` (Doc 02B §14, "Session Items Prefill Pattern"). The next-question endpoint then returns the **student-visible projection** of that row — stem, passage, options (keys + text), assets, position — and nothing else (Doc 02B §14 "Serving Questions"; §20 per-endpoint list). The full record exists server-side; the endpoint just never projects the unsafe fields.
2. **Type the pre-submit DTO so the unsafe shape doesn't compile.** Define the pre-submit payload type in `packages/shared` (Zod-first, per Coding Standards §18) with `correct_answer`/`explanation`/`option_metadata` *absent* — not optional, absent. Build the response by constructing that type, so adding a leaking field is a type error, not a code-review catch.

> Note on the documented pre-submit shape: Coding Standards §5.2 shows pre-submit responses returning `{ correct_answer: null, explanation: null }`. Treat that as the rule's shape for endpoints that must keep the keys present; prefer the stronger "field-absent" DTO where the contract allows it. Either way the value is never the real answer pre-submit.

## Surfaces (reference Doc 02B §20 / `references/reveal-matrix.md` — don't memorize the table)

- **Practice** — pre-submit: student-visible payload only. Post-submit: reveal correct answer key + explanation. Never `option_metadata` on either (Doc 02B §14, §20).
- **Full-length exam** — pre-submit / active section: no answer, explanation, `option_metadata`, `domain`, `skill_code`, `difficulty`, or Module 2 variant (Doc 04A §10.2; Doc 02B §20). Reveal happens **only at review-unlock**, which is gated on a successful `score_runs` row — *not* on the student finishing the last question (Doc 04C §2.5, §2.7). Mid-exam correctness is never shown, even for a single submitted item.
- **Review** — pre-submit: student-visible payload only. Post-submit: correctness + answer key + explanation. The review **tutor is architecturally denied** `correct_answer`/`explanation` (Doc 02B §21, CR-02B-29): it guides Socratically and cannot leak what it was never given. Never inject the answer into the tutor prompt to "help it explain better."
- **Tutor (practice/exam-review, post-submit)** — may elaborate on the already-revealed canonical explanation.
- **Guardian** — aggregate only: never question-level content, answers, student answers, or internal metadata.

## Canonical IDs

Canonical question IDs are **opaque, immutable, and a locked format** (Doc 02A §14). Do not invent alternate ID schemes, and do not serialize internal canonical IDs to the student client (tutor UI included).

## Review-surface access (anti-enumeration)

When serving a review item by `question_id`, never trust a client-supplied ID: cross-check it against the canonical form composition (`test_form_items` by `(test_form_id, section, module, ordinal, question_id)`) before serving — Doc 04C §195. For an access-denied requester, return 403 with **no state-bearing body** so existence isn't revealed (Doc 04C §2.6 / access classification first).

## Self-check before "done"

- [ ] No pre-submit code path projects `correct_answer`, `explanation`, `option_metadata`, or distractor labels — on any surface (and exam also excludes `domain`/`skill_code`/`difficulty`/variant).
- [ ] The payload is built from a typed projection of the `session_items` snapshot, not a raw `questions` select; the unsafe shape is unrepresentable, not just unfilled.
- [ ] Exam correctness/explanations appear only after review-unlock (`score_runs` success), never on mere completion.
- [ ] Review-mode tutor context contains no answer/explanation.
- [ ] No reveal decision is made client-side; no flag/debug/toggle can flip it.
- [ ] Internal canonical IDs are not serialized to the student client.

## Proving it (Coding Standards §14 — required)

Any change to a question-serving path **requires** an added or extended anti-leak route test. The test submits-then-reads and asserts the pre-submit projection carries no answer/explanation/`option_metadata` for the relevant surface, and (for exams) that correctness is unavailable until review-unlock. Doc 02B §20 ("Verification Before Refactor") lists the trace steps: inspect payload fields, trace each to its construction site, confirm no flag/debug path reveals, and audit tutor-in-review context for answer-withholding. Show the test output — assertion of success is not success.
