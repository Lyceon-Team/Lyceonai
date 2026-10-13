# Runbook — marketing email lane (Resend)

> @spec [contracts/notifications.contract.md §14 (added 2026-10-07); owner brief "SEO vertical —
> email lane" + Karl's Step 0 decisions 2026-10-07] | @implemented [2026-10-07]

Marketing email goes only to people who opted in, are 13 or over, have not been deleted and have
no deletion request pending. Lyceon decides who that is (`marketing_email_audience()`); a daily
job makes Resend match it. Unsubscribes and spam complaints come back to Lyceon through the
webhook as they happen.

## 1. One-time setup (Karl), in this order

1. **Apply the migration** `supabase/migrations/20261028000000_marketing_email_sync.sql` per
   [`migration-deploy.md`](migration-deploy.md).
2. **Create two segments in Resend:** `Marketing — students` and `Marketing — guardians`. Leave
   them empty: the job fills them.
3. **Set two Vercel env vars (production)** to those segment ids: `RESEND_SEGMENT_ID_STUDENTS`,
   `RESEND_SEGMENT_ID_GUARDIANS`. They are ids, not secrets. Until both are set, the job refuses
   to run (`config_missing`, HTTP 500) and changes nothing.
4. **Add `contact.updated` to the existing Resend webhook** (`https://lyceon.ai/api/webhooks/resend`,
   already subscribed to `email.delivered`, `email.bounced`, `email.complained`, `email.failed`).
   The signing secret does not change.
5. **Deploy.** The cron `/api/internal/marketing-email-reconcile` runs daily at 07:45 UTC
   (`vercel.json`). It can also be triggered by hand with the cron secret.

## 2. The first run retires the 72 launch contacts

The 72 contacts imported by CSV on 2026-10-07 for the one-time "Lyceon is now live" notice
(segments `General`, `Launch — friends & family`, `Launch — all account holders (batch 2)`) are
not marketing opt-ins. The first run handles them in the order the owner set:

1. **Unsubscribes come back first.** Every contact marked unsubscribed whose address matches a
   Lyceon account is reported to `apply_marketing_email_optout`: if that person is opted in,
   they are opted out (consent-log source `email_unsubscribe`). If that call fails, the contact
   is kept for the next run, never deleted with its choice still on it.
2. **Then deletion.** Every contact that is not backed by an eligible, opted-in account is
   deleted. Anyone who is opted in is (re)created in their synced segment.
3. **Then the three legacy segments are empty.** The job reports them every day as
   `foreign_segment_present` (error level) until they are gone. **Delete them in the Resend
   dashboard** once the first run has finished and they show 0 contacts.

Complaints on the launch broadcasts: none. The complained count was checked on 2026-10-08 and
was 0, so there is nothing to backfill with source `email_complaint`.

## 3. What the daily run does

Reads first: the audience, Lyceon's contact records, the segments and every contact. **If any
read fails, it writes nothing** and answers 500. Then, in this order: bring unsubscribes back →
delete → create → record. Writes are spaced 150 ms apart (Resend allows 10 requests a second per
team, shared with product email) and capped at 500 per run; anything left over is done the next
day. A second run over a correct state does nothing.

| Change in Lyceon | Reaches Resend |
|---|---|
| Opt-in (signup checkbox or Settings) | next daily run: contact created in the person's segment |
| Opt-out in Settings | next daily run: contact deleted |
| Deletion requested | next daily run: contact deleted (marketing stops at the request) |
| Deletion executed (T+7) | immediately, by the deletion job; the daily run catches any failure |
| Role changes | next daily run: contact re-created in the other segment |

| Change in Resend | Reaches Lyceon |
|---|---|
| Recipient clicks Unsubscribe | immediately (webhook `contact.updated`): opt-in off, log `email_unsubscribe` |
| Recipient marks an email as spam | immediately (webhook `email.complained`): opt-in off, log `email_complaint` |

## 4. The broadcast rule

**Marketing broadcasts target only `Marketing — students` or `Marketing — guardians`.** Never a
hand-built segment, never an imported list, never "all contacts". Resend cannot enforce this on a
broadcast, so it is held two ways: this rule (also guardrail 9 of the AI CMO skill,
`.claude/skills/ai-cmo/SKILL.md`), and the daily run, which deletes every contact not
backed by an eligible account (an imported list empties itself) and reports any other segment.

A one-off account notice that is not marketing (like the launch notice) is a transactional
message, not a broadcast to these segments. Raise it with Claude so it goes through the product
email lane.

## 5. Checking it in production (owner-run SQL, read-only)

```sql
-- How many people should be in each segment right now
SELECT segment, count(*) FROM public.marketing_email_audience() GROUP BY segment;

-- How many contacts Lyceon has recorded per segment (should match the line above after a run)
SELECT segment, count(*) FROM public.marketing_email_contacts GROUP BY segment;

-- Opt-outs that came back from Resend in the last 7 days, by source
SELECT source, count(*) FROM public.marketing_consent_log
 WHERE source IN ('email_unsubscribe', 'email_complaint')
   AND captured_at > now() - interval '7 days'
 GROUP BY source;

-- Back-sync outcomes in the last 7 days
SELECT event_type, outcome, count(*) FROM public.marketing_email_webhook_events
 WHERE received_at > now() - interval '7 days'
 GROUP BY event_type, outcome;
```

Compare the first two with the segment counts in the Resend dashboard. Claude can read the Resend
side (segment names and contact counts only) once the deploy is done.
