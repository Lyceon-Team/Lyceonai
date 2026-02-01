# Server Routes (Express)

## Express app creation + global middleware
- Express app created in `server/index.ts` (`const app = express();`) and trust proxy set immediately after. Evidence: `server/index.ts` lines 81-85.【server/index.ts:L81-L85】
- Global middleware order before most routes: requestIdMiddleware → reqLogger → corsAllowlist → cookieParser → express.json → supabaseAuthMiddleware. Evidence: `server/index.ts` lines 87-133.【server/index.ts:L87-L133】

## Mounted route prefixes and router files
- `/api/legal` → `server/routes/legal-routes.ts` (mounted with `requireSupabaseAuth`). Evidence: `server/index.ts` line 136 and `server/routes/legal-routes.ts` lines 1-70.【server/index.ts:L135-L136】【server/routes/legal-routes.ts:L1-L70】
- `/api/rag` → handler `rag` in `apps/api/src/routes/rag.ts` (mounted directly, not via router). Evidence: `server/index.ts` lines 253-259 and `apps/api/src/routes/rag.ts` lines 1-74.【server/index.ts:L253-L259】【apps/api/src/routes/rag.ts:L1-L74】
- `/api/rag/v2` → `apps/api/src/routes/rag-v2.ts`. Evidence: `server/index.ts` lines 262-269 and `apps/api/src/routes/rag-v2.ts` lines 1-60.【server/index.ts:L262-L269】【apps/api/src/routes/rag-v2.ts:L1-L60】
- `/api/tutor/v2` → `server/routes/tutor-v2.ts`. Evidence: `server/index.ts` line 273 and `server/routes/tutor-v2.ts` lines 10-168.【server/index.ts:L272-L273】【server/routes/tutor-v2.ts:L10-L168】
- `/api/auth/google` → `server/routes/google-oauth-routes.ts`. Evidence: `server/index.ts` line 276 and `server/routes/google-oauth-routes.ts` lines 127-201.【server/index.ts:L275-L276】【server/routes/google-oauth-routes.ts:L127-L201】
- `/auth/google/callback` → `googleCallbackHandler` in `server/routes/google-oauth-routes.ts`. Evidence: `server/index.ts` line 279 and `server/routes/google-oauth-routes.ts` lines 203-220.【server/index.ts:L278-L279】【server/routes/google-oauth-routes.ts:L203-L220】
- `/api/auth` → `server/routes/supabase-auth-routes.ts`. Evidence: `server/index.ts` line 282 and `server/routes/supabase-auth-routes.ts` routes at lines 144-631.【server/index.ts:L281-L282】【server/routes/supabase-auth-routes.ts:L144-L631】
- `/api/notifications` → `server/routes/notification-routes.ts`. Evidence: `server/index.ts` line 310 and `server/routes/notification-routes.ts` lines 11-293.【server/index.ts:L309-L310】【server/routes/notification-routes.ts:L11-L293】
- `/api/me/weakness` → `apps/api/src/routes/weakness.ts`. Evidence: `server/index.ts` line 313 and `apps/api/src/routes/weakness.ts` lines 9-65.【server/index.ts:L312-L314】【apps/api/src/routes/weakness.ts:L9-L65】
- `/api/me/mastery` → `apps/api/src/routes/mastery.ts`. Evidence: `server/index.ts` line 314 and `apps/api/src/routes/mastery.ts` routes at lines 147-292.【server/index.ts:L313-L315】【apps/api/src/routes/mastery.ts:L147-L292】
- `/api/calendar` → `apps/api/src/routes/calendar.ts`. Evidence: `server/index.ts` line 315 and `apps/api/src/routes/calendar.ts` routes at lines 105-397.【server/index.ts:L313-L315】【apps/api/src/routes/calendar.ts:L105-L397】
- `/api/admin` → `server/routes/admin-stats-routes.ts` and `server/routes/admin-health-routes.ts`. Evidence: `server/index.ts` lines 323-327; `server/routes/admin-stats-routes.ts` lines 15-157; `server/routes/admin-health-routes.ts` lines 56-209.【server/index.ts:L323-L327】【server/routes/admin-stats-routes.ts:L15-L157】【server/routes/admin-health-routes.ts:L56-L209】
- `/api/admin/proof` → `server/routes/admin-proof-routes.ts` (mounted with `requireSupabaseAuth` + `requireSupabaseAdmin`). Evidence: `server/index.ts` lines 331-335 and `server/routes/admin-proof-routes.ts` lines 22-181.【server/index.ts:L331-L335】【server/routes/admin-proof-routes.ts:L22-L181】
- `/api/guardian` → `server/routes/guardian-routes.ts`. Evidence: `server/index.ts` line 468 and `server/routes/guardian-routes.ts` lines 51-517.【server/index.ts:L467-L468】【server/routes/guardian-routes.ts:L51-L517】
- `/api/billing` → `server/routes/billing-routes.ts`. Evidence: `server/index.ts` line 471 and `server/routes/billing-routes.ts` lines 68-717.【server/index.ts:L470-L471】【server/routes/billing-routes.ts:L68-L717】
- `/api/account` → `server/routes/account-routes.ts`. Evidence: `server/index.ts` line 474 and `server/routes/account-routes.ts` lines 17-216.【server/index.ts:L473-L474】【server/routes/account-routes.ts:L17-L216】
- `/api/health` → `server/routes/health-routes.ts`. Evidence: `server/index.ts` line 482 and `server/routes/health-routes.ts` lines 38-120.【server/index.ts:L481-L482】【server/routes/health-routes.ts:L38-L120】
- `/api/practice` → `server/routes/practice-canonical.ts` (mounted with `requireSupabaseAuth` + `requireStudentOrAdmin`). Evidence: `server/index.ts` line 487 and `server/routes/practice-canonical.ts` routes at lines 219-306.【server/index.ts:L484-L487】【server/routes/practice-canonical.ts:L219-L306】

## Direct routes in server/index.ts
- `POST /api/billing/webhook` (Stripe webhook, raw body). Middleware: `express.raw`. Access: public. Evidence: `server/index.ts` lines 95-128.【server/index.ts:L95-L128】
- `GET /healthz` and `GET /api/health` (legacy alias). Access: public. Evidence: `server/index.ts` lines 234-236.【server/index.ts:L234-L236】
- `POST /api/rag` with `ragLimiter` → `csrfProtection` → `requireSupabaseAuth` → `requireStudentOrAdmin` → `rag`. Access: user (student/admin). Evidence: `server/index.ts` lines 253-259.【server/index.ts:L253-L259】
- `POST /api/rag/v2/*` via router with `ragLimiter` → `csrfProtection` → `requireSupabaseAuth` → `requireStudentOrAdmin`. Access: user (student/admin). Evidence: `server/index.ts` lines 262-269 and `apps/api/src/routes/rag-v2.ts` lines 25-60.【server/index.ts:L262-L269】【apps/api/src/routes/rag-v2.ts:L25-L60】
- `POST /api/tutor/v2/*` via router with `ragLimiter` → `requireSupabaseAuth` → `requireStudentOrAdmin` → `checkAiChatLimit()`. Access: user (student/admin). Evidence: `server/index.ts` line 273 and `server/middleware/usage-limits.ts` lines 70-75.【server/index.ts:L272-L273】【server/middleware/usage-limits.ts:L70-L75】
- `GET /auth/google/callback`. Access: public. Evidence: `server/index.ts` line 279.【server/index.ts:L278-L279】
- `GET /api/profile` with `requireSupabaseAuth`. Access: user. Evidence: `server/index.ts` lines 284-305.【server/index.ts:L284-L305】
- `GET /api/progress/projection` with `requireSupabaseAuth` → `requireStudentOrAdmin`. Access: user (student/admin). Evidence: `server/index.ts` line 318 and handler in `apps/api/src/routes/progress.ts` lines 439-520.【server/index.ts:L317-L319】【apps/api/src/routes/progress.ts:L439-L520】
- `GET /api/progress/kpis` with `requireSupabaseAuth` → `requireStudentOrAdmin`. Access: user (student/admin). Evidence: `server/index.ts` line 321 and handler in `apps/api/src/routes/progress.ts` lines 526-560.【server/index.ts:L320-L321】【apps/api/src/routes/progress.ts:L526-L560】
- `GET /api/admin/db-health` with `requireSupabaseAdmin`. Access: admin. Evidence: `server/index.ts` lines 338-358.【server/index.ts:L338-L358】
- `GET /api/questions` with `requireSupabaseAuth` → `requireStudentOrAdmin`. Access: user (student/admin). Evidence: `server/index.ts` lines 360-371.【server/index.ts:L360-L371】
- `GET /api/questions/recent` (public preview). Access: public. Evidence: `server/index.ts` lines 373-383.【server/index.ts:L373-L383】
- `GET /api/questions/random` with `requireSupabaseAuth` → `requireStudentOrAdmin`. Access: user (student/admin). Evidence: `server/index.ts` lines 385-394.【server/index.ts:L385-L394】
- `GET /api/questions/count`, `GET /api/questions/stats`, `GET /api/questions/feed` with `requireSupabaseAuth` → `requireStudentOrAdmin`. Access: user (student/admin). Evidence: `server/index.ts` lines 396-398.【server/index.ts:L396-L398】
- `GET /api/questions/search` (public). Access: public. Evidence: `server/index.ts` line 401.【server/index.ts:L400-L401】
- `GET /api/questions/:id` with `requireSupabaseAuth` → `requireStudentOrAdmin`. Access: user (student/admin). Evidence: `server/index.ts` line 404.【server/index.ts:L403-L404】
- `GET /api/review-errors` with `requireSupabaseAuth` → `requireStudentOrAdmin`. Access: user (student/admin). Evidence: `server/index.ts` lines 406-407.【server/index.ts:L406-L407】
- `POST /api/review-errors/attempt` with `csrfProtection` → `requireSupabaseAuth` → `requireStudentOrAdmin`. Access: user (student/admin). Evidence: `server/index.ts` lines 409-411.【server/index.ts:L409-L411】
- `POST /api/questions/validate` with `csrfProtection` → `requireSupabaseAuth` → `requireStudentOrAdmin`. Access: user (student/admin). Handler blocks guardians. Evidence: `server/index.ts` lines 414-415 and `server/routes/questions-validate.ts` lines 7-18.【server/index.ts:L414-L415】【server/routes/questions-validate.ts:L7-L18】
- `POST /api/questions/feedback` with `csrfProtection` → `requireSupabaseAuth` → `requireStudentOrAdmin`. Access: user (student/admin). Evidence: `server/index.ts` lines 417-418.【server/index.ts:L417-L418】
- `GET /api/admin/questions/needs-review`, `GET /api/admin/questions/statistics` with `requireSupabaseAdmin`. Access: admin. Evidence: `server/index.ts` lines 421-422.【server/index.ts:L421-L422】
- `POST /api/admin/questions/:id/approve`, `POST /api/admin/questions/:id/reject` with `csrfProtection` → `requireSupabaseAdmin`. Access: admin. Evidence: `server/index.ts` lines 423-424.【server/index.ts:L423-L424】
- `GET /api/admin/supabase-debug` with `requireSupabaseAdmin`. Access: admin. Evidence: `server/index.ts` lines 426-454.【server/index.ts:L426-L454】
- `POST /api/student/analyze-question` with `csrfProtection` → `studentUploadLimiter` → `requireSupabaseAuth` → `requireStudentOrAdmin`. Access: user (student/admin). Evidence: `server/index.ts` lines 457-464.【server/index.ts:L457-L464】
- `POST /api/documents/upload` with `requireSupabaseAuth` → `requireStudentOrAdmin`. Access: user (student/admin). Evidence: `server/index.ts` lines 476-478.【server/index.ts:L476-L478】
- `GET /api/_whoami` (debug). Access: public. Evidence: `server/index.ts` lines 489-497.【server/index.ts:L489-L497】
- `ALL /privacy` and `ALL /terms` redirect to `/legal/...`. Access: public. Evidence: `server/index.ts` lines 230-232.【server/index.ts:L230-L232】

## Route groups and methods (router-level detail)

### /api/legal (server/routes/legal-routes.ts)
- `POST /api/legal/accept` (requires auth upstream). Middleware: `requireSupabaseAuth` (mount) → handler. Access: user. Evidence: `server/index.ts` line 136 and `server/routes/legal-routes.ts` lines 6-47.【server/index.ts:L135-L136】【server/routes/legal-routes.ts:L6-L47】
- `GET /api/legal/acceptances` (requires auth upstream). Middleware: `requireSupabaseAuth` (mount) → handler. Access: user. Evidence: `server/routes/legal-routes.ts` lines 49-70.【server/routes/legal-routes.ts:L49-L70】

### /api/auth (server/routes/supabase-auth-routes.ts)
- `POST /api/auth/signup` with `csrfProtection`. Access: public. Evidence: `server/routes/supabase-auth-routes.ts` lines 140-249.【server/routes/supabase-auth-routes.ts:L140-L249】
- `POST /api/auth/signin` with `csrfProtection`. Access: public. Evidence: `server/routes/supabase-auth-routes.ts` lines 245-300.【server/routes/supabase-auth-routes.ts:L245-L300】
- `POST /api/auth/signout` with `csrfProtection`. Access: public (clears cookies). Evidence: `server/routes/supabase-auth-routes.ts` lines 303-325.【server/routes/supabase-auth-routes.ts:L303-L325】
- `GET /api/auth/user`. Access: public (returns `{user:null}` if anonymous). Evidence: `server/routes/supabase-auth-routes.ts` lines 329-406.【server/routes/supabase-auth-routes.ts:L329-L406】
- `POST /api/auth/consent` with `csrfProtection` → `requireSupabaseAuth`. Access: user. Evidence: `server/routes/supabase-auth-routes.ts` lines 495-540.【server/routes/supabase-auth-routes.ts:L495-L540】
- `POST /api/auth/exchange-session`. Access: public. Evidence: `server/routes/supabase-auth-routes.ts` lines 543-581.【server/routes/supabase-auth-routes.ts:L543-L581】
- `POST /api/auth/refresh` with `csrfProtection`. Access: public (refresh token required). Evidence: `server/routes/supabase-auth-routes.ts` lines 584-622.【server/routes/supabase-auth-routes.ts:L584-L622】
- `GET /api/auth/debug`. Access: public. Evidence: `server/routes/supabase-auth-routes.ts` lines 625-710.【server/routes/supabase-auth-routes.ts:L625-L710】

### /api/notifications (server/routes/notification-routes.ts)
- `GET /api/notifications` with `requireSupabaseAuth`. Access: user. Evidence: `server/routes/notification-routes.ts` lines 11-107.【server/routes/notification-routes.ts:L11-L107】
- `GET /api/notifications/unread-count` with `requireSupabaseAuth`. Access: user. Evidence: `server/routes/notification-routes.ts` lines 109-162.【server/routes/notification-routes.ts:L109-L162】
- `PATCH /api/notifications/:id/read` with `csrfProtection` → `requireSupabaseAuth`. Access: user. Evidence: `server/routes/notification-routes.ts` lines 164-224.【server/routes/notification-routes.ts:L164-L224】
- `PATCH /api/notifications/mark-all-read` with `csrfProtection` → `requireSupabaseAuth`. Access: user. Evidence: `server/routes/notification-routes.ts` lines 226-293.【server/routes/notification-routes.ts:L226-L293】

### /api/admin (server/routes/admin-stats-routes.ts)
- `GET /api/admin/stats` with `requireSupabaseAdmin`. Access: admin. Evidence: `server/routes/admin-stats-routes.ts` lines 11-41.【server/routes/admin-stats-routes.ts:L11-L41】
- `GET /api/admin/kpis` with `requireSupabaseAdmin`. Access: admin. Evidence: `server/routes/admin-stats-routes.ts` lines 43-96.【server/routes/admin-stats-routes.ts:L43-L96】
- `GET /api/admin/database/schema` with `requireSupabaseAdmin`. Access: admin. Evidence: `server/routes/admin-stats-routes.ts` lines 98-121.【server/routes/admin-stats-routes.ts:L98-L121】
- `GET /api/admin/questions-proof` with `requireSupabaseAdmin`. Access: admin. Evidence: `server/routes/admin-stats-routes.ts` lines 123-157.【server/routes/admin-stats-routes.ts:L123-L157】

### /api/admin (server/routes/admin-health-routes.ts, mounted with requireSupabaseAdmin)
- `GET /api/admin/health` (no per-route middleware; admin enforced by mount). Access: admin. Evidence: `server/index.ts` line 327 and `server/routes/admin-health-routes.ts` lines 56-209.【server/index.ts:L326-L327】【server/routes/admin-health-routes.ts:L56-L209】

### /api/admin/proof (server/routes/admin-proof-routes.ts)
- `GET /api/admin/proof/questions` (admin enforced by mount). Access: admin. Evidence: `server/routes/admin-proof-routes.ts` lines 25-76.【server/routes/admin-proof-routes.ts:L25-L76】
- `POST /api/admin/proof/insert-smoke` with `csrfProtection` (admin enforced by mount). Access: admin. Evidence: `server/routes/admin-proof-routes.ts` lines 79-141.【server/routes/admin-proof-routes.ts:L79-L141】
- `DELETE /api/admin/proof/cleanup-smoke` with `csrfProtection` (admin enforced by mount). Access: admin. Evidence: `server/routes/admin-proof-routes.ts` lines 149-181.【server/routes/admin-proof-routes.ts:L149-L181】

### /api/guardian (server/routes/guardian-routes.ts)
- `GET /api/guardian/students` with `requireSupabaseAuth` → `requireGuardianRole`. Access: guardian/admin. Evidence: `server/routes/guardian-routes.ts` lines 51-72.【server/routes/guardian-routes.ts:L51-L72】
- `POST /api/guardian/link` with `requireSupabaseAuth` → `requireGuardianRole` → `durableRateLimiter`. Access: guardian/admin. Evidence: `server/routes/guardian-routes.ts` lines 74-133.【server/routes/guardian-routes.ts:L74-L133】
- `DELETE /api/guardian/link/:studentId` with `requireSupabaseAuth` → `requireGuardianRole`. Access: guardian/admin. Evidence: `server/routes/guardian-routes.ts` lines 135-182.【server/routes/guardian-routes.ts:L135-L182】
- `GET /api/guardian/students/:studentId/summary` with `requireSupabaseAuth` → `requireGuardianRole` → `requireGuardianEntitlement`. Access: guardian/admin (paid entitlement). Evidence: `server/routes/guardian-routes.ts` lines 184-265 and `server/middleware/guardian-entitlement.ts` lines 6-150.【server/routes/guardian-routes.ts:L184-L265】【server/middleware/guardian-entitlement.ts:L6-L150】
- `GET /api/guardian/students/:studentId/calendar/month` with `requireSupabaseAuth` → `requireGuardianRole` → `requireGuardianEntitlement`. Access: guardian/admin (paid entitlement). Evidence: `server/routes/guardian-routes.ts` lines 323-430.【server/routes/guardian-routes.ts:L323-L430】
- `GET /api/guardian/weaknesses/:studentId` with `requireSupabaseAuth` → `requireGuardianRole` → `requireGuardianEntitlement`. Access: guardian/admin (paid entitlement). Evidence: `server/routes/guardian-routes.ts` lines 435-517.【server/routes/guardian-routes.ts:L435-L517】

### /api/billing (server/routes/billing-routes.ts)
- `POST /api/billing/checkout` with `requireSupabaseAuth`. Access: user (student/guardian). Evidence: `server/routes/billing-routes.ts` lines 68-265.【server/routes/billing-routes.ts:L68-L265】
- `GET /api/billing/status` with `requireSupabaseAuth`. Access: user. Evidence: `server/routes/billing-routes.ts` lines 267-404.【server/routes/billing-routes.ts:L267-L404】
- `GET /api/billing/products` with `requireSupabaseAuth` → `requireGuardianRole`. Access: guardian/admin. Evidence: `server/routes/billing-routes.ts` lines 406-415.【server/routes/billing-routes.ts:L406-L415】
- `GET /api/billing/prices` (public), `GET /api/billing/prices/authenticated` with `requireSupabaseAuth`. Evidence: `server/routes/billing-routes.ts` lines 480-483.【server/routes/billing-routes.ts:L480-L483】
- `GET /api/billing/products/:productId/prices` with `requireSupabaseAuth`. Evidence: `server/routes/billing-routes.ts` lines 483-498.【server/routes/billing-routes.ts:L483-L498】
- `GET /api/billing/portal` (returns 405), `POST /api/billing/portal` with `requireSupabaseAuth`. Evidence: `server/routes/billing-routes.ts` lines 500-557.【server/routes/billing-routes.ts:L500-L557】
- `GET /api/billing/publishable-key` (public). Evidence: `server/routes/billing-routes.ts` lines 561-569.【server/routes/billing-routes.ts:L561-L569】
- `GET /api/billing/debug/env` with `requireSupabaseAuth` → `requireGuardianRole`. Evidence: `server/routes/billing-routes.ts` lines 581-620.【server/routes/billing-routes.ts:L581-L620】
- `GET /api/billing/debug/validate` with `requireSupabaseAuth` → `requireGuardianRole`. Evidence: `server/routes/billing-routes.ts` lines 622-717.【server/routes/billing-routes.ts:L622-L717】

### /api/account (server/routes/account-routes.ts)
- `GET /api/account/bootstrap` with `requireSupabaseAuth`. Access: user. Evidence: `server/routes/account-routes.ts` lines 17-68.【server/routes/account-routes.ts:L17-L68】
- `GET /api/account/status` with `requireSupabaseAuth`. Access: user. Evidence: `server/routes/account-routes.ts` lines 70-145.【server/routes/account-routes.ts:L70-L145】
- `POST /api/account/select` with `requireSupabaseAuth` (guardian-only inside). Access: guardian/admin. Evidence: `server/routes/account-routes.ts` lines 151-216.【server/routes/account-routes.ts:L151-L216】

### /api/health (server/routes/health-routes.ts)
- `GET /api/health/practice` (public). Evidence: `server/routes/health-routes.ts` lines 38-120.【server/routes/health-routes.ts:L38-L120】

### /api/practice (server/routes/practice-canonical.ts)
- `GET /api/practice/next` with `requireSupabaseAuth` → `checkPracticeLimit({ increment: true })` (guardian blocked earlier by `requireStudentOrAdmin` at mount). Access: user (student/admin). Evidence: `server/routes/practice-canonical.ts` lines 219-306 and `server/index.ts` line 487.【server/routes/practice-canonical.ts:L219-L306】【server/index.ts:L484-L487】
- `POST /api/practice/answer` with `requireSupabaseAuth` (guardian blocked earlier by `requireStudentOrAdmin` at mount). Access: user (student/admin). Evidence: `server/routes/practice-canonical.ts` lines 306-460 and `server/index.ts` line 487.【server/routes/practice-canonical.ts:L306-L460】【server/index.ts:L484-L487】

### /api/me/weakness (apps/api/src/routes/weakness.ts)
- `GET /api/me/weakness/skills` (auth enforced by mount). Access: user (student/admin). Evidence: `apps/api/src/routes/weakness.ts` lines 11-63 and `server/index.ts` lines 312-314.【apps/api/src/routes/weakness.ts:L11-L63】【server/index.ts:L312-L314】
- `GET /api/me/weakness/clusters` (auth enforced by mount). Access: user (student/admin). Evidence: `apps/api/src/routes/weakness.ts` lines 39-63.【apps/api/src/routes/weakness.ts:L39-L63】

### /api/me/mastery (apps/api/src/routes/mastery.ts)
- `GET /api/me/mastery/summary` (auth enforced by mount). Access: user (student/admin). Evidence: `apps/api/src/routes/mastery.ts` lines 147-165.【apps/api/src/routes/mastery.ts:L147-L165】
- `GET /api/me/mastery/skills` (auth enforced by mount). Access: user (student/admin). Evidence: `apps/api/src/routes/mastery.ts` lines 167-240.【apps/api/src/routes/mastery.ts:L167-L240】
- `GET /api/me/mastery/weakest` (auth enforced by mount). Access: user (student/admin). Evidence: `apps/api/src/routes/mastery.ts` lines 258-288.【apps/api/src/routes/mastery.ts:L258-L288】
- `POST /api/me/mastery/add-to-plan` (auth enforced by mount). Access: user (student/admin). Evidence: `apps/api/src/routes/mastery.ts` lines 291-340.【apps/api/src/routes/mastery.ts:L291-L340】

### /api/calendar (apps/api/src/routes/calendar.ts)
- `GET /api/calendar/profile` (auth enforced by mount). Access: user (student/admin). Evidence: `apps/api/src/routes/calendar.ts` lines 105-128.【apps/api/src/routes/calendar.ts:L105-L128】
- `PUT /api/calendar/profile` (auth enforced by mount). Access: user (student/admin). Evidence: `apps/api/src/routes/calendar.ts` lines 130-186.【apps/api/src/routes/calendar.ts:L130-L186】
- `GET /api/calendar/streak` (auth enforced by mount). Access: user (student/admin). Evidence: `apps/api/src/routes/calendar.ts` lines 256-279.【apps/api/src/routes/calendar.ts:L256-L279】
- `GET /api/calendar/month` (auth enforced by mount). Access: user (student/admin). Evidence: `apps/api/src/routes/calendar.ts` lines 281-382.【apps/api/src/routes/calendar.ts:L281-L382】
- `PATCH /api/calendar/day/complete` (auth enforced by mount). Access: user (student/admin). Evidence: `apps/api/src/routes/calendar.ts` lines 384-388.【apps/api/src/routes/calendar.ts:L384-L388】
- `POST /api/calendar/generate` (auth enforced by mount). Access: user (student/admin). Evidence: `apps/api/src/routes/calendar.ts` lines 391-397.【apps/api/src/routes/calendar.ts:L391-L397】

## Auth invariants observed
- User-facing auth only accepts `sb-access-token` cookie and rejects `Authorization: Bearer` headers in `resolveTokenFromRequest`. Evidence: `server/middleware/supabase-auth.ts` lines 19-70.【server/middleware/supabase-auth.ts:L19-L70】
- `requireSupabaseAuth` returns 401 when `req.user` missing. Evidence: `server/middleware/supabase-auth.ts` lines 407-424.【server/middleware/supabase-auth.ts:L407-L424】
- `requireSupabaseAdmin` returns 403 for non-admin users. Evidence: `server/middleware/supabase-auth.ts` lines 427-469.【server/middleware/supabase-auth.ts:L427-L469】
- `requireStudentOrAdmin` blocks guardians with 403. Evidence: `server/middleware/supabase-auth.ts` lines 487-521.【server/middleware/supabase-auth.ts:L487-L521】
- CSRF guard checks Origin/Referer on non-GET/HEAD/OPTIONS in non-dev environments. Evidence: `server/middleware/csrf.ts` lines 13-49.【server/middleware/csrf.ts:L13-L49】
