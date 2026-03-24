# Route Registry

**CANONICAL SOURCE OF TRUTH** for all client routes, entitlements, and backing server endpoints.

This document is the single authoritative registry of:
- All frontend routes in client/src/App.tsx
- Role-based access controls
- Entitlement levels (free/entitled/admin-only)
- Backing server API endpoints
- Route lifecycle status (ACTIVE/STUBBED/DEPRECATED)

**Last Updated:** 2026-03-17 (Canonical content/review runtime truth reconciliation)

---

## Complete Route Table

| Route | Roles Allowed | Entitlement | Component | Backing Server Endpoints | Status |
|-------|---------------|-------------|-----------|-------------------------|--------|
| `/` | public | free | HomePage | N/A (static) | ACTIVE |
| `/login` | public | free | Login | `/api/auth/signin`, `/api/auth/signup` | ACTIVE |
| `/signup` | public | free | Redirect→`/login` | N/A | ACTIVE |
| `/reset-password` | public | free | UpdatePassword | `/api/auth/reset-password` | ACTIVE |
| `/update-password` | public | free | UpdatePassword | `/api/auth/update-password` | ACTIVE |
| `/digital-sat` | public | free | DigitalSAT | N/A (static SEO) | ACTIVE |
| `/digital-sat/math` | public | free | DigitalSATMath | N/A (static SEO) | ACTIVE |
| `/digital-sat/reading-writing` | public | free | DigitalSATReadingWriting | N/A (static SEO) | ACTIVE |
| `/blog` | public | free | Blog | N/A (static) | ACTIVE |
| `/blog/:slug` | public | free | BlogPost | N/A (static) | ACTIVE |
| `/trust` | public | free | TrustHub | N/A (static SEO) | ACTIVE |
| `/trust/evidence` | public | free | TrustEvidence | N/A (static SEO) | ACTIVE |
| `/legal` | public | free | LegalHub | N/A (static content) | ACTIVE |
| `/legal/:slug` | public | free | LegalDoc | N/A (static content) | ACTIVE |
| `/privacy` | public | free | Redirect→`/legal/privacy-policy` | N/A | ACTIVE |
| `/terms` | public | free | Redirect→`/legal/student-terms` | N/A | ACTIVE |
| `/dashboard` | student, admin | free | LyceonDashboard | `/api/progress/kpis`, `/api/progress/projection`, `/api/calendar/profile`, `/api/calendar/month` | ACTIVE |
| `/calendar` | student, admin | free | CalendarPage | `/api/calendar/month`, `/api/calendar/profile` | ACTIVE |
| `/chat` | student, admin | entitled† | Chat | `/api/tutor/v2` (with usage limits) | ACTIVE |
| `/full-test` | student, admin | free | FullTest | `/api/full-length/sessions`, `/api/full-length/sessions/current`, `/api/full-length/sessions/:id/start`, `/api/full-length/sessions/:id/answer`, `/api/full-length/sessions/:id/module/submit`, `/api/full-length/sessions/:id/break/continue`, `/api/full-length/sessions/:id/complete` | ACTIVE |
| `/practice` | student, admin | free | Practice | `/api/questions/stats`, `/api/practice/topics`, `/api/progress/kpis`, `/api/calendar/month` | ACTIVE |
| `/practice/topics` | student, admin | free | BrowseTopics | `/api/practice/topics`, `/api/practice/questions` | ACTIVE |
| `/practice/math` | student, admin | entitled† | MathPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/practice/reading-writing` | student, admin | entitled† | ReadingWritingPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/practice/random` | student, admin | entitled† | RandomPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/math-practice` | student, admin | entitled† | MathPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/reading-writing-practice` | student, admin | entitled† | ReadingWritingPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/mastery` | student, admin | free | MasteryPage | `/api/me/mastery/skills` | ACTIVE |
| `/review-errors` | student, admin | free | ReviewErrors | `/api/review-errors`, `/api/review-errors/sessions`, `/api/review-errors/sessions/:sessionId/state`, `/api/review-errors/attempt` | ACTIVE |
| `/flow-cards` | student, admin | entitled† | FlowCards | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/structured-practice` | student, admin | entitled† | StructuredPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/profile` | student, guardian, admin | free | UserProfile | `/api/profile` | ACTIVE |
| `/profile/complete` | student, guardian, admin | free | ProfileComplete | `/api/profile`, `/api/legal/accept` | ACTIVE |
| `/guardian` | guardian, admin | entitled | GuardianDashboard | `/api/guardian/students`, `/api/guardian/students/:id/summary`, `/api/guardian/link`, `/api/guardian/link/:studentId`, `/api/billing/status`, `/api/billing/prices`, `/api/billing/checkout`, `/api/billing/portal` | ACTIVE |
| `/guardian/students/:studentId/calendar` | guardian, admin | entitled | GuardianCalendar | `/api/guardian/students/:studentId/calendar/month`, `/api/guardian/students/:studentId/summary` | ACTIVE |
| `/guardian/verify-consent` | guardian, admin | entitled | GuardianVerifyConsent | `/api/guardian/verify-consent` | ACTIVE |
| `/admin` | admin | admin-only | AdminPortal | `/api/admin/db-health` (mounted); content publish/review admin endpoints are service-only/unmounted from runtime | ACTIVE |
| `/admin-dashboard` | N/A | N/A | Redirect→`/admin` | N/A | ACTIVE |
| `/admin-system-config` | N/A | N/A | Redirect→`/admin` | N/A | ACTIVE |
| `/admin-questions` | N/A | N/A | Redirect→`/admin` | N/A | ACTIVE |
| `/admin-review` | N/A | N/A | Redirect→`/admin` | N/A | ACTIVE |
| `/admin-portal` | N/A | N/A | Redirect→`/admin` | N/A | ACTIVE |
| `/admin-review-v2` | N/A | N/A | Redirect→`/admin` | N/A | ACTIVE |

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
- authenticated app surfaces (dashboard, practice, full-test, mastery, guardian, admin)

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
| `/api/auth/consent` | POST | Yes | any | Submit guardian consent for under-13 users (CSRF protected) |
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
| `/api/calendar/profile` | GET | Yes | student/admin | free | Calendar profile data |
| `/api/calendar/month` | GET | Yes | student/admin | free | Monthly calendar data |
| `/api/practice/next` | GET | Yes | student/admin | entitled† | Get next practice question |
| `/api/practice/answer` | POST | Yes | student/admin | free | Submit practice answer |
| `/api/practice/topics` | GET | Yes | student/admin | free | Get SAT topic taxonomy |
| `/api/practice/questions` | GET | Yes | student/admin | free | Get filtered questions for practice |
| `/api/tutor/v2` | POST | Yes | student/admin | entitled† | AI tutor chat |
| `/api/questions` | GET | Yes | student/admin | free | Get questions list |
| `/api/questions/:id` | GET | Yes | student/admin | free | Get specific question |
| `/api/questions/validate` | POST | No (unmounted) | N/A | N/A | UNMOUNTED in runtime (404 contract) |
| `/api/questions/feedback` | POST | Yes | student/admin | free | Submit question feedback |
| `/api/questions/stats` | GET | Yes | student/admin | free | Question statistics |
| `/api/questions/feed` | GET | Yes | student/admin | free | Question feed for flow-cards |
| `/api/review-errors` | GET | Yes | student/admin | free | Get incorrect answers |
| `/api/review-errors/attempt` | POST | Yes | student/admin | free | Submit session-based review answer (owner: `submitReviewSessionAnswer`) |
| `/api/me/mastery/skills` | GET | Yes | student/admin | free | Mastery statistics |
| `/api/me/weakness/skills` | GET | Yes | student/admin | free | Weakest skills analysis |
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
| `/api/guardian/students/:studentId/summary` | GET | Yes | guardian/admin | entitled | Student progress summary |
| `/api/guardian/students/:studentId/calendar/month` | GET | Yes | guardian/admin | entitled | Student calendar data (projection of canonical student month payload via `buildCalendarMonthView`) |
| `/api/guardian/weaknesses/:studentId` | GET | Yes | guardian/admin | entitled | Student weaknesses |

### Admin Endpoints
| Endpoint | Method | Auth Required | Role | Purpose |
|----------|--------|--------------|------|---------|
| `/api/admin/stats` | GET | Yes | admin | System statistics |
| `/api/admin/kpis` | GET | Yes | admin | Admin KPIs |
| `/api/admin/questions/needs-review` | GET | No (unmounted) | N/A | Service-only legacy/admin workflow endpoint (not mounted in runtime) |
| `/api/admin/questions/statistics` | GET | No (unmounted) | N/A | Service-only legacy/admin workflow endpoint (not mounted in runtime) |
| `/api/admin/questions/:id/approve` | POST | No (unmounted) | N/A | Service-only legacy/admin workflow endpoint (not mounted in runtime) |
| `/api/admin/questions/:id/reject` | POST | No (unmounted) | N/A | Service-only legacy/admin workflow endpoint (not mounted in runtime) |
| `/api/admin/db-health` | GET | Yes | admin | Database health check |

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

- **AdminGuard** (`client/src/components/auth/AdminGuard.tsx`)
  - Enforces admin-only access within AdminPortal
  - Shows access denied UI for non-admins
  - Used internally by: `/admin` route

- **SubscriptionPaywall** (`client/src/components/guardian/SubscriptionPaywall.tsx`)
  - Shows upgrade prompt for non-entitled guardian features
  - Used for: guardian dashboard features

### Server-Side Middleware
- **requireSupabaseAuth** - Validates authenticated session (all protected endpoints)
- **requireStudentOrAdmin** - Enforces student or admin role
- **requireGuardianRole** - Enforces guardian or admin role
- **requireSupabaseAdmin** - Enforces admin-only access
- **requireGuardianEntitlement** - Enforces paid entitlement for guardian features
- **checkPracticeLimit** - Enforces practice usage limits (free tier: 10/day)
- **checkAiChatLimit** - Enforces AI chat usage limits (free tier: 5/day)

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

