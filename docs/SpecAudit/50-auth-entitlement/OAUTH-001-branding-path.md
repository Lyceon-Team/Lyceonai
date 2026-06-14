# OAUTH-001 — Google consent-screen branding ("Lyceon.ai") path

> Audience: owner decision. Status: **HALT — owner ruling required** (which branding tier; and approval
> to convert the OAuth flow to the native Supabase path). No code converted in this lane; see "What this
> lane changed" at the bottom.
> Grounded in the live code at HEAD `76831d1` and the cited Google/Supabase facts.

---

## 1. The goal

Show **"Lyceon.ai"** as the application identity on the Google account-chooser / consent screen, instead
of a raw Supabase project domain or a bare OAuth client name.

There are two distinct things a user sees on that screen, and they are billed differently:

| Element on the Google screen | What controls it | Cost |
|---|---|---|
| **App name + logo** (the prominent "Choose an account to continue to **Lyceon.ai**" title + icon) | Google Cloud Console → OAuth consent screen (App name, logo, support email) | **FREE** |
| **The "to continue to `<domain>`" / callback authority line** | The domain Google redirects the OAuth handshake through. On the native Supabase path this is the **Supabase project domain** (`<ref>.supabase.co`). | Changing it to `auth.lyceon.ai` needs a Supabase **custom domain** add-on = **$10/mo** (paid plan, not spend-capped); OR a free **vanity subdomain** (`brand.supabase.co`) which still needs a paid plan (Pro+), is experimental/CLI-only, and is mutually exclusive with custom domains. |

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
  provider: 'google',
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

## 5. What this lane changed

Nothing in the OAuth code path. This lane:

- Did **not** edit `server/routes/google-oauth-routes.ts` or any OAuth runtime (no in-lane code change to
  the non-native flow — the conversion is the §4 HALT).
- Produced this findings doc for the owner decision (§3) and flagged the `next.config.js` secret exposure.

Reconciliation note: the conversion in §4 and the secret-env removal should be picked up as a follow-up
once the owner approves (C), because they require dashboard/secret actions.
