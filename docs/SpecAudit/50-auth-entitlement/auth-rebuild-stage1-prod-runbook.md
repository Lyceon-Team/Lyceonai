# Auth rebuild — Stage 1 prod runbook (OWNER-applied)

CC has written + validated the governed migrations against a throwaway Postgres 16 — the `genesis-fresh-apply` gate passes: **A.2** trigger auto-creates exactly one profile, **A.3** role-clamp (admin/tutor/teacher → student), **A.5** same-email second identity does NOT abort the auth insert; plus determinism, snapshot match, RLS-everywhere, FK RESTRICT, and the anti-leak hard gate. **Prod application is owner-applied** per the approved plan. Apply against project `hncolwkccbbjkfithhlo`.

## Toggle posture (Option A — THIS deploy keeps autoconfirm; Confirm-email + Link-identities stay OFF)

This deploy restores service and ships the toggle-robust code. It does **not** flip any Auth toggle. We stay on **autoconfirm** through the test phase (fake-email testing needs it; production SMTP is launch-time). The Confirm-email-ON / Link-identities-ON flips are a **launch-day checklist** (§4 below), separate from this apply. The code is written to be correct under both toggle states.

## Verified prod state (read-only introspection, 2026-06-19 — informs the backfill + launch readiness)

- **54 of 116 auth users have no profile.** Breakdown by provider / metadata-role / email-confirmed:

  | n | provider | meta role | email_confirmed |
  |---|---|---|---|
  | 45 | email | student | yes |
  | 6 | google | (none) | yes |
  | 3 | email | student | no |

  **No guardians, admins, tutors, or teachers among the 54.** The trigger-logic backfill (§2) maps all 54 to `student` — correct by construction (a `guardian` in metadata would be honored; none exist; the 6 Google users carry no role → `student`).
- **No duplicate emails** — neither among the 54 nor across all 116. The backfill faces zero email-unique collisions; the trigger's `lower(email)` arbiter is unreachable in current data (its catch-all `ON CONFLICT` is purely defensive for the linking-OFF test phase).
- **Email-confirmed: 113 / 116.** The **3 unconfirmed** are exactly the 3 orphaned email/students above. ⚠️ **Launch-readiness flag:** when Confirm-email is flipped ON at launch, those 3 (and anyone still unconfirmed then) must be re-confirmed or password-reset or they cannot log in. No action now — autoconfirm keeps them working.

## 1. Apply migrations to prod (DDL)

The two legal tables (`20260618000000`, `20260618010000`) are **already in prod** and are immutable history — do not re-apply or edit them. Apply only the forward set:

| Order | Migration | What it does |
|---|---|---|
| 1 | `20260617000000_notification_outbox.sql` | Create `notification_outbox` (absent from prod today — governance reconciliation). |
| 2 | `20260619000000_handle_new_user_trigger.sql` | `handle_new_user` + `on_auth_user_created` — the single profile-creation mechanism. Catch-all `ON CONFLICT`. |
| 3 | `20260619000100_profiles_auth_columns.sql` | Add `student_link_code`, `profile_completed_at`, `marketing_opt_in` (+ indexes). |
| 4 | `20260619000300_legal_outbox_independent.sql` | Drop `legal_acceptance_outbox` FK→profiles (independent durable fallback). |

Each is idempotent (`CREATE OR REPLACE` / `IF NOT EXISTS` / `DROP … IF EXISTS` / `ON CONFLICT`) and carries a DOWN block. After this, prod ≡ `genesis-schema.expected.sql` (the Stage-4 drift detector enforces it going forward; the `auth.users` trigger itself isn't in a `--schema=public` dump, so its prod presence is proven by the Stage-5 smoke probe).

## 2. One-shot backfill — recovers the 54 users created before the trigger existed

Run ONCE, after §1 (the trigger only fires on *new* inserts). Mirrors the trigger's column + role logic **exactly**, so backfilled and trigger-created profiles are identical. Catch-all `ON CONFLICT` (matches the trigger) → idempotent and collision-safe.

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
ON CONFLICT DO NOTHING;
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

-- columns present (expect 3)
SELECT count(*) AS cols FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles'
  AND column_name IN ('student_link_code','profile_completed_at','marketing_opt_in');

-- outbox FK gone (expect 0)
SELECT count(*) AS outbox_profiles_fk FROM information_schema.table_constraints
WHERE table_name='legal_acceptance_outbox' AND constraint_type='FOREIGN KEY';

-- notification_outbox exists
SELECT to_regclass('public.notification_outbox') IS NOT NULL AS notif_outbox;
```

After Stage 1 the profile-read path stops throwing and all 116 users have a profile — service is restored, autoconfirm unchanged.

## 4. Launch-day checklist (LATER — separate from this deploy; do NOT run as part of Stage 1)

1. Wire production **SMTP** in Supabase Auth.
2. Configure **PKCE email templates** (token-hash → our callback):
   - Confirm: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup`
   - Recovery: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/update-password`
3. Switch the smoke probe from autoconfirm/fake-email to a **real mailbox**.
4. Flip **Confirm-email ON** (Karl-1).
5. Flip **Link-identities ON** (Karl-2) — makes the trigger's email arbiter structurally unreachable (one auth id per verified email).
6. Re-run `pnpm smoke:auth` against real email; confirm the **3 previously-unconfirmed** users are re-confirmed / reset.
```
