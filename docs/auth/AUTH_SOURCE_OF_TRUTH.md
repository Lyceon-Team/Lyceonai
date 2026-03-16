# Auth Source Of Truth

## Canonical runtime owners

- Session parsing and request auth context: `server/middleware/supabase-auth.ts`
- Auth routes: `server/routes/supabase-auth-routes.ts`
- Google OAuth routes: `server/routes/google-oauth-routes.ts`
- Profile hydration and profile completion: `server/routes/profile-routes.ts`
- Mounted hydration endpoint: `GET /api/profile`

## Locked runtime rules

- Supabase Auth is the only live identity provider.
- `profiles` is the canonical runtime profile source of truth.
- `/api/profile` is the only current-user hydration endpoint.
- `/api/auth/user` is removed and must remain unmounted.
- Missing or invalid runtime roles normalize to `student` in `server/lib/auth-role.ts`.
- Admin accounts cannot be created through signup or metadata bootstrap.
- Admin provisioning is only allowed through `POST /api/auth/admin-provision` when `ADMN_PASSCODE` is configured and matched.
- Direct runtime role mutation is forbidden. `PATCH /api/profile` rejects `role` changes and sends the user to `support@lyceon.ai`.

## Canonical request flow

1. `server/index.ts` installs `supabaseAuthMiddleware`
2. `supabaseAuthMiddleware` resolves cookie-only auth and attaches `req.user`
3. `requireSupabaseAuth` enforces authenticated access on protected surfaces
4. Route-local role middleware applies next (`requireStudentOrAdmin`, `requireGuardianRole`, `requireSupabaseAdmin`)
5. Route handlers use `requireRequestUser` or `requireRequestAuthContext` for canonical request user reads

## Guardian-link truth

- Runtime guardian-link decisions are sourced from `guardian_links` through `server/lib/account.ts`.
- Canonical helpers:
  - `getGuardianLinkForStudent`
  - `isGuardianLinkedToStudent`
  - `getPrimaryGuardianLink`
  - `createGuardianLink`
  - `revokeGuardianLink`
- Profile-level guardian references are not canonical access truth.

## Account bootstrap timing

- Canonical bootstrap happens during authenticated request setup in `supabaseAuthMiddleware`.
- Additional `ensureAccountForUser(...)` calls remain only where runtime must resolve the linked student account for entitlement or billing ownership.
- Runtime account switching is disabled through `POST /api/account/select`.

## Evidence-backed regression coverage

- `tests/ci/auth-surface.contract.test.ts`
- `tests/ci/auth.ci.test.ts`
- `tests/ci/routes.ci.test.ts`
- `tests/ci/identity-entitlement.contract.test.ts`
