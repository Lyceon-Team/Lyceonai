# Practice Runtime Contract

This document outlines the locked schema expectations, endpoint behaviors, and anti-leak guarantees for Lyceon's practice system.

## Foundational Truths
1. **Source of Truth**
   - The exact canonical source of truth for runtime logic is the `server/**` directory.
   - The system uses the `practice_sessions` and `answer_attempts` tables per `supabase/migrations/20260110_practice_canonical_plus_events.sql` without any secondary persistence modeling.
   - Server handles all state orchestration and timing.
2. **Determinism and Session Flow**
   - Practice is session-based, resumable, and deterministic.
   - We avoid duplicate items on resume.
   - `client_instance_id` provides multi-tab takeover safety.

## Multi-Tab Behavior & Resumption Check
- When a client issues `GET /api/practice/next?client_instance_id=<ID>`, the server:
  1. Finds the existing "in_progress" session.
  2. Inspects `session.metadata.active_question_id`.
  3. If this active question has **not** been answered yet, the server *resumes* it rather than fetching a new random question.
  4. At the same time, the server updates `session.metadata.client_instance_id` to the currently requesting `<ID>`.
- **Takeover Conflict**: When a client issues `POST /api/practice/answer` using an older `client_instance_id`, the server detects that `session.metadata.client_instance_id` mismatches. It rejects the attempt with `409 Conflict`.
  - Exception: If it is an **idempotent retry** (matching `client_attempt_id` stored as `idempotencyKey`), it is allowed to pass gracefully to avoid punishing poor network conditions on successful answers.

## Idempotency Rules
- Answer submission is fully idempotent by verifying `client_attempt_id` mapped to `answer_attempts.client_attempt_id` against a composite unique index with `user_id`.
- Duplicate answer submissions safely return the prior generated result (including `isCorrect`, `explanation`, and `correctAnswerKey`) instead of logging extra answers.

## Anti-Leak Guarantees
- Any payload returned BEFORE a question is answered must be explicitly neutralized.
- Specifically, `GET /api/practice/next` leverages `toSafeQuestionDTO` to mandate that pre-submit items strictly guarantee `correct_answer: null` and `explanation: null`.
- Only following successful idempotent or standard execution of `POST /api/practice/answer` are correct answers and explanations yielded to the client.

## Endpoint Contract
1. `GET /api/practice/next?section=<SECTION>&client_instance_id=<ID>`
   - Finds or initializes session.
   - Checks metadata for resumption of same unanswered item.
   - Mutates `client_instance_id`.
   - Returns neutralized `SafeQuestionDTO`.
2. `POST /api/practice/answer`
   - Expects variables: `sessionId`, `questionId`, `selectedAnswer` or `freeResponseAnswer`, `skipped`, `client_instance_id`, `idempotencyKey`.
   - Rejects 409 on `client_instance_id` drift (unless `idempotencyKey` confirms previously secured retry).
   - Validates response with canonical truth and mutates `answer_attempts`.
   - Computes mastery using internal domain pipeline.
   - Returns outcome with un-neutralized `explanation` and `correctAnswerKey`.
