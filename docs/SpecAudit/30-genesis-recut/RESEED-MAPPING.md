# Reseed Mapping — preserved `profiles` → genesis shape (OWNER-RUN; profiles-only)

> Shape-mapping reseed (NOT a verbatim restore) of the preserved **profiles** from the
> owner's out-of-repo `03_preserve_questions_profiles.sql` into the **genesis** `public`
> shape. **Owner-run; no reseed until the dump is loaded into staging and the pre-flight
> gates pass.** Agents never hold `service_role`. Governed by RECUT-CONTRACT §6.
>
> **"Old" schema = the committed capture** `docs/SpecAudit/0000-supabase-live-20260607.csv`
> (blob `5bb0ffe1…`, A2 columns) — authoritative for the dump's `profiles` shape.
> **"New" schema = genesis** `supabase/migrations/00000000000000_genesis.sql`.

## 0. Decision: the 280 preserved `questions` are DISCARDED — bank starts EMPTY by design

Owner ruling (2026-06-09): the preserved `public.questions` are **synthetic test fixtures
with real quality defects**, not a content bank. They are **not reseeded**; genesis
`public.questions` stays **empty**, and the generation + QA pipeline populates it later with
**§14-compliant, promotion-time** canonical ids.

Defects found in content review (beyond the canonical-id format gate):
- **Duplicate answer options** within items (e.g. `SATM1TQPDU1`, `SATMD1AJYK4`, `SATM0CSBDK5`).
- **Unsimplified "garbage" options** on every arc-length item.
- **Same question duplicated up to 5×** (e.g. the ephemera / "John Johnson", "Marta Coll" items).
- **40+ identical template "Solve for x" clones**, all keyed answer-C.
- **Truncated / missing RW passages** (e.g. `SATF1BFBED3`).
- **`section_code = 'MATH'`** (would fail the `{M,RW}` gate) and **`source_type = 1` on SYNTH rows**.

These are recorded for provenance; the questions mapping/transform from the prior draft is
removed. **Reseed scope is PROFILES ONLY.**

---

## 1. Load the dump's profiles into a STAGING schema, and CONFIRM it loaded

Genesis `public.profiles` already exists in the **new** shape, so the dump (old shape) cannot
load into it. Load into a throwaway staging schema first.

```sql
-- 1a. create the staging table (deployed shape; role/enum as TEXT to avoid type coupling)
CREATE SCHEMA IF NOT EXISTS reseed_stage;
CREATE TABLE reseed_stage.profiles_old (
  id uuid, email text, display_name text, role text, is_under_13 boolean,
  guardian_email text, guardian_consent boolean, consent_given_at timestamptz,
  created_at timestamptz, updated_at timestamptz, last_login_at timestamptz,
  overall_level text, primary_style text, secondary_style text, explanation_level integer,
  competency_map jsonb, persona_tags text[], learning_prefs jsonb, guardian_profile_id uuid,
  student_link_code text, stripe_customer_id text, _updated_at timestamptz,
  first_name text, last_name text, phone_number text, date_of_birth date, address jsonb,
  time_zone text, preferred_language text, marketing_opt_in boolean, profile_completed_at timestamptz
);
```

```bash
# 1b. load ONLY the profile rows from the dump into staging (psql; redirect target if needed)
sed -E 's/\bpublic\.profiles\b/reseed_stage.profiles_old/g' 03_preserve_questions_profiles.sql \
  | psql "$DATABASE_URL"
```

```sql
-- 1c. CONFIRM the dump is loaded into reseed_stage BEFORE going further. Expect 62.
SELECT count(*) AS staged_profiles FROM reseed_stage.profiles_old;   -- MUST be 62
```
**Do not proceed to the gates/transform until 1c returns 62.**

---

## 2. `profiles` column mapping (old 31 → genesis)

Key on `id`. Genesis target columns: `id, email, full_name, display_name, role,
date_of_birth, age_years*, is_under_13*, country_code, stripe_customer_id, guardian_email,
guardian_consent, consent_given_at, guardian_profile_id, last_login_at, deleted_at,
created_at, updated_at`. `*age_years/is_under_13` are **trigger-derived**
(`set_profile_age_fields`) — **do NOT insert them**.

| # | old column | → genesis | rule |
|---|---|---|---|
| 1 | `id` | `id` | key; must ∈ `auth.users` (GATE-ID) |
| 2 | `email` | `email` | direct |
| 3 | `display_name` | `display_name` | direct |
| 4 | `role` | `role` | `role::public.profile_role` (deployed `{student,guardian,admin}` ⊆ genesis) |
| 5 | `is_under_13` | — | **DROP** (genesis derives it at write from `date_of_birth`) |
| 6 | `guardian_email` | `guardian_email` | direct |
| 7 | `guardian_consent` | `guardian_consent` | direct |
| 8 | `consent_given_at` | `consent_given_at` | direct |
| 9 | `created_at` | `created_at` | direct |
| 10 | `updated_at` | `updated_at` | direct |
| 11 | `last_login_at` | `last_login_at` | direct |
| 23 | `first_name` | `full_name` | `full_name = NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), '')` |
| 24 | `last_name` | `full_name` | (combined above) |
| 26 | `date_of_birth` | `date_of_birth` | direct → drives the age trigger |
| 19 | `guardian_profile_id` | `guardian_profile_id` | **two-step** (§4): insert NULL, then set where the target id is also reseeded (self-FK `ON DELETE SET NULL`) |
| 21 | `stripe_customer_id` | `stripe_customer_id` | direct (UNIQUE in genesis — GATE-P2) |
| — | — | `country_code` | **NULL** (deployed has only `address` jsonb #27; backfill later from billing) |
| — | — | `deleted_at` | **NULL** (test accounts are active) |

**Dropped old columns (not in genesis Doc 01 V8 §4 — learning-state / profile-extras owned by later waves):**
`overall_level`(12), `primary_style`(13), `secondary_style`(14), `explanation_level`(15),
`competency_map`(16), `persona_tags`(17), `learning_prefs`(18), `student_link_code`(20),
`_updated_at`(22, duplicate-artifact), `phone_number`(25), `address`(27), `time_zone`(28),
`preferred_language`(29), `marketing_opt_in`(30), `profile_completed_at`(31).

**`is_under_13` null-safety (verified 2026-06-09).** The `set_profile_age_fields` trigger
branches on `date_of_birth IS NULL` **before** any `age()` math, so a NULL DOB →
`age_years`/`is_under_13` = **NULL** (never `true`, never an error). Proven on a reseed-style
batch insert: a NULL-DOB row alongside dated rows committed without aborting (`nodob`→NULL,
`kid`→11/true, `adult`→36/false). So dropping `is_under_13` from the INSERT is safe, and a
DOB-less test account neither gets gated nor kills the batch. **Downstream gating semantics
(later waves, COPPA): a NULL `is_under_13` means age-unknown and MUST NOT be treated as
under-13 — a DOB-less account is not gated** (owner ruling 2026-06-09; production signup
enforces a DOB, so NULL is a test-data artifact).

---

## 3. PRE-FLIGHT GATES (run after §1c = 62; **HALT on any failure — do not reseed**)

```sql
-- GATE-ID: every reseeded profile id must exist in auth.users (FK RESTRICT). Expect 0.
SELECT count(*) AS orphan_profiles
FROM reseed_stage.profiles_old p
LEFT JOIN auth.users u ON u.id = p.id
WHERE u.id IS NULL;                          -- MUST be 0  (62 dump ids ⊆ 114 auth.users)

-- GATE-P1: genesis UNIQUE(lower(email)) WHERE deleted_at IS NULL — no case-insensitive dups.
SELECT lower(email) AS email, count(*) FROM reseed_stage.profiles_old
GROUP BY lower(email) HAVING count(*) > 1;    -- MUST return no rows

-- GATE-P2: genesis stripe_customer_id is UNIQUE — no non-null dups.
SELECT stripe_customer_id, count(*) FROM reseed_stage.profiles_old
WHERE stripe_customer_id IS NOT NULL GROUP BY stripe_customer_id HAVING count(*) > 1; -- no rows
```
> Resolve any non-zero/returned-rows result before reseeding; do not fabricate or coalesce
> away a constraint violation.

---

## 4. Reseed transform (run ONLY after §3 gates pass)

```sql
BEGIN;

-- profiles: insert with guardian_profile_id NULL first (self-FK safety), then backfill.
INSERT INTO public.profiles
  (id, email, full_name, display_name, role, date_of_birth, country_code,
   stripe_customer_id, guardian_email, guardian_consent, consent_given_at,
   guardian_profile_id, last_login_at, deleted_at, created_at, updated_at)
SELECT
  p.id, p.email,
  NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''),
  p.display_name,
  p.role::public.profile_role,
  p.date_of_birth,
  NULL,                                   -- country_code (backfill later)
  p.stripe_customer_id, p.guardian_email, p.guardian_consent, p.consent_given_at,
  NULL,                                   -- guardian_profile_id (step 2)
  p.last_login_at, NULL,                  -- deleted_at
  p.created_at, p.updated_at
FROM reseed_stage.profiles_old p;
-- (age_years / is_under_13 are set by the profiles_set_age trigger from date_of_birth.)

-- step 2: backfill guardian_profile_id only where the target is also a reseeded profile.
UPDATE public.profiles g
SET guardian_profile_id = s.guardian_profile_id
FROM reseed_stage.profiles_old s
WHERE g.id = s.id
  AND s.guardian_profile_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.profiles t WHERE t.id = s.guardian_profile_id);

COMMIT;
```

---

## 5. Exit proof (RECUT-CONTRACT §9) + cleanup

```sql
-- counts: 62 profiles reseeded; questions EMPTY by design (§0).
SELECT (SELECT count(*) FROM public.profiles)  AS profiles,    -- expect 62
       (SELECT count(*) FROM public.questions) AS questions;   -- expect 0 (empty by design)

-- FK-intact: zero profiles orphaned from auth.users.
SELECT count(*) FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.id WHERE u.id IS NULL; -- 0

-- (questions anti-leak posture still holds even empty: anon/authenticated have no grant.)
DROP SCHEMA reseed_stage CASCADE;   -- cleanup
```

Embed the §1c/gate/exit outputs in the closure record. After exit proof passes
(**62 profiles, FK-intact, questions = 0 by design**), WS-1 is fully closed: genesis applied,
profiles reseeded, questions intentionally empty pending the generation+QA pipeline.
