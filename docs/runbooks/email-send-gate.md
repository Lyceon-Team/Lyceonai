# Email send gate — runbook

@spec [owner brief "Email send gate" (Karl, 2026-10-30); rulings 2026-11-02; contracts/notifications.contract.md C15; SCL-263] | @implemented [2026-11-02]

What it does: decides, per recipient, whether a reminder-type ("governed") email may go out, and stops emailing students who have stopped reading. Account, billing and link emails ("always") are never blocked. The three SAT-date emails ("milestones") go in every state. Contract C15 is the full rule set.

## Before the first deploy (owner)

1. **Vercel:** set `NOTIFICATION_TRACKED_FROM_EMAIL` (Production) to a sender on `lyceon.ai`, for example `notifications@lyceon.ai`. Unset, governed and milestone emails fall back to `NOTIFICATION_FROM_EMAIL` (untracked) with a `email_tracked_sender_unconfigured` warning, and clicks are not seen.
2. **Resend:** set the From of the four lifecycle automations (reminder, diagnostic, Pro no plan, practising free) to the same tracked sender. Those emails are sent by Resend, not by our transport.
3. **Resend webhook:** `email.opened` and `email.clicked` are already subscribed (read-only check, 2026-11-02). Nothing to change.
4. **Deploy the code, then apply** `supabase/migrations/20261126000000_email_send_gate.sql` by hand. The backfill moves every student the old QOTD 7-send sunset paused into `paused` (no second note).
5. **Launch ruling (Karl, 2026-11-02, revised):** before applying `supabase/migrations/20261127000000_email_gate_launch_pause.sql`, nothing to set; after applying it, add the internal list and re-run the move:

```sql
-- LIFECYCLE_EMAIL_DENYLIST's entries and your own addresses (full addresses or domains)
UPDATE public.notification_runtime_config
   SET value = '["lyceon.ai", "<your address>", "<denylisted domain>"]'::jsonb
 WHERE key = 'email_gate_internal_denylist';
SELECT public.email_gate_launch_backfill(now());   -- how many accounts it paused
```

   It pauses every account quiet since before 2026-09-27 (or never active and signed up before it), and every internal or test account. No pause note goes to either. Accounts active since then are unchanged.

6. **Milestone window and duplicate guard (Karl, 2026-11-02):** apply `supabase/migrations/20261128000000_email_gate_milestone_window.sql` after 20261127000000. No manual check-ins around test dates from now on: the milestones are automatic only.

## Checks after applying

Owner-run, with one exception: the first sweep after `20261128000000` is applied is verified by Claude directly in production, read-only, using the queries below (Karl's ruling on #1403, 2026-11-02). Nothing else here is run by an agent.

```sql
-- the gate exists and the config is complete (16 keys once 20261127000000 is applied; 14 before)
SELECT count(*) FROM public.notification_runtime_config WHERE key LIKE 'email_gate_%';
-- the backfill: students paused by the old QOTD sunset are paused here
SELECT count(*) FROM public.email_gate_state WHERE reason = 'qotd_sunset_backfill';
-- the decision for one profile, now
SELECT public.email_gate_decide('<profile id>', 'review_ask');
-- after a sweep: milestones sent today, and the ones skipped and why
SELECT event_type, count(*) FROM public.notification_events
 WHERE event_type LIKE 'sat\_%' AND created_at >= current_date GROUP BY 1;
SELECT kind, reason, count(*) FROM public.email_milestone_skips
 WHERE recorded_at >= current_date GROUP BY 1, 2;
-- milestone or governed emails refused for a bounced or complained address
SELECT count(*) FROM public.notification_messages
 WHERE last_error = 'email_gate:suppressed' AND created_at >= current_date;
```

## Daily operation

Everything runs inside the existing 14:00 UTC `notification-dispatch-sweep` cron (no new cron): milestones, the state sweep (and pause notes), the Resend `email_state` mirror, then the dispatch. The parent pauses run in the 18:00 Chicago accountability job, before the digest. The route's JSON carries an `emailGate` summary; the logs carry `email_gate_job_done`.

A mirror failure is retried with backoff (2, 4, 8 … minutes, at most a day) and never blocks a send:

```sql
SELECT email_state, attempts, last_error, next_attempt_at
  FROM public.email_gate_resend_outbox WHERE synced_at IS NULL ORDER BY attempts DESC LIMIT 20;
```

## Manual campaigns

1. Pick recipients from `public.email_gate_status` (service role): `WHERE may_send_governed` for a campaign, `may_send_milestone` for a test-date note. Under-13s and pending deletions are never `may_send_governed`.
2. After each send, record it, so the gate counts it (cooling cap, unengaged count):

```sql
SELECT public.record_campaign_send('<address>', '<campaign>', '<variant or NULL>', '<sent_at>', '<resend email id>');
-- 'recorded' | 'duplicate' (same Resend id) | 'unknown_recipient'
```

## Silent bulk pause (Karl, 2026-11-11; SCL-281)

For a list of students whose emails should stop without telling them or their parent, such as the December cohort drop. Their account, progress and any free Pro are untouched. Apply `supabase/migrations/20261205000000_email_gate_pause_profiles.sql` first. Owner-run, service role.

```sql
-- 1. Dry run (the default): writes nothing, lists who would change.
SELECT public.email_gate_pause_profiles(ARRAY['<id>', '<id>']::uuid[], 'cohort_drop_2026_11_16');
-- {"dry_run": true, "to_pause": [...], "already_paused": [...], "not_student": [...],
--  "no_profile": [...], "guardian_digest_pauses": n}

-- 2. Check the lists, then the real run with the same ids and reason.
SELECT public.email_gate_pause_profiles(ARRAY['<id>', '<id>']::uuid[], 'cohort_drop_2026_11_16', false);

-- 3. Afterwards: who it paused, and who has woken since.
SELECT t.profile_id, g.state FROM public.email_gate_transitions t
  JOIN public.email_gate_state g USING (profile_id)
 WHERE t.actor = 'bulk_pause' AND t.reason = 'cohort_drop_2026_11_16';
```

- **Silent:** no pause note to the student, and no parent pause email: the parent's digest for that student pauses quietly, as it would have once the student went idle.
- **Wake-up is unchanged:** any activity or Keep me posted wakes the student; student activity or a guardian sign-in resumes the parent's digest.
- **Safe to re-run:** a student already paused is listed as `already_paused` and nothing is written.
- **Resend:** `email_state = paused` is queued for the mirror (never for an under-13); the mirror only updates an existing contact and never creates one.
- **Students only:** a guardian id comes back as `not_student`. At most 1000 ids per call. The reason is 3-64 characters of a-z, 0-9 and `_`.
- The pause has effect only while `email_gate_enabled` is true.

## Tuning

Every threshold is a row in `public.notification_runtime_config` (history in `notification_runtime_config_history`). `email_gate_enabled = false` allows every governed email while still recording state. A missing or malformed key fails closed (the gate errors, and the dispatcher defers rather than sends).

## Proof

`tests/ci/email-gate.pg.ci.test.ts`, `tests/ci/email-gate.contract.test.ts`, the D18 and W1 cases in `tests/ci/exam-score-renewal.contract.test.ts`; planted defects in `scripts/ci/email-gate.mutations.sh` (G01–G87; the bulk pause is BP1–BP6 and G76–G87).
