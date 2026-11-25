# Billing lapse — runbook

@spec [Doc 01 §21, §22.1, §23; owner brief "Founding lapse flow" (Karl, 2026-11-24) rulings 1-8; SCL-289] | @implemented [2026-11-24]

What it does: warns a member with no card before their first charge, gives a failed renewal a fixed 7-day grace, and cancels the subscription when that grace ends unpaid. The account, progress and free-tier access always stay.

## The three emails

Lyceon sends Resend Automation events; Resend holds the templates (the growth session writes them). All three are billing emails: always sent, never held by the email send gate, from `send.lyceon.ai`. They go to the payer: the student when they pay themselves, the guardian when a guardian pays. An under-13 payer gets none (they are never a Resend contact).

| Event | When | Payload (all strings) |
|---|---|---|
| `lyceon.billing_card_needed` | Daily job: a renewing subscription with no default payment method and a next invoice over $0, in the 14 / 7 / 2-day bands (8-14, 3-7, 1-2 days left) | `days_left`, `invoice_date` (YYYY-MM-DD), `amount` (e.g. `$59.99`, Stripe's upcoming-invoice preview), `currency`, `add_card_url` |
| `lyceon.billing_payment_failed` | Webhook `invoice.payment_failed`, attempts 1, 2 and 3 | `attempt`, `grace_ends_on` (YYYY-MM-DD), `amount`, `currency`, `add_card_url`, `invoice_url` (Stripe's hosted invoice page, or empty) |
| `lyceon.billing_access_ended` | Daily job cancels at the deadline, or Stripe cancels for non-payment. Never on a self-cancel | `ended_on` (YYYY-MM-DD), `reason` (`payment_failed`) |

`add_card_url` is `/profile?tab=billing` for a student and `/guardian/students` for a guardian, on `PUBLIC_SITE_URL`: signed-in pages whose "Manage billing" opens the Stripe portal, where a card is added. A signed-out click returns there after sign-in.

Each email is sent once per subscription and milestone (`billing_lapse_notices`). A send Resend refuses is released and retried on the next run or the next webhook delivery.

## The deadline

- `entitlements.grace_period_ends_at` is the deadline. `entitlement_active` counts `past_due` only until it.
- The first `invoice.payment_failed` sets it to now + 7 days, only when it is empty. Later attempts keep it.
- `invoice.payment_succeeded`, and the subscription being written as `active` or `trialing`, clear it.
- A `past_due` row with no deadline keeps Pro until the daily job sets it to the earliest unpaid invoice + 7 days.
- The deadline is authoritative: when it passes, Pro ends at that moment whatever Stripe's retries are doing, and the next daily run cancels the subscription in Stripe.

## Daily job

`GET /api/internal/billing-lapse`, Vercel cron `30 20 * * *` (after the 20:00 renewal job, so a subscription it set to cancel at period end the same day is skipped). CRON_SECRET-gated. The JSON summary:

```json
{ "ok": true, "job": "billing_lapse", "summary": {
  "cardNeeded": { "considered": 0, "sent": 0, "alreadySent": 0, "hasCard": 0, "cancelAtPeriodEnd": 0,
                  "zeroAmount": 0, "notInBand": 0, "skippedUnder13": 0, "skippedOther": 0, "failed": 0 },
  "graceBackfilled": 0, "deadlineCancelled": 0,
  "accessEnded": { "sent": 0, "skippedUnder13": 0, "failed": 0 }, "errors": 0 } }
```

A 500 means at least one subscription failed (counted in `errors` or `failed`); the others still ran. Logs: `BILLING_LAPSE job_done`, with digested subscription ids only.

## Checks (owner-run, production, read-only)

```sql
-- the predicate is live
SELECT md5(prosrc) FROM pg_proc WHERE proname = 'entitlement_active';
-- members past due and their deadlines
SELECT status, grace_period_ends_at IS NULL AS undated, count(*)
  FROM public.entitlements WHERE status = 'past_due' GROUP BY 1, 2;
-- emails recorded, by kind
SELECT notice, count(*) FILTER (WHERE sent_at IS NOT NULL) AS sent,
       count(*) FILTER (WHERE sent_at IS NULL) AS held
  FROM public.billing_lapse_notices GROUP BY 1 ORDER BY 1;
-- under-13 payers who will get no email (self-paying students under 13 with a live subscription)
SELECT count(*) FROM public.entitlements e JOIN public.profiles p ON p.id = e.profile_id
 WHERE e.payer_profile_id IS NULL AND e.status IN ('active', 'trialing', 'past_due')
   AND e.stripe_subscription_id IS NOT NULL
   AND (p.date_of_birth IS NULL OR p.date_of_birth > (current_date - interval '13 years'));
```

## Stripe settings (Karl, in the dashboard)

Not set by code. For the emails to line up with Doc 01 §23 (day 0, 3, 6, then the day-8 access-ended email), set the subscription retry schedule to 3 attempts within 7 days (for example days 3 and 6 after the first), and what happens after the last retry (cancel is consistent with the ruling; our deadline cancels at day 7 either way).
