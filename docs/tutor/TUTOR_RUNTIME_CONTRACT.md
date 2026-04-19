# Tutor Runtime Contract (Cutover)

## Canonical Mounted Owner
- Canonical mounted owner: `server/routes/tutor-*` is the production owner.
- Mount source: `server/index.ts`
- Production route handler: `server/routes/tutor-runtime.ts`
- Any duplicate tutor route under `apps/api/**` must remain removed, quarantined, or unmounted.

## Live Schema Preflight (Blocking)
- Before runtime changes, run:
  - `pnpm tutor:schema:proof`
  - `pnpm tutor:schema:assert`
- Proof output is saved to `tmp/tutor_schema_proof.latest.json`.
- Runtime wiring must use only live-proven column names and constraint-compatible values.
- Contract gate requires:
  - `tutor_messages.client_turn_id` exists
  - unique idempotency index on `(student_id, conversation_id, client_turn_id)` with `client_turn_id IS NOT NULL`
  - locked enum check constraints match the approved contract values.

## Canonical Tutor Endpoints
- `POST /api/tutor/conversations`
- `POST /api/tutor/messages`
- `GET /api/tutor/conversations/:conversationId`
- `GET /api/tutor/conversations`
- `POST /api/tutor/conversations/:conversationId/close`

## Cutover Notes
- Legacy `POST /api/tutor/v2` is removed from production mount.
- Tutor runtime remains server-authoritative for auth, role, entitlement, scope resolution, and anti-leak behavior.
- Guardians are denied tutor access.
- Admin is allowed by explicit override policy.

## Runtime Persistence Order
For successful append-turn requests (`POST /api/tutor/messages`), writes are authoritative in this order:
1. Persist student message (`tutor_messages`)
2. Persist instructional assignment (`tutor_instruction_assignments`)
3. Invoke orchestration/model layer
4. Run anti-leak checks
5. Persist tutor message (`tutor_messages`)
6. Persist question links (`tutor_question_links`)
7. Persist instruction exposures (`tutor_instruction_exposures`)

Message and policy-assignment persistence are blocking for success.

## Idempotent Retry Contract
- `client_turn_id` is the append-turn idempotency key.
- Duplicate retries must not create duplicate student turn rows.
- Recovery resumes from existing logical turn when safe; otherwise runtime returns explicit recoverable failure:

```json
{
  "error": {
    "code": "TUTOR_RECOVERABLE_RETRY_REQUIRED",
    "message": "The tutor turn could not be completed safely. Please retry.",
    "retryable": true
  }
}
```

## Rate Limiting Policy
- Primary hard throttle key: `student_id`
- Secondary abuse guard: IP fallback signal for burst abuse patterns
- DB tutor budget gate (`check_and_reserve_tutor_budget` / `finalize_tutor_usage`) remains authoritative for usage/cost
- Admin bypasses tutor budget quota gate, but does not bypass hard abuse throttles

## Anti-Leak Rules
- Pre-submit practice: direct answer leakage is blocked.
- Review-safe contexts: explanations allowed, internal metadata disallowed.
- Full-length live states (`not_started`, `in_progress`, `break`): tutor unavailable.
- Full-length review explanations only after completion/unlock.
