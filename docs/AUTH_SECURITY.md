# Auth and Security Architecture (Server Truth)

## TL;DR

- `profiles` is the only runtime profile source of truth.
- `/api/profile` is the only hydration endpoint used by client runtime.
- Supabase auth runtime is canonicalized in:
  - `server/middleware/supabase-auth.ts`
  - `server/routes/supabase-auth-routes.ts`
  - `server/routes/google-oauth-routes.ts`
- No runtime role-switch feature exists in product surfaces.
- Operational fallback for role corrections is `support@lyceon.ai`.
- Missing/legacy profile roles are normalized to `student`.
- Admin provisioning is fail-closed unless `ADMN_PASSCODE` is configured and explicitly provided to `POST /api/auth/admin-provision`.

## Canonical Runtime Surface

### Auth middleware (token resolution + user attachment)
- `server/middleware/supabase-auth.ts`
  - Resolves auth from `sb-access-token` cookie only.
  - Rejects `Authorization: Bearer ...` for user-facing auth paths.
  - Loads/creates `profiles` row and attaches `req.user`.
  - Applies role guards via `requireSupabaseAuth`, `requireSupabaseAdmin`, `requireStudentOrAdmin`.

### Auth routes
- `server/routes/supabase-auth-routes.ts`
  - `POST /api/auth/signup`
  - `POST /api/auth/signin`
  - `POST /api/auth/signout`
  - `POST /api/auth/consent`
  - `POST /api/auth/refresh`
  - `POST /api/auth/admin-provision` (guarded; not part of normal signup/signin)
  - `GET /api/auth/debug`

### Google OAuth routes
- `server/routes/google-oauth-routes.ts`
  - `GET /api/auth/google/start`
  - `GET /auth/google/callback`
  - `GET /api/auth/google/debug`

### Profile hydration routes
- `server/index.ts` + `server/routes/profile-routes.ts`
  - `GET /api/profile` (hydration payload)
  - `PATCH /api/profile` (profile completion/update)

## Removed/Blocked Legacy Paths

- `GET /api/auth/user` is intentionally absent and should return `404`.
- `POST /api/auth/exchange-session` is intentionally absent and should return `404`.
- Any auth flow that relies on client-held access/refresh tokens is legacy and non-canonical.

## Runtime Flow

### Email/password sign-in
1. Client calls `POST /api/auth/signin`.
2. Server signs in with Supabase Auth.
3. Server sets `sb-access-token` and `sb-refresh-token` as HTTP-only cookies.
4. Client hydrates via `GET /api/profile`.

### Google OAuth sign-in
1. Client/browser requests `GET /api/auth/google/start`.
2. Server redirects to Google OAuth with state cookie.
3. Google redirects to `GET /auth/google/callback`.
4. Server exchanges code, signs in with Supabase, sets HTTP-only cookies.
5. Client hydrates via `GET /api/profile`.

### Profile hydration
1. Client calls `GET /api/profile` with cookies.
2. `requireSupabaseAuth` enforces authentication.
3. Response includes canonical runtime user payload.

## Security Controls

### Cookie-only auth
- Accepted auth cookies: `sb-access-token`, `sb-refresh-token`.
- User-facing auth rejects bearer headers.
- Tokens are not returned in hydration responses.

### CSRF protection
- State-changing auth endpoints enforce CSRF via origin checks.
- `GET` routes remain readable without CSRF headers.

### Role and access enforcement
- Server-side role checks are enforced by middleware and route guards.
- Guardian/student/admin behavior is server-authoritative.
- Missing profile role values are normalized server-side to `student`.
- Profile PATCH rejects direct role mutation requests and returns support-mediated guidance.
- No in-product runtime role-switch endpoint is exposed.

### Admin provisioning guard
- `POST /api/auth/admin-provision` is the only runtime path that can write an admin role.
- Requests fail closed when `ADMN_PASSCODE` is missing.
- Requests fail closed when the provided passcode does not match `ADMN_PASSCODE`.
- Signup/metadata/fallback bootstrap paths cannot create admins.

## Verification Checklist

### Endpoint truth checks
```bash
curl -i http://localhost:5000/api/auth/user
# expected: 404

curl -i http://localhost:5000/api/auth/exchange-session
# expected: 404

curl -i http://localhost:5000/api/profile
# expected: 401 without auth cookie
```

### CI contract checks
- `tests/ci/auth.ci.test.ts`
- `tests/ci/routes.ci.test.ts`
- `tests/ci/security.ci.test.ts`
- `tests/ci/auth-surface.contract.test.ts`

## Non-goals / intentional gaps

- In-product role switching is not implemented by design.
- Role correction and account-state exceptions are handled operationally via `support@lyceon.ai`.

