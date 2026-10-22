# Lifecycle emails (Resend Automations)

Owner brief "Lifecycle emails: reminder timing fix + behaviour triggers" (Karl, 2026-10-21);
contracts/notifications.contract.md §14A (C14A.4, C14A.5); SCL-239, SCL-240.

These are **study nudges, not marketing** (Karl, 2026-10-15). Lyceon decides **who** and **when**
(two fixed UTC send slots: 22:00 UTC Monday–Friday and 15:00 UTC Saturday–Sunday, run by
`GET /api/internal/lifecycle-email` from the crons `0 22 * * 1-5` and `0 15 * * 0,6`; no time-zone
or DST logic, quiet hours kept as a backstop; Karl's rulings on #1284, 2026-10-21); Resend holds
the **templates**. Lyceon sends one Resend event per email; each event starts its own Automation.
The 14:00 UTC dispatch sweep sends no lifecycle email.

Every trigger counts only situations on or after **2026-10-21 08:00 UTC**
(`lifecycle_reminder_since()` and `lifecycle_triggers_since()`; no cutover to wait for).

| Resend event | Fires when (all once per student, ever; 13+ only; never deleted, deletion-pending or denylisted) | Automation |
|---|---|---|
| `lyceon.onboarded` | first onboarding completion (unchanged) | "Founding cohort welcome": welcome only |
| `lyceon.reminder_due` | onboarded 3–14 days ago, not entitled (PR 1) | "Founding cohort reminder (sent by app)": check `entitled` → the existing founding reminder template |
| `lyceon.diagnostic_unfinished` | started Find your blind spots 48 h–14 days ago, not completed | send |
| `lyceon.pro_no_plan` | entitled 48 h–14 days ago, no study plan | send |
| `lyceon.practising_free` | not entitled, 10th answered item in the last 14 days (QOTD excluded) | check `entitled` ≠ `"true"` → send |

At most **one lifecycle email per student per 3 days**, in the order reminder → diagnostic → Pro →
practising; the rest wait. A trigger the student acts on while it waits is resolved and never
sent. The QOTD daily email is not a lifecycle email and is outside the cap.

## Wiring

**Done (Claude, 2026-10-21): the Resend split.** "Founding cohort welcome" runs on
`lyceon.onboarded` (welcome only); "Founding cohort reminder (sent by app)" runs on
`lyceon.reminder_due` (contact property `entitled` is not `"true"` → the existing reminder
template); the old Automation (welcome + 72 h reminder) is disabled.

**Remaining, after #1284 merges and Karl applies `20261111000000_lifecycle_triggers.sql`
(owner-run):**

1. Claude creates one Automation per behaviour trigger: `lyceon.diagnostic_unfinished` → send;
   `lyceon.pro_no_plan` → send; `lyceon.practising_free` → condition `entitled` is not `"true"` →
   send. Copy below, as approved.
2. **Test each one**: send the event to Karl's test account (Resend → Events, or
   `POST /events/send`), confirm the email arrives with the approved subject, preview, body, button
   and link, and confirm a real run lands at 22:00 UTC on a weekday or 15:00 UTC on a weekend.

Every link carries `utm_source=resend&utm_medium=email&utm_campaign=lifecycle&utm_content=<trigger>`
with `<trigger>` = `reminder`, `diagnostic_unfinished`, `pro_no_plan` or `practising_free`.

Resend Automations do not email an unsubscribed contact; the footer keeps Resend's unsubscribe
link.

## Copy — APPROVED (Karl, 2026-10-21, with edits)

Approved by Karl in "Updates to #1284" (2026-10-21), item 4: the diagnostic email with his edits
to the subject, body and button; the Pro and practising emails with new subjects and the bodies as
drafted. General, encouraging and short. Never "we saw you did X", never a score, prediction or
number from the student's data, nothing about how Lyceon works inside (Public Disclosure Doctrine
§2). Product wording is quoted only from approved claim-inventory rows: **W2** (Pro features) and
**V3** ("Practice every day for free").

### `lyceon.diagnostic_unfinished`

- **Subject:** SAT prep: finish finding your blind spots
- **Preview:** Your blind-spot check is ready when you are.
- **Body:**
  > Hi {{first_name|there}},
  >
  > Great start. Finish Find your blind spots, or do a quick practice set, so you know exactly
  > where to focus.
- **Button:** Keep going → `https://lyceon.ai/practice?utm_source=resend&utm_medium=email&utm_campaign=lifecycle&utm_content=diagnostic_unfinished`

### `lyceon.pro_no_plan`

- **Subject:** SAT plan: one step left
- **Preview:** Your study plan is one step away.
- **Body:**
  > Hi {{first_name|there}},
  >
  > Thanks for joining Lyceon Pro. Your next step: set up a study plan built around your weak
  > areas from your Calendar.
- **Button:** Set up my plan → `https://lyceon.ai/calendar?utm_source=resend&utm_medium=email&utm_campaign=lifecycle&utm_content=pro_no_plan`

### `lyceon.practising_free`

- **Subject:** SAT practice: keep your momentum
- **Preview:** A little practice often adds up.
- **Body:**
  > Hi {{first_name|there}},
  >
  > Great start on your SAT practice. Keep going with free daily practice, and when you want
  > more, Lyceon Pro adds no daily limit on practice, full-length practice tests, a study plan
  > built around your weak areas and an AI tutor for step-by-step help.
- **Button:** See Lyceon Pro → `https://lyceon.ai/upgrade?utm_source=resend&utm_medium=email&utm_campaign=lifecycle&utm_content=practising_free`
