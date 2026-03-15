# Mastery Event Taxonomy

## Locked Canonical Event Set
`applyMasteryUpdate(...)` accepts only:
- `practice_pass`
- `practice_fail`
- `review_pass`
- `review_fail`
- `tutor_helped`
- `tutor_fail`
- `test_pass`
- `test_fail`

## Source Mapping
- Practice submit:
  - correct -> `practice_pass`
  - incorrect -> `practice_fail`
- Review submit:
  - correct -> `review_pass`
  - incorrect -> `review_fail`
- Tutor modifier (only after verified retry in review flow):
  - correct retry -> `tutor_helped`
  - incorrect retry -> `tutor_fail`
- Full-length test scoring bridge:
  - correct -> `test_pass`
  - incorrect -> `test_fail`
- Diagnostic submit:
  - correct -> `practice_pass`
  - incorrect -> `practice_fail`

## Semantics
- Tutor-only interactions do not emit mastery events.
- Review events are stronger than practice events.
- Test events are highest trust anchors.
- Event weights are fixed constants in `apps/api/src/services/mastery-constants.ts`.

## Enforcement
- Unknown event types are rejected (fail-closed) in `apps/api/src/services/mastery-write.ts`.
- No alternate runtime writer is allowed to bypass the choke point.
