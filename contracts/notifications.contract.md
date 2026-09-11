# Notifications — Validation Contract

> @spec [Doc-01_V8 §36.1 step 6 "Both parties notified", §37.2 step 7, §38.1/§38.2 guardian
> aggregate-only visibility, §5.1 audit retention tiers; Doc-01A_V1.0 §14 PII redaction;
> lyceon-coding-standards §4.2 idempotency, §7 Zod at boundaries, §8 thin handlers, §12 privacy,
> §13 no silent catch] | @implemented [2026-09-03]
>
> Written BEFORE the implementation (owner brief, Notifications: Full Deletion and Pure Rebuild).
> This file defines correctness independently of the code. Every clause states the observation
> that proves it violated. Codex audits the build against this file; a clause that cannot be
> falsified is a defect in this file.
>
> Supersedes and replaces `contracts/notification-outbox.contract.md` (deleted in the same commit).

---

## 0. Scope and lanes

Three email lanes exist. This contract governs exactly one.

| Lane | Owner | Code in this repo |
|---|---|---|
| Auth email (password reset, email change, confirmation) | Supabase Auth via its SMTP integration (Resend) | none — no send code, no templates |
| Billing email (receipts, dunning, trial ending) | Stripe | none |
| **Product notifications** (in-app + email from one event) | **this contract** | `notification_events`, `notification_messages`, `notification_delivery_events`, `server/lib/notifications/*`, `server/routes/notifications.ts`, `server/routes/resend-webhook.ts` |
| **Direct transactional sends** (guardian consent request; deletion-scheduled recovery link) | **this contract, §0.4** — same transport, NOT events (owner rulings R7/R8, 2026-09-03) | `server/lib/notifications/direct-sends.ts` and its two call sites |

**C0.1** No code under `server/lib/notifications/` or `server/routes/notifications.ts` sends auth or billing mail.
*Violated if:* a template or transport call in those paths references password reset, email change, confirmation, receipts, invoices, or trial state.

**C0.2** The only module that talks to Resend is `server/lib/notifications/transport.ts`.
*Violated if:* `grep -rn "api.resend.com" server apps packages client` returns any file other than `server/lib/notifications/transport.ts`.

**C0.3** `contact@lyceon.ai` does not appear in any file under `server/`, `apps/`, `packages/`, `client/`, or `supabase/`.
*Violated if:* `grep -rn "contact@lyceon.ai" server apps packages client supabase` returns anything.

**C0.4** Two transactional emails are direct sends, not notification events, by owner ruling (2026-09-03): the guardian consent request (R7 — the recipient has no account by definition; every message row is addressed to a profile) and the deletion-scheduled recovery email (R8 — it carries a credential that can never sit in a persisted, recipient-readable payload). Each is sent at its request site through `server/lib/notifications/direct-sends.ts` → `transport.ts`, from `NOTIFICATION_FROM_EMAIL`, with `Idempotency-Key` derived from the durable request row id: `guardian-consent-request:<guardian_consent_requests.id>` and `account-deletion-scheduled:<account_deletion_requests.id>`. Nothing about either message (address, body, token) is persisted by this lane.
*Violated if:* a `notification_events` row exists with either type; the consent route or the deletion route no longer calls its sender (`tests/ci/notifications.direct-sends.test.ts` greps both call sites); a captured send lacks the row-derived key; or a token or address appears in any notification table.

**C0.5** Both direct sends are best-effort after their mutation has committed: a transport failure is a `Result`, logged with ids and a redacted address, and never fails the request that produced it.
*Violated if:* a consent-request PATCH or a deletion request returns 5xx because mail failed, or the sender throws.

---

## 1. Schema

**C1.1** `public.notification_events(event_id uuid PK, event_type text, subject_profile_id uuid FK → profiles(id) ON DELETE CASCADE, payload jsonb, created_at)`, with `event_type` restricted by CHECK to exactly `guardian_linked` (launch scope after rulings R7/R8; adding a type is a CHECK change plus a row in §2.3).
*Violated if:* `pg_get_constraintdef` of `notification_events_type_check` lists any value other than `guardian_linked`; or `confdeltype` of the profiles FK is not `c`.

**C1.2** `public.notification_messages(message_id uuid PK, event_id FK → notification_events ON DELETE CASCADE, recipient_profile_id FK → profiles(id) ON DELETE CASCADE, channel ∈ {in_app,email}, status ∈ {queued,sent,delivered,bounced,complained,failed}, provider_message_id, attempts, last_error, seen_at, read_at, archived_at, sent_at, delivered_at, created_at)` with `UNIQUE (event_id, recipient_profile_id, channel)`.
*Violated if:* any listed column, CHECK, or the unique constraint is absent in `information_schema` / `pg_constraint`; or either FK's `confdeltype` is not `c`.

**C1.3** Deleting a `profiles` row succeeds while `notification_events` and `notification_messages` rows reference it, and those rows are gone afterwards. This is load-bearing for account deletion (`execute_account_deletion_cascade` relies on FK cascade from `profiles`).
*Violated if:* `DELETE FROM public.profiles WHERE id = $1` raises `23503` while message rows exist for `$1`, or any row referencing `$1` survives the delete. *Negative control:* with either FK altered to `ON DELETE NO ACTION`, the same DELETE MUST raise `23503`; a guard that cannot be observed failing does not count.

**C1.4** `public.notification_delivery_events(provider_event_id text PK, provider_message_id text, event_type text, occurred_at, received_at, message_id uuid NULL FK → notification_messages ON DELETE CASCADE, applied_at timestamptz NULL)` records every verified provider webhook exactly once.
*Violated if:* two rows share a `provider_event_id` (impossible by PK — the observable is a `23505` on replay inside the apply function, which the function converts to the `duplicate` outcome).

**C1.5** RLS is enabled on all three tables.
*Violated if:* `select relname from pg_class where relname like 'notification_%' and not relrowsecurity` returns a row.

---

## 2. Event → message fan-out

**C2.1** One call to `public.emit_notification_event(p_event_id, p_event_type, p_subject_profile_id, p_recipients, p_payload)` inserts exactly one `notification_events` row and exactly one `notification_messages` row per `(recipient.profile_id, channel)` pair in `p_recipients`, in the caller's transaction.
*Violated if:* after a single call with N distinct (profile_id, channel) pairs the message count for that `event_id` is not N; or the event row exists and any of the N message rows does not.

**C2.2** Same transaction as the triggering mutation. The emit runs inside the SQL function that performs the domain mutation, before it returns.
*Violated if:* `BEGIN; SELECT create_active_guardian_link_audited(...); ROLLBACK;` leaves any row in `notification_events` or `notification_messages`; or the emit is issued from application code on a separate client call.

**C2.3** Recipient rule per event type:

| event_type | subject | recipients and channels | emitted by |
|---|---|---|---|
| `guardian_linked` | the student | student: `in_app`; guardian: `in_app`, `email` | `create_active_guardian_link_audited` |

Not event types (see §0.4): the guardian consent request and the deletion-scheduled email are direct sends.

*Violated if:* a `guardian_linked` event has a message for any profile other than its student and the linking guardian, or the guardian lacks an `email` row, or the student has an `email` row; or an event row exists whose type is not in this table.

**C2.4** `in_app` rows are delivered on insert: `status='delivered'`, `delivered_at = created_at`. The row is the delivery.
*Violated if:* an `in_app` row exists with `status <> 'delivered'` or `delivered_at IS NULL`.

**C2.5** `email` rows are inserted `status='queued'`, `attempts=0`, `provider_message_id IS NULL`, `sent_at IS NULL`.
*Violated if:* a freshly emitted `email` row has any other initial state.

---

## 3. Channel matrix

| channel | delivered by | terminal statuses | mutable by recipient |
|---|---|---|---|
| `in_app` | the row itself, read through `GET /api/notifications` | `delivered` | `seen_at`, `read_at`, `archived_at` |
| `email` | Resend, via the dispatcher | `delivered`, `bounced`, `complained`, `failed` | none (email rows are never in the feed) |

**C3.1** `GET /api/notifications` returns only `channel='in_app'` rows.
*Violated if:* any item in the feed response corresponds to a row with `channel='email'`.

---

## 4. Status lifecycle

Legal transitions. Anything not listed is illegal; an illegal transition requested by a webhook is **recorded and ignored** (§7), never applied.

| from | to | actor | evidence written |
|---|---|---|---|
| `queued` | `sent` | dispatcher, on a 2xx from Resend | `sent_at`, `provider_message_id`, `attempts+1` |
| `queued` | `queued` | dispatcher, on a non-2xx / transport failure | `attempts+1`, `last_error` |
| `queued` | `failed` | dispatcher, when `attempts` reaches `NOTIFICATION_EMAIL_MAX_ATTEMPTS` (5) after a failure | `attempts`, `last_error` |
| `sent` | `delivered` | webhook `email.delivered` | `delivered_at` |
| `sent` | `bounced` | webhook `email.bounced` | — |
| `delivered` | `bounced` | webhook `email.bounced` (asynchronous bounce) | — |
| `sent` | `complained` | webhook `email.complained` | — |
| `delivered` | `complained` | webhook `email.complained` | — |
| `sent` | `failed` | webhook `email.failed` | `last_error` |

**C4.1** A failed send never produces `status='failed'` before the cap, and never produces `status='sent'`.
*Violated if:* after a transport failure the row reads anything other than `queued` with `attempts` incremented by exactly one and `last_error` non-null (below the cap), or `failed` (at the cap).

**C4.2** A send that never happened and a send that failed are distinguishable at every point.
*Violated if:* a row with `attempts = 0` has `last_error IS NOT NULL`, or a row with `attempts > 0` and `status='queued'` has `last_error IS NULL`.

**C4.3** `status='sent'` implies `provider_message_id IS NOT NULL AND sent_at IS NOT NULL`; `status='delivered'` on an email row implies `delivered_at IS NOT NULL`.
*Violated if:* a row exists that contradicts either implication.

**C4.4** `bounced`, `complained`, and `failed` are terminal.
*Violated if:* a row leaves any of those statuses.

---

## 5. Idempotency

**C5.1** `event_id` is deterministic: `public.notification_event_id(event_type, source_id)` = the first 16 bytes of `sha256(event_type || ':' || source_id)` with the RFC 4122 version nibble set to 5 and the variant bits set to `10`. The TypeScript derivation in `server/lib/notifications/event-id.ts` produces the identical uuid.
*Violated if:* for any `(event_type, source_id)` the SQL and TypeScript results differ, or two calls with the same inputs differ.

**C5.2** Emit is a no-op on replay: calling `emit_notification_event` twice with the same `p_event_id` leaves event and message counts unchanged (`ON CONFLICT DO NOTHING` on both inserts).
*Violated if:* the second call raises, or any count changes.

**C5.3** Every send carries `Idempotency-Key: <message_id>` so a retried send of the same row cannot produce two emails within Resend's window.
*Violated if:* a captured request to the transport lacks the header or its value differs from the row's `message_id`.

**C5.4** Webhook processing is idempotent under at-least-once delivery: a second delivery with the same `svix-id` changes nothing and returns 2xx.
*Violated if:* replaying a verified webhook changes any `notification_messages` column or inserts a second `notification_delivery_events` row.

---

## 6. Dispatch

**C6.1** Timeliness comes from the inline path: after the mutation's transaction commits, the request awaits `dispatchQueuedMessages({ eventId })` for that event before responding. It is not fire-and-forget.
*Violated if:* the redeem handler responds before the dispatcher promise settles (observable: a transport stub that resolves late sees the response first), or the dispatcher call is not awaited.

**C6.2** The daily sweep (`GET /api/internal/notification-dispatch-sweep`, CRON_SECRET-gated) is a backstop for orphaned `queued` rows only. The design does not depend on it for timeliness.
*Violated if:* no code path dispatches an event's messages outside the sweep.

**C6.3** The dispatcher selects only `channel='email' AND status='queued' AND attempts < NOTIFICATION_EMAIL_MAX_ATTEMPTS`.
*Violated if:* the transport is invoked for a row outside that predicate.

**C6.4** The dispatcher resolves the recipient address from `profiles.email` for `recipient_profile_id` and never from the payload.
*Violated if:* `payload` contains an email address, or the transport receives an address that is not `profiles.email` of the recipient.

**C6.5** Race closure: if a delivery webhook arrives before the dispatcher has written `provider_message_id`, the event is stored `unmatched` (`message_id IS NULL`, `applied_at IS NULL`); when the dispatcher records the send, pending events for that `provider_message_id` are applied in `occurred_at` order in the same transaction.
*Violated if:* a webhook recorded before the send record leaves the row at `sent` after the send record commits.

---

## 7. Webhook receiver

**C7.1** Path `POST /api/webhooks/resend`, registered before `express.json()` with a raw body, CSRF-exempt by signature only.
*Violated if:* the handler receives a parsed body (observable: the handler's raw-body check fails), or the mount is after the JSON parser.

**C7.2** Verification before anything else: `svix-id`, `svix-timestamp`, `svix-signature` against `RESEND_WEBHOOK_SECRET` (`whsec_` base64 secret; signed content `${id}.${timestamp}.${body}`; HMAC-SHA256; constant-time compare against every `v1,` candidate; timestamp within ±300 s). A missing secret fails closed.
*Violated if:* any DB write occurs for a request whose signature is absent, malformed, expired, or wrong; or a request verifies when `RESEND_WEBHOOK_SECRET` is unset.

**C7.3** Response codes: 400 for unverifiable (do not retry), 200 for applied / duplicate / ignored / unmatched, 500 for a handler failure (provider retries).
*Violated if:* a signature failure returns 5xx, or a DB failure returns 2xx.

**C7.4** Mapping: `email.delivered → delivered`, `email.bounced → bounced`, `email.complained → complained`, `email.failed → failed`. `email.opened`, `email.clicked`, `email.sent`, and unknown types are acknowledged (200) and not recorded.
*Violated if:* an open/click event writes any row, or a listed type maps to a different status.

**C7.5** Dedupe and effect are one transaction: `public.apply_notification_delivery_event` inserts the `provider_event_id` and applies the status change in one function call. "Claimed but not applied" is unrepresentable.
*Violated if:* the receiver writes the event id and the status in separate statements from application code, or a `notification_delivery_events` row with `message_id IS NOT NULL` has `applied_at IS NULL`.

---

## 8. Payload rule (non-negotiable)

**C8.1** `payload` holds identifiers and rendering parameters only. For `guardian_linked`: `{ "link_id": uuid, "student_display_name": text }` and nothing else.
*Violated if:* a `guardian_linked` payload has any other key, or any payload contains question content, responses, tutor data, session detail, an email address, a token, or a date of birth (Doc 01 §38.1/§38.2; Doc 01A §14).

**C8.2** Nothing addressed to a guardian carries more than aggregate/identity data.
*Violated if:* an email or in-app body rendered for a guardian recipient contains any of the §38.1 "no" categories.

---

## 9. Access rule (RLS + API)

**C9.1** `notification_messages`: `authenticated` may SELECT and UPDATE only rows where `recipient_profile_id = auth.uid()`; no INSERT or DELETE policy exists for `authenticated`; `anon` has no grant.
*Violated if:* as `authenticated` with `auth.uid() = A`, a SELECT returns a row with `recipient_profile_id <> A`, or an INSERT/DELETE succeeds; or any statement as `anon` returns rows or succeeds.

**C9.2** A recipient's UPDATE may change only `seen_at`, `read_at`, `archived_at`. A BEFORE UPDATE trigger raises `42501` when `current_user IN ('authenticated','anon')` and any other column differs between OLD and NEW.
*Violated if:* as `authenticated` an UPDATE that sets `status`, `attempts`, `provider_message_id`, `last_error`, `sent_at`, `delivered_at`, `recipient_profile_id`, `event_id`, `channel`, or `created_at` succeeds.

**C9.3** `notification_events` and `notification_delivery_events` have no policies; only `service_role` can read or write them.
*Violated if:* `pg_policies` lists a policy on either table, or a statement as `authenticated`/`anon` returns rows.

**C9.4** The API is recipient-scoped by the server: every handler in `server/routes/notifications.ts` reads the recipient from the authenticated session and never from the request. A `message_id` belonging to another recipient is answered 404, not 403.
*Violated if:* a request can name a recipient; or a PATCH on another recipient's `message_id` returns anything other than 404 or changes the row.

**C9.5** The guardian-visibility predicate `guardian_can_view_student` is NOT used for notification access. A guardian's message row is addressed to the guardian; self-scope covers it.
*Violated if:* any policy or handler on the notification tables references `guardian_can_view_student` or `guardian_view_decision`.

---

## 10. Logging and privacy

**C10.1** The transport logs through the structured logger with the recipient address redacted to first letter + domain (Doc 01A §14). It never logs subject, body, or the API key.
*Violated if:* a log line produced by `server/lib/notifications/*` contains an `@` address with more than one character before the `@`, an HTML fragment, a subject string, or a bearer token.

**C10.2** When `RESEND_API_KEY` is absent the transport returns a failure `Result`; it does not print the message.
*Violated if:* any `console.*` call exists under `server/lib/notifications/` or `server/routes/notifications.ts` / `server/routes/resend-webhook.ts`.

---

## 11. Retention rule

**C11.1** `in_app` message rows are retained 90 days from `created_at`; `email` message rows and `notification_delivery_events` rows are retained 90 days from `created_at` / `received_at`. `notification_events` rows are retained until their last message is gone. This matches the Doc 01 §5.1 authentication-event tier (90 days). `docs/Spec` has no notification retention rule; the gap is filed as a PROPOSED SCL.
*Violated if:* the SCL entry is absent from `docs/SpecAudit/SPEC_CHANGES_LOG.md`, or a retention sweep deletes rows younger than 90 days.

**C11.2** The sweep itself is Phase 2. This build ships no retention cron.
*Violated if:* a retention delete exists in this build's diff.

---

## 12. Sender, environment, and tracking

**C12.1** Sender is `NOTIFICATION_FROM_EMAIL` (`notifications@send.lyceon.ai` in production), read from the environment, never hard-coded.
*Violated if:* a literal sender address appears in `server/lib/notifications/*`.

**C12.2** `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `NOTIFICATION_FROM_EMAIL` are declared in `packages/shared/src/env.ts` and checked at startup by `validateEnvironment()` in `apps/api/src/env.ts` (fatal in production when missing).
*Violated if:* production boots with any of the three unset, or the names are absent from the shared schema.

**C12.3** Open and click tracking stay off: the send request body contains no tracking option and no per-message tag or header that enables it.
*Violated if:* a captured request body to `/emails` contains a `tags` entry or header enabling open/click tracking.

---

## 13. Falsification summary

| Clause | Proving test |
|---|---|
| C1.3 | `tests/ci/notifications.pg.ci.test.ts` — cascade positive + `NO ACTION` negative control |
| C2.1, C2.3 | fan-out: one `guardian_linked` → exactly three rows |
| C2.2 | rollback leaves zero rows |
| C5.1 | SQL vs TypeScript `event_id` parity |
| C5.2 | double emit, counts unchanged |
| C4.1, C4.2 | transport failure → `queued`, `attempts=1`, `last_error` set |
| C5.3, C12.3 | captured transport request has `Idempotency-Key` = `message_id` and no tracking fields |
| C7.2, C7.3, C7.4, C5.4 | valid signature applies; invalid returns 400 and writes nothing; replay is a no-op |
| C9.1, C9.2, C9.3 | `SET ROLE authenticated` / `anon` with `auth.uid()` fixtures |
| C0.2, C0.3, C10.2 | grep clauses, run in the same suite |
| C0.4, C0.5 | `tests/ci/notifications.direct-sends.test.ts` — row-derived keys, sender, links, no tracking, Result on failure, both call sites wired |
