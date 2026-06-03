---
name: new-feature
description: Implement a feature or alignment fix following the locked §18 order — spec → schema → domain → handler → tests → observability — then self-review. Invoke with /new-feature [description]. Use for every implementation pass during repo cleanup.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(pnpm:*), Bash(git:*)
---

# /new-feature $ARGUMENTS — spec-anchored implementation pass

Implement **one atomic change**: $ARGUMENTS. Follow this order exactly. Stop on ambiguity — surface it, don't guess.

## 1. Spec alignment
Find and read the governing `docs/Spec` section. State the Doc-ID, version, and § you are implementing against. If none governs this, STOP and ask Karl. Load any relevant skill (anti-leak, auth-entitlements, stripe-billing, practice-engine, tutor-runtime, mastery-kpi, frontend).

## 2. Schema
Add/extend the Zod schema in `packages/shared`. Infer the TS type from it (`z.infer`). Never define a parallel type. This is the single source of truth.

## 3. Domain logic
Pure functions — no IO where avoidable. Deterministic. Idempotent where the spec requires (carry `idempotency_key` / event-ledger). Explicit return types.

## 4. Route handler (if applicable)
Thin, fixed order: **auth → entitlement → Zod parse → domain → serialize.** No business logic in the handler; no auth logic in domain. Consistent response shape (`{ data }` / `{ error: { message, code?, details? } }`) and correct status code.

## 5. Tests
Add the required tests for every invariant class this change touches: anti-leak route test, idempotency replay test, auth denial test, redaction test — whichever apply. Then:

```bash
pnpm -s run build && pnpm test
```

Show the output. Green or it isn't done.

## 6. Observability
Structured, redacted logs only. Verify every emitted field — no secrets, cookies, tokens, student answers, or tutor content.

## 7. Annotate + self-review
Add to each changed unit:
`@spec [Doc-ID_version, §section] | @implemented [YYYY-MM-DD] | plain English: what it does, expected outcome, trade-offs, edge cases`

Then run `/grill-me` on the diff, fix every HIGH/auto-fail, and hand to the `spec-auditor` subagent. Only after it returns APPROVE is the pass ready for Codex.

## Definition of done
- [ ] Behavior matches the named spec section.
- [ ] Schema-first; types inferred; no shadow type.
- [ ] Handler order correct; no client trust.
- [ ] Required invariant tests present and green; coverage ≥80% touched.
- [ ] Logs redacted; annotation present.
- [ ] `/grill-me` clean; `spec-auditor` → APPROVE.
