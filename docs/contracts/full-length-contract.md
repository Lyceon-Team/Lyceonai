# Full-Length Contract

## Canonical tables

- `full_length_exam_sessions`
- `full_length_exam_modules`
- `full_length_exam_questions`
- `full_length_exam_responses`
- `full_length_exam_score_rollups`

## Core structure

One full-length exam session has:

- 1 session
- 4 modules

Modules are:

1. Reading and Writing Module 1
2. Reading and Writing Module 2
3. Math Module 1
4. Math Module 2

## Creation flow

When a student starts a full-length exam:

1. create one `full_length_exam_sessions` row
2. create/persist the four module rows in `full_length_exam_modules`
3. materialize the module-owned question sets into `full_length_exam_questions`
4. each question row must belong to:
   - one exam session
   - one module
   - one display order within that module
   - one persisted runtime snapshot

## Adaptive rule

The second module is dynamic based on the first module.

That means:

- RW Module 2 depends on RW Module 1 outcome
- Math Module 2 depends on Math Module 1 outcome

So the contract must support:

- first module outcome being persisted
- second module difficulty/selection path being determined from persisted first-module results
- second-module items then being materialized and persisted as session-owned exam items

No raw-bank runtime reads after that.

## Runtime flow

After the session/module items exist, full-length runtime must read only from:

- `full_length_exam_sessions`
- `full_length_exam_modules`
- `full_length_exam_questions`
- `full_length_exam_responses`
- `full_length_exam_score_rollups`

Not from `questions`.

## Answer flow

When the student answers:

- persist the response to the session-owned full-length runtime layer
- correctness/result must be derivable from the persisted session-owned exam item state
- module progression must be driven from persisted session/module state

## Resume flow

When the student comes back:

- load the same exam session
- load the same module state
- load the same persisted exam questions
- continue from the persisted position/state
- do not regenerate or re-pick the exam

## Review flow

Full-length review must come from persisted full-length session data.

Allowed review modes:

- review by full-length session
- review wrong answers from a specific full-length session
- review all full-length mistakes across sessions

## Session-item truth rule

`full_length_exam_questions` plus session/module/response tables must be able to answer the same session-owned truth for the exam runtime.

## Runtime disable behavior (locked)

When full-length runtime is contract-disabled:

- backend returns terminal `503` with code `FULL_LENGTH_RUNTIME_DISABLED_BY_CONTRACT`
- response is emitted before any legacy runtime logic, fallback, or DB-dependent runtime branching
- frontend treats it as terminal-disabled:
  - no auto-retry
  - no polling retry
  - no repeated toast spam
  - no spinner loops

## Unlock acceptance gates

- creation persists 1 exam session + 4 modules + persisted exam item rows
- RW2 and Math2 are selected from persisted module-1 outcomes only
- no adaptive shortcut from transient memory or raw-bank runtime re-query is allowed
- delivery/resume/submit/scoring/review read only persisted `full_length_exam_*` session data
- if persisted exam items are missing after creation, runtime fails closed with explicit contract error
