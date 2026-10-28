# Runbook: smart landing and the sign-up channel

> @spec [owner brief "Smart landing: within-student rotating landing test" (Karl, 2026-10-26) and its
> > rulings; owner brief "Smart landing: new students land on Home; capture sign-up channel" (Karl,
> > 2026-10-28)] | @implemented [2026-10-28]

## 1. Who is in the test

The rotation (one landing per 48-hour window, drawn per student) applies to a student who meets
all of these:

- is a student aged 13 or over;
- has the kill switch on (`landing_rotation_enabled`);
- **has reached their first QOTD day after the day they onboarded** (Karl, 2026-10-28).

Until that QOTD day starts, a new student always lands on Home, which shows the Getting Started
checklist. The server asks `landing_rotation_open(profile, now)` before anything else, so that
period writes no `landing_windows` row, no `landing_shows` row and no landing event.

The QOTD day is `qotd_day()`, the same rule everywhere: the America/Chicago date before its
cutover, then 04:00 UTC to 04:00 UTC.

## 2. How to analyse it: within-student, returning visits only

- **Compare each student with themselves.** Compare a student's outcomes under one arm with the
  same student's outcomes under another, never one group of students against another group.
- **Use returning visits only.** From 2026-10-28 every `landing_shows` row is one: the onboarding
  day can no longer produce a show.
- **Rows before 2026-10-28 need a filter.** Rows from 2026-10-26 to 2026-10-28 were written before
  the gate existed, so drop any show on or before the student's onboarding QOTD day. The queries
  below do this for every row.
- **Only students who saw at least two arms tell you anything.** A student who saw one arm cannot
  be compared with themselves.

Read-only queries, run by the owner (Claude never queries production).

**Shows per arm, returning visits only:**

```sql
SELECT s.arm,
       count(*)                                   AS shows,
       count(*) FILTER (WHERE s.fallback_reason IS NOT NULL) AS fell_back,
       count(*) FILTER (WHERE s.escaped_at IS NOT NULL)      AS escaped_home
  FROM public.landing_shows s
  JOIN public.profiles p ON p.id = s.profile_id
 WHERE p.profile_completed_at IS NOT NULL
   AND public.qotd_day(s.shown_at) > public.qotd_day(p.profile_completed_at)
 GROUP BY s.arm
 ORDER BY s.arm;
```

**Within-student: escape rate per arm, for students who saw two arms or more:**

```sql
WITH returning AS (
  SELECT s.*
    FROM public.landing_shows s
    JOIN public.profiles p ON p.id = s.profile_id
   WHERE p.profile_completed_at IS NOT NULL
     AND public.qotd_day(s.shown_at) > public.qotd_day(p.profile_completed_at)
     AND s.fallback_reason IS NULL
),
compared AS (
  SELECT profile_id FROM returning GROUP BY profile_id HAVING count(DISTINCT arm) >= 2
)
SELECT r.arm,
       count(DISTINCT r.profile_id) AS students,
       count(*)                     AS shows,
       round(avg((r.escaped_at IS NOT NULL)::int)::numeric, 3) AS escape_rate
  FROM returning r JOIN compared c USING (profile_id)
 GROUP BY r.arm
 ORDER BY r.arm;
```

The answers after a landing are reported in the nightly `landing_session_summary` event (PostHog).
Filter that event the same way: keep a student's events only from their first QOTD day after
onboarding.

## 3. The sign-up channel

- **What's stored.** `profiles.signup_channel` holds one of `reddit`, `tiktok`, `instagram`,
  `facebook`, `email`, `direct`, `other`. `profiles.signup_campaign` holds a name on the allowlist
  in `packages/shared/src/signup-attribution.ts` (`SIGNUP_CAMPAIGNS`), or null.
- **Where it comes from.** The first touch, taken from the landing URL's UTM.
- **When it's written.** By the server, once, before onboarding.
- **Under 13.** An under-13 profile never holds either value; the database clears them when the age
  is known.
- **No cookie or storage.** The browser keeps the value in memory and carries it on the link into
  sign-up as `?signup_channel=…&signup_campaign=…`. It needs no consent and no analytics cookie.

**Tagging a link:** use `utm_source` (for example `reddit`, `tiktok`, `ig`, `fb`, `newsletter`) and,
for a campaign, `utm_campaign`:

```
https://lyceon.ai/?utm_source=reddit&utm_campaign=dec_cohort
```

- **Adding a campaign.** A campaign name not on the list is stored as no campaign. To add one, add
  it to `SIGNUP_CAMPAIGNS` (lowercase letters, digits and `_`, at most 40 characters). The
  database only checks the shape, so no migration is needed.
- **Known limit.** A visitor who leaves and comes back later by typing the address arrives as
  `direct`. Nothing is stored on the device to remember the first visit.

**Sign-ups per channel and campaign (aggregate only; under-13 profiles hold neither value):**

```sql
SELECT coalesce(signup_channel, '(not recorded)') AS channel,
       coalesce(signup_campaign, '-')             AS campaign,
       count(*)                                   AS accounts
  FROM public.profiles
 WHERE role = 'student' AND created_at >= '2026-10-28'
 GROUP BY 1, 2
 ORDER BY 3 DESC;
```

## 4. Owner steps

1. Apply `supabase/migrations/20261121000000_landing_new_students_signup_channel.sql`. Either
   deploy order is safe:
   - **Code first:** the landing's rotation read fails until the function exists, and the route's
     fail-safe answers Home.
   - **Migration first:** nothing uses the new objects yet.
2. Confirm it is live (read-only):
   ```sql
   SELECT public.landing_rotation_open(gen_random_uuid(), now());  -- false (no such profile)
   SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name IN ('signup_channel', 'signup_campaign');   -- 2
   ```
