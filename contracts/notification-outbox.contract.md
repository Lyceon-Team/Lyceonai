# Notification Outbox — Emission Foundation Contract

> Decision locked (owner, 2026-06-17): user-facing notifications are an **end-stage feature**, but
> **trigger emission starts now** so the end-build is cheap. This contract governs the **emission
> foundation only** — the durable, idempotent event-emission seam. It is **not** the notification
> feature. The dispatcher, channel delivery (email / push / in-app), the in-app notification UI, and
> user notification preferences are **explicitly deferred** to the end-stage notification lane.
>
> @spec [Doc-01_V6 §15 Guardian Trust and Linkage / §16 Guardian Visibility / §17 Under-13 Consent &
>   COPPA] [Doc-01_V6 "Cross-Domain Writes": `notification-authority` consolidation acknowledged,
>   Doc 05 scope, unresolved] [lyceon-coding-standards §4.2 idempotency / outbox-dedup, §12 privacy,
>   §17 hard-stops]
> @implemented [2026-06-17] (artifacts 1–3; table applied owner-run)

---

## 1. What this is (and is not)

**Is:** a single, durable place where already-built and future features **record** that a notifiable
moment happened — `notification_outbox`. Writes are atomic with the state change that produced them,
idempotent, and append-only. The table is **inert**: nothing reads or drains it yet.

**Is not:** a notification system. There is **no dispatcher, no delivery, no UI, no preferences** in
this lane. Those are the end-stage feature. Building them is out of scope here by decision.

The shape exists so that, when the end-stage lane lands, the historical and ongoing stream of
notifiable events is already captured — we "wire the triggers as we build, build the feature at the
end." This is the outbox (transactional-outbox) pattern: **emit in the same transaction as the state
change; consume later, separately.**

---

## 2. The `notification_outbox` shape

| Column | Type | Notes |
|---|---|---|
| `event_id` | `uuid` PRIMARY KEY | **Insert-once idempotency key** — same discipline as the mastery audit dedup (`UNIQUE(event_source_kind, event_id)` in `20260610010000_ws3_mastery_formula.sql`). The emitter supplies a **deterministic** `event_id` (e.g. `uuidv5` over `event_type` + the source entity id + a version), so the same logical event cannot be emitted twice. Insert with `ON CONFLICT (event_id) DO NOTHING`. |
| `event_type` | `text` NOT NULL, `CHECK` enum | Grows as features land. Initial set is exactly the catalogued moments: `guardian_linked`, `quota_reached`, `trial_ending`, `payment_failed`, `score_projection_updated`, `mastery_milestone`. Adding a type = one line in the CHECK (a tracked migration), never a free-text value. |
| `recipient_kind` | `text` NOT NULL, `CHECK ('student' \| 'guardian' \| 'both')` | **The Lyceon-specific field.** The audience is resolved **per the guardian-trust model, NOT "the user."** This encodes right-party resolution **at emission time** — the emitter knows whether the moment is the student's, the guardian's, or both. |
| `recipient_profile_id` | `uuid` NOT NULL, FK → `public.profiles(id)` | The **subject/anchor** profile the event concerns. For every moment in the current catalog this is the **student** profile. The concrete human recipients are derived from `(recipient_profile_id, recipient_kind)` by the future dispatcher via the guardian-trust gate — never stored as a second guardian id here. |
| `payload` | `jsonb` NOT NULL DEFAULT `'{}'` | Minimal, non-sensitive context for rendering — **ids and small scalars only**. Per §12, it carries **no PII, no secrets/tokens, no student answers, no tutor prompts/responses**. (e.g. `{ "guardian_profile_id": "…", "link_id": "…" }`, `{ "section": "M", "milestone": "level_up" }`.) |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | Emission time. |
| `processed_at` | `timestamptz` NULL | **NULL until the future dispatcher drains it.** Stays NULL forever in this lane (nothing drains). The dispatcher will stamp it when delivery is resolved. |
| `channel_hint` | `text` NULL | Optional, advisory. A hint at the likely channel (`in_app` / `email` / `push`); the dispatcher + user preferences decide the actual channel(s) at end-stage. NULL = no hint. |

### Recipient resolution rule (binding)

`recipient_kind` resolves to humans **only** through the guardian-trust gate, identically to every
other guardian-visible surface (Doc-01 §15/§16; the canonical `public.guardian_can_view_student`
predicate used across the 05 family):

- `student` → the subject student.
- `guardian` → the subject student's guardian(s), **only if** the guardian link is active **AND** the
  student entitlement is active. No active+entitled guardian ⇒ no guardian recipient.
- `both` → the student, **plus** any active+entitled guardian(s) by the same gate.

Guardians remain **view-only**: a notification is a read-side delivery, never a write into student
learning state. Emitting to `notification_outbox` grants no guardian write capability.

---

## 3. Emission discipline (how features write to it)

1. **Atomic with the state change.** The `INSERT` happens in the **same transaction** as the mutation
   that makes the moment true (the link going active, the quota tripping, the entitlement write, the
   projection upsert). If the state change rolls back, the emission rolls back. No moment without its
   state change; no state change silently without its moment.
2. **Idempotent.** Deterministic `event_id` + `ON CONFLICT (event_id) DO NOTHING`. Re-running a
   handler (Stripe webhook re-delivery, resume-on-refresh, a retried mutation) emits **at most one**
   row per logical event. This is the same idempotency contract the rest of the platform already
   holds (coding-standards §4.2).
3. **Durable & append-only.** Rows are never updated by emitters. Only the future dispatcher will set
   `processed_at`. No emitter deletes rows.
4. **Redacted payloads.** §12 applies in full. The payload is rendering context, not a content store.

---

## 4. COPPA / AADC constraint (why `recipient_kind` matters now)

Minor-directed notification **delivery** (channel gating, quiet hours, guardian-routing for under-13,
age-appropriate framing) is a **dispatcher-stage** concern and is **enforced by the future
dispatcher** under Doc-01 §17 (COPPA) and AADC. It is deliberately **not** built here.

What is captured **now**, at emission time, is **right-party resolution**: `recipient_kind` records
*who the moment is for* per the guardian-trust model. This is the durable, hard-to-reconstruct-later
fact. Resolving it at emission (where the feature has full context) means the dispatcher inherits a
correct audience and only has to apply delivery-time COPPA/AADC policy — it never has to re-derive
*whether a moment was the student's or the guardian's* after the fact.

---

## 5. Storage & access (RLS)

- **Service-role-only**, exactly like the other outboxes (`projection_refresh_outbox`,
  `student_projection_refresh_state`). RLS **enabled**; `REVOKE ALL FROM PUBLIC`;
  `GRANT ALL TO service_role`; **no `anon`/`authenticated` policy** — absence of policy is the denial.
- **No client access** in this lane. The in-app notification UI (which would need a scoped student/
  guardian read policy) is an end-stage deliverable; that read policy is added **with** the UI, not
  here. Until then nothing but `service_role` (RLS-bypassing) touches the table.

---

## 6. Explicitly deferred (end-stage notification lane — DO NOT build here)

- The **dispatcher** (the worker that drains `processed_at IS NULL` and resolves recipients).
- **Channel delivery**: email, push, SMS, in-app.
- The **in-app notification UI** and its scoped read policy.
- **User notification preferences** (per-type, per-channel opt-in/out, quiet hours).
- COPPA/AADC **delivery** policy (minor routing, age-appropriate framing).

This contract is satisfied when the three artifacts exist and the catalog is complete. Drains,
delivery, and UI are a separate, later lane.

---

## 7. Where the table lives (pending; owner-run apply)

The migration is **written and reviewed** but **not yet in the active `supabase/migrations/`
pipeline**, because it is to be **applied owner-run when convenient**. It is staged at:

```
supabase/migrations-pending/20260617000000_notification_outbox.sql
```

This path is **swept by none** of the migration gates (`genesis-fresh-apply.sh`, the 05b/05c/lane-c/
guardian-mirror gates, and `no-hardcoded-constants.mjs` all scope to `supabase/migrations/` — the
non-recursive `*.sql` glob and the `walk("supabase/migrations")` root), so staging it keeps CI green
and the committed `genesis-schema.expected.sql` snapshot un-drifted until the owner activates it.

**To activate (owner):**
1. `git mv supabase/migrations-pending/20260617000000_notification_outbox.sql supabase/migrations/`.
2. Regenerate `scripts/ci/genesis-schema.expected.sql` from the fresh-apply harness (the established
   genesis-extending step — same as 05B/05C did).
3. Apply to the project (`hncolwkccbbjkfithhlo`).

The migration ships a **reversible DOWN** (drop the table; its policies/indexes drop with it) so the
activation is fully reversible.

---

## 8. Until the table is applied: emits are catalogued, not wired

Because the table does **not exist** in the database yet, **no feature wires a live `INSERT` now** — a
runtime insert into a non-existent relation would break those code paths and their tests. Every
notifiable moment in already-built features is therefore captured as a **tracked back-emit item** in
the catalog (`docs/SpecAudit/notification-triggers.md`), with its exact emit point, `event_type`, and
`recipient_kind`. When the owner applies the table, each one-line emit is added at its catalogued
point under this contract's discipline (§3).

The standing rule for **all future lanes** (added to the build checklist): *emit to
`notification_outbox` if this feature produces a notifiable event* — same transaction, deterministic
`event_id`, `recipient_kind` per the guardian-trust model.
