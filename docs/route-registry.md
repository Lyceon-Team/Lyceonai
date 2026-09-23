# Route Registry

**CANONICAL SOURCE OF TRUTH** for all client routes, entitlements, and backing server endpoints.

This document is the single authoritative registry of:
- All frontend routes in client/src/App.tsx
- Role-based access controls
- Entitlement levels (free/entitled/admin-only)
- Backing server API endpoints
- Route lifecycle status (ACTIVE/STUBBED/DEPRECATED)

**Last Updated:** 2026-09-23 (Doc 05F study calendar rebuilt — `/calendar` ACTIVE again, and the guardian read at `/students/:studentId/calendar` added. §16 makes the calendar premium for the SUBJECT, so the guardian route is gated on the STUDENT's entitlement, not the guardian's; `/api/me/streak` is served with no `calendar_access` check at all (INV-08-20).) · 2026-09-22 (Brief 6 — the calendar is REACHABLE: a Calendar tab in the student shell's top navigation, shown to free students too because the page's own 402 renders `PremiumUpgradePrompt` and a hidden tab is a dead end rather than a paywall; and a per-student Calendar link on the guardian dashboard to `/students/:studentId/calendar`. No route is added or retired by this change — both already existed and neither was linked from anywhere.)
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
| `/trust` | public | free | TrustHub | N/A (static SEO) | ACTIVE |
| `/trust/evidence` | public | free | TrustEvidence | N/A (static SEO) | ACTIVE |
| `/tutor` | public | free | TutorPage | N/A (static SEO) | ACTIVE |
| `/legal` | public | free | LegalHub | N/A (static content) | ACTIVE |
| `/legal/:slug` | public | free | LegalDoc | N/A (static content) | ACTIVE |
| `/privacy` | public | free | Redirect→`/legal/privacy-policy` | N/A | ACTIVE |
| `/terms` | public | free | Redirect→`/legal/student-terms` | N/A | ACTIVE |
| `/dashboard` | student, admin | free | LyceonDashboard | `/api/progress/kpis`, `/api/progress/projection` | ACTIVE |
| `/calendar` | student, admin | entitled† | CalendarPage | `/api/calendar`, `/api/calendar/profile`, `/api/calendar/plan/regenerate`, `/api/calendar/days/:date` (+`/regenerate`, `/reset`), `/api/calendar/blocks/:id/launch` (+`/do-it-now`, `/move`), `/api/calendar/acknowledge`, `/api/me/streak` | ACTIVE |
| `/students/:studentId/calendar` | guardian, admin | entitled† (the STUDENT's) | GuardianStudentCalendarPage | `/api/students/:studentId/calendar` | ACTIVE |
| `/chat` | student, admin | entitled† | Chat | `/api/tutor/conversations`, `/api/tutor/messages` (with runtime budget/throttle gates) | ACTIVE |
| `/full-test` | student, admin | free | FullTest | `/api/full-length/sessions`, `/api/full-length/sessions/current`, `/api/full-length/sessions/:id/start`, `/api/full-length/sessions/:id/answer`, `/api/full-length/sessions/:id/module/submit`, `/api/full-length/sessions/:id/break/continue`, `/api/full-length/sessions/:id/complete` | ACTIVE |
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
| `/profile` | student, guardian, admin | free | UserProfile | `/api/profile` | ACTIVE |
| `/profile/complete` | student, guardian, admin | free | ProfileComplete | `/api/profile`, `/api/legal/accept` | ACTIVE |
| `/notifications` | student, guardian, admin | free | NotificationsPage | `/api/notifications` (`?archived=`, cursor), `/api/notifications/unread-count`, `/api/notifications/mark-all-seen`, `/api/notifications/mark-all-read`, `PATCH /api/notifications/:message_id` | ACTIVE |
| `/admin/crisis-review` | admin | admin-only | CrisisReviewList | `/api/admin/crisis-review/cases` | ACTIVE |
| `/admin/crisis-review/:id` | admin | admin-only | CrisisReviewDetail | `/api/admin/crisis-review/cases/:id`, `/api/admin/crisis-review/cases/:id/claim`, `/api/admin/crisis-review/cases/:id/disposition` | ACTIVE |
| `/guardian` | guardian, admin | entitled | GuardianDashboard | `/api/guardian/students`, `/api/guardian/link`, `/api/guardian/link/:linkId/accept`, `/api/guardian/link/:studentId`, `/api/billing/status`, `/api/billing/prices`, `/api/billing/checkout`, `/api/billing/portal` | ACTIVE |

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
- `/trust`
- `/trust/evidence`
- `/legal`
- `/legal/:slug` (currently: `privacy-policy`, `student-terms`, `honor-code`, `community-guidelines`, `parent-guardian-terms`, `trust-and-safety`)

### Active + Non-indexable (intentional)
- `/login`
- `/signup`
- `/privacy` (301 to `/legal/privacy-policy`)
- `/terms` (301 to `/legal/student-terms`)
- authenticated app surfaces (dashboard, practice, full-test, mastery, guardian)

### Dead/Stale Public Routes
- none (legacy ingestion/admin-deprecated routes remain removed)

### SEO/Sitemap Reconciliation Notes
- `client/public/sitemap.xml` and `server/seo-content.ts` public entries are aligned for core static pages.
- `server/index.ts` now provides legal-slug SSR metadata fallback for public legal pages not explicitly listed in `PUBLIC_SSR_ROUTES`.
- `client/public/robots.txt` now disallows authenticated/private app routes to prevent crawl drift.

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

### Full-Length Exam Endpoints (Bluebook SAT)
| Endpoint | Method | Auth Required | Role | Entitlement | Purpose |
|----------|--------|--------------|------|-------------|---------|
| `/api/full-length/sessions` | POST | Yes | student/admin | free | Create new exam session |
| `/api/full-length/sessions/current` | GET | Yes | student/admin | free | Get current session state |
| `/api/full-length/sessions/:id/start` | POST | Yes | student/admin | free | Start exam (begin RW Module 1) |
| `/api/full-length/sessions/:id/answer` | POST | Yes | student/admin | free | Submit answer to question (idempotent) |
| `/api/full-length/sessions/:id/module/submit` | POST | Yes | student/admin | free | End module, compute score, set adaptive difficulty |
| `/api/full-length/sessions/:id/break/continue` | POST | Yes | student/admin | free | Continue from break to Math Module 1 |
| `/api/full-length/sessions/:id/complete` | POST | Yes | student/admin | free | Complete exam, get final results |

### Guardian Endpoints
| Endpoint | Method | Auth Required | Role | Entitlement | Purpose |
|----------|--------|--------------|------|-------------|---------|
| `/api/guardian/students` | GET | Yes | guardian/admin | free | List linked students |
| `/api/guardian/link` | POST | Yes | guardian/admin | free | Link student account |
| `/api/guardian/link/:studentId` | DELETE | Yes | guardian/admin | free | Unlink student |
| `/api/students/:studentId/kpi/overall` | GET | Yes | guardian/admin | entitled | Student progress summary |
| `/api/students/:studentId/mastery/domains` | GET | Yes | guardian/admin | entitled | Student weaknesses |

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

- **SubscriptionPaywall** (`client/src/components/guardian/SubscriptionPaywall.tsx`)
  - Shows upgrade prompt for non-entitled guardian features
  - Used for: guardian dashboard features

### Server-Side Middleware
- **requireSupabaseAuth** - Validates authenticated session (all protected endpoints)
- **requireStudentOrAdmin** - Enforces student or admin role
- **requireGuardianRole** - Enforces guardian or admin role
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

