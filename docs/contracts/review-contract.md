# Review Contract

## Core principle

Review is derived from persisted session outcomes.

It is not reconstructed from the raw bank on demand.

## Review sources

Review must be driven by persisted wrong/missed items from:

- practice sessions
- full-length exam sessions

## Supported review views

The student must be able to review:

1. **By session**
   - review wrong answers from one practice session
   - review wrong answers from one full-length session
2. **All past mistakes**
   - review all wrong answers across past practice/full-length history
3. **By full-length**
   - review only full-length mistakes/history

## Canonical rule

If an item was shown and answered in a session, review must come from that session-owned persisted state.

Not from a fresh raw `questions` lookup.

## Runtime disable behavior

When review is contract-disabled:

- backend returns terminal `503` with code `REVIEW_RUNTIME_DISABLED_BY_CONTRACT`
- response is emitted before any legacy runtime logic, fallback, or DB-dependent runtime branching
- disabled-state UX copy is standardized with practice/full-length
- frontend treats it as terminal-disabled:
  - no auto-retry
  - no polling retry
  - no repeated toast spam
  - no spinner loops

## Unlock acceptance gates

- all review modes are sourced from persisted session outcomes:
  - by practice session
  - by full-length session
  - all past mistakes
- no raw-bank `questions` reconstruction path survives anywhere in mounted review runtime
- if required persisted review/session data is missing, runtime fails closed with explicit contract error
