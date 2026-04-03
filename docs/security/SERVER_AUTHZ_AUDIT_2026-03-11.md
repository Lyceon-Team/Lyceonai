# Server Authorization Audit (Code-Derived)

Date: 2026-03-11
Auditor: Codex (repository evidence only)
Scope: `server/index.ts`, `server/middleware/supabase-auth.ts`, and protected route modules

## Method
1. Reviewed token resolution and middleware gates in `server/middleware/supabase-auth.ts`.
2. Reviewed route mounting and authz middleware chains in `server/index.ts` and guardian/exam routers.
3. Verified sensitive endpoints derive identity from `req.user` (server-attached), not client body/query identity.

## Core Findings

| Control | Evidence | Result |
|---|---|---|
| Cookie-first auth source for user-facing flows | `server/middleware/supabase-auth.ts:34-69` (`resolveTokenFromRequest`) | PASS: bearer header is rejected for user-facing auth resolution |
| Base auth gate | `server/middleware/supabase-auth.ts:409-426` (`requireSupabaseAuth`) | PASS: unauthenticated requests get 401 |
| Admin authz gate | `server/middleware/supabase-auth.ts:429-468` (`requireSupabaseAdmin`) | PASS: non-admin requests get 403 |
| Student-only gate (guardian denied) | `server/middleware/supabase-auth.ts:491-515` (`requireStudentOrAdmin`) | PASS: guardians blocked from student-only surfaces |
| Legal acceptance API protected | `server/index.ts:141` | PASS: `/api/legal/*` mounted behind `requireSupabaseAuth` |
| Tutor endpoint protected | `server/index.ts:272` | PASS: `/api/tutor/v2` requires `requireSupabaseAuth` + `requireStudentOrAdmin` |
| Practice canonical protected | `server/index.ts:488` | PASS: `/api/practice` requires `requireSupabaseAuth` + `requireStudentOrAdmin` |
| Full-length exam API protected | `server/index.ts:492` | PASS: `/api/full-length` requires `requireSupabaseAuth` + `requireStudentOrAdmin` |
| Admin health endpoint protected | `server/index.ts:317` | PASS: `/api/admin/db-health` requires `requireSupabaseAuth` + `requireSupabaseAdmin` |
| Guardian scoped routes protected | `server/routes/guardian-routes.ts:65-505` | PASS: guardian routes require auth + guardian role; sensitive student data routes add entitlement check |

## Identity Source-of-Truth Check
- Full-length exam handlers pass `req.user.id` into service calls (`server/routes/full-length-exam-routes.ts:54,84,119,170,224,268,310,360,408`).
- Practice canonical notes and usage assume authenticated user identity, not client-provided user ID (`server/routes/practice-canonical.ts:520`).
- Middleware attaches `req.user` after Supabase token verification and profile loading (`server/middleware/supabase-auth.ts:197-329`).

## Sensitive-Route Denial Behavior
- User-facing bearer header attempts are explicitly treated as rejected auth source (`server/middleware/supabase-auth.ts:53-58`).
- This preserves server cookie auth as the canonical session source for browser/user flows.

## Residual Risk Notes
1. `service_role` paths remain privileged by design; key custody and environment secret handling are critical.
2. This audit is repository-derived and does not prove runtime env variable correctness or deployed route drift.
3. CSRF coverage on mutating routes is route-level and should remain part of regression tests for new endpoints.

## Conclusion
Current server authorization architecture is consistent with the requirement that server auth remains the source of truth: middleware-enforced authentication, role-based gates at route boundaries, and handler logic deriving identity from server-attached `req.user`.
