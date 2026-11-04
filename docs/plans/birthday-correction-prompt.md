# Correcting the birthdays that saved the current year

**Owner brief:** Karl, 2026-11-04 — "don't edit data. Give me a read-only list of profiles whose
`date_of_birth` is in the current year or the future, plus a proposal for prompting those users to
correct it on their next login", and "the one-time correction (in-app prompt plus a drafted, unsent
email)".

**Status:** proposal + draft email. **Nothing here has been run, sent, or built.** No data has been
edited and no query has been run against production from this session (CLAUDE.md: "Owner-run
against production: never query or write production yourself. State what you would run and hand it
over.").

---

## 1. The read-only list — for you to run

Read-only. Returns one row per affected profile, newest sign-up first.

```sql
-- Profiles whose stored date of birth is in the CURRENT YEAR or the FUTURE.
-- Read-only: no writes, no locks beyond a plain SELECT.
SELECT
  p.id,
  p.email,
  p.role,
  p.date_of_birth,
  p.is_under_13,
  p.profile_completed_at,
  p.created_at,
  -- Which repair path this row needs (see §2).
  CASE
    WHEN p.profile_completed_at IS NULL THEN 'self-serve: not yet completed, the student can still edit'
    ELSE 'LOCKED: profiles_lock_date_of_birth refuses any change'
  END AS repair_path,
  (p.date_of_birth > CURRENT_DATE) AS in_the_future,
  date_part('year', age(CURRENT_DATE, p.date_of_birth)) AS stored_age_years
FROM public.profiles p
WHERE p.deleted_at IS NULL
  AND p.date_of_birth IS NOT NULL
  AND p.date_of_birth >= date_trunc('year', CURRENT_DATE)::date
ORDER BY p.created_at DESC;
```

A wider sweep, if you want everything the new 5-year floor would now refuse rather than only the
current year — same shape, one predicate changed:

```sql
-- Anything the new floor would refuse: less than 5 years ago, or in the future.
SELECT p.id, p.email, p.role, p.date_of_birth, p.profile_completed_at, p.created_at
FROM public.profiles p
WHERE p.deleted_at IS NULL
  AND p.date_of_birth IS NOT NULL
  AND p.date_of_birth > (CURRENT_DATE - INTERVAL '5 years')::date
ORDER BY p.date_of_birth DESC;
```

The four rows you already named, for cross-checking the output:

| email | stored `date_of_birth` | note |
|---|---|---|
| `berylandkarl@gmail.com` | 2026-04-04 | your test account; 2006 was entered |
| `z3k3.008@gmail.com` | 2026-04-03 | |
| `dixitastha02@gmail.com` | 2026-11-04 | exactly its sign-up date |
| `tolembeknuradil@gmail.com` | 2026-06-19 | |

All four are **students**. That follows from the code rather than from a query: `guardianAgeRefusal`
requires 18+, so a guardian could never have stored an age-0 date through either write path.

---

## 2. The blocker you need to rule on first

**A prompt alone cannot fix these rows.** The date of birth is locked after profile completion, in
two places:

- the route (`server/routes/profile-routes.ts`, G2-03) refuses a changed date with
  `409 DATE_OF_BIRTH_LOCKED`; and
- the database trigger `public.profiles_lock_date_of_birth` raises `LY007` on any change to a
  non-null date once `profile_completed_at` is set. Its only two exemptions are the one-time fill
  from `NULL` and account deletion.

So for any of the four whose profile is complete, there is **no path today** by which the student
can correct their own birthday, however we prompt them. That is a deliberate guardrail — the
under-13 gate derives from this column — and widening it is a decision, not an implementation
detail.

Three options, with what each costs:

| Option | What it is | For | Against |
|---|---|---|---|
| **A. One-time self-correction window** | Allow exactly one change, only when the stored date is one the new rules would refuse, only for the account's owner, recorded in an audit row | The student fixes their own data; no admin handling; it closes itself | A new exemption in the trigger and the route — the thing the lock exists to prevent. Needs a migration and its own gate |
| **B. Support-mediated correction** | The prompt asks the student to reply with their real birthday; you correct it out of band | No change to the lock at all; four rows is a tractable number | Manual, and it puts a date of birth into an email thread. Does not scale if the list grows |
| **C. Clear to NULL, then re-fill** | An admin sets `date_of_birth = NULL`; the existing one-time-fill path (exemption (a)) then lets the student enter it once | Reuses a path that already exists and is already tested | Still an admin write per row; and between the clear and the re-fill `is_under_13` is unknown, so the student is gated until they re-enter |

**My recommendation: C for these four, A only if the list grows.** C needs no new exemption — it
rides exemption (a), which is already in the trigger and already covered by
`tests/ci/date-of-birth-lock.pg.ci.test.ts` — and it leaves the lock exactly as strict as it is
today. With four rows the admin cost is trivial. A is the right shape if this ever becomes dozens,
but it means loosening the one guardrail under the under-13 gate, which is not worth doing for four
rows.

I have not built any of the three. Say which and I will.

---

## 3. The in-app prompt (proposed)

**Trigger.** On next login, for an account whose `date_of_birth` is one the current rules would
refuse. Server-derived, never client-decided: the existing `GET /api/profile` hydration already
returns `dateOfBirth`, so the flag is a derived boolean on that payload
(`dateOfBirthNeedsCorrection`) computed with the same `dateOfBirthRefusal` the write path uses. No
new endpoint, no new client rule, and it cannot drift from the server's idea of "wrong".

**Shape.** A dismissible `Notice` on the dashboard, not a blocking modal. These students are using
the product; their birthday being wrong does not make the session unsafe, and a hard block on
first login reads as a lockout. One exception: if the stored date makes them *appear* under 13 when
they are not, they are already gated by the link rule, so for them the notice is the explanation of
a block they can already see.

**Copy** (plain, no mechanism disclosed — Public Disclosure Doctrine §2):

> **Check your date of birth**
> Your date of birth is saved as 4 April 2026, which doesn't look right. It affects which features
> you can use. [Fix it] [Not now]

**What [Fix it] does** depends on §2. Under C it opens the three-field input in the one-time-fill
state. Under B it opens a prefilled support mail. Under A it opens the same three-field component in
a one-time-correction state.

**Cadence.** Once per login, at most once a day, suppressed for 30 days after a dismissal, and gone
for good once the date passes the rules. Reuses the notice-cadence pattern the review ask already
has (`product_review_prompt_state`) rather than inventing a second one.

**What it must not do:** pre-fill a guess. The whole defect was a value nobody typed.

---

## 4. The drafted email — NOT SENT

Drafted only. It is not in Resend, there is no broadcast, no contact list, and nothing is scheduled.
Under-13 users are excluded from all email (CLAUDE.md, Public Disclosure Doctrine §7) — check the
list against `is_under_13` before anything is sent, which matters here precisely because a
current-year birthday makes `is_under_13` true for all four.

**Subject:** Quick check on your Lyceon account

> Hi {{first_name}},
>
> We found a problem with how our sign-up form saved dates of birth, and your account is one of a
> small number affected. Your date of birth is currently saved as **{{stored_date}}**, which we
> don't think is what you entered.
>
> We've fixed the form so it can't happen again. To correct your own details, {{correction_call_to_action}}.
>
> Your date of birth affects which parts of Lyceon you can use, so it's worth getting right. Nothing
> else about your account was affected, and you don't need to do anything else.
>
> Sorry for the inconvenience.
>
> — The Lyceon team

`{{correction_call_to_action}}` is the one line that depends on your §2 ruling:

- **A/C:** "sign in and use the prompt at the top of your dashboard"
- **B:** "reply to this email with your date of birth and we'll correct it for you"

Notes on the copy, against the doctrine: it states a fact about our own product (§1 industry
standard, §2 nothing proprietary — no mention of iOS, wheels, or validation rules), makes no
outcome claim, and names no mechanism. It needs your written approval before sending (§5), and for
a guardian-linked under-13 student the guardian is the correct recipient, not the student.

---

## 5. What was changed in code, for context

Nothing in this document. The PR this ships with changes only the input and its validation:

- `<input type="date">` → three fields (Month dropdown, Day, Year), nothing pre-filled;
- the same rules on the client and the server, from one shared function;
- a 5-year plausibility floor on the server, which is what makes a current-year birthday
  impossible to store going forward.

Existing rows are untouched, by your instruction.
