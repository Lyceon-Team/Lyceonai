# Lifecycle emails (Resend Automations)

Owner brief "Lifecycle emails: reminder timing fix + behaviour triggers" (Karl, 2026-10-21);
contracts/notifications.contract.md §14A (C14A.4, C14A.5); SCL-239, SCL-240.

These are **study nudges, not marketing** (Karl, 2026-10-15). Lyceon decides **who** and **when**
(the 14:00 UTC morning sweep, 08:00–09:00 Chicago, outside quiet hours); Resend holds the
**templates**. Lyceon sends one Resend event per email; each event starts its own Automation.

| Resend event | Fires when (all once per student, ever; 13+ only; never deleted, deletion-pending or denylisted) | Automation |
|---|---|---|
| `lyceon.onboarded` | first onboarding completion (unchanged) | welcome only (the reminder step is removed at the PR 1 cutover) |
| `lyceon.reminder_due` | onboarded 3–14 days ago, not entitled (PR 1) | check `entitled` → the existing founding reminder template |
| `lyceon.diagnostic_unfinished` | started Find your blind spots 48 h–14 days ago, not completed | send |
| `lyceon.pro_no_plan` | entitled 48 h–14 days ago, no study plan | send |
| `lyceon.practising_free` | not entitled, 10th answered item in the last 14 days (QOTD excluded) | check `entitled` ≠ `"true"` → send |

At most **one lifecycle email per student per 3 days**, in the order reminder → diagnostic → Pro →
practising; the rest wait. A trigger the student acts on while it waits is resolved and never
sent. The QOTD daily email is not a lifecycle email and is outside the cap.

## Wiring (Claude, when each PR is live)

1. **PR 1 (`lyceon.reminder_due`), at 2026-10-23 14:00 UTC** (`lifecycle_reminder_since()`):
   in the existing Automation on `lyceon.onboarded`, remove the 72 h delay + reminder step (keep
   the welcome). First check in Resend whether removing a step stops runs already waiting on it;
   if it does, students onboarded in the 72 h before the cutover would get no reminder, so tell
   Karl before removing it. Create a new Automation: trigger `lyceon.reminder_due` → condition
   contact property `entitled` is not `"true"` → send the existing reminder template.
2. **PR 2, at 2026-10-27 14:00 UTC** (`lifecycle_triggers_since()`): one Automation per event
   above, trigger → send, with the copy below once Karl approves it.
3. **Test**: send each event to Karl's test account (Resend → Events, or `POST /events/send`),
   confirm the email arrives, and confirm a real run lands inside 08:00–21:00 Chicago.

Every link carries `utm_source=resend&utm_medium=email&utm_campaign=lifecycle&utm_content=<trigger>`
with `<trigger>` = `reminder`, `diagnostic_unfinished`, `pro_no_plan` or `practising_free`.

Resend Automations do not email an unsubscribed contact; the footer keeps Resend's unsubscribe
link.

## Copy drafts — FOR KARL'S APPROVAL (not live)

General, encouraging and short. Never "we saw you did X", never a score, prediction or number
from the student's data, nothing about how Lyceon works inside (Public Disclosure Doctrine §2).
Pro features are quoted only from approved claim-inventory row **W2**.

### `lyceon.diagnostic_unfinished`

- **Subject:** Find out where to focus first
- **Preview:** Your blind-spot check is ready when you are.
- **Body:**
  > Hi {{first_name|there}},
  >
  > Great start with Lyceon. Find your blind spots shows which SAT skills to focus on first, so
  > your practice goes where it helps most. You can finish it any time from Home.
- **Button:** Open Lyceon → `https://lyceon.ai/?utm_source=resend&utm_medium=email&utm_campaign=lifecycle&utm_content=diagnostic_unfinished`

### `lyceon.pro_no_plan`

- **Subject:** Set up your study plan
- **Preview:** It takes a couple of minutes.
- **Body:**
  > Hi {{first_name|there}},
  >
  > Thanks for joining Lyceon Pro. A study plan built around your weak areas spreads your
  > practice across the days you choose, up to your test date. Setting it up takes a couple of
  > minutes.
- **Button:** Set up my plan → `https://lyceon.ai/calendar?utm_source=resend&utm_medium=email&utm_campaign=lifecycle&utm_content=pro_no_plan`

### `lyceon.practising_free`

- **Subject:** Great start on your SAT practice
- **Preview:** A little practice often adds up.
- **Body:**
  > Hi {{first_name|there}},
  >
  > Great start on your SAT practice. Keep going with free daily practice, and when you want
  > more, Lyceon Pro adds no daily limit on practice, full-length practice tests, a study plan
  > built around your weak areas and an AI tutor for step-by-step help.
- **Button:** See Lyceon Pro → `https://lyceon.ai/upgrade?utm_source=resend&utm_medium=email&utm_campaign=lifecycle&utm_content=practising_free`

Open points for Karl: "a couple of minutes" (plan setup) is a timing claim; drop it if not
wanted. "Keep going with free daily practice" leans on approved V3 ("Practice every day for
free"). The Pro link goes to `/upgrade`, the in-app plans page.
