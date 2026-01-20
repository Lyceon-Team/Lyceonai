# System Invariants (Launch-Critical)

## 1. Scope Lock (Launch-Critical)

**In scope for launch**

* Express runtime defined in `server/index.ts` (only runtime entrypoint).
* Supabase-authenticated student and guardian flows.
* Admin operations explicitly mounted in `server/index.ts`.
* Practice sessions, question retrieval, review errors, guardian summaries, billing, and ingestion endpoints explicitly mounted in `server/index.ts`.

**Out of scope for launch**

* Any router or service not mounted in `server/index.ts`.
* Any route under `apps/api/src/routes/**` that is not mounted in `server/index.ts`.
* Any Next.js API routes (none exist in runtime).
* Any UI-only routes or client-side behavior not surfaced via the server runtime.

## 2. Identity & Roles

* **Student**: The primary learner. Owns practice sessions and answers.
* **Guardian**: A read-only overseer of linked student data; cannot modify student state.
* **Admin**: Operational authority; can access admin-only ingestion, review, and diagnostic endpoints.

**Guardian–Student linkage invariants**

* A student can be linked to **at most one guardian** at a time.
* A guardian may link **multiple students**.
* Guardian access to student data is permitted **only** when the student is linked to that guardian.
* Guardians cannot mutate student state or submissions (read-only for student progress data).

## 3. Authentication Invariants

* Authentication is **server-only** using **httpOnly cookies**.
* Supabase is the **identity provider**; all auth validation is handled server-side.
* **No Supabase JS auth on the client** (no client-side token handling).
* Cookie-based flows **must** enforce CSRF protection on state-changing requests.

## 4. Data Access & Security

* **No cross-user data leakage**: a user can only access their own records unless explicitly authorized (guardian link or admin role).
* Guardians are **read-only** for student state (sessions, attempts, mastery, calendar, progress).
* Admin-only data access is restricted to routes explicitly protected by admin auth middleware.

## 5. Practice Session Invariants (Core Loop)

**Lifecycle**

1. **start**: resolve or create an in-progress session per user+section.
2. **serve**: select a valid question and return it without answers.
3. **answer**: submit response; server grades using canonical answer.
4. **feedback**: return correctness and explanation (if allowed).
5. **persist**: store attempt and related events.
6. **resume**: subsequent calls rehydrate session stats from persisted data.

**Idempotency**

* Session creation is idempotent per `(user_id, section)` for an in-progress session.
* Answer submission must tolerate duplicate submissions for the same `(session_id, question_id)` without corrupting state.

**Multi-tab conflict**

* The server is the **source of truth** for session state and attempt history.
* Clients must not assume local state is authoritative when multiple tabs are open.

## 6. Anti-Answer-Leak Rules

* Correct answers **must never** be returned before a student submits an answer.
* Question retrieval endpoints must **never** return answer keys or explanation-only data prior to submission.
* Exceptions are allowed **only** on admin or debug routes explicitly marked and protected.

## 7. Payments & Entitlements

* Stripe webhooks are the **source of truth** for paid entitlement status.
* **No hardcoded Stripe price IDs** in code; all price IDs must be environment-configured.
* Entitlements must gate all paid functionality (guardian premium views, usage-limit unlocks).

## 8. Observability & Safety

* Every request log **must** include: `request_id`, `role`, and a **hashed** `user_id` when available.
* Admin actions (ingestion, review, billing changes) must be auditable with timestamped logs.
* Debug endpoints must avoid leaking secrets and should return only presence/health signals.
