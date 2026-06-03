---
name: tutor-runtime
description: LISA AI tutor runtime — context resolution, model orchestration, ephemeral logging, mastery boundary, and access scope. Use whenever code calls the tutor, builds tutor context, logs tutor interactions, orchestrates Vertex/Gemini, or touches anything LISA-related. Covers the no-PII-in-prompts, ephemeral-logs, never-writes-mastery, and zero-guardian-access rules.
---

# LISA Tutor Runtime (canonical: docs/Spec Doc 03 family · 03 Main, 03A, 03B, 03C)

LISA is the AI tutor. The persona is the moat; the wiring is commodity. Reference Doc 03 by exact section — never restate its numbers (SLA targets §26.B, failure matrix §26.A, retention matrix §14.2, cost metrics §24 are canonical there).

## Hard invariants

- **LISA NEVER writes mastery (INV-03-01).** Tutor-triggered retries flow through the review engine (Doc 02B), which emits canonical events with `source_family='review'`. LISA logs only to tutor tables. Tutor interaction alone does not change mastery.
- **No PII in AI prompts.** Strip/avoid identity before anything reaches Vertex/Gemini. This is one of Lyceon's strongest compliance assets — preserve it against product pressure.
- **Tutor conversations are ephemeral.** Do not store raw exchanges verbatim. Tutor prompts/responses never appear in logs.
- **Guardians have ZERO LISA access of any kind (INV-03-05).**
- **Anti-leak is inherited.** LISA never surfaces a canonical answer for an unsubmitted item; canonical IDs are internal-only in tutor UI. (See `anti-leak`.)
- **Not available during a live full-length test UI.** Available only in review-safe post-submit contexts.

## Orchestration (reference Doc 03A/03C for exact contract)

- Model stack: **Gemini via Vertex AI** — Flash-Lite (classification) / Flash (default) / Pro (escalation).
- Private **Cloud Run** orchestrator (us-central1); Cloud Tasks for compaction; explicit context caching.
- **Supabase remains canonical source of truth; GCP is orchestration, not truth.**
- Server-authoritative context resolution; no client-trusted state. Policy logging mandatory per turn.
- Synchronous request/response at MVP (no streaming). Scoped-first, broad-second entry modes.

## Usage limits (reference §-values, don't hardcode magic numbers)

Quotas, cooldowns, and appeal UX are defined in Doc 03 — implement against the named constants, not inline literals.

## Self-check before done

- [ ] No mastery write from any LISA path.
- [ ] No PII in the prompt assembled for Vertex.
- [ ] No verbatim tutor exchange persisted or logged.
- [ ] No guardian entrypoint to LISA.
- [ ] Tutor unavailable in live-exam UI.

## Proving mechanism

Test: tutor turn produces zero mastery mutation; prompt-assembly test asserts no PII fields; log-redaction test asserts no tutor content in sinks (see `testing-audit`).
