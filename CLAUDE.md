# Lyceon — Claude Code Operating Rules

Lyceon is an SAT-prep platform for students 13–18. The system is **deterministic, server-authoritative, anti-leak by design, and audit-friendly**. No feature bypasses entitlement, role rules, explainability, or anti-leak constraints.

## Canonical truth lives in `docs/Spec` (READ-ONLY)

The locked spec corpus under `docs/Spec/` is the single source of truth. It is **canonical and immutable**. You may read it freely; you may **never** edit, move, or "improve" it. When code and spec disagree, the **code is wrong** — fix the code, never the spec. Every implementation must trace to a named spec section.

If a task seems to require changing a spec, STOP and surface it to Karl. Do not work around it.

## The non-negotiable invariants (true every turn)

These are hard stops. Generating any of them is a defect, not a tradeoff:

- **Anti-leak:** no endpoint returns `correct_answer` or `explanation` before submit. Pre-submit payloads return them as `null`. (skill: `anti-leak`)
- **Anti-leak chokepoint rule:** anti-leak is a property of the serialization sanitizer, not individual fields. When adding a field to a context/profile object that is spread (`...context`) into a client response, verify the sanitizer strips it in the SAME change — a new field on a spread object bypasses per-field null-outs and opens a leak one layer up. (Learned: MA-07 #419, `mastery_score` via `studentProfile` through `...context` spread in `rag-v2.ts`.)
- **Server-authoritative:** never trust client claims about role, entitlement, session state, or elapsed time. Validate server-side only.
- **No client privilege:** UI may show/hide by role, but the server always enforces. Never gate access on client-held role state.
- **Determinism:** no randomness in question selection once mastery data exists. Mutations are idempotent (`idempotency_key`; Stripe webhooks deduped via event ledger).
- **Guardian model:** guardian visibility is derived ONLY if (link active AND student entitlement active). Guardians are view-only — zero write access to learning state, zero LISA access.
- **Mastery is earned from observed events only.** Never infer, estimate, or invent "predicted score" / "AI confidence" / vanity metrics. (skill: `mastery-kpi`)
- **Privacy:** never log secrets, cookies, tokens, student answers, or tutor prompts/responses. Tutor exchanges are ephemeral — never stored verbatim. No PII in AI prompts.
- **No escape hatches:** no `any`, no `@ts-ignore`/`@ts-expect-error`, no silent/empty `catch`. `unknown` at boundaries, narrow with Zod.

Full hard-stop list: see `docs/Spec` Coding Standards §17. Domain detail loads on demand via skills — do not inline it here.

## Workflow — every feature, every time (Coding Standards §18)

1. **Spec alignment** — confirm behavior against the named `docs/Spec` section. Cite it.
2. **Schema** — Zod schema first in `packages/shared`; infer TS types from it. Never define a type and schema separately.
3. **Domain logic** — pure functions (deterministic; idempotent where required).
4. **Route handler** — thin, fixed order: auth → entitlement → Zod parse → domain → serialize.
5. **Tests** — anti-leak, idempotency, and denial tests for the new behavior.
6. **Observability** — structured, redacted logs (no content leakage).
7. **Notification emission** — emit to `notification_outbox` if this feature produces a notifiable event: same transaction as the state change, deterministic `event_id` (insert-once), `recipient_kind` per the guardian-trust model. Emission only — the dispatcher/delivery/UI/preferences are end-stage. See `contracts/notification-outbox.contract.md` + `docs/SpecAudit/notification-triggers.md`.

Annotate every implementation:
`@spec [Doc-ID_version, §section] | @implemented [YYYY-MM-DD] | plain English: what it does, expected outcome, trade-offs, edge cases`

## Verify before you say "done"

Never report success on assertion alone. Run the check and show the evidence (command + output):

```bash
pnpm -s run build && pnpm test
```

A task is open until: build passes, tests pass, no invariant violated, result reproducible. Passing CI is necessary, not sufficient.

## Tooling

- **`pnpm` only.** `npm` is prohibited (blocked by hook). No dependency changes without approval.
- One atomic change per step. Stop on ambiguity — do not guess or batch unrelated fixes.
- Proof discipline: no "appears to / likely / should work." File:line or verbatim output, or it didn't happen.

## Managed-service first

Before implementing scheduling, queueing, retries, alerting, tracing, or any other infrastructure behavior, check whether a connected platform already provides it — GCP (Cloud Tasks, Cloud Scheduler, Cloud Monitoring, Cloud Logging, Pub/Sub), Supabase, Stripe, or Vercel. Hand-rolled infrastructure requires a stated reason in the PR description explaining why the managed service does not fit. "We already have code for it" is not a reason.

This applies to spec implementation too: where a spec section names a managed service (e.g. Doc 03C §8 names Cloud Tasks queues), implement it with that service rather than an application-layer equivalent.

## Branch targeting — three integration branches, never `main`

Three long-lived integration branches exist. Route every PR to the correct one by scope:

| Branch | Scope | Examples |
|---|---|---|
| `questions` | Question bank creation **only** | Batch authoring, taxonomy edits, seed SQL, ingestion pipeline |
| `lisa` | AI tutor / LISA work | Tutor runtime, context/memory, RAG, LISA API, tutor-adjacent tests |
| `cleanup` | Everything else | Spec alignment, auth, mastery, practice engine, frontend, billing, CI, docs |

**Never open a PR against `main`.** Karl owns all merges to `main`.

When opening a PR, set its base to the integration branch that matches the scope above. If a PR is already open for the working branch, push to that branch and let the existing PR pick up the commits rather than opening a second PR.

### Claude Code branch rules (standing)

- Work on `claude/*` branches — never commit directly to an integration branch.
- Always open PRs as **draft**.
- Never merge a PR. Never force-push a shared branch. Karl owns all merges.

## Unified code across agents & sessions

Multiple subagents and parallel sessions work this repo. They must produce **one coherent codebase**, not several divergent ones. Before writing a helper, type, schema, pattern, or constant: **search for an existing canonical one and consume it** — never fork a second version. Shared primitives (`packages/shared` schemas/types, DB utilities, the logger, identity helpers) are single-source-of-truth; extend the canonical definition, don't duplicate it. Foundations land before the work that depends on them. When integrating parallel work, verify it reuses existing primitives and follows established patterns rather than introducing a parallel approach. Divergence and duplication are defects, even when no two edits touch the same line.

## Plan before implementing

For any non-trivial change, use **plan mode**: explore and read first, propose a plan, proceed to edits only after the plan is reviewed. Use **subagents** for investigation, parallel exploration, and independent review so the main thread stays focused and uncluttered.

## Before declaring a domain change complete

Invoke `/grill-me` to adversarially self-review the diff against the spec, then hand to the `spec-auditor` subagent. Goal: **never fail a Codex audit** — catch everything Codex would catch in the inner loop first.

## Compact policy

When compacting, always preserve: the spec sections referenced this session, the full list of modified files, the exact test/build commands, and any unresolved invariant findings. Summarize exploration briefly.

## Imports

- Full coding standards: @docs/Spec/lyceon-coding-standards.md
  (renamed 2026-06-06 from `lyceon-coding-standards (1).md` — the space/"(1)" that
   previously broke this `@import` parse is gone, so the standards now auto-load)
- Domain skills load on demand once promoted into `.claude/skills/` (see SKILL-BUILD-PLAN.md): anti-leak, auth-entitlements, determinism-idempotency, stripe-billing, practice-engine, mastery-kpi, tutor-runtime, frontend, testing-audit
