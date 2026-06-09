# Reseed Mapping — preserved `profiles` + `questions` → genesis shape (OWNER-RUN)

> Shape-mapping reseed (NOT a verbatim restore) of the two preserved tables from the
> owner's out-of-repo `03_preserve_questions_profiles.sql` into the **genesis** `public`
> shape. **Owner-run; no reseed until this mapping is reviewed and the pre-flight gates
> pass.** Agents never hold `service_role`. Governed by RECUT-CONTRACT §6.
>
> **"Old" schema = the committed capture** `docs/SpecAudit/0000-supabase-live-20260607.csv`
> (blob `5bb0ffe1…`, A2 columns) — the dump was taken from that live DB, so its columns
> are authoritative. **"New" schema = genesis** `supabase/migrations/00000000000000_genesis.sql`.

## 0. Load mechanism (dump → a STAGING schema, NOT the genesis tables)

The genesis `public.profiles`/`public.questions` already exist in the **new** shape, so the
dump (old shape) **cannot** load into them. Load it into a throwaway staging schema, then
run the transform (§4). Recommended: **`psql`** (the dump + jsonb is larger than the web
editor's paste comfort); the transform itself is small enough to paste into the Supabase
SQL editor.

```bash
# 1) create the staging tables (DDL in §3) — run §3 first, in the SQL editor or psql.
# 2) load ONLY the row data from the dump into staging. If 03_preserve… INSERTs target
#    public.profiles/public.questions, redirect them to staging:
sed -E 's/\bpublic\.profiles\b/reseed_stage.profiles_old/g; s/\bpublic\.questions\b/reseed_stage.questions_old/g' \
    03_preserve_questions_profiles.sql | psql "$DATABASE_URL"
# (If the dump already uses its own staging table names, point §4's FROM at those instead.)
```

---

## 1. `profiles` column mapping (old 31 → genesis)

Key on `id`. Genesis target columns: `id, email, full_name, display_name, role,
date_of_birth, age_years*, is_under_13*, country_code, stripe_customer_id, guardian_email,
guardian_consent, consent_given_at, guardian_profile_id, last_login_at, deleted_at,
created_at, updated_at`. `*age_years/is_under_13` are **trigger-derived** (`set_profile_age_fields`) — **do NOT insert them**.

| # | old column | → genesis | rule |
|---|---|---|---|
| 1 | `id` | `id` | key; must ∈ `auth.users` (pre-flight §2) |
| 2 | `email` | `email` | direct |
| 3 | `display_name` | `display_name` | direct |
| 4 | `role` | `role` | `role::public.profile_role` (deployed enum `{student,guardian,admin}` ⊆ genesis `{…,tutor,teacher}`) |
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
| 21 | `stripe_customer_id` | `stripe_customer_id` | direct (UNIQUE in genesis — pre-flight should confirm no dup) |
| — | — | `country_code` | **NULL** (deployed has only `address` jsonb #27; backfill later from billing — Doc 01 V8 §4) |
| — | — | `deleted_at` | **NULL** (test accounts are active) |

**Dropped old columns (not in genesis Doc 01 V8 §4 — learning-state / profile-extras owned by later waves):**
`overall_level`(12), `primary_style`(13), `secondary_style`(14), `explanation_level`(15),
`competency_map`(16), `persona_tags`(17), `learning_prefs`(18), `student_link_code`(20),
`_updated_at`(22, duplicate-artifact), `phone_number`(25), `address`(27), `time_zone`(28),
`preferred_language`(29), `marketing_opt_in`(30), `profile_completed_at`(31).

---

## 2. `questions` column mapping (old 21 → genesis) + DROP `answer_text`

Key on `canonical_id → id`. Genesis target: `id, section, source_type, domain, skill_codes,
difficulty, stem, passage, options, correct_answer, explanation, option_metadata, assets,
status, version, created_at, published_at, retired_at, source_lineage,
generation_attribution, estimated_time_seconds, premium_flag, quality_score, issue_flags`.

| old column | → genesis | rule |
|---|---|---|
| `canonical_id` (34) | `id` | **preserve**; must match genesis CHECK `^SAT(M\|RW)[12][A-Z0-9]{6}$` → **pre-flight GATE-Q1** |
| `section_code` (36) | `section` | direct **iff** ∈ `{M,RW}` → pre-flight GATE-Q3 |
| `source_type` (37) | `source_type` | direct **iff** ∈ `{1,2}` and not NULL → pre-flight GATE-Q4 |
| `domain` (40) | `domain` | direct (genesis NOT NULL) → pre-flight GATE-Q5 |
| `skill` (41) + `subskill` (42) | `skill_codes` | `array_remove(ARRAY[skill, subskill], NULL)` (text[]; empty array if both NULL — NOT NULL satisfied) |
| `difficulty` (15) | `difficulty` | direct **iff** ∈ `{1,2,3}` and not NULL → pre-flight GATE-Q2 (deployed was nullable, historically 1–5 per CR-02A-02) |
| `stem` (7) | `stem` | direct (both NOT NULL) |
| `options` (10) | `options` | direct (genesis NOT NULL) → pre-flight GATE-Q5 |
| `correct_answer` (48) | `correct_answer` | direct (both NOT NULL) |
| `explanation` (14) | `explanation` | direct (genesis NOT NULL; deployed nullable) → pre-flight GATE-Q5 |
| `answer_text` (13) | — | **DROP** (leaky duplicate, not spec-owned — decision #7) |
| `provenance_chunk_ids` (25) | `source_lineage` | `provenance_chunk_ids` → `source_lineage` (provenance carry-over) |
| `created_at` (31) | `created_at` | direct |
| — | `status` | `'published'` (these were live questions) |
| — | `version` | `1` |
| — | `published_at` | `created_at` (proxy — they were live; or NULL if preferred) |
| — | `passage`, `option_metadata`, `assets`, `retired_at`, `generation_attribution`, `estimated_time_seconds`, `quality_score`, `issue_flags` | **NULL** (no deployed source) |
| — | `premium_flag` | `FALSE` (default) |

**Dropped old columns:** `id`(1, the uuid PK — genesis PK is the text `canonical_id`),
`question_type`(8, all MC), `tags`(18), `embedding`(23, embeddings are a later-wave store),
`updated_at`(32, no genesis equivalent), `test_code`(35), `diagram_present`(46).

---

## 3. Staging tables (deployed shape; `role`/enum loaded as TEXT to avoid type coupling)

```sql
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

CREATE TABLE reseed_stage.questions_old (
  id uuid, stem text, question_type text, options jsonb, answer_text text, explanation text,
  difficulty integer, tags jsonb, embedding jsonb, provenance_chunk_ids jsonb,
  created_at timestamptz, updated_at timestamptz, canonical_id text, test_code text,
  section_code text, source_type integer, domain text, skill text, subskill text,
  diagram_present boolean, correct_answer text
);
```
> The staging tables list **only the live deployed columns**. If `03_preserve…` carries
> additional/renamed columns, adjust this DDL to match the dump before loading.

---

## 4. PRE-FLIGHT GATES (run after loading staging; **HALT on any failure — do not reseed**)

```sql
-- GATE-ID: every reseeded profile id must exist in auth.users (FK RESTRICT). Expect 0.
SELECT count(*) AS orphan_profiles
FROM reseed_stage.profiles_old p
LEFT JOIN auth.users u ON u.id = p.id
WHERE u.id IS NULL;                        -- MUST be 0  (62 dump ids ⊆ 114 auth.users)

-- GATE-P1: genesis UNIQUE(lower(email)) WHERE deleted_at IS NULL — no case-insensitive dups.
SELECT lower(email) AS email, count(*) FROM reseed_stage.profiles_old
GROUP BY lower(email) HAVING count(*) > 1;  -- MUST return no rows

-- GATE-P2: genesis stripe_customer_id is UNIQUE — no non-null dups.
SELECT stripe_customer_id, count(*) FROM reseed_stage.profiles_old
WHERE stripe_customer_id IS NOT NULL GROUP BY stripe_customer_id HAVING count(*) > 1; -- no rows

-- GATE-Q1 (the big one): canonical_id must match the LOCKED genesis format.
SELECT count(*) AS bad_canonical_id
FROM reseed_stage.questions_old
WHERE canonical_id !~ '^SAT(M|RW)[12][A-Z0-9]{6}$';   -- MUST be 0, else HALT (Doc 02A §14 is immutable — owner decision)

-- GATE-Q2: difficulty in 1..3, not null.
SELECT count(*) AS bad_difficulty FROM reseed_stage.questions_old
WHERE difficulty IS NULL OR difficulty NOT BETWEEN 1 AND 3;   -- MUST be 0

-- GATE-Q3: section_code in {M,RW}.
SELECT count(*) AS bad_section FROM reseed_stage.questions_old
WHERE section_code IS NULL OR section_code NOT IN ('M','RW');  -- MUST be 0

-- GATE-Q4: source_type in {1,2}.
SELECT count(*) AS bad_source_type FROM reseed_stage.questions_old
WHERE source_type IS NULL OR source_type NOT IN (1,2);         -- MUST be 0

-- GATE-Q5: genesis NOT-NULL columns have no NULLs in the source.
SELECT count(*) AS null_required FROM reseed_stage.questions_old
WHERE domain IS NULL OR options IS NULL OR correct_answer IS NULL OR explanation IS NULL; -- MUST be 0

-- GATE-COUNT: expect 62 profiles, 280 questions.
SELECT (SELECT count(*) FROM reseed_stage.profiles_old)  AS profiles_n,
       (SELECT count(*) FROM reseed_stage.questions_old) AS questions_n;
```

> If **GATE-Q1** is non-zero, **STOP** — the preserved ids predate the locked Doc 02A §14
> SAT format. `canonical_id` is immutable, so this is an owner/spec decision (relax the
> genesis CHECK via a spec amendment, or the ids must be reconciled), **not** something the
> reseed may paper over. Same posture for any other non-zero gate: resolve the data or the
> spec before reseeding; do not coalesce/fabricate required values.

---

## 5. Reseed transform (run ONLY after all gates = 0)

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

-- questions: map into the canonical anti-leak shape; answer_text dropped.
INSERT INTO public.questions
  (id, section, source_type, domain, skill_codes, difficulty, stem, passage, options,
   correct_answer, explanation, option_metadata, assets, status, version,
   created_at, published_at, retired_at, source_lineage, generation_attribution,
   estimated_time_seconds, premium_flag, quality_score, issue_flags)
SELECT
  q.canonical_id, q.section_code, q.source_type, q.domain,
  array_remove(ARRAY[q.skill, q.subskill], NULL),
  q.difficulty, q.stem, NULL, q.options,
  q.correct_answer, q.explanation, NULL, NULL,
  'published', 1,
  q.created_at, q.created_at, NULL, q.provenance_chunk_ids, NULL,
  NULL, FALSE, NULL, NULL
FROM reseed_stage.questions_old q;

COMMIT;
```

---

## 6. Post-reseed exit proof (RECUT-CONTRACT §9 E.1–E.3)

```sql
-- E.1 counts
SELECT (SELECT count(*) FROM public.questions) AS questions,   -- expect 280
       (SELECT count(*) FROM public.profiles)  AS profiles;    -- expect 62
-- E.2 FK-intact: zero profiles orphaned from auth.users
SELECT count(*) FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.id WHERE u.id IS NULL; -- 0
-- E.3 anti-leak: anon/authenticated cannot read answers (deny-all)
SET ROLE anon;          SELECT correct_answer FROM public.questions LIMIT 1;  -- expect: permission denied
RESET ROLE;
SET ROLE authenticated; SELECT explanation    FROM public.questions LIMIT 1;  -- expect: permission denied
RESET ROLE;
-- cleanup staging
DROP SCHEMA reseed_stage CASCADE;
```

Embed the gate + exit-proof outputs in the closure record. After E.1–E.3 pass, WS-1 is
fully closed (genesis applied + reseeded + proven).
