# Auth rebuild — Stage 1 prod runbook (OWNER-applied)

CC has written + validated the governed migrations against a throwaway Postgres 16 (the `genesis-fresh-apply` gate passes, including the new G1 trigger gates). **Prod application is owner-applied** per the approved plan. Apply in this order against project `hncolwkccbbjkfithhlo`.

## 0. Dashboard config (Stage 0 — do AFTER the SQL below so users aren't gated before profiles work)

1. **Auth → Providers → Email → "Confirm email" = ON** (Karl-1).
2. **Auth → enable "Link identities"** (native account linking, Karl-2). Required precondition for the trigger's single-profile guarantee.
3. **Auth → SMTP + Email templates** — set **Confirm signup** and **Reset password** to the PKCE token-hash form:
   - Confirm: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup`
   - Recovery: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/update-password`

## 1. Apply migrations to prod (DDL)

The two legal tables (`20260618000000`, `20260618010000`) are **already in prod**. Apply the rest:

| Order | Migration | What it does |
|---|---|---|
| 1 | `20260617000000_notification_outbox.sql` | Create `notification_outbox` (absent from prod today). |
| 2 | `20260619000000_handle_new_user_trigger.sql` | `handle_new_user` + `on_auth_user_created` — the single profile-creation mechanism. |
| 3 | `20260619000100_profiles_auth_columns.sql` | Add `student_link_code`, `profile_completed_at`, `marketing_opt_in` (+ indexes). |
| 4 | `20260619000300_legal_outbox_independent.sql` | Drop `legal_acceptance_outbox` FK→profiles (independent durable fallback). |

Each is idempotent (`IF NOT EXISTS` / `DROP … IF EXISTS` / `ON CONFLICT`) and carries a DOWN block.

## 2. One-shot backfill — recovers the 54 users created before the trigger existed

Run ONCE, after step 1 (the trigger only fires on *new* inserts; existing users need this). Mirrors the trigger's column/role logic exactly. Idempotent.

```sql
INSERT INTO public.profiles (id, email, display_name, role)
SELECT
  u.id,
  u.email,
  COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1)
  ),
  CASE WHEN u.raw_user_meta_data->>'role' = 'guardian' THEN 'guardian' ELSE 'student' END::public.profile_role
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;
```

## 3. Verify (must all hold before declaring Stage 1 done)

```sql
-- 0 expected: every auth user now has a profile
SELECT count(*) AS users_without_profile
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

-- trigger + function present
SELECT to_regprocedure('public.handle_new_user()') IS NOT NULL AS fn,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='on_auth_user_created') AS trg;

-- columns present
SELECT count(*) AS cols FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles'
  AND column_name IN ('student_link_code','profile_completed_at','marketing_opt_in'); -- expect 3

-- outbox FK gone
SELECT count(*) AS outbox_profiles_fk FROM information_schema.table_constraints
WHERE table_name='legal_acceptance_outbox' AND constraint_type='FOREIGN KEY'; -- expect 0

-- notification_outbox exists
SELECT to_regclass('public.notification_outbox') IS NOT NULL AS notif_outbox;
```

After Stage 1, the profile-read path stops throwing and all 116 users have a profile — service is restored regardless of the Stage 0 toggles. The drift detector (Stage 4) then enforces prod ≡ `genesis-schema.expected.sql` going forward.
