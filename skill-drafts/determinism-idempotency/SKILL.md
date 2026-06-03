---
name: determinism-idempotency
description: Determinism and idempotency rules for any mutation, selection, scoring, or webhook path — not tied to one domain. Use whenever code writes state, submits an answer, selects questions, scores, processes a payment event, or resumes a session. Make sure to use this skill any time a mutation could be retried, replayed, or run concurrently, even if the domain skill (practice-engine, stripe-billing, mastery-kpi) also applies. Covers idempotency keys, event-ledger dedup, deterministic selection, and server-authoritative time/state.
---

# Determinism & Idempotency (Coding Standards §4 · canonical: docs/Spec)

Determinism and idempotency are core to the codebase: the system does not guess, and the same input must produce the same result no matter how many times it runs. This skill is cross-cutting — it applies on top of the domain skills, not instead of them.

## Idempotency is required for every mutation

A mutation that can be retried, replayed, or double-submitted MUST be idempotent. If it isn't, it is not complete.

- **Answer submits** (practice and exam) → idempotent via `idempotency_key`. A replay returns the same result and causes exactly one state change.
- **Stripe webhooks** → deduped via the event-ledger pattern: record `event.id`, skip if seen, process-and-record in one transaction. (See `stripe-billing`.)
- **Outbox / event consumers** → dedupe on the canonical event id (e.g. `ON CONFLICT (event_id) DO NOTHING` as defense-in-depth). Match the owning spec's pattern; do not invent a parallel one.

Decide the idempotency key deliberately: it must be stable across retries of the same logical operation and distinct across different operations. Read the owning spec section for the canonical key shape rather than choosing your own.

## Determinism in selection and scoring

- **No randomness once mastery data exists.** Selection must be stable and explainable. (Coding Standards §4.1.) Randomness is permitted only for cold-start, and if used must be deterministic-per-session (seeded by the session), never a bare `Math.random()`.
- **Scoring is deterministic.** The scoring formula is canonical/immutable (Doc 04B); the same answers always produce the same scaled score. Reference-parity (a Python reference vs the production path producing bit-exact results) is the proving mechanism — never introduce a code path that could diverge.
- No wall-clock or environment-dependent branching inside pure scoring/selection logic.

## Server is the source of truth for state and time

- Timers are enforced **server-side** — never trust client-reported elapsed time.
- Resume-on-refresh must not create duplicate items or sessions.
- Never trust client claims about role, entitlement, or session state. (See `auth-entitlements`.)

## Self-check before done

- [ ] Every mutation touched has an idempotency mechanism; a replay test proves one-effect.
- [ ] No randomness in selection where mastery exists; any cold-start seed is per-session.
- [ ] Scoring/selection logic has no time- or environment-dependent branching.
- [ ] Server enforces time and state; resume creates no duplicates.

## Proving mechanism

Replay test (same key/event id → one state change, identical response); a resume test (refresh mid-session → no duplicate items); reference-parity check for scoring. Any idempotency change REQUIRES a replay test (Coding Standards §14).
