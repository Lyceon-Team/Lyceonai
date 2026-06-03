---
name: grill-me
description: Adversarial self-review of the current diff against the locked spec before handing to the spec-auditor subagent and Codex. Invoke manually with /grill-me. Mirrors the Codex audit checklist exactly so anything Codex would fail gets caught here first.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(pnpm test:*), Bash(pnpm -s run build)
---

# /grill-me — adversarial self-review $ARGUMENTS

You are now a hostile reviewer of your own diff. Assume it is wrong until proven otherwise. The goal is to **never fail a Codex audit** — so this checklist is a strict superset of the Codex audit. Do not defend; find the gap.

Run `git diff` for the change under review (scope: $ARGUMENTS if given, else the working diff). For every file, produce findings with **file:line + verbatim evidence**. No "appears to."

## 1. Spec alignment (Lyceon-specific, checked first)

- Does every new/changed unit carry a correct `@spec [Doc-ID_version, §section]` annotation, and does the behavior actually match that section in `docs/Spec`?
- Any behavior with no spec section → FINDING (either find the section or flag it for Karl; do not invent).
- Does any line **restate** a number/mechanism a referenced doc owns instead of referencing it? → FINDING (reference-not-restate discipline).

## 2. Platform invariants (auto-fail)

- Anti-leak: any pre-submit path returning non-null answer/explanation? Full-test correctness before review phase?
- Server-authoritative: any trust of client role/entitlement/state/elapsed time?
- Guardian: visibility not gated on (link active AND entitlement active)? Any guardian write or LISA access?
- Determinism: randomness where mastery exists? Non-idempotent mutation (missing `idempotency_key` / webhook ledger)?
- Mastery: inferred/predicted/confidence/vanity metric? Mastery written by LISA?
- Privacy: any log line reachable with a secret/cookie/token/student answer/tutor content? PII in an AI prompt? Verbatim tutor storage?

## 3. Security (auto-fail — mirrors Codex)

- Hardcoded secret/credential anywhere? (Even in tests/fixtures.)
- Input validation present at every boundary (Zod `safeParse`)? SQL parameterized / via centralized DB utility (no ad-hoc SQL)?
- Any obviously injectable or unvalidated external payload (Stripe, request body, query, env)?

## 4. Quality (mirrors Codex)

- Any `any`, `@ts-ignore`, `@ts-expect-error`, empty/silent `catch`?
- Duplicate TS type shadowing an existing Zod schema?
- `useEffect` for derived state? Direct state mutation? Business logic in a component?
- Function complexity unreasonable? Explicit return types on non-trivial functions?

## 5. Tests & proof

- Required test present for each changed invariant class (anti-leak / idempotency / auth-denial / redaction)?
- `pnpm -s run build && pnpm test` actually run, green, and shown? Coverage adequate on touched code?

> PROVISIONAL quality bar (not spec-derived): coverage ≥80%, complexity <10. Placeholder targets for clean code; confirm/replace at final lock.

## Output (same JSON shape Codex emits, so parity is checkable)

```json
{
  "compliance": "PASS|FAIL|PARTIAL",
  "findings": [
    { "severity": "LOW|MEDIUM|HIGH", "file": "path", "line": 0,
      "issue": "...", "evidence": "verbatim", "fix": "executable" }
  ],
  "verification": { "buildRun": true, "testsRun": true, "evidenceComplete": true, "invariantsVerified": true },
  "recommendation": "APPROVE|REVISE|REJECT"
}
```

Then FIX every HIGH and every auto-fail before handing to the `spec-auditor` subagent. Do not stop at PARTIAL.
