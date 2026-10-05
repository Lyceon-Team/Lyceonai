# Route Registry

**The canonical route inventory is `infra/route-surface-classification.yaml`** (Doc 06A §5.3.1; owner
ruling 2026-10-03, SEO Wave 1A). Every client route is classified there — surface class, prerender,
sitemap — and the build, the sitemap and `vercel.json` are derived from it. This document is the prose
companion: `pnpm run route:validate` fails unless its ACTIVE routes are exactly the YAML's rows, which
are exactly the routes `client/src/App.tsx` mounts.

This document records, for those routes:
- All frontend routes in client/src/App.tsx
- Role-based access controls
- Entitlement levels (free/entitled/admin-only)
- Backing server API endpoints
- Route lifecycle status (ACTIVE/STUBBED/DEPRECATED)

**Last Updated:** 2026-10-01 (guardian closeout — Guardian Endpoints rows corrected: `POST /api/guardian/link` is `POST /api/guardian/link/redeem`; the student-resource rows a guardian reads are listed with their real gates; admins are not admitted to guardian routes; `SubscriptionPaywall` replaced by the guardian state matrix.) · 2026-09-27 (G1 — a guardian reads a linked student's full-length practice test results at `/students/:studentId/tests` and `/students/:studentId/tests/:sessionId`, linked per student from the guardian dashboard. Gated server-side on the link AND the STUDENT's entitlement and `exam_full_length` feature; read-only. SCL-180/181.) · 2026-09-25 (E7b — the full-length exam shell: `/tests`, `/tests/:sessionId`, `/tests/:sessionId/:section/:module`, `/tests/:sessionId/report`, and a Tests tab in the student navigation. Client only: every backing endpoint is E6/E7a's, entitlement is enforced there.) · 2026-09-23 (Doc 05F study calendar rebuilt — `/calendar` ACTIVE again, and the guardian read at `/students/:studentId/calendar` added. §16 makes the calendar premium for the SUBJECT, so the guardian route is gated on the STUDENT's entitlement, not the guardian's; `/api/me/streak` is served with no `calendar_access` check at all (INV-08-20).) · 2026-09-22 (Brief 6 — the calendar is REACHABLE: a Calendar tab in the student shell's top navigation, shown to free students too because the page's own 402 renders `PremiumUpgradePrompt` and a hidden tab is a dead end rather than a paywall; and a per-student Calendar link on the guardian dashboard to `/students/:studentId/calendar`. No route is added or retired by this change — both already existed and neither was linked from anywhere.)
**Last Updated:** 2026-09-22 (R4 — the two review CLIENT routes R3 reserved are now real and listed below. Both are `free`: review is free and unlimited, ruling 10, so unlike `/practice/session/:sessionId` neither carries `entitled†`. The loop behind `/review/session/:sessionId` is the SAME component practice uses, pointed at `/api/review/*` by an engine config.)

---

## Complete Route Table

| Route | Roles Allowed | Entitlement | Component | Backing Server Endpoints | Status |
|-------|---------------|-------------|-----------|-------------------------|--------|
| `/` | public | free | HomePage | N/A (static) | ACTIVE |
| `/login` | public | free | Login | `/api/auth/signin`, `/api/auth/signup` | ACTIVE |
| `/signup` | public | free | Redirect→`/login` | N/A | ACTIVE |
| `/update-password` | public | free | UpdatePassword | `/api/auth/update-password` | ACTIVE |
| `/account/recover` | public | free | AccountRecover | `/api/account/recover-deletion` | ACTIVE |
| `/digital-sat` | public | free | DigitalSAT | N/A (static SEO) | ACTIVE |
| `/digital-sat/math` | public | free | DigitalSATMath | N/A (static SEO) | ACTIVE |
| `/digital-sat/reading-writing` | public | free | DigitalSATReadingWriting | N/A (static SEO) | ACTIVE |
| `/blog` | public | free | Blog | N/A (static) | ACTIVE |
| `/blog/:slug` | public | free | BlogPost | N/A (static) | ACTIVE |
| `/sat-question-of-the-day` | public | free | QotdHub | `/api/public/qotd/today`, `/api/public/qotd/today/answer` | ACTIVE |
| `/sat-question-of-the-day/:date` | public | free | QotdArchiveDay | `/api/public/qotd/:date` | ACTIVE |
| `/trust` | public | free | TrustHub | N/A (static SEO) | ACTIVE |
| `/tutor` | public | free | TutorPage | N/A (static SEO) | ACTIVE |
| `/legal` | public | free | LegalHub | N/A (static content) | ACTIVE |
| `/legal/:slug` | public | free | LegalDoc | N/A (static content) | ACTIVE |
| `/privacy` | public | free | Redirect→`/legal/privacy-policy` | N/A | ACTIVE |
| `/terms` | public | free | Redirect→`/legal/student-terms` | N/A | ACTIVE |
| `/dashboard` | student, admin | free | LyceonDashboard | `/api/progress/kpis`, `/api/progress/projection` | ACTIVE |
| `/calendar` | student, admin | entitled† | CalendarPage | `/api/calendar`, `/api/calendar/profile`, `/api/calendar/plan/regenerate`, `/api/calendar/days/:date` (+`/regenerate`, `/reset`), `/api/calendar/blocks/:id/launch` (+`/do-it-now`, `/move`), `/api/calendar/acknowledge`, `/api/me/streak` | ACTIVE |
| `/tests` | student, admin | entitled (exam_full_length, enforced by every backing route) | TestsHomePage | `/api/tests/forms`, `/api/tests/sessions`, `/api/tests/sessions/:session_id/sections/:section/modules/:module/start` | ACTIVE |
| `/tests/:sessionId` | student, admin | entitled (exam_full_length) | ExamSessionPage (begin, Module 2 hand-off, break) | `/api/tests/sessions/:session_id/state`, `…/modules/:module/start`, `/api/tests/forms` | ACTIVE |
| `/tests/:sessionId/:section/:module` | student, admin | entitled (exam_full_length) | ExamModulePage (the URL only shows the server's position; any other module redirects) | `…/state`, `…/modules/:module/items`, `…/modules/:module/workspace` (GET, PUT), `/api/tests/answer`, `…/sections/:section/heartbeat`, `…/modules/:module/submit`, `…/modules/:module/start` | ACTIVE |
| `/tests/:sessionId/report` | student, admin | entitled (lapsed = 200 `unavailable`, Doc 04C §11.5b) | ExamReportPage | `/api/tests/sessions/:session_id/report`, `/api/tests/sessions/:session_id/report/status` | ACTIVE |
| `/chat` | student, admin | entitled† | Chat | `/api/tutor/conversations`, `/api/tutor/messages` (with runtime budget/throttle gates) | ACTIVE |
| `/practice` | student, admin | free | Practice | `/api/questions/stats`, `/api/practice/topics`, `/api/progress/kpis` | ACTIVE |
| `/practice/topics` | student, admin | free | BrowseTopics | `/api/practice/topics`, `/api/practice/reference/questions` | ACTIVE |
| `/practice/math` | student, admin | entitled† | MathPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/practice/reading-writing` | student, admin | entitled† | ReadingWritingPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/practice/random` | student, admin | entitled† | RandomPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/math-practice` | student, admin | entitled† | MathPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/reading-writing-practice` | student, admin | entitled† | ReadingWritingPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/practice/session/:sessionId` | student, admin | entitled† | ResumePractice | `/api/practice/sessions/:sessionId/state`, `/api/practice/sessions/:sessionId/next` | ACTIVE |
| `/review` | student, admin | free | Review | `/api/review/pool`, `/api/review/sessions/open`, `/api/review/sessions`, `/api/practice/topics` | ACTIVE |
| `/review/session/:sessionId` | student, admin | free | ResumeReview | `/api/review/sessions/:sessionId/state`, `/api/review/sessions/:sessionId/next`, `/api/review/answer`, `/api/review/sessions/:sessionId/skip` | ACTIVE |
| `/mastery` | student, admin | free | MasteryPage | `/api/students/{{studentId}}/mastery/domains`, `/api/students/:studentId/mastery/skills` | ACTIVE |
| `/upgrade` | student, admin | free | UpgradePage | Canonical Premium plan-selection page (Monthly/Quarterly/Yearly); `/api/billing/plans`; `/api/billing/checkout` (server-created Stripe Checkout only, no client-side entitlement grant) | ACTIVE |
| `/flow-cards` | student, admin | entitled† | FlowCards | `/api/practice/next`, `/api/practice/answer` (with usage limits) | RETIRED |
| `/structured-practice` | student, admin | entitled† | StructuredPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | RETIRED |
| `/profile` | student, guardian, admin | free | Settings for a student or admin (UI-58: Profile, Account, Guardian, Billing, Appearance; `?tab=` selects the section); UserProfile in GuardianShell for a guardian (G4-08) | `/api/profile`, `PATCH /api/profile/name`, `/api/calendar/profile` (GET, PUT), `POST /api/auth/change-password`, `/api/account/email-suppression`, `POST /api/account/delete`, `/api/students/:studentId/links`, `/api/students/:studentId/link-code` (+`/regenerate`, `/invite`), `/api/billing/status`, `POST /api/billing/portal` | ACTIVE |
| `/help` | student, admin | free | HelpPage (UI-58; OQ-46: the rail's Help, the avatar menu's Help and the footer's "Help and FAQs") | N/A (static; Contact support is `mailto:`) | ACTIVE |
| `/profile/complete` | student, guardian, admin | free | ProfileComplete | `/api/profile`, `/api/legal/accept` | ACTIVE |
| `/guardian-required` | student | free | GuardianRequired (G2-04: an under-13 student with no active guardian link) | `/api/profile`, `/api/students/:studentId/link-code`, `/api/students/:studentId/link-code/regenerate`, `/api/students/:studentId/link-code/invite`, `/api/students/:studentId/links`, `/api/students/:studentId/links/:linkId` | ACTIVE |
| `/score-report` | student, admin | free (SCL-191: the authorisation is the prompt we sent, not an entitlement key — see `server/routes/score-report-routes.ts`) | ScoreReport | `/api/score-report`, `POST /api/score-report`, `POST /api/score-report/renewal` | ACTIVE |
| `/notifications` | student, guardian, admin | free | NotificationsPage | `/api/notifications` (`?archived=`, cursor), `/api/notifications/unread-count`, `/api/notifications/mark-all-seen`, `/api/notifications/mark-all-read`, `PATCH /api/notifications/:message_id` | ACTIVE |
| `/admin/crisis-review` | admin | admin-only | CrisisReviewList | `/api/admin/crisis-review/cases` | ACTIVE |
| `/admin/crisis-review/:id` | admin | admin-only | CrisisReviewDetail | `/api/admin/crisis-review/cases/:id`, `/api/admin/crisis-review/cases/:id/claim`, `/api/admin/crisis-review/cases/:id/disposition` | ACTIVE |
| `/guardian` | guardian | free | GuardianHome (redirects to the first linked student's Dashboard, or the no-student state; G4-01) | `/api/guardian/students` | ACTIVE |
| `/guardian/students` | guardian | free | GuardianStudentsPage — Linked students & billing: per-student status, one Manage billing (the existing portal), Remove with confirmation (G4-10) | `/api/guardian/students`, `/api/billing/status`, `/api/billing/plans`, `POST /api/billing/portal`, `POST /api/billing/checkout`, `DELETE /api/guardian/link/:studentId` | ACTIVE |
| `/guardian/:studentId` | guardian | entitled (the STUDENT's) | GuardianDashboardTab, in GuardianShell (G4-01/G4-03) | `/api/guardian/students`, `/api/students/:studentId/calendar`, `/api/students/:studentId/mastery/domains`, `/api/students/:studentId/tests`, `/api/students/:studentId/tests/:sessionId/report` | ACTIVE |
| `/guardian/:studentId/calendar` | guardian | entitled† (the STUDENT's) | GuardianCalendarTab (GuardianStudentCalendarPage in GuardianShell; G4-01/G4-04) | `/api/students/:studentId/calendar` | ACTIVE |
| `/guardian/:studentId/exams` | guardian | entitled (the STUDENT's exam_full_length) | GuardianExamsPage (list; G4-01/G4-05) | `/api/students/:studentId/tests` | ACTIVE |
| `/guardian/:studentId/exams/:sessionId` | guardian | entitled (the STUDENT's exam_full_length) | GuardianExamsPage (one attempt: headline + per-domain bars, SCL-180/181/189; G4-01/G4-05) | `/api/students/:studentId/tests/:sessionId/report` | ACTIVE |

**†** entitled = free tier has daily usage limits; paid/entitled tier has unlimited access  
**admin-only** = admin role bypasses all entitlement checks (full access)

---

## Public Crawlability Inventory (GROW1)

### Active + Indexable (sitemap + canonical SEO)
- `/`
- `/digital-sat`
- `/digital-sat/math`
- `/digital-sat/reading-writing`
- `/blog`
- `/blog/:slug` (currently: `is-digital-sat-harder`, `digital-sat-scoring-explained`, `quick-sat-study-routine`, `sat-question-bank-practice`, `common-sat-math-algebra-mistakes`)
- `/sat-question-of-the-day`
- `/sat-question-of-the-day/:date` (every past day, prerendered at build time)
- `/trust`
- `/legal`
- `/legal/:slug` (currently: `privacy-policy`, `student-terms`, `honor-code`, `community-guidelines`, `parent-guardian-terms`, `trust-and-safety`)

### Active + Non-indexable (intentional)
- `/login`
- `/signup`
- `/privacy` (301 to `/legal/privacy-policy`)
- `/terms` (301 to `/legal/student-terms`)
- authenticated app surfaces (dashboard, practice, mastery, guardian)

### Dead/Stale Public Routes
- none (legacy ingestion/admin-deprecated routes remain removed)

### SEO/Sitemap Reconciliation Notes
- 2026-10-03 (SEO Wave 1A): public pages are prerendered at build and `sitemap.xml` is generated from
  `infra/route-surface-classification.yaml` (the hand-written sitemap and the unreachable Express SSR
  path are deleted). See `docs/seo/SEO_SOURCE_OF_TRUTH.md`.
- `client/public/robots.txt` disallows every authenticated route, held to the registry by
  `tests/seo.route-registry.test.ts`.

---
## DEPRECATED Routes (Removed)

The following routes have been **REMOVED** from the codebase:

| Route | Previous Status | Lifecycle Behavior | Removal Date |
|-------|----------------|-------------------|--------------|
| `/admin-pdf-monitor` | Redirected to `/admin` | **REMOVED** (no longer exists) | 2026-02-02 |
| `/admin-ingest-jobs` | Redirected to `/admin` | **REMOVED** (no longer exists) | 2026-02-02 |
| `/admin-ingest` | Redirected to `/admin` | **REMOVED** (no longer exists) | 2026-02-02 |

**Note:** These ingestion-related routes were removed as part of Sprint 2 "Kill ingestion surfaces" initiative.

---

## Server API Endpoints Reference

### Authentication Endpoints
| Endpoint | Method | Auth Required | Role | Purpose |
|----------|--------|--------------|------|---------|
| `/api/auth/signup` | POST | No | public | Email/password signup |
| `/api/auth/signin` | POST | No | public | Email/password signin |
| `/api/auth/signout` | POST | No (CSRF required) | any | Sign out current user (clears cookies) |
| `/api/auth/google/start` | GET | No | public | Google OAuth flow |
| `/api/auth/refresh` | POST | No | public | Refresh auth token |
| `/api/auth/admin-provision` | POST | No (CSRF + passcode required) | guarded | Provision admin account through explicit passcode gate (`ADMN_PASSCODE`) |
| `/api/profile` | GET | Yes | any | Get user profile (canonical) |
| `/auth/google/callback` | GET | No | public | Google OAuth callback handler |

Removed auth endpoints (must return 404):
- `/api/auth/user`
- `/api/auth/exchange-session`

### Student Endpoints
| Endpoint | Method | Auth Required | Role | Entitlement | Purpose |
|----------|--------|--------------|------|-------------|---------|
| `/api/progress/kpis` | GET | Yes | student/admin | free | Weekly KPIs and stats |
| `/api/progress/projection` | GET | Yes | student/admin | free | SAT score projection |
| `/api/practice/next` | GET | Yes | student/admin | entitled† | Get next practice question |
| `/api/practice/answer` | POST | Yes | student/admin | free | Submit practice answer |
| `/api/practice/sessions/:sessionId/state` | GET | Yes | student/admin | entitled† | Resume practice session state |
| `/api/practice/sessions/:sessionId/next` | GET | Yes | student/admin | entitled† | Resume practice session next |
| `/api/practice/topics` | GET | Yes | student/admin | free | Get SAT topic taxonomy |
| `/api/practice/reference/questions` | GET | Yes | student/admin | free | Get filtered questions for practice (reference-only) |
| `/api/review/pool` | GET | Yes | student/admin | free | Review pool summary — counts and past sessions for the pickers |
| `/api/review/sessions` | POST | Yes | student/admin | free | Start a review session (mode: queue / session / filter) |
| `/api/review/sessions/open` | GET | Yes | student/admin | free | Open review sessions (created + active only) |
| `/api/review/sessions/:sessionId/state` | GET | Yes | student/admin | free | Resume review session state |
| `/api/review/sessions/:sessionId/next` | GET | Yes | student/admin | free | Serve the next review item |
| `/api/review/sessions/:sessionId/resume` | POST | Yes | student/admin | free | Resume / take over a review session |
| `/api/review/sessions/:sessionId/terminate` | POST | Yes | student/admin | free | Abandon a review session |
| `/api/review/sessions/:sessionId/calculator-state` | POST | Yes | student/admin | free | Persist Desmos state for a review session |
| `/api/review/sessions/:sessionId/skip` | POST | Yes | student/admin | free | Skip the served review item (requeues, no mastery) |
| `/api/review/answer` | POST | Yes | student/admin | free | Submit a review answer (mastery source `review`) |
| `/api/tutor/conversations` | POST | Yes | student/admin | entitled† | start/reuse tutor conversation |
| `/api/tutor/messages` | POST | Yes | student/admin | entitled† | append tutor turn + response |
| `/api/tutor/conversations/:conversationId` | GET | Yes | student/admin | entitled† | fetch tutor conversation + messages |
| `/api/tutor/conversations` | GET | Yes | student/admin | entitled† | list tutor conversations |
| `/api/tutor/conversations/:conversationId/close` | POST | Yes | student/admin | entitled† | close/abandon tutor conversation |
| `/api/questions` | GET | Yes | student/admin | free | Get questions list |
| `/api/questions/:id` | GET | Yes | student/admin | free | Get specific question |
| `/api/questions/validate` | POST | No (unmounted) | N/A | N/A | UNMOUNTED in runtime (404 contract) |
| `/api/questions/feedback` | POST | Yes | student/admin | free | Submit question feedback |
| `/api/questions/stats` | GET | Yes | student/admin | free | Question statistics |
| `/api/questions/feed` | GET | Yes | student/admin | free | Question feed for flow-cards |
| `/api/students/{{studentId}}/mastery/domains` | GET | Yes | student/admin | premium | Domain grid: level + level name per canonical domain |
| `/api/students/:studentId/mastery/skills` | GET | Yes | student/admin | premium | Skill panel for one domain; unmeasured skills present and labelled |
| `/api/students/{{studentId}}/mastery/skills` | GET | Yes | student/admin | free | Weakest skills analysis |
| `/api/me/weakness/clusters` | GET | Yes | student/admin | free | Weakest topic clusters analysis |

### Full-Length Exam Endpoints
Doc 04A V2.2 §16 student runtime (E6, 2026-09-24), mounted at `/api/tests`. Every handler:
auth -> `exam_full_length` entitlement -> Zod -> one `exam_*` SQL function -> serialize.
`:module` is `1` or `2` (the server resolves Module 2 to the locked path; SCL-132). No
admin, publish, report or outbox route exists. The pre-baseline `/api/full-length/*`
runtime and the `/full-test` page were removed by E1 (2026-09-23); no client page yet.

| Endpoint | Method | Auth Required | Role | Entitlement | Purpose |
|----------|--------|--------------|------|-------------|---------|
| `/api/tests/sessions` | POST | Yes | student/admin | premium (`exam_full_length`) | Create a session, or return the in-progress one for the same form |
| `/api/tests/sessions/:session_id/state` | GET | Yes | student/admin | premium (`exam_full_length`) | Session state + remaining time; finalises a past-grace session |
| `/api/tests/sessions/:session_id/sections/:section/modules/:module/start` | POST | Yes | student/admin | premium (`exam_full_length`) | Start a module; returns its first item |
| `/api/tests/sessions/:session_id/sections/:section/modules/:module/items` | GET | Yes | student/admin | premium (`exam_full_length`) | Items of the active module (no answer, no explanation) |
| `/api/tests/answer` | POST | Yes | student/admin | premium (`exam_full_length`) | Submit one answer (idempotent via `idempotency_key`) |
| `/api/tests/sessions/:session_id/sections/:section/modules/:module/submit` | POST | Yes | student/admin | premium (`exam_full_length`) | Submit a module (Module 1 routes; the last Module 2 completes and scores) |
| `/api/tests/sessions/:session_id/sections/:section/heartbeat` | POST | Yes | student/admin | premium (`exam_full_length`) | Activity heartbeat (lenient pause accounting) |

### Guardian Endpoints
| Endpoint | Method | Auth Required | Role | Entitlement | Purpose |
|----------|--------|--------------|------|-------------|---------|
| `/api/guardian/students` | GET | Yes | guardian | free | List linked students |
| `/api/guardian/link/redeem` | POST | Yes | guardian | free | Redeem a student's link code (rate-limited) |
| `/api/guardian/link/:studentId` | DELETE | Yes | guardian | free | Unlink student |
| `/api/students/:studentId/kpi/overall` | GET | Yes | student/guardian | free (student); guardian needs the student's active entitlement | Guardian gets the streak only (SCL-188) |
| `/api/students/:studentId/mastery/domains` | GET | Yes | student/guardian | premium (`mastery_detail`, the STUDENT's) | Domain-grain mastery |
| `/api/students/:studentId/calendar` | GET | Yes | student/guardian | premium (`calendar_access`, the STUDENT's) | Calendar `{ days, facts, streak }` |
| `/api/students/:studentId/tests` | GET | Yes | student/guardian | premium (`exam_full_length`, the STUDENT's) | Full-length exam list |
| `/api/students/:studentId/tests/:sessionId/report` | GET | Yes | student/guardian | premium (`exam_full_length`, the STUDENT's) | One exam attempt's report |

Guardian access to `/api/students/:studentId/*` is decided by `resolveSubject` (`server/middleware/subject-resolver.ts` → SQL `guardian_view_decision`): unlinked → 404, linked but unentitled → 402. `/api/students/:studentId/mastery/skills` refuses a guardian with 403 (SCL-194). Admins are not admitted as guardians (G2-01).

### Admin Endpoints
| Endpoint | Method | Auth Required | Role | Purpose |
|----------|--------|--------------|------|---------|
| `/api/admin/db-health` | GET | Yes | admin | Database health check |
| `/api/admin/crisis-review/cases` | GET | Yes | admin | List crisis review cases (filterable by status) |
| `/api/admin/crisis-review/cases/:id` | GET | Yes | admin | Get single crisis review case with audit log |
| `/api/admin/crisis-review/cases/:id/claim` | POST | Yes | admin | Claim an open case for review |
| `/api/admin/crisis-review/cases/:id/disposition` | POST | Yes | admin | Resolve case with disposition and notes |
| `/api/admin/crisis-review/sla-breaches` | GET | Yes | admin | List cases that have breached SLA deadline |

### Billing Endpoints
| Endpoint | Method | Auth Required | Role | Purpose |
|----------|--------|--------------|------|---------|
| `/api/billing/prices` | GET | No | public | Get pricing information |
| `/api/billing/checkout` | POST | Yes | any | Create Stripe checkout |
| `/api/billing/status` | GET | Yes | any | Get billing status |
| `/api/billing/portal` | POST | Yes | any | Access customer portal |

### Legal & Public Endpoints
| Endpoint | Method | Auth Required | Purpose |
|----------|--------|--------------|---------|
| `/api/legal/accept` | POST | Yes | Record legal document acceptance (authenticated users) |
| `/api/legal/acceptances` | GET | Yes | Get user's legal acceptances (authenticated users) |
| `/healthz` | GET | No | Health check |
| `/api/health` | GET | No | Health check (legacy) |

---

## Route Guards & Entitlement Enforcement

### Client-Side Guards
- **RequireRole** (`client/src/components/auth/RequireRole.tsx`)
  - Enforces role-based access control
  - Redirects unauthorized users to appropriate landing pages
  - Used for: student, guardian, and multi-role routes

- **Guardian state matrix** (`client/src/features/guardian/GuardianStates.tsx`)
  - Shows the lapsed state on a 402 and the revoked state on a 404 from a per-student read
  - Used for: the per-student guardian pages (via `GuardianStudentLayout.tsx` and `GuardianDashboardTab.tsx`), rendered inside `GuardianShell` (`client/src/components/layout/GuardianShell.tsx`)

### Server-Side Middleware
- **requireSupabaseAuth** - Validates authenticated session (all protected endpoints)
- **requireStudentOrAdmin** - Enforces student or admin role
- **requireGuardianRole** (`server/middleware/guardian-role.ts`) - Enforces guardian role; admins are refused (G2-01)
- **resolveSubject** (`server/middleware/subject-resolver.ts`) - Admits the student or a linked guardian of an entitled student to `/api/students/:studentId/*`
- **requireSupabaseAdmin** - Enforces admin-only access
- **checkPracticeLimit** - Enforces practice usage limits (free tier: 10/day)
- **checkAiChatLimit** - Enforces tutor chat usage limits (free tier: 5/day)

---

## Validation & Maintenance

### Automated Validation
Run the route validation script to ensure registry is in sync with App.tsx:
```bash
npm run route:validate
```

This script:
- Extracts all routes from `client/src/App.tsx`
- Compares against ACTIVE routes in this registry
- Reports any missing or undocumented routes
- Exits with code 0 if all routes are properly documented

### Manual Verification Commands

**Verify removed ingestion routes (should return 0 matches):**
```bash
rg -n "admin-pdf-monitor|admin-ingest-jobs|admin-ingest" client/src
```

**Verify nonexistent endpoints are not referenced:**
```bash
grep -r "/api/progress/detailed" client/src
grep -r "/api/user/notification-settings" client/src
```

Expected: **0 hits** for both

**Verify active endpoints are in use:**
```bash
grep -n "/api/profile" client/src/pages/UserProfile.tsx
grep -nE "/api/progress/kpis|/api/progress/projection" client/src/pages/lyceon-dashboard.tsx
```

Expected: **2+ hits** for each

---

## Maintenance Notes

### When Adding New Routes
1. Add route to `client/src/App.tsx`
2. Document route in this registry (Complete Route Table)
3. Document backing API endpoints (if any)
4. Run `npm run route:validate` to ensure consistency
5. Update `docs/entitlements-map.md` if adding new entitlement rules

### When Deprecating Routes
1. Mark status as DEPRECATED in Complete Route Table
2. Document lifecycle behavior (redirect or 410)
3. Add to DEPRECATED Routes section with removal date
4. If removing entirely, delete from App.tsx and move to DEPRECATED section only

### When Adding API Endpoints
1. Document in appropriate section (Student/Guardian/Admin/etc.)
2. Update backing endpoints for relevant routes
3. Document auth/role/entitlement requirements

---

**Maintainer:** Development Team  
**Validation Frequency:** On every route change (enforced by CI)

