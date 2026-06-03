---
name: practice-engine
description: Practice session lifecycle, item serving, idempotent answer submission, and resume safety. Use whenever code starts/serves/resumes a practice session, submits a practice answer, or implements the practice endpoints. Covers the locked endpoint contracts and the no-duplicate/no-leak/deterministic invariants.
---

# Practice Engine (Coding Standards §9 · canonical: docs/Spec)

These endpoint behaviors are **locked**. Do not change their shape or semantics.

| Endpoint | Behavior |
|---|---|
| `POST /api/practice/sessions` | Start session; records `client_instance_id` |
| `GET /api/practice/sessions/{session_id}/next` | Serve next item; **no answer or explanation** |
| `POST /api/practice/answer` | Idempotent via `idempotency_key`; returns correctness + explanation **post-submit** |
| `GET /api/practice/sessions/{session_id}/state` | Resume-safe; **no duplicate items** |

## Invariants that must not break

- **No answer leakage pre-submit.** `/next` returns `correct_answer: null, explanation: null` (see `anti-leak`).
- **No duplicate items on refresh or resume.** Resuming or re-fetching state must not re-serve or re-create items/sessions.
- **Selection is deterministic.** Once mastery data exists, item selection is stable and explainable — never random. Randomness is permitted only for cold-start, and if used must be deterministic-per-session (seeded by session). (§4.1)

## Idempotency

`POST /api/practice/answer` dedupes on `idempotency_key`: a replayed submit returns the same result and causes exactly one state change. Server is the source of truth for session state and timing — never trust client-reported elapsed time. (§4.2, §4.3)

## Self-check before done

- [ ] `/next` payload has null answer + explanation.
- [ ] Replayed `answer` with same key → one effect, identical response.
- [ ] Resume/refresh creates no duplicate session or item.
- [ ] Selection deterministic where mastery exists; cold-start seed is per-session.

## Proving mechanism

Anti-leak route test on `/next`; replay test on `/answer`; resume test that refreshes mid-session and asserts identical item set. (§14.)
