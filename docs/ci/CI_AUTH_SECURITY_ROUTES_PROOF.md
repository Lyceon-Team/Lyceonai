## CI Auth/Security/Routes Proof

**Failing tests before fixes**
- `pnpm exec tsc -p tsconfig.ci.json`  
  - `apps/api/src/services/fullLengthExam.ts` type mismatch  
  - `server/routes/supabase-auth-routes.ts` missing `setAuthCookies`, undefined `data`
- `pnpm test:ci`  
  - `tests/ci/security.ci.test.ts` multiple CSRF failures (500s and 404s)  
  - `tests/ci/auth.ci.test.ts` `/api/auth/exchange-session` returned 404/403  
  - `tests/ci/routes.ci.test.ts` public/protected route expectations failed

**Root causes**
- CSRF middleware allowed invalid origins and returned 500s when auth routes threw.  
- Supabase auth routes lacked deterministic test-mode handling, missing `/exchange-session` and `/me`, and signout referenced undefined data.  
- Route classification was ad-hoc; search endpoint hit without query via tests.  
- Type mismatch in full-length exam question projection.

**Commands run**
- `pnpm exec tsc -p tsconfig.ci.json`
- `pnpm test:ci`
- `pnpm build`

**Passing results**
- `pnpm exec tsc -p tsconfig.ci.json` ✅
- `pnpm test:ci` ✅
- `pnpm build` ✅
