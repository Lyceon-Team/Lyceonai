# Pass 2-A — Endpoint inventory (server/index.ts inline + mounts; scoped routers; apps/api)

Snapshot: origin/main @ d2902eec, extracted at `scratchpad/main`. All paths are relative to that root.
Deployment: `api/index.ts:1` imports `dist/vercel-api.cjs`, built from `server/index.ts` by `package.json:19` (`build:vercel`). `vercel.json` routes `^/api(?:/.*)?$` and `^/auth/callback$` to `/api/index`; everything else goes to `dist/public` / `index.html`.

## Global middleware chain (applies to every row below, in order)

| # | Middleware | Where |
|---|---|---|
| 1 | `requestIdMiddleware` | index.ts:102 (def middleware/request-id.ts:26) |
| 2 | `securityHeadersMiddleware()` | index.ts:103 (def middleware/security-headers.ts:31) |
| 3 | `corsAllowlist()` | index.ts:106 (def apps/api/src/middleware/cors) |
| 4 | `cookieParser()` | index.ts:116 |
| — | Stripe + Resend webhooks registered HERE (index.ts:121, :171), i.e. before json, rate limiter, and auth |
| 5 | `express.json` + body-parser error handler | index.ts:177-190 |
| 6 | `globalRateLimiter` (1000/IP/15 min) | index.ts:194-200 |
| — | `/api/csrf-token` registered HERE (index.ts:204), i.e. before auth |
| 7 | `supabaseAuthMiddleware` (non-blocking; sets `req.user`) | index.ts:210 (def middleware/supabase-auth.ts:470) |
| 8 | `enforceDeletionLock` (flag `ACCOUNT_DELETION_LIFECYCLE_V2`; /api/* only; passes when no user; pending allowlist supabase-auth.ts:632-637) | index.ts:216 (def supabase-auth.ts:656) |

Middleware definitions used below: `requireSupabaseAuth` supabase-auth.ts:615 (401 only); `requireSupabaseAdmin` :719 (`req.user.isAdmin`); `requireConsentCompliance` :753; `requireProfileComplete` :780; `requireStudentOnly` :828 (role === student); `requireStudentOrAdmin` :889 (blocks guardians); `requireGuardianRole` middleware/guardian-role.ts:13 (guardian or admin); `doubleCsrfProtection` middleware/csrf-double-submit.ts:149 (ignores GET/HEAD/OPTIONS); `oidcAuthMiddlewareWithConfigGuard` packages/shared/internal-auth/verify-oidc-middleware.ts:191; `cronAuthorized()` (in-handler `Authorization: Bearer $CRON_SECRET`, timingSafeEqual) internal-cron-routes.ts:39-49; `guardianLinkCodeEntryRateLimit` middleware/guardian-link-rate-limit.ts:60; `awaitTutorConfig` index.ts:379.

Abbreviations: RSA = requireSupabaseAuth; RSOA = requireStudentOrAdmin; CSRF = doubleCsrfProtection; PC+CC = requireProfileComplete + requireConsentCompliance (route-level `studentGuards`).

## A. app.use mounts in server/index.ts

| Mount | index.ts line | Chain at mount | Router file | In this pass? |
|---|---|---|---|---|
| /api/legal | 219 | RSA, CSRF | legal-routes.ts | no (mount only) |
| /api/tutor | 390-398 | tutorLimiter (30/min), RSA, requireStudentOnly, CSRF, awaitTutorConfig | tutor-runtime.ts | no (mount only) |
| /auth | 403 | googleOAuthCallbackLimiter | oauth-callback-routes.ts | no (mount only) |
| /api/auth | 412 | none | supabase-auth-routes.ts | no (mount only) |
| /api/internal | 415 | none | internal-cron-routes.ts | YES |
| /api/internal | 417 | awaitTutorConfig | internal-memory-routes.ts | YES |
| /api/internal | 419 | none | internal-retention-routes.ts | YES |
| /api/profile | 426-431 | RSA, CSRF | profile-routes.ts | no (mount only) |
| /api/notifications (`NOTIFICATION_API_MOUNT`, packages/shared/src/notifications-schema.ts:201) | 435-440 | RSA, CSRF | notifications.ts | no (mount only) |
| /api/students | 448-453 | RSA, CSRF | student-resources.ts | no (mount only) |
| /api/calendar | 460-466 | RSA, CSRF, RSOA | calendar-routes.ts `calendarRouter` | YES |
| /api/me | 472 | RSA, RSOA | calendar-routes.ts `streakRouter` | YES |
| /api/admin/crisis-review | 510-514 | CSRF (router adds RSA + requireSupabaseAdmin at admin-crisis-review.ts:64-65) | admin-crisis-review.ts | YES |
| /api/guardian | 610-615 | RSA, CSRF | guardian-routes.ts | YES |
| /api/public | 630 | none | public-pricing-routes.ts | no (mount only) |
| /api/billing | 633 | none (per-route) | billing-routes.ts | YES |
| /api/account | 636 | none (per-route) | account-routes.ts | YES |
| /api/account | 637 | none (per-route) | account-deletion-routes.ts | YES |
| /api/health | 640 | none | health-routes.ts | YES |
| /api/practice/diagnostic | 659-665 | RSA, RSOA, CSRF | diagnostic-routes.ts | YES |
| /api/practice | 670-676 | RSA, RSOA, CSRF | practice-canonical.ts | no (mount only) |
| /api/tests | 683-689 | RSA, RSOA, CSRF | exam-runtime-routes.ts | YES |
| /api/tests | 696-702 | RSA, RSOA, CSRF | exam-report-routes.ts | YES |
| /api/review | 711-717 | RSA, RSOA, CSRF | review-canonical.ts | no (mount only) |
| (static) | 840 | `express.static(dist/public)` | — | — |
| (error) | 852 | final error boundary (CSRF errors -> 403 `csrf_blocked`) | — | — |

## B. Endpoint table

| Path | Method | File:line | Auth guard | Entitlement | Role guard | Callers (file:line) | Caller surface |
|---|---|---|---|---|---|---|---|
| /api/billing/webhook (`STRIPE_WEBHOOK_PATH`, server/lib/stripe/webhook-path.ts:16) | POST | server/index.ts:121 | none (Stripe signature: `stripe-signature` header index.ts:126, verified via `processStripeWebhook` -> `webhooks.constructEvent` server/lib/stripe/webhook-handler.ts:2763); `express.raw` | none | none | Stripe (webhook). No client caller: `grep -rn "billing/webhook" client/src \| grep -v test` -> (empty) | system (Stripe) |
| /api/webhooks/resend (`RESEND_WEBHOOK_PATH`, packages/shared/src/notifications-schema.ts:301) | POST | server/index.ts:171 (handler server/routes/resend-webhook.ts:221) | none (Svix signature, `verifySvixSignature` resend-webhook.ts:94); `express.raw` | none | none | Resend (webhook) | system (Resend) |
| /api/csrf-token | GET | server/index.ts:204 | none (registered before supabaseAuthMiddleware) | none | none | client/src/lib/csrf.ts:9 (every csrfFetch/apiRequest mutation) | student/guardian/admin (shared infra) |
| /privacy | ALL | server/index.ts:349 | none | none | none | redirect 301 -> /legal/privacy-policy. Client has a SPA route `/privacy` (client/src/App.tsx:147) — no fetch caller | none (browser nav / SEO) |
| /terms | ALL | server/index.ts:350 | none | none | none | redirect 301 -> /legal/student-terms; SPA route client/src/App.tsx:150 | none (browser nav / SEO) |
| /healthz | GET | server/index.ts:353 | none | none | none | `grep -rn "healthz" client/src --include=*.ts --include=*.tsx \| grep -vE '\.test\.\|__tests__'` -> (empty, exit 1). NOT routed on Vercel: vercel.json routes only `^/api(?:/.*)?$` and `^/auth/callback$` to the function; `/healthz` hits `^/(?!api/).*` -> `/index.html`. External uptime probe unverified from repo. | none |
| /api/health | GET | server/index.ts:354 ("Legacy alias") | none | none | none | `grep -rn "api/health" client/src ...` -> (empty, exit 1) | none |
| /api/tutor/* | (router) | mount server/index.ts:390 | tutorLimiter, RSA, requireStudentOnly, CSRF | in router (not in this pass) | requireStudentOnly (supabase-auth.ts:828) | out of scope | — |
| /api/auth/callback | GET | server/index.ts:405 (handler oauth-callback-routes.ts:142) | googleOAuthCallbackLimiter; none else (PKCE code exchange) | none | none | Supabase OAuth redirect; client builds `/auth/callback` redirectTo at client/src/contexts/SupabaseAuthContext.tsx:343 (the `/auth` mount, oauth-callback-routes.ts:422, serves it; this `/api/auth/callback` is the "Vercel alias" per comment index.ts:404) | system (OAuth redirect) |
| /api/internal/legal-acceptance-drain | GET | server/routes/internal-cron-routes.ts:54 | `cronAuthorized` (Bearer CRON_SECRET) :57 | none | none | vercel.json:8 cron `0 3 * * *` | system (Vercel cron) |
| /api/internal/execute-deletions | GET | internal-cron-routes.ts:93 | `cronAuthorized` :96 | none | none | vercel.json:12 cron `0 2 * * *` | system (Vercel cron) |
| /api/internal/crisis-sla-sweep | POST | internal-cron-routes.ts:167 | `oidcAuthMiddlewareWithConfigGuard(readSlaSweepOidcConfig)` :169 (reader :162) | none | none | infra/terraform/cloud-scheduler-crisis.tf:34 `google_cloud_scheduler_job.crisis_sla_sweep`, uri :55 | system (Cloud Scheduler) |
| /api/internal/stale-session-sweep | GET | internal-cron-routes.ts:242 | `cronAuthorized` :245 | none | none | vercel.json:16 cron `30 3 * * *` | system (Vercel cron) |
| /api/internal/baseline-pending-sweep | GET | internal-cron-routes.ts:308 | `cronAuthorized` :311 | none | none | vercel.json:20 cron `0 4 * * *` | system (Vercel cron) |
| /api/internal/notification-dispatch-sweep | GET | internal-cron-routes.ts:373 | `cronAuthorized` :376 | none | none | vercel.json:24 cron `30 4 * * *` | system (Vercel cron) |
| /api/internal/notification-retention-sweep | GET | internal-cron-routes.ts:438 | `cronAuthorized` :441 | none | none | vercel.json:28 cron `0 5 * * *` | system (Vercel cron) |
| /api/internal/calendar-weekly-regen | GET | internal-cron-routes.ts:481 | `cronAuthorized` :484 | none | none | vercel.json:32 cron `30 5 * * *` | system (Vercel cron) |
| /api/internal/calendar-exam-notify | GET | internal-cron-routes.ts:532 | `cronAuthorized` :535 | none | none | vercel.json:36 cron `0 6 * * *` | system (Vercel cron) |
| /api/internal/memory/compact-writeback | POST | server/routes/internal-memory-routes.ts:91 | mount `awaitTutorConfig` index.ts:417; `oidcAuthMiddlewareWithConfigGuard(readOidcConfig)` :93 (reader :72) | none | none | Cloud Tasks queue `lisa-compaction`, enqueued at server/routes/tutor-runtime.ts:2412-2414 (`enqueueCloudTask`) | system (Cloud Tasks) |
| /api/internal/async/memory-refresh | POST | internal-memory-routes.ts:186 | awaitTutorConfig; OIDC :188 | none | none | NO enqueuer in code: `grep -rn "enqueueCloudTask(" server apps packages --include=*.ts \| grep -v .test.` -> only tutor-runtime.ts:2414 (lisa-compaction) + definition cloud-tasks-enqueue.ts:139. Queue `lisa-memory-refresh` declared only in comment infra/terraform/cloud-tasks.tf:10 | system (declared Cloud Tasks; no producer found) |
| /api/internal/async/pending-reconciliation | POST | internal-memory-routes.ts:287 | awaitTutorConfig; OIDC :289 | none | none | NO producer: same grep as above; `grep -rnE "lisa-pending-reconciliation" --include=*.ts --include=*.tf --include=*.sql .` (excluding tests) -> only infra/terraform/cloud-tasks.tf:11 (comment). No Cloud Scheduler job in infra/terraform/*.tf (`grep -nE "uri\s*=" infra/terraform/*.tf` -> crisis-sla-sweep + 3x retention/sweep only) | system (no producer found) |
| /api/internal/retention/sweep | POST | server/routes/internal-retention-routes.ts:110 | OIDC `oidcAuthMiddlewareWithConfigGuard(readOidcConfig)` :112 | none | none | infra/terraform/cloud-scheduler.tf:69/98 (7d, `30 5 * * *`), :156/177 (90d), :202/223 (180d) | system (Cloud Scheduler) |
| /api/profile/* | (router) | mount index.ts:426 | RSA, CSRF | — | — | out of scope | — |
| /api/notifications/* | (router) | mount index.ts:435 | RSA, CSRF | — | — | out of scope | — |
| /api/students/* | (router) | mount index.ts:448 | RSA, CSRF (subject resolver inside) | — | — | out of scope | — |
| /api/calendar | GET | server/routes/calendar-routes.ts:478 | mount RSA, CSRF (GET ignored), RSOA (index.ts:460-466); in-handler `callerOf` :479 | Conditional: no study profile -> 200 with `entitled` flag from `EntitlementService.canAccessFeature(...,calendar_access)` :513; profile present -> `entitled()` :527 (402 via `sendPaymentRequired`, def :179-197) | RSOA | client/src/features/calendar/api/client.ts:174 `fetchCalendar` <- queries.ts:63/120 `useCalendar` <- client/src/pages/calendar.tsx:79 | student |
| /api/calendar/profile | PUT | calendar-routes.ts:555 | mount RSA, CSRF, RSOA | **none** (no `entitled()` call in handler :555-572) | RSOA | client.ts:211 `putStudyProfile` <- mutations.ts:132 <- pages/calendar.tsx:96 | student |
| /api/calendar/plan/regenerate | POST | calendar-routes.ts:574 | mount RSA, CSRF, RSOA | `entitled()` :580 (402) | RSOA | client.ts:264 `postRegeneratePlan` <- mutations.ts:223 <- pages/calendar.tsx:91 | student |
| /api/calendar/days/:date/regenerate | POST | calendar-routes.ts:676 (handler factory :625) | mount RSA, CSRF, RSOA | `entitled()` :629 (402) | RSOA | client.ts:280 `postRegenerateDay` <- mutations.ts:240 <- pages/calendar.tsx:92 | student |
| /api/calendar/days/:date/reset | POST | calendar-routes.ts:681 (factory :625) | mount RSA, CSRF, RSOA | `entitled()` :629 (402) | RSOA | client.ts:296 `postResetDay` <- mutations.ts:257 <- pages/calendar.tsx:93 | student |
| /api/calendar/days/:date | PUT | calendar-routes.ts:689 | mount RSA, CSRF, RSOA | `entitled()` :692 (402) | RSOA | client.ts:228 `putDay` <- mutations.ts:162 <- pages/calendar.tsx:89 | student |
| /api/calendar/blocks/:id/launch | POST | calendar-routes.ts:775 | mount RSA, CSRF, RSOA | `entitled()` :780 (402) | RSOA | client.ts:333 `postLaunch` <- mutations.ts:333 <- features/calendar/api/launch.ts:130 `useLaunchBlock` <- pages/calendar.tsx:97 | student |
| /api/calendar/blocks/:id/do-it-now | POST | calendar-routes.ts:831 | mount RSA, CSRF, RSOA | `entitled()` :836 (402) | RSOA | client.ts:312 `postDoItNow` <- mutations.ts:275 <- pages/calendar.tsx:94 | student |
| /api/calendar/blocks/:id/move | POST | calendar-routes.ts:927 | mount RSA, CSRF, RSOA | `entitled()` :933 (402) | RSOA | client.ts:249 `postMoveBlock` <- mutations.ts:197 <- pages/calendar.tsx:90 | student |
| /api/calendar/acknowledge | POST | calendar-routes.ts:983 | mount RSA, CSRF, RSOA | `entitled()` :986 (402) | RSOA | client.ts:348 `postAcknowledge` <- mutations.ts:291 <- pages/calendar.tsx:95 | student |
| /api/me/streak | GET | calendar-routes.ts:1022 (`streakRouter`) | mount RSA, RSOA (index.ts:472); no CSRF (GET) | none (deliberate, INV-08-20 per index.ts:468-471) | RSOA | client.ts:180 `fetchStreak` <- queries.ts:152 `useStreak` <- pages/calendar.tsx:87, pages/practice.tsx:182 | student |
| /api/progress/projection | GET | server/index.ts:474 (handler server/routes/legacy/progress.ts:61 `getScoreEstimate`) | RSA, RSOA (route-level index.ts:476-477); in-handler `requireRequestUser` progress.ts:63 | in-handler: `resolvePaidKpiAccessForUser` progress.ts:68; `EntitlementService.canAccessFeature(user.id,"mastery_detail")` :108 (admin bypass :104; `catch {}` -> false :111) — degrades payload, no 402 | RSOA | client/src/lib/projectionApi.ts:122 `fetchScoreEstimate` <- pages/lyceon-dashboard.tsx:123-124, pages/practice.tsx:187-188; components/progress/ScoreProjectionCard.tsx:30-31 (component imported nowhere) | student |
| /api/progress/kpis | GET | server/index.ts:482 (handler legacy/progress.ts:384 `getRecencyKpis`) | RSA, RSOA; in-handler `requireRequestUser` :386 | `resolvePaidKpiAccessForUser` :391; `resolveHistoricalTrendsAccess` :397-398 (admin bypass) — degrades payload | RSOA | default queryFn (client/src/lib/queryClient.ts:99-101 joins queryKey as URL): pages/lyceon-dashboard.tsx:113, pages/practice.tsx:176 | student |
| /api/admin/db-health | GET | server/index.ts:489 | RSA :491 | none | requireSupabaseAdmin :492 | `grep -rn "db-health" client/src --include=*.ts --include=*.tsx \| grep -vE '\.test\.\|__tests__'` -> (empty, exit 1). Comment index.ts:488 "for regression invariants" | none |
| /api/admin/crisis-review/cases | GET | server/routes/admin-crisis-review.ts:74 | mount CSRF (index.ts:512); router RSA :64 | none | requireSupabaseAdmin :65 | client/src/pages/admin/CrisisReviewList.tsx:149 (default queryFn) | admin |
| /api/admin/crisis-review/cases/:id | GET | admin-crisis-review.ts:128 | CSRF, RSA :64 | none | requireSupabaseAdmin :65 | client/src/pages/admin/CrisisReviewDetail.tsx:143-146 (default queryFn) | admin |
| /api/admin/crisis-review/cases/:id/claim | POST | admin-crisis-review.ts:187 | CSRF, RSA :64 | none | requireSupabaseAdmin :65 | CrisisReviewDetail.tsx:153 | admin |
| /api/admin/crisis-review/cases/:id/disposition | POST | admin-crisis-review.ts:239 | CSRF, RSA :64 | none | requireSupabaseAdmin :65 | CrisisReviewDetail.tsx:164 | admin |
| /api/admin/crisis-review/sla-breaches | GET | admin-crisis-review.ts:305 | CSRF, RSA :64 | none | requireSupabaseAdmin :65 | `grep -rn "sla-breaches" client/src --include=*.ts --include=*.tsx \| grep -vE '\.test\.\|__tests__'` -> (empty, exit 1) | none |
| /api/questions | GET | server/index.ts:518 (handler questions-runtime.ts:107) | RSA, RSOA | none | RSOA | `grep -rn "api/questions" client/src ...` -> only client/src/lib/queryClient.ts:113 (response unwrapping) and pages/practice.tsx:145 (`/api/questions/stats`); no caller of bare `/api/questions` | none |
| /api/questions/recent | GET | server/index.ts:537 (handler questions-runtime.ts:146) | **none** (anonymous by design, comment :538) | none | none | `grep -rn "questions/recent" client/src ...` -> (empty, exit 1) | none |
| /api/questions/random | GET | server/index.ts:552 (handler questions-runtime.ts:182) | RSA, RSOA | none | RSOA | `grep -rn "questions/random" client/src ...` -> (empty, exit 1) | none |
| /api/questions/count | GET | server/index.ts:571 (handler :223) | RSA, RSOA | none | RSOA | `grep -rn "questions/count" client/src ...` -> (empty, exit 1) | none |
| /api/questions/stats | GET | server/index.ts:577 (handler :248) | RSA, RSOA | none | RSOA | client/src/pages/practice.tsx:145 (default queryFn) | student |
| /api/questions/feed | GET | server/index.ts:583 (handler :308) | RSA, RSOA | none | RSOA | `grep -rn "questions/feed" client/src ...` -> (empty, exit 1) | none |
| /api/questions/:id | GET | server/index.ts:591 (handler :352) | RSA, RSOA | none | RSOA | no literal or template caller (the `api/questions` grep above returns only queryClient.ts:113 and practice.tsx:145) | none |
| /api/questions/feedback | POST | server/index.ts:601 (handler :492) | RSA, RSOA, CSRF | none | RSOA | `grep -rn "questions/feedback" client/src ...` -> (empty, exit 1). NOTE: registered AFTER `GET /api/questions/:id`, but method differs so no shadowing | none |
| /api/guardian/students | GET | server/routes/guardian-routes.ts:98 | mount RSA, CSRF (index.ts:610-615); route RSA :100 | none as gate; per-student display via `EntitlementService.isEntitlementActiveForProfile` :196 + `getEntitlementForProfile` :199 | `requireGuardianAccess` = `requireGuardianRole` (guardian-routes.ts:45, :101) | client/src/hooks/useGuardianStudents.ts:52 <- pages/guardian-dashboard.tsx:139 | guardian |
| /api/guardian/link/redeem | POST | guardian-routes.ts:285 | mount RSA, CSRF; route RSA :287; `guardianLinkCodeEntryRateLimit` :289 | none (deliberate, comment :267-270) | requireGuardianAccess :288 | client/src/pages/guardian-dashboard.tsx:229 | guardian |
| /api/guardian/link/:studentId | DELETE | guardian-routes.ts:457 | mount RSA, CSRF; route RSA :459 | none | requireGuardianAccess :460 | client/src/pages/guardian-dashboard.tsx:274 | guardian |
| /api/public/* | (router) | mount index.ts:630 | none | — | — | out of scope | — |
| /api/billing/checkout | POST | server/routes/billing-routes.ts:123 | RSA :125, CSRF :126 | purchase eligibility, not access: `evaluateSubjectPurchaseEligibility` :174 (self path), :291 (guardian path), `deniesEntitlement` :371 | in-handler: admin -> 403 :134-137; guardian branch :155 | client/src/lib/billing-client.ts:129 `startSubscriptionCheckout` <- pages/upgrade.tsx:100 (student); components/guardian/GuardianPurchaseCard.tsx:134 <- pages/guardian-dashboard.tsx:55 (guardian) | SHARED student+guardian |
| /api/billing/status | GET | billing-routes.ts:706 | RSA :708 | reads entitlement (display): guardian `resolveLinkedPairPremiumAccessForGuardian` :737; self `getEntitlementForProfile` :826 + `EntitlementService.evaluateEntitlementActive` :827 | in-handler admin -> 403 :715-718 | client/src/pages/UserProfile.tsx:142 (default queryFn; /profile allows student/guardian/admin, App.tsx:294-298); components/billing/PremiumUpgradePrompt.tsx:155 (rendered on pages/lyceon-dashboard.tsx:459, pages/practice.tsx:690, features/calendar/components/CalendarStates.tsx:104, components/tutor/LisaUpgradeCard.tsx:53); components/guardian/CheckoutReturnPoller.tsx:108 (guardian-dashboard.tsx:396); pages/guardian-dashboard.tsx:213 | SHARED student+guardian (+admin via /profile, which gets 403) |
| /api/billing/portal | POST | billing-routes.ts:897 | RSA :899, CSRF :900 | none | in-handler admin -> 403 :907-910 | client/src/lib/billing-client.ts:152 `openBillingPortal` <- hooks/useBillingPortal.ts:55 <- pages/UserProfile.tsx:209, components/billing/PremiumUpgradePrompt.tsx:146, components/guardian/ManageSubscriptionButton.tsx:68, components/guardian/GuardianPurchaseCard.tsx:91 | SHARED student+guardian |
| /api/billing/plans | GET | billing-routes.ts:998 | RSA :1000 | none | none | client/src/lib/billing-client.ts:94 `getBillingPlans` <- pages/upgrade.tsx:81 (student); components/guardian/GuardianPurchaseCard.tsx:124 (guardian) | SHARED student+guardian |
| /api/billing/publishable-key | GET | billing-routes.ts:1050 | **none** | none | none | `grep -rn "publishable-key" client/src --include=*.ts --include=*.tsx \| grep -vE '\.test\.\|__tests__'` -> (empty, exit 1) | none |
| /api/account/status | GET | server/routes/account-routes.ts:15 | RSA :17 | reads `getEntitlementForProfile` :41 + `getDailyUsage` :42 (display only) | none | `grep -rn "account/status" client/src ...` -> (empty, exit 1) | none |
| /api/account/select | POST | account-routes.ts:90 | RSA :92, CSRF :93 | none | none (always 409 `ACCOUNT_SELECTION_DISABLED` :107-111) | `grep -rn "account/select" client/src ...` -> (empty, exit 1) | none |
| /api/account/email-suppression | GET | account-routes.ts:138 | RSA :140 | none | none | client/src/components/account/EmailNotificationsCard.tsx:33/:45 (default queryFn) <- pages/UserProfile.tsx:670 | SHARED student+guardian+admin (/profile) |
| /api/account/email-suppression/clear | POST | account-routes.ts:178 | RSA :180, CSRF :181 | none | none | EmailNotificationsCard.tsx:52 <- UserProfile.tsx:670 | SHARED student+guardian+admin |
| /api/account/delete | POST | server/routes/account-deletion-routes.ts:238 | RSA :240, CSRF :241 | none | none | client/src/components/account-deletion/DeleteAccountCard.tsx:44 <- pages/UserProfile.tsx:671 | SHARED student+guardian+admin |
| /api/account/cancel-deletion | POST | account-deletion-routes.ts:403 | RSA :405, CSRF :406; on enforceDeletionLock pending allowlist (supabase-auth.ts:634) | none | none | client/src/components/account-deletion/PendingDeletionScreen.tsx:37 <- client/src/App.tsx:417 (`DeletionGate`, any role) | SHARED any authenticated role |
| /api/account/recover-deletion | POST | account-deletion-routes.ts:542 | **none** (token capability; 404 when flag off :545-547); no CSRF; on pending allowlist supabase-auth.ts:635 | none | none | client/src/pages/account-recover.tsx:29 (public route `/account/recover`, App.tsx:318) | unauthenticated user (email link) |
| /api/health/practice | GET | server/routes/health-routes.ts:37 | none (404 when NODE_ENV=production :38-40) | none | none | `grep -rn "api/health" client/src ...` -> (empty, exit 1) | none |
| /api/practice/topics | GET | server/index.ts:643 (handler practice-topics-routes.ts:44) | RSA, RSOA | none | RSOA | default queryFn: pages/practice.tsx:165, pages/review.tsx:135, pages/browse-topics.tsx:58 | student |
| /api/practice/reference/questions | GET | server/index.ts:649 (handler practice-topics-routes.ts:94) | RSA, RSOA | none | RSOA | pages/browse-topics.tsx:78-88 | student |
| /api/practice/diagnostic/sessions | POST | server/routes/diagnostic-routes.ts:67 | mount RSA, RSOA, CSRF (index.ts:659-665); in-handler 401 :82-88 | none (no entitlement / usage call in file: `grep -nE "ntitle\|usage\|canAccess" diagnostic-routes.ts` -> only `.limit(1)` at :141, :423) | RSOA | client/src/hooks/useDiagnosticStart.ts:54 <- pages/lyceon-dashboard.tsx:21, components/diagnostic/DiagnosticCTACard.tsx:22, components/diagnostic/DiagnosticPromptModal.tsx:34 | student |
| /api/practice/diagnostic/sessions/:sessionId/weakest-skills | GET | diagnostic-routes.ts:451 | mount RSA, RSOA, CSRF; in-handler 401 :462-468 | none | RSOA | `grep -rn "weakest-skills" client/src --include=*.ts --include=*.tsx \| grep -vE '\.test\.\|__tests__'` -> (empty, exit 1) | none |
| /api/practice/* | (router) | mount index.ts:670 | RSA, RSOA, CSRF | — | — | out of scope | — |
| /api/tests/sessions | POST | server/routes/exam-runtime-routes.ts:181 | mount RSA, RSOA, CSRF (index.ts:683-689); route PC+CC (`studentGuards` :177); `authorizeExamCaller` :185 | `authorizeExamCaller` -> `EntitlementService.canAccessFeature(user.id, exam_full_length)` :129 -> **403** (not 402) :138-146 | RSOA | client/src/features/exam/api/exam-api.ts:173 `createExamSession` <- features/exam/pages/TestsHomePage.tsx:157 | student |
| /api/tests/sessions/:session_id/state | GET | exam-runtime-routes.ts:201 | same + PC+CC; authorizeExamCaller :205 | exam_full_length :129 (403) | RSOA | exam-api.ts:106 `fetchExamSession` <- pages/ExamSessionPage.tsx:45, ExamModulePage.tsx:40 | student |
| /api/tests/sessions/:session_id/sections/:section/modules/:module/start | POST | exam-runtime-routes.ts:221 | same; :225 | exam_full_length (403) | RSOA | exam-api.ts:184 `startExamModule` <- TestsHomePage.tsx:158, ExamSessionPage.tsx:27 | student |
| /api/tests/sessions/:session_id/sections/:section/modules/:module/items | GET | exam-runtime-routes.ts:246 | same; :250 | exam_full_length (403) | RSOA | exam-api.ts:115 `fetchModuleItems` <- ExamModulePage.tsx:134 | student |
| /api/tests/answer | POST | exam-runtime-routes.ts:271 | same; :275 | exam_full_length (403) | RSOA | exam-api.ts:202 `submitExamAnswer` <- ExamModulePage.tsx:313 | student |
| /api/tests/sessions/:session_id/sections/:section/modules/:module/submit | POST | exam-runtime-routes.ts:291 | same; :295 | exam_full_length (403) | RSOA | exam-api.ts:196 `submitExamModule` <- ExamModulePage.tsx:411 | student |
| /api/tests/sessions/:session_id/sections/:section/heartbeat | POST | exam-runtime-routes.ts:316 | same; :320 | exam_full_length (403) | RSOA | exam-api.ts:226 `sendExamHeartbeat` <- features/exam/hooks/useHeartbeat.ts:54, :87 | student |
| /api/tests/forms | GET | exam-runtime-routes.ts:351 | same + PC+CC; :352 | exam_full_length (403) | RSOA | exam-api.ts:101 `fetchExamForms` <- TestsHomePage.tsx:58, ExamSessionPage.tsx:25; also features/calendar/components/FullLengthFields.tsx:56 (rendered in CreateBlockSheet.tsx:221, BlockSheet.tsx:175) | student |
| /api/tests/sessions/:session_id/sections/:section/modules/:module/workspace | GET | exam-runtime-routes.ts:361 | same; :365 | exam_full_length (403) | RSOA | exam-api.ts:124 `fetchModuleWorkspace` <- ExamModulePage.tsx:139 | student |
| /api/tests/sessions/:session_id/sections/:section/modules/:module/workspace | PUT | exam-runtime-routes.ts:386 | same; :390 | exam_full_length (403) | RSOA | exam-api.ts:213 `saveItemWorkspace` <- ExamModulePage.tsx:342 | student |
| /api/tests/sessions/:session_id/report | GET | server/routes/exam-report-routes.ts:135 | mount RSA, RSOA, CSRF (index.ts:696-702) — also traverses the 683 mount chain first; route PC+CC (:133) | ownership first, then `EntitlementService.canAccessFeature(user.id, exam_full_length)` passed into `readExamReport` :85-87; lapsed on owned -> 200 `unavailable` payload | RSOA | exam-api.ts:133 `fetchExamReport` <- features/exam/pages/ExamReportPage.tsx:49 | student |
| /api/tests/sessions/:session_id/report/status | GET | exam-report-routes.ts:145 | same | same :85-87 | RSOA | exam-api.ts:143 `fetchExamReportStatus` <- ExamReportPage.tsx:58 | student |
| /api/review/* | (router) | mount index.ts:711 | RSA, RSOA, CSRF | — | — | out of scope | — |
| /api/_whoami | GET | server/index.ts:720 | none (404 when NODE_ENV=production :721-723) | none | none | `grep -rn "_whoami" client/src ...` -> (empty, exit 1) | none |
| PUBLIC_SSR_ROUTES (16 paths: `/`, `/digital-sat`, `/digital-sat/math`, `/digital-sat/reading-writing`, `/blog`, 5x `/blog/<slug>`, `/trust`, `/trust/evidence`, `/tutor`, `/legal`, `/legal/privacy-policy`, `/legal/student-terms`; server/seo-content.ts:35+) | GET | server/index.ts:781-785 | none | none | none | Not reachable on Vercel (vercel.json sends non-/api paths to filesystem/index.html); serves only in `app.listen` mode | none (SEO; local server only) |
| /legal/:slug | GET | server/index.ts:789 | none | none | none | Same Vercel note as above | none (SEO; local server only) |
| * (SPA fallback; /api/* -> 404 JSON) | GET | server/index.ts:844 | none | none | none | — | none |

## C. apps/api

| Path | Method | File:line | Mounted? | Evidence |
|---|---|---|---|---|
| /healthz | GET | apps/api/src/routes/healthz.ts:6 (inside `registerHealthz`, :5) | **NOT mounted** | `grep -rn "registerHealthz" . --exclude-dir=node_modules` -> only apps/api/src/routes/healthz.ts:5 (the definition). `apps/api/package.json` scripts `dev`/`build` target `src/index.ts`, which does not exist (`ls apps/api/src/index.ts` -> "No such file or directory"). Only other reference: tests/ci/servable-questions-gate.ci.test.ts:44 (allowlist label). `/healthz` served in production build is server/index.ts:353, not this file. |

server/index.ts imports from apps/api only middleware/env/lib (`corsAllowlist` index.ts:43, `env`/`validateEnvironment` :44); guardian-routes/diagnostic-routes import `apps/api/src/lib/supabase-server`. No apps/api router is mounted.
