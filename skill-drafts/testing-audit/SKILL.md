---
name: testing-audit
description: Testing requirements, redaction/logging discipline, and the proof bar for declaring work done. Use whenever code is being finished, when adding tests, when changing anti-leak/idempotency/auth/logging behavior, or before claiming a task complete. Covers what must have tests, the logging-redaction rules, and the evidence standard.
---

# Testing & Audit (Coding Standards §12–§14 · canonical: docs/Spec)

## Tooling

`pnpm` only — for every script and CI command. `npm` is blocked.

## Tests are REQUIRED when changing

- **Anti-leak behavior** → add/extend route tests asserting null pre-submit answer/explanation.
- **Idempotency** → add replay tests (same key/event id → one effect).
- **Auth / roles / entitlements** → add denial tests (401/403, inactive link, guardian write rejected).
- **Logging redaction** → add explicit redaction tests.

## Logging & privacy (§12 — never log)

Never, under any circumstances, log: cookies, auth headers, tokens; request bodies for sensitive endpoints; student answers; tutor prompts or responses. Logging is structured and **redacts by default**. When adding a log line, explicitly verify every field it emits.

Minor-safety posture: minimize data collection on student surfaces; no invasive analytics on student-facing pages; tutor exchanges ephemeral.

## Error handling (§13)

- Expected failures (validation, not-found, business-rule) → `Result` types / structured error responses. Do not throw.
- Unexpected failures → log with context, then re-throw. Never swallow.
- **No empty catch blocks.**

## The proof bar (declaring done)

Passing CI is necessary, not sufficient. A task is done only when:

- build passes, tests pass, coverage adequate on touched code;
- no invariant violated;
- evidence shown (command + output, file:line) — never "appears to / should work";
- result reproducible.

> PROVISIONAL quality bar (not spec-derived): coverage ≥80% on touched code. Placeholder target for clean code; confirm/replace against `docs/Spec` at final lock.

## Self-check before done

- [ ] Every changed invariant class has its required test.
- [ ] No forbidden field reachable by any log line touched.
- [ ] No empty/silent catch; expected failures use Result.
- [ ] Evidence (command output) shown, not asserted.

## Proving mechanism

This skill *is* the proving-mechanism checklist. Pair it with `grill-me` (adversarial self-review) and the `spec-auditor` subagent before handing to Codex.
