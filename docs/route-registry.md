# Route Registry

**CANONICAL SOURCE OF TRUTH** for all client routes, entitlements, and backing server endpoints.

This document is the single authoritative registry of:
- All frontend routes in client/src/App.tsx
- Role-based access controls
- Entitlement levels (free/entitled/admin-only)
- Backing server API endpoints
- Route lifecycle status (ACTIVE/STUBBED/DEPRECATED)

**Last Updated:** 2026-02-02 (Sprint 2 PR-3)

---

## Complete Route Table

| Route | Roles Allowed | Entitlement | Component | Backing Server Endpoints | Status |
|-------|---------------|-------------|-----------|-------------------------|--------|
| `/` | public | free | HomePage | N/A (static) | ACTIVE |
| `/login` | public | free | Login | `/api/auth/signin`, `/api/auth/signup` | ACTIVE |
| `/signup` | public | free | Redirect→`/login` | N/A | ACTIVE |
| `/digital-sat` | public | free | DigitalSAT | N/A (static SEO) | ACTIVE |
| `/digital-sat/math` | public | free | DigitalSATMath | N/A (static SEO) | ACTIVE |
| `/digital-sat/reading-writing` | public | free | DigitalSATReadingWriting | N/A (static SEO) | ACTIVE |
| `/blog` | public | free | Blog | N/A (static) | ACTIVE |
| `/blog/:slug` | public | free | BlogPost | N/A (static) | ACTIVE |
| `/legal` | public | free | LegalHub | N/A (static content) | ACTIVE |
| `/legal/:slug` | public | free | LegalDoc | N/A (static content) | ACTIVE |
| `/privacy` | public | free | Redirect→`/legal/privacy-policy` | N/A | ACTIVE |
| `/terms` | public | free | Redirect→`/legal/student-terms` | N/A | ACTIVE |
| `/dashboard` | student, admin | free | LyceonDashboard | `/api/progress/kpis`, `/api/progress/projection`, `/api/calendar/profile`, `/api/calendar/month` | ACTIVE |
| `/calendar` | student, admin | free | CalendarPage | `/api/calendar/month`, `/api/calendar/profile` | ACTIVE |
| `/chat` | student, admin | entitled† | Chat | `/api/tutor/v2` (with usage limits) | ACTIVE |
| `/full-test` | student, admin | free | FullTest | None (UI-disabled stub; not implemented yet) | ACTIVE |
| `/practice` | student, admin | free | Practice | `/api/questions/stats`, `/api/practice/topics`, `/api/progress/kpis`, `/api/calendar/month` | ACTIVE |
| `/practice/topics` | student, admin | free | BrowseTopics | `/api/practice/topics`, `/api/practice/questions` | ACTIVE |
| `/practice/math` | student, admin | entitled† | MathPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/practice/reading-writing` | student, admin | entitled† | ReadingWritingPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/practice/random` | student, admin | entitled† | RandomPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/math-practice` | student, admin | entitled† | MathPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/reading-writing-practice` | student, admin | entitled† | ReadingWritingPractice | `/api/practice/next`, `/api/practice/answer` (with usage limits) | ACTIVE |
| `/mastery` | student, admin | free | MasteryPage | `/api/me/mastery/skills` | ACTIVE |
| `/review-errors` | student, admin | free | ReviewErrors | `/api/review-errors`, `/api/review-errors/attempt`, `/api/questions/:id`, `/api/questions/validate` | ACTIVE |
| `/flow-cards` | student, admin | free | FlowCards | `/api/practice/next`, `/api/practice/answer` | ACTIVE |
| `/structured-practice` | student, admin | free | StructuredPractice | `/api/practice/next`, `/api/practice/answer` | ACTIVE |
| `/profile` | student, guardian, admin | free | UserProfile | `/api/profile` | ACTIVE |
| `/profile/complete` | student, guardian, admin | free | ProfileComplete | `/api/profile`, `/api/auth/user`, `/api/legal/accept` | ACTIVE |
| `/guardian` | guardian, admin | entitled | GuardianDashboard | `/api/guardian/students`, `/api/guardian/students/:id/summary`, `/api/guardian/link`, `/api/guardian/link/:studentId`, `/api/billing/status`, `/api/billing/prices`, `/api/billing/checkout`, `/api/billing/portal` | ACTIVE |
| `/guardian/students/:studentId/calendar` | guardian, admin | entitled | GuardianCalendar | `/api/guardian/students/:studentId/calendar/month`, `/api/guardian/students/:studentId/summary` | ACTIVE |
| `/admin` | admin | admin-only | AdminPortal | `/api/admin/*` (all admin endpoints) | ACTIVE |
| `/admin-dashboard` | N/A | N/A | Redirect→`/admin` | N/A | ACTIVE |
| `/admin-system-config` | N/A | N/A | Redirect→`/admin` | N/A | ACTIVE |
| `/admin-questions` | N/A | N/A | Redirect→`/admin` | N/A | ACTIVE |
| `/admin-review` | N/A | N/A | Redirect→`/admin` | N/A | ACTIVE |
| `/admin-portal` | N/A | N/A | Redirect→`/admin` | N/A | ACTIVE |
| `/admin-review-v2` | N/A | N/A | Redirect→`/admin` | N/A | ACTIVE |

**†** entitled = free tier has daily usage limits; paid/entitled tier has unlimited access  
**admin-only** = admin role bypasses all entitlement checks (full access)

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
| `/api/auth/signout` | POST | Yes | any | Sign out current user |
| `/api/auth/user` | GET | Yes | any | Get current user (legacy) |
| `/api/auth/google/start` | GET | No | public | Google OAuth flow |
| `/api/auth/consent` | GET/POST | No | public | OAuth consent handling |
| `/api/auth/refresh` | POST | No | public | Refresh auth token |
| `/api/profile` | GET | Yes | any | Get user profile (canonical) |

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
| `/api/questions/validate` | POST | Yes | student/admin | free | Validate answer |
| `/api/questions/feedback` | POST | Yes | student/admin | free | Submit question feedback |
| `/api/questions/stats` | GET | Yes | student/admin | free | Question statistics |
| `/api/questions/feed` | GET | Yes | student/admin | free | Question feed for flow-cards |
| `/api/review-errors` | GET | Yes | student/admin | free | Get incorrect answers |
| `/api/review-errors/attempt` | POST | Yes | student/admin | free | Record review error attempt |
| `/api/me/mastery/skills` | GET | Yes | student/admin | free | Mastery statistics |
| `/api/me/weakness` | GET | Yes | student/admin | free | Weakness areas |

### Guardian Endpoints
| Endpoint | Method | Auth Required | Role | Entitlement | Purpose |
|----------|--------|--------------|------|-------------|---------|
| `/api/guardian/students` | GET | Yes | guardian/admin | free | List linked students |
| `/api/guardian/link` | POST | Yes | guardian/admin | free | Link student account |
| `/api/guardian/link/:studentId` | DELETE | Yes | guardian/admin | free | Unlink student |
| `/api/guardian/students/:studentId/summary` | GET | Yes | guardian/admin | entitled | Student progress summary |
| `/api/guardian/students/:studentId/calendar/month` | GET | Yes | guardian/admin | entitled | Student calendar data |
| `/api/guardian/weaknesses/:studentId` | GET | Yes | guardian/admin | entitled | Student weaknesses |

### Admin Endpoints
| Endpoint | Method | Auth Required | Role | Purpose |
|----------|--------|--------------|------|---------|
| `/api/admin/stats` | GET | Yes | admin | System statistics |
| `/api/admin/kpis` | GET | Yes | admin | Admin KPIs |
| `/api/admin/questions/needs-review` | GET | Yes | admin | Questions pending review |
| `/api/admin/questions/statistics` | GET | Yes | admin | Question parsing stats |
| `/api/admin/questions/:id/approve` | POST | Yes | admin | Approve question |
| `/api/admin/questions/:id/reject` | POST | Yes | admin | Reject question |
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
