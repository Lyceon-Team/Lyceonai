# Supabase Auth Setup Guide (Current Runtime)

## Scope

This guide documents the active auth setup used by the production Express runtime in `server/**`.

Canonical runtime modules:
- `server/middleware/supabase-auth.ts`
- `server/routes/supabase-auth-routes.ts`
- `server/routes/google-oauth-routes.ts`

Canonical hydration endpoint:
- `GET /api/profile`

## Required Environment Variables

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_SITE_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `ADMN_PASSCODE` (required only for guarded admin provisioning path)

## Auth Endpoints

- `POST /api/auth/signup`
- `POST /api/auth/signin`
- `POST /api/auth/signout`
- `POST /api/auth/consent`
- `POST /api/auth/refresh`
- `POST /api/auth/admin-provision` (guarded)
- `GET /api/auth/debug`
- `GET /api/auth/google/start`
- `GET /auth/google/callback`
- `GET /api/profile`
- `PATCH /api/profile`

## OAuth Redirects

### Google Cloud Console redirect URI
- `https://<your-domain>/auth/google/callback`

### Supabase Auth provider callback
- `https://<your-supabase-project>.supabase.co/auth/v1/callback`

### Site URL
- `PUBLIC_SITE_URL` must be the exact app origin used in runtime redirects.

## Database Truth

- Runtime user/profile data is read from `public.profiles`.
- Runtime identity foreign keys should reference `auth.users(id)`.
- Runtime should not depend on `public.users` writes for auth/session hydration.

## Intentional Legacy Removals

- `GET /api/auth/user` is removed.
- `POST /api/auth/exchange-session` is removed.
- Client-side token exchange flows are not canonical.

## Role and Provisioning Rules

- Missing/legacy profile roles are normalized to `student`.
- Signup and fallback profile bootstrap never assign admin.
- `POST /api/auth/admin-provision` fails closed when `ADMN_PASSCODE` is missing or mismatched.
- Runtime role switching is intentionally not implemented.
- Operational fallback for role/account correction is `support@lyceon.ai`.

## Validation Commands

```bash
curl -i http://localhost:5000/api/auth/user
# expected: 404

curl -i http://localhost:5000/api/auth/exchange-session
# expected: 404

curl -i http://localhost:5000/api/profile
# expected: 401 without auth cookie
```

