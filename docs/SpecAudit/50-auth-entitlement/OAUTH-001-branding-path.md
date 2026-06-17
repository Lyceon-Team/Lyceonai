# OAUTH-001 — Google consent-screen branding path + native OAuth conversion

> Audience: owner decision (now resolved). Status: **CONVERTED** — owner approved the native Supabase
> OAuth path and verified the dashboard config (see §0). The custom flow has been removed and replaced
> with native `signInWithOAuth` + `exchangeCodeForSession`; the Google client secret no longer lives in
> app code. Remaining items are owner dashboard actions + a tracked pre-launch verification task (§6).
> Original branding analysis (§1–§4) retained for history; §0 + §5 + §6 reflect the shipped state.

---

## 0. Owner-verified configuration (2026-06-15) — wired into code, do NOT re-do

- **Supabase project ref:** `hncolwkccbbjkfithhlo`.
- **Supabase OAuth callback (Supabase-owned):** `https://hncolwkccbbjkfithhlo.supabase.co/auth/v1/callback`
  — registered in the Google Console. This is the Google-facing redirect URI on the native path.
- **App post-login landing route (app-owned):** `PUBLIC_SITE_URL/auth/callback` — passed as `redirectTo`
  to `signInWithOAuth`. This is NOT a Google-facing callback; Supabase owns the OAuth callback above.
  This URL must be on the Supabase **redirect allow-list** (Authentication → URL Configuration →
  Redirect URLs). **Owner action if not already present:** add `https://lyceon.ai/auth/callback` (and any
  preview/dev origins, e.g. `http://localhost:5173/auth/callback`) to that allow-list.
- **Google provider:** ENABLED in Supabase with Client ID + secret (matching the Google client). The
  Supabase-configured **Client ID matches the Google client ID** (owner-confirmed, dashboard-side).
- **Google client secret:** lives ONLY in the Supabase dashboard (Authentication → Providers → Google).
  Removed from app code / Vercel env (HALT-3). App never calls Google's token endpoint directly.
- **Consent screen:** verified; **App name = "LYCEON"** (owner's deliberate choice — intentionally NOT
  "Lyceon.ai"); logo + links present. Branding is set in the Google Console, free.
- **Publishing status:** Google app is in **"Testing"** (production verification is a later pre-launch
  task — see §6). Branding-verified ≠ app-published.

---

## 1. The goal

Show **"Lyceon.ai"** as the application identity on the Google account-chooser / consent screen, instead
of a raw Supabase project domain or a bare OAuth client name.

There are two distinct things a user sees on that screen, and they are billed differently:

| Element on the Google screen                                                                      | What controls it                                                                                                                                    | Cost                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App name + logo** (the prominent "Choose an account to continue to **Lyceon.ai**" title + icon) | Google Cloud Console → OAuth consent screen (App name, logo, support email)                                                                         | **FREE**                                                                                                                                                                                                                                                                                  |
| **The "to continue to `<domain>`" / callback authority line**                                     | The domain Google redirects the OAuth handshake through. On the native Supabase path this is the **Supabase project domain** (`<ref>.supabase.co`). | Changing it to `auth.lyceon.ai` needs a Supabase **custom domain** add-on = **$10/mo** (paid plan, not spend-capped); OR a free **vanity subdomain** (`brand.supabase.co`) which still needs a paid plan (Pro+), is experimental/CLI-only, and is mutually exclusive with custom domains. |

**Net:** the prominent "Lyceon.ai" branding (app name + logo) is **FREE** and is set in the Google Console,
not in code. Only the secondary callback-authority line costs money to rebrand.

---

## 2. Recommended path

1. **Take the free win now (no spend):** set **App name = "Lyceon.ai"**, upload the logo, and set the
   support/developer email in **Google Cloud Console → APIs & Services → OAuth consent screen**. This makes
   the prominent line read "to continue to **Lyceon.ai**". This is the branding users actually read.
2. **Convert the OAuth flow to the native Supabase path** (see §4) so that `GOOGLE_CLIENT_SECRET` lives in
   the **Supabase dashboard**, not in app code, and session management is native (PKCE
   `signInWithOAuth` + `exchangeCodeForSession`). This is the correctness/safety fix; it is independent of
   the $10/mo decision.
3. **Defer the $10/mo Supabase custom domain** (`auth.lyceon.ai` on the callback line) unless the owner
   wants the callback authority line rebranded too. It does **not** affect the prominent app-name branding.

---

## 3. The owner decision needed

**Pick one of:**

- **(A) FREE — accept the `*.supabase.co` callback authority line.** Set App name = "Lyceon.ai" + logo in
  the Google Console (free). The prominent screen says "Lyceon.ai"; the small callback-authority line shows
  the Supabase project domain. **$0/mo. Recommended default.**
- **(B) PAID — $10/mo Supabase custom domain (`auth.lyceon.ai`).** Everything in (A), plus a Supabase custom
  domain so the callback authority line also reads `auth.lyceon.ai`. Requires a paid Supabase plan; the
  custom-domain add-on is **$10/mo and is not spend-capped**.

A separate, independent approval is also requested:

- **(C) Approve converting the OAuth flow to the native Supabase path** (§4). This is a safety/correctness
  fix (moves the secret out of app code) and is **strongly recommended regardless of (A) vs (B)**. It
  requires owner action in dashboards (move secret to Supabase, enable Google provider, repoint the Google
  Console redirect URI) — hence a HALT, not an in-lane code change.

---

## 4. Current flow vs native — and the conversion HALT

### Current flow is NON-NATIVE (custom), confirmed in code at HEAD `76831d1`

`server/routes/google-oauth-routes.ts` owns the entire OAuth dance itself:

- It **manually builds the Google consent URL** — `server/routes/google-oauth-routes.ts:251-262`
  (`https://accounts.google.com/o/oauth2/v2/auth?...`).
- It **exchanges the auth code directly against Google's token endpoint using the client secret held in
  app code** — `server/routes/google-oauth-routes.ts:315-327`
  (`fetch('https://oauth2.googleapis.com/token', { ... client_secret: GOOGLE_CLIENT_SECRET ... })`),
  with the secret read at `server/routes/google-oauth-routes.ts:55`.
- Supabase is touched only at the very end via `signInWithIdToken({ provider: 'google', token: id_token })`
  — `server/routes/google-oauth-routes.ts:349-354`.
- The client triggers it with a full-page redirect to `/api/auth/google/start`
  (`client/src/contexts/SupabaseAuthContext.tsx:303`; button in
  `client/src/components/auth/SupabaseAuthForm.tsx:392-394`).
- There are **zero** occurrences of `signInWithOAuth` or `exchangeCodeForSession` anywhere in the repo —
  the two hallmarks of the native PKCE path are entirely absent.

### Secret-leak defect found alongside this

`apps/api/next.config.js:6-10` exposes `GOOGLE_CLIENT_SECRET` (and `GOOGLE_CLIENT_ID`) through Next.js
`env`, which **inlines values into the client bundle**. On the native path the secret moves to the Supabase
dashboard and this `env` exposure must be **removed entirely**. (Flagged here; not changed in this lane —
the secret/env surface is owner-controlled and out of this lane's seam.)

### Native target

```ts
// start: PKCE, secret lives in the Supabase dashboard, not app code
await supabase.auth.signInWithOAuth({
  provider: "google",
  options: { redirectTo: `${PUBLIC_SITE_URL}/auth/google/callback` },
});
// callback:
await supabase.auth.exchangeCodeForSession(code);
```

On the native path `GOOGLE_CLIENT_SECRET` is configured in **Supabase → Authentication → Providers →
Google**, never in app env, and Lyceon never calls Google's token endpoint directly.

### Why the conversion is a HALT (not done in this lane)

Converting requires **owner/dashboard actions that cannot be done from the codebase alone**:

1. Move `GOOGLE_CLIENT_SECRET` into the Supabase dashboard and enable the Google provider there.
2. Repoint the Google Console authorized redirect URI to the Supabase callback
   (`https://<ref>.supabase.co/auth/v1/callback`, or the custom domain if (B) is chosen).
3. Remove the app-code secret usage + the `next.config.js` `env` exposure.

These touch live secrets and external dashboards, so they need explicit owner approval before the code is
rewired. **Verdict: flagged, not converted.**

---

## 5. What this lane changed (2026-06-15 — native conversion shipped)

Owner approved (C). The native conversion + HALT-3 secret removal + AUTH-001 are implemented in code:

- **`@supabase/ssr` added** (root `package.json`, alongside `@supabase/supabase-js`; `pnpm install` clean).
- **HALT-3 — secret removed from client-reachable config:** the `env` block in `apps/api/next.config.js`
  (which inlined `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` into the client bundle) is **deleted**. A
  postbuild + CI guard `scripts/check-no-secrets-in-bundle.js` (mirrors `check-no-cdn-katex.js`) scans
  built output (`dist/`, `dist/public/`, `client/dist/`, `public/`, and any Next `.next` output) for any
  `*_SECRET` token and fails the build if found. Wired into `package.json` `postbuild`.
- **Custom flow removed:** `server/routes/google-oauth-routes.ts` (manual Google consent URL, direct
  token-endpoint exchange with the app-held secret, state cookie) is **deleted**. Its mounts in
  `server/index.ts` (`/api/auth/google`, `/auth/google/callback`, `/api/auth/google/callback`) are gone.
  **Confirmed: nothing else in the repo routes to `/auth/google/callback` or `/api/auth/google/*`** after
  this change — so the owner can safely delete the custom `lyceon.ai/auth/google/callback` redirect URI
  from the Google Console **after** native login is verified end-to-end.
- **Native flow:** client `signInWithGoogle` now calls `supabase.auth.signInWithOAuth({ provider: 'google',
options: { redirectTo: <origin>/auth/callback } })` via an `@supabase/ssr` `createBrowserClient`
  (`client/src/lib/supabase.ts`). The server landing route `GET /auth/callback`
  (`server/routes/oauth-callback-routes.ts`) calls `exchangeCodeForSession(code)` on a request-scoped
  `createServerClient` (`server/lib/supabase-ssr.ts`), which reads the PKCE verifier cookie and writes the
  session cookie back. `vercel.json` rewrite repointed `^/auth/callback$` → `/api/index`.
- **AUTH-001:** `supabaseAuthMiddleware` now validates + auto-refreshes via the `@supabase/ssr` server
  client's `getUser()` (request-scoped, RLS-bound = `req.supabase`). The custom `POST /api/auth/refresh`
  endpoint and the client calls to it are removed (refresh is native). signin/signup/signout persist/clear
  the session through the SSR client. Middleware contract preserved: `requireSupabaseAuth`,
  `requireRequestUser`, `requireStudentOrAdmin`, `requireConsentCompliance`, `AuthenticatedRequest`, and the
  global `supabaseAuthMiddleware` keep the same exported signatures. A legacy `sb-access-token` cookie is
  still honored as a validation fallback so existing sessions are not force-logged-out.

Note on app name: §1–§3 above were written assuming "Lyceon.ai" as the app name. The owner deliberately
chose **"LYCEON"** instead (see §0). The branding tier decision (§3 A vs B — the `*.supabase.co` callback
authority line vs a $10/mo custom domain) is unaffected by the native conversion and remains the owner's
call; default remains (A), free.

## 6. Pre-launch (lead-time) item — Google app publishing/verification

- The Google OAuth app is currently in **"Testing"** publishing status. This is fine for development and
  for the owner's own test users, but it caps the user pool and shows the "unverified app" interstitial.
- **Going to production requires publishing the app + OAuth verification.** Because the consent screen has a
  **logo** and uses **sensitive/identity scopes**, Google triggers **full app verification**, which is
  **multi-day to multi-week** lead time. This is a **pre-launch lead-time task, NOT a now-blocker** — start
  it well before launch.
- **Branding-verified ≠ app-published.** The app name/logo being approved on the consent screen does not
  mean the app is published for general users; that is a separate Google review.
- Owner-confirmed (dashboard-side): the Supabase-configured Google **Client ID matches** the Google client
  ID. No code dependency — recorded here for the audit trail.

---

## 7. Identity linking — same email, two providers (AL-7; profile-per-human)

> Governs `contracts/auth-login-e2e.contract.md` AL-7 + Doc-01 §7 (one profile per human). Captures the
> required dashboard setting so the cross-provider behavior is **deliberate, not accidental**.

**The footgun.** A user signs up with email/password, then later clicks "Sign in with Google" with the
**same email** (or the reverse). Whether Supabase treats this as **one** human (one `auth.users` row →
one profile) or **two** depends on a project setting, not on app code.

**Required owner setting (Supabase → Authentication → Providers / Settings):**

- **Enable "Link accounts with the same email"** (automatic identity linking for **verified** emails). With
  it on, the second provider attaches a new identity to the **existing** `auth.users.id`, so
  `ensureProfileForAuthUser` resolves the existing profile (keyed on `id`) and **no** second profile is
  created. This is the intended state.
- Linking only fires for a **verified** email on the existing identity (Supabase will not auto-merge an
  unverified one — anti-takeover). Email/password signups must therefore confirm their email (AL-3) for the
  later Google sign-in to merge rather than collide.

**Code is config-agnostic (holds even if the toggle is wrong).** Independent of the dashboard state, the
app never forks one human into two profiles:

- Hard DB backstop: genesis `idx_profiles_email_active` — `UNIQUE (lower(email)) WHERE deleted_at IS NULL`
  — makes a second profile for the same email impossible at the database layer.
- Clean surface over it: `ensureProfileForAuthUser` (`server/lib/profile-bootstrap.ts`) pre-checks the email
  under a different auth id and translates the index's `23505` race into a typed
  `AccountEmailConflictError` → the OAuth callback redirects to `/login?error=account_exists` and the auth
  middleware returns `409 ACCOUNT_EMAIL_CONFLICT` ("sign in with your original method"), never a 500 and
  never a duplicate. Proven in `tests/ci/account-linking.contract.test.ts`.

**Net:** turn the toggle on for the seamless one-profile experience; the code guarantees profile-per-human
regardless. If the toggle is off, a same-email second provider is a deliberate, explained conflict, not a
silent duplicate.
