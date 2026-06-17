# Notification Triggers — Back-Emit Catalog

> Companion to `contracts/notification-outbox.contract.md`. Captures the **notifiable moments in
> already-built features** so none is lost while it's fresh. Each is the point where, once the
> `notification_outbox` table is applied (owner-run), a one-line emit is added **in the same
> transaction as the state change**, with a deterministic `event_id` and `recipient_kind` per the
> guardian-trust model.
>
> @spec [Doc-01_V6 §15/§16/§17] [lyceon-coding-standards §4.2 idempotency, §12 privacy]
> @implemented [2026-06-17] (catalog only — emits tracked, not wired; see "Status" below)

## Status: tracked, not yet wired (by design)

The `notification_outbox` table is **pending** (`supabase/migrations-pending/…`, applied owner-run).
A live `INSERT` into a relation that doesn't exist yet would break these code paths and their tests,
so **no emit is wired now**. Every moment below is a **tracked back-emit item** — checked off when the
table is applied. This is the "wire the triggers as we build, build the feature at the end" decision:
the catalog is the durable capture; the wiring follows the table.

> Note on drift: the live `guardian_links` writer (`account.ts`) uses `student_user_id` / `linked_at`
> while the genesis schema names `student_profile_id` / `initiated_at`. That reconciliation is the
> `cleanup` lane's concern; the **emit point** (the active-link upsert) is stable regardless of which
> column names survive. Line numbers below are as of this catalog's commit — re-confirm at wire time.

---

## Catalog

| # | Moment | `event_type` | `recipient_kind` | Emit point (file:line) | Layer | Subject (`recipient_profile_id`) |
|---|---|---|---|---|---|---|
| 1 | Guardian link becomes active | `guardian_linked` | `both` | `server/lib/account.ts` — `createGuardianLink`, the `guardian_links` upsert with `status:'active'` (~L102–L116) | TS (server) | student |
| 2 | Freemium daily practice quota exhausted | `quota_reached` | `student` | `server/routes/practice-canonical.ts` — `reservePracticeQuestionQuota`, the quota-denied branch (402) when `entitlement_active=false` and the `daily_quota_free` cap is hit (~L901–L918) | TS (server) | student |
| 3 | Trial ending | `trial_ending` | `guardian` | `server/lib/webhookHandlers.ts` — `handleSubscriptionEvent`, the `upsertEntitlement` write when the persisted Stripe status reflects a trial nearing/ending its period (~L84–L94) | TS (server) | student (billing subject) |
| 4 | Payment failed | `payment_failed` | `guardian` | `server/lib/webhookHandlers.ts` — `handleSubscriptionEvent`, the `upsertEntitlement` write when status persists as `past_due`/`unpaid` (~L84–L94) | TS (server) | student (billing subject) |
| 5 | Mastery milestone crossed | `mastery_milestone` | `student` | `supabase/migrations/20260613000000_lane_c_mastery_seam.sql` — `apply_mastery_event`, the `student_skill_mastery` upsert where `mastery_level` crosses a threshold (~L198–L212) | SQL (RPC) | student |
| 6 | Section score projection updated | `score_projection_updated` | `student` | `supabase/migrations/20260613020000_05c_section_projection.sql` — `compute_section_projection`, the `student_section_projections` upsert (~L741–L773), reached via `bump_projection_refresh_counter` on threshold cross | SQL (RPC) | student |

---

## Per-item notes (emit point, type, recipient)

### 1. `guardian_linked` — recipient `both`
- **Emit point:** `createGuardianLink` (`server/lib/account.ts`), at the `guardian_links` upsert that
  sets `status:'active'`. The link going active is the moment.
- **Why `both`:** the link is meaningful to **both** parties — the student gains a supervising
  guardian; the guardian gains (view-only) visibility, gated on link-active **and** student
  entitlement-active (Doc-01 §15/§16). Subject (`recipient_profile_id`) = the student.
- **Cheap-now vs tracked:** **tracked** (table pending). One-line emit in the same Supabase write
  path/transaction as the upsert. `payload`: `{ guardian_profile_id, link_id }` (ids only, §12).

### 2. `quota_reached` — recipient `student`
- **Emit point:** `reservePracticeQuestionQuota` (`server/routes/practice-canonical.ts`), the
  quota-denied (402) branch — unentitled user who has spent the `daily_quota_free` cap
  (`freemium-practice-quota.contract.md`).
- **Why `student`:** it's the student's practice ceiling; the guardian is not notified of a daily cap.
- **Idempotency caveat:** the quota trips on **every** blocked request that day, so a per-request
  `event_id` would emit a row per blocked attempt. Use a **per-day** deterministic key
  (`uuidv5(quota_reached + profile_id + local-quota-date)`) so the student gets **one** "you've hit
  today's limit" event per day, not one per blocked tap. **tracked.**

### 3 & 4. `trial_ending` / `payment_failed` — recipient `guardian`
- **Emit point:** `handleSubscriptionEvent` (`server/lib/webhookHandlers.ts`), at the
  `upsertEntitlement` write (the single entitlement writer). The Stripe handler is a **thin idempotent
  receiver** that persists Stripe's status verbatim — the emit derives `event_type` from the persisted
  status transition (trial→ending, active/trialing→`past_due`/`unpaid`).
- **Why `guardian`:** billing is the guardian's domain for a minor student (Doc-01 §13/§14); the
  student is the billing **subject** (`recipient_profile_id`) but is **not** the billing recipient.
  The dispatcher routes to the student's active guardian(s) via the guardian-trust gate.
- **Idempotency:** the handler is already idempotent (re-fetches + persists verbatim). Key the emit on
  `uuidv5(event_type + subscription_id + period/status-version)` so webhook **re-delivery** does not
  double-emit. **tracked.**

### 5. `mastery_milestone` — recipient `student`
- **Emit point:** `apply_mastery_event` (`…lane_c_mastery_seam.sql`), at the `student_skill_mastery`
  upsert where `mastery_level` increases (milestone). **SQL-layer** emit — a `INSERT INTO
  notification_outbox … ON CONFLICT DO NOTHING` inside the function, in the same transaction as the
  mastery write (the outbox pattern, native to the existing `apply_mastery_event` transaction).
- **Earned-only:** mastery is from **observed events only** (coding-standards §10) — emit only on a
  real level crossing, never on inferred/estimated movement. Subject = student; `payload`:
  `{ section, domain, skill, mastery_level_after }`. Deterministic key on
  `(event_id-of-the-mastery-event + 'milestone')`. **tracked.**

### 6. `score_projection_updated` — recipient `student`
- **Emit point:** `compute_section_projection` (`…05c_section_projection.sql`), at the
  `student_section_projections` upsert (reached when `bump_projection_refresh_counter` crosses
  `PROJECTION_REFRESH_EVENT_THRESHOLD`). **SQL-layer** emit, same transaction as the projection upsert.
- **Throttle-aware:** projections already refresh on a throttle (not every answer), so this naturally
  emits at a sane cadence. Emit only when the projection **materially changes** (e.g. midpoint or band
  moved) to avoid no-op notifications. Subject = student; `payload`:
  `{ section, projected_score_mid, projected_score_low, projected_score_high }`. No "predicted score"
  vanity framing — this is the existing evidence-driven projection (coding-standards §10/§17).
  Deterministic key per (student, section, refresh). **tracked.**

---

## When the table is applied

Work down this catalog: for each row, add the one-line emit at its emit point under the contract's
discipline (§3 of `contracts/notification-outbox.contract.md`) — same transaction, deterministic
`event_id`, `recipient_kind` as tabled — then check it off here. TS emits insert via the service
client in the same write path; SQL emits insert inside the existing RPC transaction.

- [ ] 1. `guardian_linked` (TS)
- [ ] 2. `quota_reached` (TS, per-day key)
- [ ] 3. `trial_ending` (TS, webhook-safe key)
- [ ] 4. `payment_failed` (TS, webhook-safe key)
- [ ] 5. `mastery_milestone` (SQL, in `apply_mastery_event`)
- [ ] 6. `score_projection_updated` (SQL, in `compute_section_projection`)
