# Practice Runtime Contract

This document defines the locked canonical runtime for Lyceon practice.

## Canonical Runtime Files
- `server/index.ts`
  - Mounts the canonical runtime at `app.use("/api/practice", requireSupabaseAuth, requireStudentOrAdmin, practiceCanonicalRouter)`.
- `server/routes/practice-canonical.ts`
  - Owns session creation, serving, state, answer submission, idempotency, anti-leak enforcement, and multi-tab conflict behavior.
- `apps/api/src/services/studentMastery.ts`
  - Canonical mastery write path called after successful non-duplicate practice submissions.

No parallel mounted practice runtime exists under `apps/api/**`.

## Canonical Data Model
- `practice_sessions`
  - Session header/source-of-truth for ownership, lifecycle metadata, and client-instance binding.
- `practice_session_items`
  - Ordered served-item truth (`session_item_id`, `ordinal`, `status`).
  - Exactly one unresolved (`status='served'`) item per session at a time.
- `answer_attempts`
  - Authoritative answer-attempt truth.
  - Linked to served items via `session_item_id` when available.

## API Contract

### `POST /api/practice/sessions`
- Validates authenticated actor from server auth context.
- Enforces student-primary ownership.
- Replays existing active session when appropriate (including start idempotency key if provided).
- Records/returns `client_instance_id`.
- Initializes lifecycle without serving duplicate items.

### `GET /api/practice/sessions/{session_id}/next?client_instance_id=...`
- Validates session ownership and client-instance binding.
- Returns current unresolved served item if one exists.
- Otherwise serves exactly one new item, persists one `practice_session_items` row, and returns stable `session_item_id` + `ordinal`.
- Enforces anti-leak before submit:
  - `correct_answer: null`
  - `explanation: null`
- Applies entitlement/usage gating when serving a **new** item.

### `GET /api/practice/sessions/{session_id}/state`
- Returns authoritative server state (`state`, `currentOrdinal`, `answeredCount`, unresolved item descriptor).
- Supports refresh/resume with no new item side effects.

### `POST /api/practice/answer`
- Validates ownership + `client_instance_id` conflict rules.
- Validates answer against canonical question truth.
- Enforces idempotency for duplicate submissions (`client_attempt_id` and served-item linkage).
- Writes exactly one attempt for the served item.
- Resolves `practice_session_items.status` from `served` to `answered`/`skipped`.
- Reveals `correctAnswerKey` and `explanation` only post-submit.
- Calls canonical mastery update path once for non-duplicate writes.

### `GET /api/practice/next` (legacy compatibility)
- Thin delegate to the same canonical domain flow.
- Requires `client_instance_id` and uses the same server-authoritative session/item logic.

## Lifecycle and State Machine
- Runtime lifecycle states:
  - `created -> active -> completed`
  - `abandoned` is terminal.
- Session completion:
  - Server marks session complete when resolved item count reaches target question count.
- Completed/abandoned sessions are read-only for progression and answer writes.

## Multi-Tab Safety
- `client_instance_id` is server-enforced for progression.
- A different active client instance on the same session receives deterministic `409 conflict`.
- Concurrent `/next` calls cannot fork progression into multiple unresolved items.

## Idempotency Guarantees
- Session start supports replay/idempotent behavior via active-session replay and optional start key.
- Answer submit duplicate calls return prior authoritative result.
- Duplicate submits do not create second attempt rows and do not trigger second mastery writes.

## Anti-Leak Guarantees
- Pre-submit payloads never include real answers/explanations.
- Post-submit responses may include correctness, canonical answer key, and explanation.

## Entitlement and Role Gates
- Practice runtime is mounted behind:
  - auth (`requireSupabaseAuth`)
  - student/admin role gate (`requireStudentOrAdmin`)
- Guardian role does not receive practice learning-write authority.
- Entitlement/usage checks are enforced server-side for new-item progression.
- Mid-session behavior is fail-closed for new-item access; already served item submission remains possible.

## Deferred / Out of Scope
- Explicit inactivity-driven abandonment automation is not part of this pass.
- Legacy compatibility endpoint (`GET /api/practice/next`) remains mounted but delegates to the canonical domain logic.
