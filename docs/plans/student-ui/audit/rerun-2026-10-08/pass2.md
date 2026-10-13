# Pass 2: API inventory (re-run on `d8d8a3c1`)

Paths are relative to the repository root. `IDX` means `server/index.ts`.

## 1. Method

**Handlers.** A script read every non-test file in `server/routes/` and listed each `router.<method>(` and `<name>Router.<method>(` call with its path and inline guards. `IDX` was read by hand for its `app.<method>(` and `app.use(` lines.

| Source | Count |
|---|---|
| Router call sites, 27 files | 132 |
| Endpoints those call sites register | 136 (the `resource()` helper at `server/routes/student-resources.ts:244` registers 5: `kpi/sections`, `kpi/domains`, `kpi/overall`, `projections/sections` and `projections/snapshots`, at `:415,422,437,456,460`) |
| `app.<method>` handlers in `IDX` (`:125,175,216,239,240,309,428,436,443,472,523,529`) | 12 |
| **Total endpoints** | **148** |

The `*` SPA fallback (`IDX:622`) is not counted.

**Callers.** I ran `git grep` over `client/src`, excluding `*.test.*`, `__tests__`, `*.fixture.ts`, `test-harness.tsx` and `test-support`. The search covered each literal path and each path constant: `CALENDAR_ROOT` (`client/src/features/calendar/api/client.ts:44`), `EXAM_ROOT` (`client/src/features/exam/api/exam-api.ts:63`), `TUTOR_API_BASE` (`client/src/hooks/tutor-client.ts:166`), `NOTIFICATIONS_QUERY_ROOT` (`client/src/lib/notificationsApi.ts:30`), `FEEDBACK_API` (`client/src/lib/product-feedback-api.ts:42`), and the shared URL builders `studentResourceUrl` and `student*Url` (`packages/shared/src/student-resources.ts:115-152`).

A query key whose first element is the path is a caller, because the default `queryFn` fetches the key (`client/src/lib/queryClient.ts:33`). The client makes no direct Supabase data calls; the only Supabase client call is `supabase.auth.signInWithOAuth`, as in the original.

**Global chain** (every request, `IDX`): `requestIdMiddleware` (:104) → `securityHeaders` (:105) → `/api` cache default (:107) → `corsAllowlist` (:110) → `cookieParser` (:120) → [Stripe webhook :125, Resend webhook :175] → `express.json` (:181) → `globalRateLimiter` (:209) → [`/api/csrf-token` :216] → `supabaseAuthMiddleware` (:227, non-blocking) → `enforceDeletionLock` (:233).

**Abbreviations.** All middleware is in `server/middleware/supabase-auth.ts` unless noted.

| Abbreviation | Middleware |
|---|---|
| RSA | `requireSupabaseAuth` |
| RSOA | `requireStudentOrAdmin` |
| RSO | `requireStudentOnly` |
| RSACC | `requireStudentAccount` (`:1090`) |
| ADM | `requireSupabaseAdmin` |
| CSRF | `doubleCsrfProtection`; ignores GET |
| PC | `requireProfileComplete` |
| U13 | `requireGuardianLinkForUnder13` |
| RS | `resolveSubject` |
| EG | `entitlementGate` (`server/routes/student-resources.ts:213`) |
| TE | `denyIfNotEntitled` (`server/routes/tutor-runtime.ts:232`) |
| CAL-ENT | `entitled()` (`server/routes/calendar-routes.ts:203`) |
| EXAM-ENT | `authorizeExamCaller` → `canAccessFeature(exam_full_length)` (`server/routes/exam-runtime-routes.ts:138,151`) |
| QUOTA | `checkAndReservePracticeQuota` (`server/routes/practice-canonical.ts:1128`) |

## 2. Mounts

| Mount | `IDX` line | Mount-level chain | Router |
|---|---|---|---|
| `/api/legal` | 236 | RSA, CSRF | `legal-routes.ts` |
| `/api/tutor` | 294-302 | tutorLimiter, RSA, RSO, CSRF, awaitTutorConfig | `tutor-runtime.ts` |
| `/auth` | 307 | googleOAuthCallbackLimiter | `oauth-callback-routes.ts` |
| `/api/auth` | 316 | none (per route) | `supabase-auth-routes.ts` |
| `/api/internal` | 319, 321, 323 | none / awaitTutorConfig / none | `internal-cron-routes.ts`, `internal-memory-routes.ts`, `internal-retention-routes.ts` |
| `/api/profile/background` | 332-338 | RSA, CSRF, RSACC | `student-background-routes.ts` (`studentBackgroundRouter`) |
| `/api/reference` | 346-352 | RSA, CSRF, RSACC | `student-background-routes.ts` (`referenceSearchRouter`) |
| `/api/profile` | 357-362 | RSA, CSRF | `profile-routes.ts` |
| `/api/feedback` | 368-374 | RSA, CSRF, U13 | `product-feedback-routes.ts` |
| `/api/notifications` | 378-383 | RSA, CSRF | `notifications.ts` |
| `/api/students` | 391-396 | RSA, CSRF (no role gate; RS decides) | `student-resources.ts` |
| `/api/calendar` | 403-409 | RSA, CSRF, RSOA | `calendar-routes.ts` |
| `/api/score-report` | 420-426 | RSA, CSRF, RSOA | `score-report-routes.ts` |
| `/api/admin/crisis-review` | 464-468 | CSRF (the router adds RSA and ADM, `admin-crisis-review.ts:63-64`) | `admin-crisis-review.ts` |
| `/api/guardian` | 480-485 | RSA, CSRF | `guardian-routes.ts` |
| `/api/public`, `/api/public/qotd`, `/api/public/cookie-consent` | 500, 507, 513 | none (public, SEO) | `public-pricing-routes.ts`, `public-qotd-routes.ts`, `cookie-consent-routes.ts` |
| `/api/billing` | 516 | none (per route) | `billing-routes.ts` |
| `/api/account` | 519, 520 | none (per route) | `account-routes.ts`, `account-deletion-routes.ts` |
| `/api/practice/diagnostic` | 539-545 | RSA, RSOA, CSRF | `diagnostic-routes.ts` |
| `/api/practice` | 550-556 | RSA, RSOA, CSRF | `practice-canonical.ts` |
| `/api/tests` | 563-569, 578-584 | RSA, RSOA, CSRF (both mounts) | `exam-runtime-routes.ts`, `exam-report-routes.ts` |
| `/api/review` | 593-599 | RSA, RSOA, CSRF | `review-canonical.ts` |

**Gone since the original:**
- the `/api/me` streak mount (`IDX:411-413`, retired by SCL-212);
- the `/api/questions` list, recent, random, count, feed, `:id` and feedback routes (`IDX:470-471`, UI-05);
- `/api/health/practice`, `/api/_whoami`, `/privacy` and `/terms`, and the server-rendered public routes. `IDX` has no `app.<method>` beyond the 12 listed, and `IDX:619` notes that the Express SSR path was removed.

## 3. Student-callable endpoints

"Student-callable" means a signed-in student passes the mount and route guards: mastery and practice under RSOA, tutor under RSO, and the shared routes. Endpoints that refuse a student (guardian-only, admin-only, internal, webhooks) are in §5.

`Caller` is the request line in `client/src`. `none` means the search in §1 found no non-test caller; the evidence is in pass3 §3.

| # | Method | Path | Handler | Guard (mount + route) | Entitlement | Caller (`client/src/…`) |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/csrf-token` | `IDX:216` | none | — | `lib/csrf.ts:10` |
| 2 | POST | `/api/auth/signup` | `supabase-auth-routes.ts:114` | authRateLimiter, CSRF | — | `contexts/SupabaseAuthContext.tsx:372` |
| 3 | POST | `/api/auth/signin` | `:341` | authRateLimiter, CSRF | — | `SupabaseAuthContext.tsx:439` |
| 4 | POST | `/api/auth/signout` | `:419` | CSRF | — | `SupabaseAuthContext.tsx:518` |
| 5 | POST | `/api/auth/reset-password` | `:477` | CSRF | — | `SupabaseAuthContext.tsx:543` |
| 6 | POST | `/api/auth/update-password` | `:557` | RSA, CSRF | — | `SupabaseAuthContext.tsx:566` |
| 7 | POST | `/api/auth/change-password` | `:679` | authRateLimiter, RSA, CSRF | — | `lib/settings-api.ts:72` |
| 8 | GET | `/auth/callback` | `oauth-callback-routes.ts:478` | OAuth limiter, PKCE | — | SYSTEM (OAuth redirect target) |
| 9 | GET | `/api/auth/callback` | `IDX:309` | OAuth limiter | — | SYSTEM (rewrite alias) |
| 10 | POST | `/api/legal/reaccept` | `legal-routes.ts:44` | RSA, CSRF | — | `components/legal/ReconsentModal.tsx:110` |
| 11 | GET | `/api/profile` | `profile-routes.ts:219` | RSA, CSRF | — | `hooks/useProfileQuery.ts:99` |
| 12 | PATCH | `/api/profile` | `:372` | RSA, CSRF | — | `pages/profile-complete.tsx:164` |
| 13 | PUT | `/api/profile/marketing-consent` | `:732` | RSA, CSRF, U13 | — | `lib/product-feedback-api.ts:91` |
| 14 | PATCH | `/api/profile/name` | `:858` | RSA, CSRF, RSACC | — | `lib/settings-api.ts:56` |
| 15 | GET | `/api/profile/background` | `student-background-routes.ts:77` | RSA, CSRF, RSACC | none (by design, `IDX:327-331`) | **none**: held by UI-S8 and OQ-37 |
| 16 | PUT | `/api/profile/background` | `:88` | same | none | **none**: held by UI-S8 and OQ-37 |
| 17 | GET | `/api/reference/colleges` | `:162` | RSA, CSRF, RSACC + ledger limit | none | **none**: held by UI-S8 |
| 18 | GET | `/api/reference/high-schools` | `:167` | same | none | **none**: held by UI-S8 |
| 19 | GET | `/api/feedback/prompt` | `product-feedback-routes.ts:141` | RSA, CSRF, U13 | — | `lib/product-feedback-api.ts:112` (SEO-owned, R28) |
| 20 | POST | `/api/feedback/prompt/dismiss` | `:174` | same | — | `product-feedback-api.ts:137` |
| 21 | POST | `/api/feedback/prompt/trustpilot` | `:185` | same | — | `product-feedback-api.ts:141` |
| 22 | POST | `/api/feedback/reviews` | `:204` | same | — | `product-feedback-api.ts:145` |
| 23 | POST | `/api/feedback/feedback` | `:247` | same | — | `product-feedback-api.ts:158` |
| 24 | GET | `/api/notifications` | `notifications.ts:112` | RSA, CSRF | — | `lib/notificationsApi.ts:80` |
| 25 | GET | `/api/notifications/unread-count` | `:207` | same | — | `notificationsApi.ts:64` |
| 26 | POST | `/api/notifications/mark-all-seen` | `:236` | same | — | `notificationsApi.ts:86` |
| 27 | POST | `/api/notifications/mark-all-read` | `:269` | same | — | `notificationsApi.ts:96` |
| 28 | PATCH | `/api/notifications/:message_id` | `:298` | same | — | `notificationsApi.ts:109` |
| 29 | GET | `/api/students/:id/mastery/domains` | `student-resources.ts:289` | RSA, CSRF, RS, U13 | EG `mastery_detail` (`:307`) | `lib/masteryApi.ts:77`; query keys `pages/mastery.tsx:107`, `practice.tsx:127`, `review.tsx:152`, `TestsHomePage.tsx:178`, `PaidHome.tsx:125` |
| 30 | GET | `/api/students/:id/mastery/skills` | `:358` | RSA, CSRF, RSOA, RS | EG (`:368`) | `masteryApi.ts:95` (`mastery.tsx:114`) |
| 31 | GET | `/api/students/:id/kpi/sections` | `:244` via `:415` | RSA, CSRF, RS, U13 | EG (`:254`) | **none**: held in UI-06 ("`kpi/*` and `/projections/*`, guardian vertical decides") |
| 32 | GET | `/api/students/:id/kpi/domains` | `:244` via `:422` | same | EG | **none**: held in UI-06 |
| 33 | GET | `/api/students/:id/kpi/overall` | `:244` via `:437` | same | EG | **none**: held in UI-06. The original had a guardian caller; `features/guardian/GuardianDashboardTab.tsx:8` now records "no kpi/overall call" |
| 34 | GET | `/api/students/:id/projections/sections` | `:244` via `:456` | same | EG | `lib/projectionApi.ts:141` (`hooks/useHomeProjection.ts:39`) |
| 35 | GET | `/api/students/:id/projections/snapshots` | `:244` via `:460` | same | EG | **none**: held in UI-06 |
| 36 | GET | `/api/students/:id/calendar` | `:484` | RSA, CSRF, RS, U13 | EG (`:494`) | `features/calendar/api/client.ts:194` (the guardian calendar; a student passes RS as `self`) |
| 37 | GET | `/api/students/:id/tests` | `:575` | same | EG (`:585`) | `features/exam/api/exam-api.ts:213` (guardian) |
| 38 | GET | `/api/students/:id/tests/:sessionId/report` | `:619` | same | EG (`:629`) | `exam-api.ts:229` (guardian) |
| 39 | GET | `/api/students/:id/link-code` | `:707` | RSA, CSRF, RS (self) | — | `components/student/StudentLinkCodePanel.tsx:63` |
| 40 | POST | `/api/students/:id/link-code/regenerate` | `:787` | same | — | `StudentLinkCodePanel.tsx:85` |
| 41 | GET | `/api/students/:id/links` | `:845` | same | — | `components/student/StudentGuardiansPanel.tsx:44` |
| 42 | POST | `/api/students/:id/link-code/invite` | `:930` | same | — | `StudentLinkCodePanel.tsx:115` |
| 43 | DELETE | `/api/students/:id/links/:linkId` | `:1081` | same | — | `StudentGuardiansPanel.tsx:87` |
| 44 | GET | `/api/calendar` | `calendar-routes.ts:494` | RSA, CSRF, RSOA | `canAccessFeature` (`:529`) / CAL-ENT (`:543`) | `features/calendar/api/client.ts:162` |
| 45 | GET | `/api/calendar/profile` | `:597` | same | none (OQ-25, ungated) | `client.ts:175` |
| 46 | PUT | `/api/calendar/profile` | `:631` | same | none (OQ-8, SCL-130) | `client.ts:222` |
| 47 | POST | `/api/calendar/plan/regenerate` | `:650` | same | CAL-ENT (`:656`) | `client.ts:273` |
| 48 | POST | `/api/calendar/days/:date/regenerate` | `:752` | same | CAL-ENT (`:705`) | `client.ts:289` |
| 49 | POST | `/api/calendar/days/:date/reset` | `:757` | same | CAL-ENT (`:705`) | `client.ts:305` |
| 50 | PUT | `/api/calendar/days/:date` | `:765` | same | CAL-ENT (`:768`) | `client.ts:239` |
| 51 | POST | `/api/calendar/blocks/:id/launch` | `:851` | same | CAL-ENT (`:856`) | `client.ts:342` |
| 52 | POST | `/api/calendar/blocks/:id/do-it-now` | `:907` | same | CAL-ENT (`:912`) | `client.ts:321` |
| 53 | POST | `/api/calendar/blocks/:id/move` | `:1003` | same | CAL-ENT (`:1009`) | `client.ts:258` |
| 54 | POST | `/api/calendar/acknowledge` | `:1059` | same | CAL-ENT (`:1062`) | `client.ts:357` |
| 55 | GET | `/api/score-report` | `score-report-routes.ts:146` | RSA, CSRF, RSOA | none (by design, `IDX:416-419`) | `pages/score-report.tsx:53,74` (query key) |
| 56 | POST | `/api/score-report` | `:167` | same | none | `score-report.tsx:83` |
| 57 | POST | `/api/score-report/renewal` | `:189` | same | none | `score-report.tsx:105` |
| 58 | GET | `/api/progress/projection` | `IDX:428` → `server/routes/legacy/progress.ts` | RSA, RSOA | payload degrades | `lib/projectionApi.ts:149` (`useHomeProjection.ts:46`; `estimateStatus` only, OQ-36) |
| 59 | GET | `/api/progress/kpis` | `IDX:436` → `legacy/progress.ts` | RSA, RSOA | payload degrades | **none**: only `invalidateQueries` on its key (`hooks/useProgressKpis.ts:40`, called from `features/exam/pages/ExamModulePage.tsx:319` and `hooks/useCanonicalPractice.ts:629`). Its one reader, `useProgressKpis` (`useProgressKpis.ts:28`), has no production caller. **Finding F-1** |
| 60 | POST | `/api/billing/checkout` | `billing-routes.ts:120` | RSA, CSRF, U13 | purchase eligibility | `lib/billing-client.ts:157` |
| 61 | GET | `/api/billing/status` | `:712` | RSA | reads entitlement | `hooks/useBillingStatusQuery.ts:49` |
| 62 | POST | `/api/billing/portal` | `:912` | RSA, CSRF, U13 | — | `billing-client.ts:180` |
| 63 | GET | `/api/billing/plans` | `:1038` | RSA | — | `billing-client.ts:115` |
| 64 | GET | `/api/account/email-suppression` | `account-routes.ts:33` | RSA | — | `components/account/EmailNotificationsCard.tsx:33` (query key) |
| 65 | POST | `/api/account/email-suppression/clear` | `:73` | RSA, CSRF | — | `EmailNotificationsCard.tsx:67` |
| 66 | POST | `/api/account/delete` | `account-deletion-routes.ts:285` | RSA, CSRF | — | `components/account-deletion/DeleteAccountCard.tsx:53` |
| 67 | POST | `/api/account/cancel-deletion` | `:435` | RSA, CSRF | — | `components/account-deletion/PendingDeletionScreen.tsx:40` |
| 68 | POST | `/api/account/recover-deletion` | `:574` | none (token capability; exempt from the deletion lock, `server/middleware/supabase-auth.ts:677`) | — | `pages/account-recover.tsx:38` (email-only page) |
| 69 | GET | `/api/practice/topics` | `IDX:523` | RSA, RSOA | — | `hooks/usePracticeTopics.ts:25` |
| 70 | GET | `/api/practice/reference/questions` | `IDX:529` | RSA, RSOA | — | `pages/browse-topics.tsx:88` **only** (the OQ-3 orphan page; also F-11) |
| 71 | POST | `/api/practice/diagnostic/sessions` | `diagnostic-routes.ts:67` | RSA, RSOA, CSRF | — | `hooks/useDiagnosticStart.ts:54` |
| 72 | GET | `/api/practice/diagnostic/sessions/:id/weakest-skills` | `:469` | same | — | **none**: held in UI-06 ("funnel audit") |
| 73 | GET | `/api/practice/quota` | `practice-canonical.ts:2251` | RSA, RSOA, CSRF + RSA, PC, U13 | read of QUOTA | `hooks/usePracticeQuota.ts:29` |
| 74 | GET | `/api/practice/sessions/open` | `:2324` | same | — | `lib/session-reads.ts:36` → `hooks/useActiveSessions.ts:36` (query key) |
| 75 | POST | `/api/practice/sessions/:id/resume` | `:2415` | same | — | `lib/engine-config.ts:156` |
| 76 | POST | `/api/practice/sessions` | `:2538` | same | QUOTA | `hooks/usePractice.ts:120`; `engine-config.ts:155` |
| 77 | POST | `/api/practice/sessions/:id/terminate` | `:2613` | same | — | `useActiveSessions.ts:45` |
| 78 | POST | `/api/practice/sessions/:id/calculator-state` | `:2688` | same | — | `engine-config.ts:162` |
| 79 | GET | `/api/practice/sessions/:id/next` | `:2775` | same | QUOTA | `engine-config.ts:158` |
| 80 | GET | `/api/practice/sessions/:id/state` | `:2825` | same | — | `pages/resume-practice.tsx:70`; `features/calendar/api/launch.ts:44` |
| 81 | POST | `/api/practice/answer` | `:4121` | same + practiceAnswerRateLimiter | — | `engine-config.ts:159` |
| 82 | POST | `/api/practice/sessions/:id/skip` | `:4129` | same + practiceAnswerRateLimiter | — | `engine-config.ts:160` |
| 83 | POST | `/api/tests/sessions` | `exam-runtime-routes.ts:208` | RSA, RSOA, CSRF, PC, U13 | EXAM-ENT | `features/exam/api/exam-api.ts:247` |
| 84 | GET | `/api/tests/sessions/:id/state` | `:228` | same | EXAM-ENT | `exam-api.ts:126` |
| 85 | POST | `…/sections/:s/modules/:m/start` | `:248` | same | EXAM-ENT | `exam-api.ts:259` |
| 86 | GET | `…/modules/:m/items` | `:273` | same | EXAM-ENT | `exam-api.ts:136` |
| 87 | POST | `/api/tests/answer` | `:298` | same | EXAM-ENT | `exam-api.ts:284` |
| 88 | POST | `…/modules/:m/submit` | `:318` | same | EXAM-ENT | `exam-api.ts:273` |
| 89 | POST | `…/sections/:s/heartbeat` | `:343` | same | EXAM-ENT | `exam-api.ts:308` |
| 90 | GET | `/api/tests/forms` | `:378` | same | EXAM-ENT | `exam-api.ts:119` |
| 91 | GET | `…/modules/:m/workspace` | `:388` | same | EXAM-ENT | `exam-api.ts:147` |
| 92 | PUT | `…/modules/:m/workspace` | `:413` | same | EXAM-ENT | `exam-api.ts:295` |
| 93 | GET | `/api/tests/sessions/:id/report` | `exam-report-routes.ts:189` | same | 200 `unavailable` when lapsed | `exam-api.ts:163` |
| 94 | GET | `/api/tests/sessions/:id/report/status` | `:204` | same | same | `exam-api.ts:176` |
| 95 | GET | `/api/tests/sessions?state=scored` | `:241` | same | entitlement first (OQ-30) | `exam-api.ts:196` |
| 96 | GET | `/api/review/pool` | `review-canonical.ts:1435` | RSA, RSOA, CSRF, PC, U13 | none (free) | `hooks/useReview.ts:86` (query key) |
| 97 | GET | `/api/review/sessions/open` | `:1489` | same | — | `useReview.ts:254` (query key) |
| 98 | POST | `/api/review/sessions` | `:1545` | same | — | `useReview.ts:340`; `engine-config.ts:204` |
| 99 | GET | `/api/review/sessions/:id/state` | `:1633` | same | — | `pages/resume-review.tsx:64`; `launch.ts:55` |
| 100 | GET | `/api/review/sessions/:id/next` | `:1690` | same | — | `engine-config.ts:207` |
| 101 | POST | `/api/review/sessions/:id/resume` | `:1728` | same | — | `engine-config.ts:205` |
| 102 | POST | `/api/review/sessions/:id/terminate` | `:1795` | same | — | `useReview.ts:263` |
| 103 | POST | `/api/review/sessions/:id/calculator-state` | `:1841` | same | — | `engine-config.ts:211` |
| 104 | POST | `/api/review/answer` | `:1888` | same + practiceAnswerRateLimiter | — | `engine-config.ts:208` |
| 105 | POST | `/api/review/sessions/:id/skip` | `:1897` | same + practiceAnswerRateLimiter | — | `engine-config.ts:209` |
| 106 | POST | `/api/tutor/conversations` | `tutor-runtime.ts:642` | tutorLimiter, RSA, RSO, CSRF | TE (`:653`) | `hooks/tutor-client.ts:205` |
| 107 | POST | `/api/tutor/messages` | `:897` | same | TE (`:906`) | `tutor-client.ts:226` |
| 108 | GET | `/api/tutor/conversations/:id` | `:2137` | same | TE (`:2145`) | `tutor-client.ts:248` |
| 109 | GET | `/api/tutor/conversations` | `:2309` | same | TE (`:2318`) | `tutor-client.ts:280,315` |
| 110 | POST | `/api/tutor/conversations/:id/end` | `:2523` | same | TE (`:2532`) | `tutor-client.ts:343` |
| 111 | POST | `/api/tutor/conversations/:id/resume` | `:2656` | same | TE (`:2665`) | `tutor-client.ts:403` |
| 112 | GET | `/healthz` | `IDX:239` | none | — | **none**: held in UI-06 ("may be used by monitors") |
| 113 | GET | `/api/health` | `IDX:240` | none | — | **none**: held in UI-06 |

## 4. UI-06 deletions: still gone

```bash
git grep -nE "_whoami|admin-provision|auth/debug|publishable-key|account/status|account/select|health/practice|legal/accept\b|acceptances" -- server apps/api packages client/src ':!*.test.ts' ':!*.test.tsx'
```

Every hit is a comment recording the deletion (`server/lib/account.ts:291-292`, `server/routes/billing-routes.ts:6`, `server/routes/legal-routes.ts:48`) or the `legal_acceptances` table name. No handler matches. `ls apps/api/src/routes` → `No such file or directory`. `ls server/routes/health-routes.ts` → `No such file or directory`.

`node scripts/ci/retired-endpoints-gate.mjs` (exit 0): `OK: retired endpoints — 3543 file(s) scanned, no caller remains for 14 retired path(s)`. The 14 include the student streak read retired by SCL-212 and the 6 `/api/me/mastery/*` and `/api/me/weakness/*` paths.

## 5. Endpoints that refuse a student (listed only)

| Group | Endpoints (handler) | Caller |
|---|---|---|
| Public (SEO vertical) | `GET /api/public/pricing` (`public-pricing-routes.ts:155`); `GET /api/public/qotd/today`, `/archive`, `/:date`, `POST /today/answer` (`public-qotd-routes.ts:88,120,139,184`); `POST /api/public/cookie-consent` (`cookie-consent-routes.ts:29`) | `lib/public-pricing.ts:31`; `lib/qotd.ts:28`; `lib/analytics/consent.ts:135` |
| Guardian | `GET /api/guardian/students`, `POST /link/redeem`, `DELETE /link/:studentId` (`guardian-routes.ts:147,332,620`); `POST /api/profile/date-of-birth` (`profile-routes.ts:932`, refuses a non-guardian at `:936`) | `hooks/useGuardianStudents.ts:63`; `features/guardian/AddStudentDialog.tsx:43,58`; `features/guardian/GuardianStudentsPage.tsx:76` |
| Admin | `/api/admin/crisis-review/cases`, `cases/:id`, `claim`, `disposition` (`admin-crisis-review.ts:73,127,186,238`) | `pages/admin/CrisisReviewList.tsx:149`; `CrisisReviewDetail.tsx:143,153,164` |
| Admin, **no caller** | `GET /api/admin/crisis-review/sla-breaches` (`admin-crisis-review.ts:304`); `GET /api/admin/db-health` (`IDX:443`); `GET /api/questions/stats` (`IDX:472`, admin-only since UI-07; `client/src/pages/practice.test.tsx:825` asserts the student page never calls it) | none (handoff, findings H-1) |
| Internal: Vercel cron | `internal-cron-routes.ts:58,97,246,312,377,442,485,536,589,634,676` (11 GETs) | `vercel.json:8-48` (11 `path` entries) |
| Internal: OIDC | `POST /crisis-sla-sweep` (`internal-cron-routes.ts:171`; `infra/terraform/cloud-scheduler-crisis.tf:55`); `POST /retention/sweep` (`internal-retention-routes.ts:122`; `infra/terraform/cloud-scheduler.tf:98,177,223`); `POST /memory/compact-writeback` (`internal-memory-routes.ts:92`; Cloud Tasks) | SYSTEM |
| Internal, **no producer** | `POST /api/internal/async/memory-refresh`, `/async/pending-reconciliation` (`internal-memory-routes.ts:193,300`) | held in UI-06 ("LISA backlog") |
| Webhooks | `POST /api/billing/webhook` (`IDX:125`), `POST /api/webhooks/resend` (`IDX:175`) | SYSTEM |
