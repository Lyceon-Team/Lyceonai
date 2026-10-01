# Pass 2-B — endpoint / guard / caller inventory

Snapshot: origin/main @ d2902eec, extracted at `scratchpad/main`. All paths below relative to that root.

## Legend

**Global stack (G)** — applied to every route registered after it in `server/index.ts`:
`requestIdMiddleware` (index.ts:102) → `securityHeadersMiddleware` (:103) → `corsAllowlist` (:106) → `cookieParser` (:116) → `express.json` (:177) → `globalRateLimiter` (:200, def :194) → `supabaseAuthMiddleware` (:210; def `server/middleware/supabase-auth.ts:470`, sets `req.user`) → `enforceDeletionLock` (:216; def supabase-auth.ts:656).
**G-pre** = only requestId/securityHeaders/cors/cookieParser (routes registered at index.ts:121/171, before `express.json`).

Middleware definitions:
- `requireSupabaseAuth` — server/middleware/supabase-auth.ts:615
- `requireStudentOrAdmin` — supabase-auth.ts:889 (403 when `isGuardian && !isAdmin`; under-13-without-consent block)
- `requireStudentOnly` — supabase-auth.ts:828 (403 when `role !== "student"`; unconditional under-13 age gate)
- `requireProfileComplete` — supabase-auth.ts:780
- `requireConsentCompliance` — supabase-auth.ts:753
- `requireSupabaseAdmin` — supabase-auth.ts:719
- `doubleCsrfProtection` — server/middleware/csrf-double-submit.ts:149 (ignores GET/HEAD/OPTIONS)
- `resolveSubject` — server/middleware/subject-resolver.ts:83 (self → `via:"self"`; else `resolveGuardianViewDecision` → allow/402 `student_unentitled`/404; access recorded, fail-closed 500 on unrecorded)
- `requireRequestUser` — supabase-auth.ts:235 (in-handler 401 helper)
- `authRateLimiter` — server/routes/supabase-auth-routes.ts:24
- `tutorLimiter` — index.ts:356; `googleOAuthCallbackLimiter` — index.ts:362
- `practiceAnswerRateLimiter` — server/routes/practice-canonical.ts:302 (imported by review-canonical.ts:59)
- `studentLinkCodeRegenerationRateLimit` — server/middleware/guardian-link-rate-limit.ts:66; `applyGuardianInviteRateLimit` in-handler student-resources.ts:904
- Practice quota: `reservePracticeQuestionQuota` practice-canonical.ts:1097 → `checkAndReservePracticeQuota` apps/api/src/lib/rate-limit-ledger.ts:146 (RPC `check_and_reserve_practice_quota`; admin bypass at :156). This is a usage quota (402 "Usage limit reached"), not a feature-entitlement call.
- Tutor entitlement: `denyIfNotEntitled` tutor-runtime.ts:205 → `EntitlementService.isEntitlementActiveForProfile` (:210)
- Student-resources entitlement: `entitlementGate` student-resources.ts:199 → `EntitlementService.canAccessFeature(subject, requiresEntitlement[path])` (table :134-154)
- Calendar streak: `callerOf` calendar-routes.ts:156 (401 only)

"PRAC stack" = mount `requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection` + route-level `requireSupabaseAuth, requireProfileComplete, requireConsentCompliance` (requireSupabaseAuth runs twice).

Mount points (server/index.ts):
| Mount | Line | Mount middleware |
|---|---|---|
| `/api/legal` → legalRouter | 219 | requireSupabaseAuth, doubleCsrfProtection |
| `/api/tutor` → tutorRuntimeRouter | 390-398 | tutorLimiter, requireSupabaseAuth, requireStudentOnly, doubleCsrfProtection, awaitTutorConfig |
| `/auth` → oauthCallbackRoutes | 403 | googleOAuthCallbackLimiter |
| `/api/auth/callback` (app.get → nativeOAuthCallbackHandler) | 405-409 | googleOAuthCallbackLimiter |
| `/api/auth` → supabaseAuthRoutes | 412 | none (per-route) |
| `/api/profile` → profileRoutes | 426-431 | requireSupabaseAuth, doubleCsrfProtection |
| `/api/notifications` (`NOTIFICATION_API_MOUNT`, packages/shared/src/notifications-schema.ts:201) → notificationsRouter | 435-440 | requireSupabaseAuth, doubleCsrfProtection |
| `/api/students` → studentResourceRoutes | 448-453 | requireSupabaseAuth, doubleCsrfProtection (NO role gate by design) |
| `/api/me` → streakRouter (defined server/routes/calendar-routes.ts:81 — not in services/lib) | 472 | requireSupabaseAuth, requireStudentOrAdmin |
| `/api/questions*` app.get/app.post | 518-606 | per-route |
| `/api/public` → publicPricingRoutes | 630 | none |
| `/api/practice/topics`, `/api/practice/reference/questions` app.get | 643-654 | requireSupabaseAuth, requireStudentOrAdmin |
| `/api/practice` → practiceCanonicalRouter | 670-676 | requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection |
| `/api/review` → reviewCanonicalRouter | 711-717 | requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection |
| `POST /api/webhooks/resend` (`RESEND_WEBHOOK_PATH`, notifications-schema.ts:301) | 171-175 | express.raw only (G-pre) |

No `Router()` exists under `server/services` or `server/lib` (`grep -rn "Router()" server/services server/lib` → no output).

---

## Endpoint table

| Path | Method | File:line | Auth guard | Entitlement | Role guard | Callers (file:line) | Caller surface |
|---|---|---|---|---|---|---|---|
| /api/legal/accept | POST | server/routes/legal-routes.ts:26 | G + requireSupabaseAuth, doubleCsrfProtection (index.ts:219) | none | none | Handler returns 404 unconditionally. Client helper `recordAcceptance` client/src/lib/legal.ts:55 (fetch :59) has zero importers — see grep G1 | none |
| /api/legal/reaccept | POST | legal-routes.ts:55 | G + requireSupabaseAuth, doubleCsrfProtection (index.ts:219); in-handler requireRequestUser (:60) | none | none | client/src/components/legal/ReconsentModal.tsx:113, rendered by components/auth/RequireRole.tsx:7 (wraps every RequireRole page) | student + guardian + admin (SHARED) |
| /api/legal/acceptances | GET | legal-routes.ts:173 | G + requireSupabaseAuth, doubleCsrfProtection (index.ts:219); in-handler `(req as any).user?.id` 401 (:175) | none | none | Helper `fetchUserAcceptances` client/src/lib/legal.ts:81 (fetch :91) has zero importers — grep G1 | none |
| /api/notifications | GET | server/routes/notifications.ts:101 | G + requireSupabaseAuth, doubleCsrfProtection (index.ts:435) | none | none | client/src/lib/notificationsApi.ts:78 via components/notifications/NotificationBell.tsx:58 (in layout/app-shell.tsx:21 and layout/GuardianShell.tsx:22), pages/notifications.tsx:75 (App.tsx:320, allow student/guardian/admin) | student + guardian (SHARED) |
| /api/notifications/unread-count | GET | notifications.ts:196 | same as above | none | none | notificationsApi.ts:63 via NotificationBell.tsx:49, pages/notifications.tsx:83 | student + guardian (SHARED) |
| /api/notifications/mark-all-seen | POST | notifications.ts:225 | same | none | none | notificationsApi.ts:85 via NotificationBell.tsx:68, pages/notifications.tsx:93 | student + guardian (SHARED) |
| /api/notifications/mark-all-read | POST | notifications.ts:258 | same | none | none | notificationsApi.ts:95 via pages/notifications.tsx:101 | student + guardian (SHARED) |
| /api/notifications/:message_id | PATCH | notifications.ts:287 | same | none | none | notificationsApi.ts:108 via NotificationBell.tsx:76, pages/notifications.tsx:106,111 | student + guardian (SHARED) |
| /auth/callback | GET | server/routes/oauth-callback-routes.ts:422 → nativeOAuthCallbackHandler :142 | G + googleOAuthCallbackLimiter (index.ts:403); no auth (OAuth landing) | none | none (post-login redirect branches on profile.role, :352) | SYSTEM: browser redirect from Supabase OAuth; `redirectTo` built at client/src/contexts/SupabaseAuthContext.tsx:343 and passed to `supabase.auth.signInWithOAuth` :346. vercel.json:46 routes `^/auth/callback$` → `/api/index` | system (OAuth callback) |
| /api/auth/callback | GET | server/index.ts:405 → oauth-callback-routes.ts:142 | G + googleOAuthCallbackLimiter | none | none | No client caller — grep G6. Comment index.ts:404 names it a Vercel alias | system (OAuth alias) — see ambiguity 3 |
| /api/auth/signup | POST | server/routes/supabase-auth-routes.ts:83 | G + authRateLimiter, doubleCsrfProtection (route-level); unauthenticated by design | none | in-handler blocks admin role request `isAdminRoleRequest` (:92) | SupabaseAuthContext.tsx:228 ← components/auth/SupabaseAuthForm.tsx:112 ← pages/login.tsx:5 | public (pre-auth) |
| /api/auth/admin-provision | POST | supabase-auth-routes.ts:316 | G + authRateLimiter, doubleCsrfProtection; in-handler 403 if NODE_ENV=production (:334) or ADMIN_PROVISION_ENABLE≠"true" (:348) | none | none (env-gated) | No client caller — grep G2. Only non-code reference: postman/collections/…/Admin Provision.request.yaml | none |
| /api/auth/signin | POST | supabase-auth-routes.ts:497 | G + authRateLimiter, doubleCsrfProtection | none | none | SupabaseAuthContext.tsx:289 ← SupabaseAuthForm.tsx:99 ← pages/login.tsx | public (pre-auth) |
| /api/auth/signout | POST | supabase-auth-routes.ts:568 | G + doubleCsrfProtection | none | none | SupabaseAuthContext.tsx:366 ← components/layout/HeaderUserMenu.tsx:46,137 (app-shell + GuardianShell), components/navigation.tsx:26, components/NavBar.tsx:21, pages/UserProfile.tsx:149, pages/home.tsx:88, components/account-deletion/PendingDeletionScreen.tsx:115 | student + guardian + admin (SHARED) |
| /api/auth/debug | GET | supabase-auth-routes.ts:615 | G only; in-handler 404 when NODE_ENV=production (:616) | none | none | No client caller — grep G3 | none |
| /api/auth/reset-password | POST | supabase-auth-routes.ts:732 | G + authRateLimiter, doubleCsrfProtection | none | none | SupabaseAuthContext.tsx:388 ← SupabaseAuthForm.tsx:81 ← pages/login.tsx | public (pre-auth) |
| /api/auth/update-password | POST | supabase-auth-routes.ts:797 | G + requireSupabaseAuth, doubleCsrfProtection | none | none | SupabaseAuthContext.tsx:415 ← pages/update-password.tsx:69 (App.tsx:310, allow student/guardian/admin) | student + guardian + admin (SHARED) |
| /api/profile | GET | server/routes/profile-routes.ts:115 | G + requireSupabaseAuth, doubleCsrfProtection (index.ts:426); requireRequestUser (:117) | none | none | components/auth/RequireRole.tsx:51; contexts/SupabaseAuthContext.tsx:84; pages/profile-complete.tsx:104; pages/UserProfile.tsx:131 (queryKey → default queryFn lib/queryClient.ts:98) | student + guardian + admin (SHARED) |
| /api/profile | PATCH | profile-routes.ts:246 | same; requireRequestUser (:248) | none | in-handler: role change vs session role rejected (:259), admin profile rejected (:286), body role enum student/guardian (:105) | pages/profile-complete.tsx:146 (App.tsx:302, allow student/guardian/admin) | student + guardian (SHARED) |
| /api/public/pricing | GET | server/routes/public-pricing-routes.ts:155 | G only (no auth, no CSRF by design, index.ts:630) | none | none | client/src/lib/public-pricing.ts:31 ← pages/home.tsx:71 | public |
| /api/questions | GET | index.ts:518 → server/routes/questions-runtime.ts:107 | G + requireSupabaseAuth, requireStudentOrAdmin | none | requireStudentOrAdmin | No client caller — grep G4 | none |
| /api/questions/recent | GET | index.ts:537 → questions-runtime.ts:146 | G only (anonymous by comment index.ts:538) | none | none | No client caller — grep G4 | none |
| /api/questions/random | GET | index.ts:552 → questions-runtime.ts:182 | G + requireSupabaseAuth, requireStudentOrAdmin | none | requireStudentOrAdmin | No client caller — grep G4 | none |
| /api/questions/count | GET | index.ts:571 → questions-runtime.ts:223 | G + requireSupabaseAuth, requireStudentOrAdmin | none | requireStudentOrAdmin | No client caller — grep G4 | none |
| /api/questions/stats | GET | index.ts:577 → questions-runtime.ts:248 | G + requireSupabaseAuth, requireStudentOrAdmin | none | requireStudentOrAdmin | client/src/pages/practice.tsx:145 (queryKey → default queryFn) | student |
| /api/questions/feed | GET | index.ts:583 → questions-runtime.ts:308 | G + requireSupabaseAuth, requireStudentOrAdmin | none | requireStudentOrAdmin | No client caller — grep G4 | none |
| /api/questions/:id | GET | index.ts:591 → questions-runtime.ts:352 | G + requireSupabaseAuth, requireStudentOrAdmin | none | requireStudentOrAdmin | No client caller — grep G4 | none |
| /api/questions/feedback | POST | index.ts:601 → questions-runtime.ts:492 | G + requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection | none | requireStudentOrAdmin | No client caller — grep G4 | none |
| /api/practice/topics | GET | index.ts:643 → server/routes/practice-topics-routes.ts:44 | G + requireSupabaseAuth, requireStudentOrAdmin | none | requireStudentOrAdmin | pages/practice.tsx:165, pages/review.tsx:135, pages/browse-topics.tsx:58 (queryKey → default queryFn) | student |
| /api/practice/reference/questions | GET | index.ts:649 → practice-topics-routes.ts:94 | G + requireSupabaseAuth, requireStudentOrAdmin | none | requireStudentOrAdmin | pages/browse-topics.tsx:78-88 | student |
| /api/practice/sessions/open | GET | server/routes/practice-canonical.ts:2139 | G + PRAC stack | none | requireStudentOrAdmin (mount) | hooks/useActiveSessions.ts:42 ← pages/practice.tsx:154 | student |
| /api/practice/sessions/:sessionId/resume | POST | practice-canonical.ts:2213 | G + PRAC stack | none | requireStudentOrAdmin | lib/engine-config.ts:148 via hooks/useCanonicalPractice.ts:335 ← components/practice/CanonicalPracticePage.tsx:212 ← pages/resume-practice.tsx:37 | student |
| /api/practice/sessions | POST | practice-canonical.ts:2325 (→ startOrReplaySession :1317) | G + PRAC stack | quota dry-run :1472 and reserve :1736 (checkAndReservePracticeQuota) | requireStudentOrAdmin | hooks/usePractice.ts:255 ← pages/practice.tsx:243; lib/engine-config.ts:147 via useCanonicalPractice.ts:380 | student |
| /api/practice/sessions/:sessionId/terminate | POST | practice-canonical.ts:2400 | G + PRAC stack | none | requireStudentOrAdmin | hooks/useActiveSessions.ts:48-49 ← pages/practice.tsx:154; engine-config.ts:153-154 via useCanonicalPractice.ts:686; (hooks/usePractice.ts:557 inside `terminateSession`, not invoked by practice.tsx — see ambiguity 5) | student |
| /api/practice/sessions/:sessionId/calculator-state | POST | practice-canonical.ts:2475 | G + PRAC stack | none | requireStudentOrAdmin | engine-config.ts:155-156 via useCanonicalPractice.ts:729; (usePractice.ts:616, see ambiguity 5) | student |
| /api/practice/sessions/:sessionId/next | GET | practice-canonical.ts:2562 (→ serveNextForSession :1858) | G + PRAC stack | quota reserve :2079 (reservePracticeQuestionQuota) | requireStudentOrAdmin | engine-config.ts:149-150 via useCanonicalPractice.ts:467; (usePractice.ts:334-337, see ambiguity 5) | student |
| /api/practice/sessions/:sessionId/state | GET | practice-canonical.ts:2612 | G + PRAC stack | none | requireStudentOrAdmin | pages/resume-practice.tsx:70; features/calendar/api/launch.ts:45 (prefetch :157-163 ← useLaunchBlock ← pages/calendar.tsx:97) | student |
| /api/practice/answer | POST | practice-canonical.ts:3985 | G + PRAC stack + practiceAnswerRateLimiter | none | requireStudentOrAdmin | engine-config.ts:151 via useCanonicalPractice.ts:565; (usePractice.ts:412, see ambiguity 5) | student |
| /api/practice/sessions/:sessionId/skip | POST | practice-canonical.ts:3993 | G + PRAC stack + practiceAnswerRateLimiter | none | requireStudentOrAdmin | engine-config.ts:152 via useCanonicalPractice.ts:564; (usePractice.ts:494, see ambiguity 5) | student |
| /api/review/pool | GET | server/routes/review-canonical.ts:1411 | G + PRAC stack (mount index.ts:711) | none (by design, review-canonical.ts:19) | requireStudentOrAdmin | hooks/useReview.ts:56,80-81,97 ← pages/review.tsx:117 | student |
| /api/review/sessions/open | GET | review-canonical.ts:1447 | G + PRAC stack | none | requireStudentOrAdmin | hooks/useReview.ts:57,150 ← pages/review.tsx (useActiveReviewSessions import :78) | student |
| /api/review/sessions | POST | review-canonical.ts:1502 | G + PRAC stack | none | requireStudentOrAdmin | hooks/useReview.ts:237 ← pages/review.tsx (useCreateReviewSession); engine-config.ts:208 via useCanonicalPractice.ts:380 | student |
| /api/review/sessions/:sessionId/state | GET | review-canonical.ts:1590 | G + PRAC stack | none | requireStudentOrAdmin | pages/resume-review.tsx:65; features/calendar/api/launch.ts:56 (prefetch ← pages/calendar.tsx:97) | student |
| /api/review/sessions/:sessionId/next | GET | review-canonical.ts:1646 (→ review's own serveNextForSession :729) | G + PRAC stack | none | requireStudentOrAdmin | engine-config.ts:210-211 via useCanonicalPractice.ts:467 ← CanonicalPracticePage ← pages/resume-review.tsx:37 | student |
| /api/review/sessions/:sessionId/resume | POST | review-canonical.ts:1684 | G + PRAC stack | none | requireStudentOrAdmin | engine-config.ts:209 via useCanonicalPractice.ts:335 ← resume-review.tsx | student |
| /api/review/sessions/:sessionId/terminate | POST | review-canonical.ts:1751 | G + PRAC stack | none | requireStudentOrAdmin | hooks/useReview.ts:159 ← pages/review.tsx; engine-config.ts:214-215 via useCanonicalPractice.ts:686 | student |
| /api/review/sessions/:sessionId/calculator-state | POST | review-canonical.ts:1797 | G + PRAC stack | none | requireStudentOrAdmin | engine-config.ts:216-217 via useCanonicalPractice.ts:729 | student |
| /api/review/answer | POST | review-canonical.ts:1844 | G + PRAC stack + practiceAnswerRateLimiter | none | requireStudentOrAdmin | engine-config.ts:212 via useCanonicalPractice.ts:565 | student |
| /api/review/sessions/:sessionId/skip | POST | review-canonical.ts:1853 | G + PRAC stack + practiceAnswerRateLimiter | none | requireStudentOrAdmin | engine-config.ts:213 via useCanonicalPractice.ts:564 | student |
| /api/students/:studentId/mastery/domains | GET | server/routes/student-resources.ts:270 | G + requireSupabaseAuth, doubleCsrfProtection (index.ts:448) + resolveSubject | entitlementGate `mastery_detail` (:287) + guardian_view_decision in resolver | resolveSubject (self or linked guardian) | lib/masteryApi.ts:77 (fetchMasteryDomains) ← pages/mastery.tsx:170 (student); pages/guardian-dashboard.tsx:192-193 (guardian) | student + guardian (SHARED) |
| /api/students/:studentId/mastery/skills | GET | student-resources.ts:336 | same | entitlementGate `mastery_detail` (:345); guardian gets empty list (:355) | resolveSubject | lib/masteryApi.ts:95 (fetchMasterySkills) ← pages/mastery.tsx:177 | student |
| /api/students/:studentId/kpi/sections | GET | student-resources.ts:385 (registered by `resource()` :219/:226) | same | none (table null) + resolver guardian term | resolveSubject | No client caller — grep G5 | none |
| /api/students/:studentId/kpi/domains | GET | student-resources.ts:389 | same | none (table null) | resolveSubject | No client caller — grep G5 | none |
| /api/students/:studentId/kpi/overall | GET | student-resources.ts:398 | same | none (table null) | resolveSubject | pages/guardian-dashboard.tsx:153-154 | guardian |
| /api/students/:studentId/projections/sections | GET | student-resources.ts:410 | same | none (table null) | resolveSubject | No client caller — grep G5 | none |
| /api/students/:studentId/projections/snapshots | GET | student-resources.ts:414 | same | none (table null) | resolveSubject | No client caller — grep G5 | none |
| /api/students/:studentId/calendar | GET | student-resources.ts:438 | same | entitlementGate `calendar_access` (:447) | resolveSubject | features/calendar/api/client.ts:195 (fetchGuardianCalendar) ← queries.ts:176 useGuardianCalendar ← pages/guardian-student-calendar.tsx:69 (App.tsx:225, allow guardian/admin) | guardian |
| /api/students/:studentId/tests | GET | student-resources.ts:521 | same | entitlementGate `EXAM_FEATURE_KEY` (:530) | resolveSubject | features/exam/api/exam-api.ts:155 ← features/exam/pages/GuardianExamResultsPage.tsx:151 (App.tsx:238) | guardian |
| /api/students/:studentId/tests/:sessionId/report | GET | student-resources.ts:564 | same | entitlementGate `EXAM_FEATURE_KEY` (:573) | resolveSubject | exam-api.ts:161 ← GuardianExamResultsPage.tsx:219 (App.tsx:246) | guardian |
| /api/students/:studentId/link-code | GET | student-resources.ts:648 | same | none | resolveSubject + in-handler `via !== "self"` → 404 (:655) | components/student/StudentLinkCodePanel.tsx:68 ← pages/UserProfile.tsx:650 (rendered only when currentRole==="student", :649) | student |
| /api/students/:studentId/link-code/regenerate | POST | student-resources.ts:728 | same + studentLinkCodeRegenerationRateLimit | none | via==="self" (:736) | StudentLinkCodePanel.tsx:90 ← UserProfile.tsx:650 | student |
| /api/students/:studentId/links | GET | student-resources.ts:786 | same | none | via==="self" (:793) | components/student/StudentGuardiansPanel.tsx:59 ← UserProfile.tsx:655 | student |
| /api/students/:studentId/link-code/invite | POST | student-resources.ts:871 | same; in-handler applyGuardianInviteRateLimit (:904) | none | via==="self" (:878) | StudentLinkCodePanel.tsx:120 ← UserProfile.tsx:650 | student |
| /api/students/:studentId/links/:linkId | DELETE | student-resources.ts:1022 | same | none | via==="self" (:1030) | StudentGuardiansPanel.tsx:86 ← UserProfile.tsx:655 | student |
| /api/me/streak | GET | server/routes/calendar-routes.ts:1022 | G + requireSupabaseAuth, requireStudentOrAdmin (index.ts:472); callerOf 401 (:156) | none (by design, index.ts:468-471) | requireStudentOrAdmin | features/calendar/api/client.ts:45,181 (fetchStreak) ← queries.ts useStreak ← pages/calendar.tsx:87, pages/practice.tsx:182 | student |
| /api/tutor/conversations | POST | server/routes/tutor-runtime.ts:564 | G + tutorLimiter, requireSupabaseAuth, requireStudentOnly, doubleCsrfProtection, awaitTutorConfig (index.ts:390) | denyIfNotEntitled (:575) | requireStudentOnly | hooks/tutor-client.ts:217 (useCreateConversation) ← pages/tutor.tsx:45, pages/chat.tsx:281, components/tutor/ScopedTutorPanel.tsx:114 (← CanonicalPracticePage ← resume-practice / resume-review) | student |
| /api/tutor/messages | POST | tutor-runtime.ts:813 | same | denyIfNotEntitled (:822) | requireStudentOnly | tutor-client.ts:238 (useSendMessage) ← hooks/useTutorTurn.ts:67 ← pages/chat.tsx:39, ScopedTutorPanel.tsx:53 | student |
| /api/tutor/conversations/:conversationId | GET | tutor-runtime.ts:2046 | same | denyIfNotEntitled (:2054) | requireStudentOnly | tutor-client.ts:259-260 (useConversation) ← pages/chat.tsx:278, ScopedTutorPanel.tsx:277 | student |
| /api/tutor/conversations | GET | tutor-runtime.ts:2195 | same | denyIfNotEntitled (:2204) | requireStudentOnly | tutor-client.ts:291-292 (useItemConversation ← ScopedTutorPanel.tsx:113); tutor-client.ts:306-307 (useConversations ← pages/tutor.tsx:44, pages/chat.tsx:280) | student |
| /api/tutor/conversations/:conversationId/end | POST | tutor-runtime.ts:2348 | same | denyIfNotEntitled (:2357) | requireStudentOnly | tutor-client.ts:321-322 (useEndConversation) ← pages/chat.tsx:282, ScopedTutorPanel.tsx:278 | student |
| /api/tutor/conversations/:conversationId/resume | POST | tutor-runtime.ts:2453 | same | denyIfNotEntitled (:2462) | requireStudentOnly | tutor-client.ts:381-382 (useResumeConversation) ← hooks/useTutorTurn.ts:68 | student |
| /api/webhooks/resend | POST | server/index.ts:171 → server/routes/resend-webhook.ts:221 (resendWebhookHandler → processResendWebhook :53) | G-pre + express.raw; Svix signature verification in-handler (verifySvixSignature :94, secret `RESEND_WEBHOOK_SECRET` :77); no session auth, CSRF-exempt | none | none | SYSTEM: Resend (Svix-signed) webhook; contract contracts/notifications.contract.md:197 (C7.1). No client caller — grep G7 | system (Resend webhook) |

---

## Client-direct Supabase calls (client/src, non-test)

| Call | RPC / table | File:line | Page / component |
|---|---|---|---|
| `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } })` | Supabase Auth (Google OAuth, PKCE) — no RPC, no table | client/src/contexts/SupabaseAuthContext.tsx:346 (client from `getSupabaseBrowserClient()` :345; created at client/src/lib/supabase.ts:24 via `createBrowserClient`) | `signInWithGoogle` ← components/auth/SupabaseAuthForm.tsx:161 ← pages/login.tsx:5 (public, pre-auth) |

No `supabase.rpc(`, `supabase.from(`, `.storage`, or `.channel(` calls exist in client/src non-test. Command and output:

```
$ grep -rnE "\.rpc\(|supabase\.from\(|\.from\(\"|\.auth\.|\.storage\b|\.channel\(|getSupabaseBrowserClient\(|createBrowserClient|createClient\(" client/src --include=*.ts --include=*.tsx | grep -vE "\.test\.|__tests__"
client/src/contexts/SupabaseAuthContext.tsx:345:      const supabase = getSupabaseBrowserClient();
client/src/contexts/SupabaseAuthContext.tsx:346:      const { error } = await supabase.auth.signInWithOAuth({
client/src/lib/supabase.ts:1:import { createBrowserClient } from "@supabase/ssr";
client/src/lib/supabase.ts:15:export function getSupabaseBrowserClient(): SupabaseClient {
client/src/lib/supabase.ts:24:    browserClient = createBrowserClient(url, anonKey);
```

---

## No-caller evidence (run from snapshot root)

```
G1 $ grep -rnE 'recordAcceptance|fetchUserAcceptances' client/src --include=*.ts --include=*.tsx | grep -vE '\.test\.|__tests__'
client/src/lib/legal.ts:55:export async function recordAcceptance(
client/src/lib/legal.ts:81:export async function fetchUserAcceptances(): Promise<{
[exit=0]   (definitions only; no importer)

G2 $ grep -rnE 'admin-provision' client/src | grep -vE '\.test\.|__tests__'
[exit=1]

G3 $ grep -rnE 'api/auth/debug|auth/debug' client/src | grep -vE '\.test\.|__tests__'
[exit=1]

G4 $ grep -rnE 'api/questions' client/src --include=*.ts --include=*.tsx | grep -vE '\.test\.|__tests__'
client/src/lib/queryClient.ts:113:      url.includes("/api/questions") &&
client/src/pages/practice.tsx:145:    queryKey: ["/api/questions/stats"],
[exit=0]   (only /stats is called; queryClient.ts:113 is a response-unwrapping branch, not a call)

G5 $ grep -rnE 'kpiSections|kpiDomains|projectionsSections|projectionsSnapshots|kpi/sections|kpi/domains|projections/' client/src | grep -vE '\.test\.|__tests__'
[exit=1]

G6 $ grep -rnE 'api/auth/callback' client/src | grep -vE '\.test\.|__tests__'
[exit=1]

G7 $ grep -rnE 'webhooks/resend|RESEND_WEBHOOK_PATH' client/src | grep -vE '\.test\.|__tests__'
[exit=1]
```

---

## Ambiguities

1. `GET /api/legal/acceptances` reads `(req as any).user?.id` (legal-routes.ts:175) instead of `requireRequestUser`; mount-level requireSupabaseAuth already enforces auth, so the in-handler check is redundant, and the `any` cast is a Coding Standards §3.2 violation.
2. `POST /api/legal/accept` is a live mounted route that always returns 404 (legal-routes.ts:26-28); the client still ships a helper that POSTs to it (lib/legal.ts:55-59) with zero importers. Both are dead code.
3. `GET /api/auth/callback` (index.ts:405): vercel.json:46 rewrites `/auth/callback` to `/api/index`; whether Express then sees `/auth/callback` or `/api/auth/callback` depends on Vercel's rewrite semantics, which this repo does not pin. No client or config references `/api/auth/callback` (G6).
4. Practice/review routers apply `requireSupabaseAuth` at both mount and route level (e.g. practice-canonical.ts:2141, review-canonical.ts:1413) — double execution; the second pass does not change outcome.
5. `hooks/usePractice.ts` defines next/answer/skip/terminate/calculator-state calls (:334, :412, :494, :557, :616), but `pages/practice.tsx` — its only importer (:52) — reads only `startSession`, `quotaExhausted`, `error` (practice.tsx:243, 689-696). Those five call sites are unreached from any page; the live callers for those endpoints are via `engine-config.ts` + `useCanonicalPractice.ts`.
6. Seven `/api/questions*` endpoints (all except `/stats`) have no client caller (G4); `/api/questions/recent` is anonymous (index.ts:537, no auth middleware). Postman collections reference `/feed` and `/feedback`; those are not runtime callers.
7. Four subject resources (`kpi/sections`, `kpi/domains`, `projections/sections`, `projections/snapshots`) have no client caller (G5). `kpi/overall` is called only from the guardian dashboard; the student dashboard uses `/api/progress/kpis` (out of scope) instead.
8. `/api/students/*` mount has no role gate (index.ts:448 comment says this is deliberate); admin callers go through `resolveSubject`'s non-self path (guardian_view_decision), so an admin reading another student gets whatever that decision returns — role-specific admin behaviour is not visible in subject-resolver.ts:83-163.
9. Tutor quota: tutor-runtime.ts:879-881 comment states daily/weekly/monthly quota accounting is "not yet built. Deferred." — only `tutorLimiter` (30/min/IP) bounds usage.
10. Tutor entitlement uses `isEntitlementActiveForProfile` (tutor-runtime.ts:210), not the feature-keyed `canAccessFeature` used by student-resources and calendar — two entitlement predicates across in-scope surfaces.
11. `streakRouter` is defined in `server/routes/calendar-routes.ts:81`, not in server/services or server/lib; no router is defined in those two directories.
