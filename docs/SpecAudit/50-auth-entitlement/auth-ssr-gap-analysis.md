# Auth Gap Analysis — Lyceon vs. the canonical `@supabase/ssr` flow

**Date:** 2026-06-18
**Scope:** Analysis only. No fixes in this pass — this report scopes the cleanup.
**Stack:** Express/Node (`server/`) + React/Vite (`client/`) — **not** Next.js. `@supabase/ssr@0.12.0`, `@supabase/supabase-js@2.104.1`.
**Project (prod):** Supabase `MVP` / ref `hncolwkccbbjkfithhlo` (us-east-2).
**Method:** (1) canonical standard re-established from current official Supabase SSR docs (not memory); (2) implementation mapped from live code; (3) every load-bearing claim grounded in the **live prod schema** via SQL, not assumption.

---

## 0. TL;DR — the smoking guns (live prod, verified)

The stated bug ("legal capture runs before the `profiles` row exists → both legal tables FK to profiles → 503") is **real but is a symptom**. The root cause is deeper and is **not fixable by reordering**, because on the signup path *there is no profile-creation step to reorder*. Two independent schema-drift defects make the profile parent unreachable:

| # | Live-prod fact | Source |
|---|---|---|
| 1 | **No `handle_new_user` trigger and no `on_auth_user_created` trigger exist on `auth.users` in prod.** The signup handler's comment claims "Profile is auto-created by Supabase trigger (handle_new_user)" — that trigger does not exist. | `SELECT … FROM pg_trigger … WHERE … auth.users` → `[]` |
| 2 | **`profiles` is missing `student_link_code`, `profile_completed_at`, `marketing_opt_in`** — yet `ensureProfileForAuthUser` (the only app-code profile creator) and the profile-hydration query both `SELECT` them. The PostgREST select errors (column does not exist) → the function **throws before it can create the profile**. | live columns = `id, email, full_name, display_name, role, date_of_birth, age_years, is_under_13, country_code, stripe_customer_id, guardian_email, guardian_consent, consent_given_at, guardian_profile_id, last_login_at, deleted_at, created_at, updated_at`; code at `server/lib/profile-bootstrap.ts:26`, `server/routes/profile-routes.ts:69` |
| 3 | **54 of 116 auth users have no `profiles` row.** | `SELECT count(*) … users_without_profile` → `54` |
| 4 | **`legal_acceptances` = 0 rows; `legal_acceptance_outbox` = 0 rows.** The legal tables were created **today** (`20260618044956`, `20260618051930`) and have durably captured nothing — every capture fails on the missing FK parent, and the outbox shares that exact FK so it absorbs nothing. | counts = `0` / `0`; FK both → `profiles.id` |
| 5 | **`notification_outbox` does not exist in prod** (migration `20260617000000` never applied). | `to_regclass('public.notification_outbox')` → `null` |
| 6 | **Email confirmation is OFF (autoconfirm ON)** in the current project config. | 113/116 confirmed with **no** confirmation email sent; 112 confirmed within 5 s of signup; only 3 confirmation emails ever sent (all to `email`-provider users created 2025-10-20, still unconfirmed). |

**Net effect:** Both profile-creation paths are broken in prod right now — signup (no trigger) *and* OAuth/middleware (`ensureProfileForAuthUser` throws on the missing-column select). With no profile parent, legal capture FK-fails, the outbox FK-fails, signup returns **503**, and any user without a pre-existing profile is effectively locked out (`requireSupabaseAuth` → 401). Creating the legal tables earlier today fixed a *missing-table* symptom but not the root cause; **the outbox cannot be a fallback for a failure mode (missing `profiles` parent) it shares.**

**What is NOT broken (do not "fix" these):** the core session machinery is sound — `getUser()` (network-truth) is used everywhere for trust, `getSession()` appears nowhere server-side, the `getAll`/`setAll` cookie adapter is the current 0.x shape and writes refreshed cookies + `Cache-Control: private, no-store` back on the response, and the signup handler *correctly* branches on whether a session exists post-`signUp` (so it is robust to the confirm-email toggle).

---

## 1. Part A — The canonical `@supabase/ssr` standard (grounded in current docs)

Re-established from the live Supabase docs (SSR creating-a-client, advanced-guide, passwords, social-login/google, JS reference). Cross-cutting facts first, then the five flows. Framework note: the **cookie adapter, `getUser`/`getClaims`, `exchangeCodeForSession`/`verifyOtp`** are framework-agnostic core; `middleware.ts`/`NextResponse`/matcher are Next.js glue with a direct Express equivalent (one auth middleware before protected routers).

**Cross-cutting invariants the standard assumes:**

- **PKCE is the SSR flow** (default in `@supabase/ssr`). Supported on Magic Link, OAuth, **Sign Up**, and Password Recovery. *"The PKCE flow cannot be used when autoconfirm is enabled"* — i.e. with confirm-email **OFF**, `signUp` returns a session directly (no code/OTP round-trip).
- **The cookie *is* the session.** Cookie named `sb-<project_ref>-auth-token`. One mechanism end-to-end; no app-held token.
- **Trust = `getUser()` / `getClaims()`, never `getSession()` server-side.** *"Never trust `supabase.auth.getSession()` inside server code… It isn't guaranteed to revalidate the Auth token."* `getUser()` is the network-truth call (detects server-side logout); newest docs prefer `getClaims()` (local asymmetric JWT verification) for the hot path — both are valid.
- **`setAll` must write refreshed cookies + cache headers back on the response.** It is called after a token refresh; a read-without-write-back causes intermittent 401s.
- **Create the client per request**, never at module scope.
- **App rows are created AFTER the auth user exists.** The canonical mechanism is a Postgres trigger on `auth.users`:
  ```sql
  create function public.handle_new_user() returns trigger ... as $$
  begin
    insert into public.profiles (id, ...) values (new.id, ...);
    return new;
  end; $$ language plpgsql security definer;
  create trigger on_auth_user_created
    after insert on auth.users for each row execute procedure public.handle_new_user();
  ```
- **Redirect targets are allowlisted**; errors are **generic where enumeration matters** (login, reset, and existing-email signup).

**Flow 1 — Email/password signup.** `signUp({ email, password, options: { emailRedirectTo }})`. **Confirm-email ON:** `data.user` and `data.session` are both `null`; session established only after the user clicks the link → `/auth/confirm?token_hash&type=email` → `verifyOtp({ type, token_hash })`. **Confirm-email OFF:** user auto-confirmed, session returned directly from `signUp`. Existing-email is *obfuscated*; surface a generic message.

**Flow 2 — Email/password login.** `signInWithPassword({ email, password })`; generic error on failure (no enumeration).

**Flow 3 — Google OAuth.** `signInWithOAuth({ provider: 'google', options: { redirectTo: '<site>/auth/callback' }})` (client auto-redirects) → provider → your `/auth/callback?code=…` → `exchangeCodeForSession(code)` sets the session cookie via the adapter. `redirectTo` must be on the allowlist.

**Flow 4 — Password reset.** `resetPasswordForEmail(email, { redirectTo })` (always generic) → recovery email `type=recovery` → same `/auth/confirm` → `verifyOtp({ type: 'recovery', token_hash })` → temporary session → `updateUser({ password })`.

**Flow 5 — Per-request validation.** Per-request `createServerClient` with the `getAll`/`setAll` adapter → `getUser()`/`getClaims()` → write refreshed cookies + cache headers on the response → gate the route. *"Do not run code between `createServerClient` and the auth call."*

---

## 2. Part B — Live prod ground truth

- **FK constraints (real, confirmed):** `legal_acceptances.user_id → profiles.id` (CASCADE) **and** `legal_acceptance_outbox.user_id → profiles.id` (CASCADE). Both children share the same parent. `notification_outbox.recipient_profile_id → profiles.id` exists only in the repo migration — the table is absent from prod.
- **Migration ledger (prod):** `00000000000000 genesis`, `20260618044956 create_legal_acceptances_table`, `20260618051930 create_legal_acceptance_outbox`. The repo's `supabase/migrations-pending/2026061800…`/`2026061801…` legal files and `supabase/migrations/20260617000000_notification_outbox.sql` are **not** in the applied ledger — the live legal tables were hand-applied out-of-band under different version stamps. Repo↔prod migration drift is real.
- **`auth.users` triggers:** none (no `on_auth_user_created`). **`handle_new_user` function:** does not exist. It lives only in ungoverned `database/*.sql` files (`supabase-profiles-setup.sql`, `supabase-auth-only.sql`, `supabase-auth-migration-simple.sql`), none of which are in the migration pipeline.
- **Confirm-email:** behaviorally OFF (autoconfirm ON) today; was briefly ON at launch (2025-10-20). *Definitive source is the Auth dashboard toggle, which is not queryable via MCP — flagged as a confirm-item, but the data is conclusive.*

---

## 3. Part C — Gap table (one row per deviation)

Severity legend: **breaks-auth** = prevents a flow / live security hole · **fragile** = works now but on a fault line or diverges from the single-mechanism standard · **cosmetic** = style/maintainability/by-design.

| # | Flow | Standard behavior | Our behavior | Severity | Root cause |
|---|---|---|---|---|---|
| G1 | Signup · profile creation | Trigger `handle_new_user` creates the `profiles` row atomically on `auth.users` insert; profile exists before any app row. | Handler does **not** create the profile — only `UPDATE … role` (`supabase-auth-routes.ts:183`), relying on a trigger that **does not exist in prod**. Comment at `:178` asserts it does. | **breaks-auth** | Missing trigger; no app-code profile creation on the signup path. Divergent from OAuth, which *does* create via `ensureProfileForAuthUser`. |
| G2 | Signup · legal FK ordering | App/consent rows written only after the profile exists. | `captureLegalAcceptances` (`:205`) writes `legal_acceptances` (FK→`profiles`) with no guaranteed parent; on failure enqueues `legal_acceptance_outbox` (also FK→`profiles`) → both fail → `durable:false` → **503** (`:226-237`). Live: 0 / 0 rows. | **breaks-auth** | Downstream of G1 (no parent). Not reorderable — there is no profile-create step on this path to move earlier. |
| G3 | Architecture · fallback independence | A fallback must not share the failed dependency. | `legal_acceptance_outbox` shares the identical FK parent (`profiles.id`) with `legal_acceptances`. | **breaks-auth** (defeats the fail-open design) | Shared FK parent; the outbox is not an independent store for a profiles-missing failure. |
| G4 | Profile bootstrap · schema drift | Code reads only existing columns. | `PROFILE_SELECT` (`profile-bootstrap.ts:26`) and hydration (`profile-routes.ts:69`) read `student_link_code`, `profile_completed_at`, `marketing_opt_in` — **absent from prod `profiles`**. The select errors → `ensureProfileForAuthUser` throws before insert (`:76-79`) → OAuth callback signs out (`oauth-callback-routes.ts`), middleware swallows → no profile. | **breaks-auth** | Governed migrations for these columns never applied to prod; columns exist only in `_legacy-migrations`. Compounds G1: **both** profile paths are down. |
| G5 | Signup · enumeration | Existing-email is obfuscated; with autoconfirm ON, `signUp` returns an explicit "User already registered" error that must be caught and genericized. | Returns `signupError.message` verbatim (`:163-169`). With our live autoconfirm-ON config this leaks account existence. | **breaks-auth** (security: enumeration) | Verbatim passthrough of the Supabase error; no generic mapping. |
| G6 | Password reset · native vs custom | Client `resetPasswordForEmail({ redirectTo })`; recovery via `/auth/confirm` `verifyOtp(type=recovery)`; client `updateUser({ password })`. | `admin.auth.admin.generateLink({ type:'recovery' })` + **self-built** link + **custom email send** (`:742-777`); completion via `admin.auth.admin.updateUserById` (`:821-823`), not client `updateUser`. | **fragile** (by-design) | Deliberate (action_link tokens land in the URL hash, unreadable server-side). Adds an admin-key surface + a custom email dependency that diverge from native. |
| G7 | Session minting | One per-request server client; sign in on *it* so the cookie is set natively by the adapter. | Ad-hoc `createClient(anon)` performs `signUp`/`signInWithPassword` (`:138`, `:497`), then `persistSession` → SSR `setSession()` writes the cookie. Two clients + a manual hand-off. | **fragile** | Parallel client instead of the canonical single per-request server client; works but is an extra seam. |
| G8 | One session mechanism | Single `sb-<ref>-auth-token` cookie; no parallel/app-held token. | Legacy `sb-access-token`/`sb-refresh-token` cookies are still honored as a fallback (`ALLOWED_AUTH_COOKIES`, `resolveTokenFromRequest`, `supabase-auth.ts:117-124`), cleared on signout; CSRF binds to the raw access-token string. | **fragile** | Dormant legacy dual-cookie path coexists with native; latent dual-source-of-truth. |
| G9 | update-password · authz | Trust the user from the request's validated session (`req.user`). | Authorizes via a parallel `resolveUserIdFromToken` (fresh anon `getUser(token)`) instead of `req.user` (`supabase-auth-routes.ts:814-819`). | **cosmetic / fragile** | Parallel validation path; functionally equivalent but a second seam. |
| G10 | OAuth · existing password account (AL-7) | Native behavior depends on the "link identities" setting; standard does not mandate linking. | Deliberate refusal: `ensureProfileForAuthUser` detects an email owned by a different id and throws `AccountEmailConflictError` → callback signs out → `/login?error=account_exists`. DB backstop on `idx_profiles_email_active` (23505). | **cosmetic** (intentional, defensible) | By-design "profile-per-human." Note dependency: the email-owner pre-check needs the *other* account to actually have a profile row — often false today (G1/G4), so it leans on the 23505 backstop. |
| G11 | Repo ↔ prod migration governance | Schema changes flow through governed migrations. | Legal tables hand-applied out-of-band under version stamps that don't match the repo's `migrations-pending/*`; `notification_outbox` migration unapplied; trigger + 3 columns live only in ungoverned files. | **fragile** | No single governed migration path; drift between repo and prod. |
| G12 | Notification emission | (Lyceon workflow §7) notifiable state changes emit to `notification_outbox` in-txn. | Signup emits nothing; `notification_outbox` doesn't exist in prod. | **cosmetic** (table intentionally inert this lane) | Emission foundation only; out of auth-flow scope but noted. |
| — | Session validation (`getUser` vs `getSession`) | Never trust `getSession()` server-side; use `getUser()`/`getClaims()`. | `getUser()` everywhere; no `getSession()` in `server/`. | **not a gap** (strength) | — newest docs would *prefer* `getClaims()` for hot-path perf; optional. |
| — | Cookie propagation/refresh | `setAll` writes refreshed cookies + cache headers on the response. | `setAll` writes `res.cookie` + `Cache-Control: private, no-store` (`supabase-ssr.ts:90-109`). | **not a gap** (Express-correct) | minor: doesn't consume the v0.10 `headers` arg, hardcodes the equivalent. |
| — | Confirm-email branch | Code must know whether a session exists post-`signUp`. | Handler branches on `!!authData.session` (202 vs 201, `:239-274`). | **not a gap** (correct, toggle-robust) | — |

---

## 4. Prioritized cleanup scope (no fixes this pass)

Ordered by severity. **The first cluster is one outage with one root cause: the `profiles` parent is unreachable.** Fix that and G1/G2/G3 collapse together.

1. **P0 — Restore reliable profile creation (G1 + G4).** Decide the *single* canonical mechanism — either (a) deploy the `handle_new_user`/`on_auth_user_created` trigger as a **governed** migration so every `auth.users` insert yields a profile, or (b) make the signup handler create the profile in app code (as OAuth does) and stop relying on the absent trigger — but **not both divergent paths**. Independently, reconcile the schema: either add `student_link_code` / `profile_completed_at` / `marketing_opt_in` to prod via a governed migration, or remove them from `PROFILE_SELECT`/hydration. Until the columns exist, `ensureProfileForAuthUser` throws and *no* path can create a profile.
2. **P0 — Make legal capture independent of its own failure mode (G2 + G3).** Once the profile reliably exists, ordering is satisfied. Separately, reassess whether an "outbox" that FKs to the same `profiles` parent is a real fallback — a durable fallback must not share the dependency it guards (e.g. store intent keyed to `auth.users.id`, or capture legal *after* the profile is guaranteed).
3. **P0 — Close the signup enumeration leak (G5).** Map Supabase's existing-email/`signUp` error to a generic response, matching the login/reset posture already in place.
4. **P1 — Migration governance (G11).** Bring the live legal tables, the trigger (if chosen), the missing columns, and `notification_outbox` under one governed migration set; reconcile repo `migrations-pending/*` with the applied ledger.
5. **P2 — Retire the parallel session seams (G7, G8, G9).** Converge on the single per-request server client for sign-in/sign-up; remove the legacy `sb-access-token`/`sb-refresh-token` fallback path; authorize update-password from `req.user`. One session mechanism, end-to-end.
6. **P2 — Decide native-vs-custom for reset (G6)** explicitly: keep the admin `generateLink` approach (and document why) or move to native `resetPasswordForEmail` + client `updateUser`.
7. **P3 — Confirm-items / by-design (G10, G12, dashboard toggle).** Confirm the Auth "Confirm email" toggle in the dashboard (config, not queryable via MCP). AL-7 refusal and the inert `notification_outbox` are intentional — record them as decisions, not bugs.

---

## 5. Items to confirm (not derivable from code/SQL)

- **Auth "Confirm email" dashboard toggle** — data says OFF; confirm in Authentication → Providers/Email. The signup handler is robust to either, so this is informational, not blocking.
- **Provenance of the 62 existing profiles** — created under a prior code/schema state (before `PROFILE_SELECT` referenced the now-missing columns, or via admin upsert / a trigger that existed at launch). Not required for the fix, but explains the 62/54 split.
- **Why the legal tables were hand-applied today** out-of-band vs. through the repo `migrations-pending/*` — governance decision feeding P1.

---

### Evidence index (verbatim citations)

- Signup ordering & 503: `server/routes/supabase-auth-routes.ts:138,144-161,178-186,201-237,239-274`
- Profile bootstrap (only app-code creator) + missing-column select + AL-7: `server/lib/profile-bootstrap.ts:25-26,64-80,134-201`
- Legal capture + shared-FK outbox fallback: `server/lib/legal-acceptance.ts:83-132`
- Profile hydration reading missing columns: `server/routes/profile-routes.ts:69,107,124-127`
- Session middleware (`getUser`, non-blocking) + legacy cookie fallback: `server/middleware/supabase-auth.ts:451-475,117-124`
- SSR server client (`getAll`/`setAll`, cache header): `server/lib/supabase-ssr.ts:80-110`
- `/auth/callback` (`exchangeCodeForSession` + `verifyOtp`, `SAFE_NEXT_PATHS`): `server/routes/oauth-callback-routes.ts:62-67,117-123,204-244`
- Live prod: no `auth.users` trigger / no `handle_new_user`; 54/116 users w/o profile; legal 0/0; `notification_outbox` absent; prod `profiles` columns; migration ledger; confirm-email behavioral evidence (queried 2026-06-18 against ref `hncolwkccbbjkfithhlo`).
