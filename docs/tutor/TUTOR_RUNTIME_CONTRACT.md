# Tutor Runtime Contract (Wave 1.5)

## Canonical Production Route
- Canonical mounted tutor route: `POST /api/tutor/v2`
- Mount source: `server/index.ts`
- Route handler source: `server/routes/tutor-v2.ts`

## Route Unification
- Production runtime source of truth is `server/**`.
- Exactly one tutor route is mounted in production: `POST /api/tutor/v2`.
- Deprecated duplicate removed:
  - `apps/api/src/routes/tutor-v2.ts` (unmounted legacy duplicate)

## Security Controls Present
- Auth identity is server-derived (`req.user.id` from Supabase auth middleware).
- Request-body `userId` is not accepted by tutor schema and is ignored.
- Role enforcement is server-side (`requireStudentOrAdmin` at mount).
- CSRF guard is present on tutor POST (`csrfGuard()` in route handler).
- Reveal policy is server-enforced:
  - answer/explanation blocked pre-submit
  - answer/explanation allowed only for server-verified admin or verified prior submission
  - reveal checks fail closed on lookup errors

## Anti-Leak Behavior
- Pre-submit: tutor context strips `answer` and `explanation`.
- Active full-length exam: tutor is forced to `strategy` mode only.
- During active full-length exam, question-specific tutoring context is suppressed and answer/explanation leakage is blocked.

## Verification Semantics
- Verified retry is represented by a server-side `answer_attempts` record for `(user_id, question_id)`.
- Tutor open alone does not perform mastery table writes.
- Tutor-related downstream reveal behavior is unlocked only after server-verified retry evidence.
- Full-length exam guard takes precedence over retry reveal (strategy-only during active exam).

## Response Metadata Contract
- `metadata.mode`: effective mode used by server (`strategy` forced during active full test).
- `metadata.requestedMode`: original client-requested mode.
- `metadata.fullTestStrategyEnforced`: boolean enforcement flag.
