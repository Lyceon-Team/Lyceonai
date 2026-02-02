# Entitlements Map

**Single source of truth** for entitlement gates across client and server surfaces.

This document provides explicit mappings between:
- User roles (student/guardian/admin)
- Application surfaces (routes and features)
- Entitlement levels (free/entitled/admin-only)
- Client gate mechanisms
- Server gate mechanisms

**Last Updated:** 2026-02-02 (Sprint 2 PR-3)

---

## Entitlement Philosophy

### Mental Model
**One mental model**: Every surface has a role requirement AND an entitlement level.

- **Role** = WHO can access (student/guardian/admin)
- **Entitlement** = WHAT tier is required (free/entitled/admin-only)

### Tiered Access
1. **Free Tier** - Available to all authenticated users of the required role
2. **Entitled Tier** - Requires active paid subscription
   - For students: paid plan with active/trialing status
   - For guardians: paid entitlement on linked student account
3. **Admin-Only** - Requires admin role (bypasses all entitlement checks)

### Usage Limits
Some features are available to free tier but with **usage limits**:
- Free tier gets limited daily usage
- Entitled tier gets unlimited access
- Usage limits are enforced server-side via middleware

---

## Complete Entitlement Matrix

| Surface (Route/Feature) | Role | Entitlement Level | Client Gate | Server Gate | Evidence |
|------------------------|------|-------------------|-------------|-------------|----------|
| **Public Routes** | | | | | |
| `/` | public | free | None | None | `client/src/App.tsx:63` |
| `/login` | public | free | None | None | `client/src/App.tsx:64` |
| `/signup` | public | free | None | None | `client/src/App.tsx:67` |
| `/digital-sat` | public | free | None | None | `client/src/App.tsx:70` |
| `/digital-sat/math` | public | free | None | None | `client/src/App.tsx:71` |
| `/digital-sat/reading-writing` | public | free | None | None | `client/src/App.tsx:72` |
| `/blog` | public | free | None | None | `client/src/App.tsx:73` |
| `/blog/:slug` | public | free | None | None | `client/src/App.tsx:74` |
| `/legal` | public | free | None | N/A (static content) | `client/src/App.tsx:77` |
| `/legal/:slug` | public | free | None | N/A (static content) | `client/src/App.tsx:78` |
| `/privacy` | public | free | None | None | `client/src/App.tsx:81` |
| `/terms` | public | free | None | None | `client/src/App.tsx:82` |
| **Student Routes** | | | | | |
| `/dashboard` | student, admin | free | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin | `client/src/App.tsx:85`, `server/index.ts:330-333` |
| `/calendar` | student, admin | free | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin | `client/src/App.tsx:86`, `server/index.ts:327` |
| `/chat` | student, admin | entitled† | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin, checkAiChatLimit | `client/src/App.tsx:87`, `server/index.ts:273` |
| `/full-test` | student, admin | free | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin | `client/src/App.tsx:88` |
| `/practice` | student, admin | entitled† | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin, checkPracticeLimit | `client/src/App.tsx:89`, `server/routes/practice-canonical.ts:219` |
| `/practice/math` | student, admin | entitled† | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin, checkPracticeLimit | `client/src/App.tsx:90` |
| `/practice/reading-writing` | student, admin | entitled† | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin, checkPracticeLimit | `client/src/App.tsx:91` |
| `/practice/random` | student, admin | entitled† | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin, checkPracticeLimit | `client/src/App.tsx:92` |
| `/math-practice` | student, admin | entitled† | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin, checkPracticeLimit | `client/src/App.tsx:93` |
| `/reading-writing-practice` | student, admin | entitled† | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin, checkPracticeLimit | `client/src/App.tsx:94` |
| `/mastery` | student, admin | free | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin | `client/src/App.tsx:95`, `server/index.ts:326` |
| `/review-errors` | student, admin | free | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin | `client/src/App.tsx:96`, `server/index.ts:419` |
| `/flow-cards` | student, admin | free | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin | `client/src/App.tsx:97` |
| `/structured-practice` | student, admin | free | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin | `client/src/App.tsx:98` |
| **Profile Routes** | | | | | |
| `/profile` | student, guardian, admin | free | RequireRole allow=['student', 'guardian', 'admin'] | requireSupabaseAuth | `client/src/App.tsx:101`, `server/index.ts:286` |
| `/profile/complete` | student, guardian, admin | free | RequireRole allow=['student', 'guardian', 'admin'] | requireSupabaseAuth | `client/src/App.tsx:102` |
| **Guardian Routes** | | | | | |
| `/guardian` | guardian, admin | entitled | RequireRole allow=['guardian', 'admin'], SubscriptionPaywall | requireSupabaseAuth, requireGuardianRole, requireGuardianEntitlement | `client/src/App.tsx:105`, `client/src/pages/guardian-dashboard.tsx:175-188`, `server/routes/guardian-routes.ts:51-72` |
| `/guardian/students/:studentId/calendar` | guardian, admin | entitled | RequireRole allow=['guardian', 'admin'] | requireSupabaseAuth, requireGuardianRole, requireGuardianEntitlement | `client/src/App.tsx:106`, `server/routes/guardian-routes.ts:323-430` |
| **Admin Routes** | | | | | |
| `/admin` | admin | admin-only | AdminGuard (internal) | requireSupabaseAdmin | `client/src/App.tsx:109`, `client/src/pages/AdminPortal.tsx:22-36`, `server/index.ts:336-339` |
| `/admin-dashboard` | N/A | N/A | None (redirect) | None | `client/src/App.tsx:112` |
| `/admin-system-config` | N/A | N/A | None (redirect) | None | `client/src/App.tsx:113` |
| `/admin-questions` | N/A | N/A | None (redirect) | None | `client/src/App.tsx:114` |
| `/admin-review` | N/A | N/A | None (redirect) | None | `client/src/App.tsx:115` |
| `/admin-portal` | N/A | N/A | None (redirect) | None | `client/src/App.tsx:116` |
| `/admin-review-v2` | N/A | N/A | None (redirect) | None | `client/src/App.tsx:117` |

**†** entitled = Free tier has daily usage limits; entitled tier has unlimited access

---

## API Endpoint Entitlement Map

### Authentication & Profile APIs

| Endpoint | Role | Entitlement | Server Gate | Evidence |
|----------|------|-------------|-------------|----------|
| `POST /api/auth/signup` | public | free | None (public) | `server/routes/supabase-auth-routes.ts` |
| `POST /api/auth/signin` | public | free | None (public) | `server/routes/supabase-auth-routes.ts` |
| `POST /api/auth/signout` | any | free | requireSupabaseAuth | `server/routes/supabase-auth-routes.ts` |
| `GET /api/auth/user` | any | free | requireSupabaseAuth | `server/routes/supabase-auth-routes.ts` |
| `GET /api/profile` | any | free | requireSupabaseAuth | `server/index.ts:286` |
| `PATCH /api/profile` | any | free | requireSupabaseAuth | `server/routes/profile-routes.ts` |

### Legal APIs

| Endpoint | Role | Entitlement | Server Gate | Evidence |
|----------|------|-------------|-------------|----------|
| `POST /api/legal/accept` | any | free | requireSupabaseAuth | `server/routes/legal-routes.ts:10` |
| `GET /api/legal/acceptances` | any | free | requireSupabaseAuth | `server/routes/legal-routes.ts:53` |

**Note**: Legal *content* (terms, privacy policy) is served statically from client-side. The `/api/legal/*` endpoints are for recording/retrieving user acceptances, not for fetching legal documents.

### Student APIs

| Endpoint | Role | Entitlement | Server Gate | Evidence |
|----------|------|-------------|-------------|----------|
| `GET /api/progress/kpis` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:333` |
| `GET /api/progress/projection` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:330` |
| `GET /api/calendar/profile` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:327` |
| `GET /api/calendar/month` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:327` |
| `POST /api/student/analyze-question` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:470-477` |
| `GET /api/practice/next` | student, admin | entitled† | requireSupabaseAuth, requireStudentOrAdmin, checkPracticeLimit | `server/routes/practice-canonical.ts:219-306` |
| `POST /api/practice/answer` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/routes/practice-canonical.ts` |
| `POST /api/tutor/v2` | student, admin | entitled† | requireSupabaseAuth, requireStudentOrAdmin, checkAiChatLimit | `server/index.ts:273` |
| `GET /api/questions` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:374` |
| `GET /api/questions/:id` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:416` |
| `POST /api/questions/validate` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:427` |
| `POST /api/questions/feedback` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:430` |
| `GET /api/questions/feed` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:410` |
| `GET /api/review-errors` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:419` |
| `GET /api/me/mastery` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:326` |
| `GET /api/me/weakness` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:325` |

### Guardian APIs

| Endpoint | Role | Entitlement | Server Gate | Evidence |
|----------|------|-------------|-------------|----------|
| `GET /api/guardian/students` | guardian, admin | free | requireSupabaseAuth, requireGuardianRole | `server/routes/guardian-routes.ts:51-72` |
| `POST /api/guardian/link` | guardian, admin | free | requireSupabaseAuth, requireGuardianRole | `server/routes/guardian-routes.ts:74-135` |
| `DELETE /api/guardian/link/:studentId` | guardian, admin | free | requireSupabaseAuth, requireGuardianRole | `server/routes/guardian-routes.ts:135` |
| `GET /api/guardian/students/:studentId/summary` | guardian, admin | entitled | requireSupabaseAuth, requireGuardianRole, requireGuardianEntitlement | `server/routes/guardian-routes.ts:184-265` |
| `GET /api/guardian/students/:studentId/calendar/month` | guardian, admin | entitled | requireSupabaseAuth, requireGuardianRole, requireGuardianEntitlement | `server/routes/guardian-routes.ts:323-430` |
| `GET /api/guardian/weaknesses/:studentId` | guardian, admin | entitled | requireSupabaseAuth, requireGuardianRole, requireGuardianEntitlement | `server/routes/guardian-routes.ts:435-517` |

### Admin APIs

| Endpoint | Role | Entitlement | Server Gate | Evidence |
|----------|------|-------------|-------------|----------|
| `GET /api/admin/stats` | admin | admin-only | requireSupabaseAdmin | `server/routes/admin-stats-routes.ts` |
| `GET /api/admin/kpis` | admin | admin-only | requireSupabaseAdmin | `server/routes/admin-stats-routes.ts` |
| `GET /api/admin/questions/needs-review` | admin | admin-only | requireSupabaseAdmin | `server/index.ts:433` |
| `GET /api/admin/questions/statistics` | admin | admin-only | requireSupabaseAdmin | `server/index.ts:434` |
| `POST /api/admin/questions/:id/approve` | admin | admin-only | requireSupabaseAdmin | `server/index.ts:435` |
| `POST /api/admin/questions/:id/reject` | admin | admin-only | requireSupabaseAdmin | `server/index.ts:436` |
| `GET /api/admin/db-health` | admin | admin-only | requireSupabaseAdmin | `server/index.ts:351` |

### Billing APIs

| Endpoint | Role | Entitlement | Server Gate | Evidence |
|----------|------|-------------|-------------|----------|
| `POST /api/billing/checkout` | any | free | requireSupabaseAuth | `server/routes/billing-routes.ts` |
| `GET /api/billing/status` | any | free | requireSupabaseAuth | `server/routes/billing-routes.ts` |
| `POST /api/billing/portal` | any | free | requireSupabaseAuth | `server/routes/billing-routes.ts` |

---

## Client Gate Mechanisms

### RequireRole
**File:** `client/src/components/auth/RequireRole.tsx`

**Purpose:** Enforces role-based access control on routes

**Behavior:**
- Checks if user is authenticated
- Checks if user's role is in the `allow` array
- Redirects to appropriate landing page if unauthorized:
  - Not authenticated → `/login`
  - Wrong role → role-specific dashboard (`/admin`, `/guardian`, or `/dashboard`)

**Usage:**
```tsx
<Route path="/dashboard" component={() => (
  <RequireRole allow={['student', 'admin']}>
    <LyceonDashboard />
  </RequireRole>
)} />
```

**Evidence:** `client/src/components/auth/RequireRole.tsx:13-57`

---

### AdminGuard
**File:** `client/src/components/auth/AdminGuard.tsx`

**Purpose:** Enforces admin-only access within AdminPortal component

**Behavior:**
- Used internally by AdminPortal component
- Shows "Access Denied" UI for non-admins
- Does not redirect (unlike RequireRole)

**Usage:**
```tsx
// Inside AdminPortal component
return (
  <AdminGuard>
    <AdminDashboard />
  </AdminGuard>
);
```

**Evidence:** `client/src/components/auth/AdminGuard.tsx:6-78`, `client/src/pages/AdminPortal.tsx:22-36`

---

### SubscriptionPaywall
**File:** `client/src/components/guardian/SubscriptionPaywall.tsx`

**Purpose:** Shows upgrade prompt for guardian features requiring paid entitlement

**Behavior:**
- Wraps guardian dashboard content
- Checks if linked student has active paid subscription
- Shows paywall UI if subscription is inactive or missing
- Allows access if subscription is active or trialing

**Usage:**
```tsx
<SubscriptionPaywall studentId={selectedStudentId}>
  <GuardianDashboardContent />
</SubscriptionPaywall>
```

**Evidence:** `client/src/pages/guardian-dashboard.tsx:175-188`, `client/src/components/guardian/SubscriptionPaywall.tsx:50-219`

---

## Server Gate Mechanisms

### Authentication Middleware

**requireSupabaseAuth**
- **File:** `server/middleware/supabase-auth.ts`
- **Purpose:** Validates authenticated Supabase session
- **Behavior:** Returns 401 if session invalid or missing
- **Evidence:** `server/middleware/supabase-auth.ts`

### Role Enforcement Middleware

**requireStudentOrAdmin**
- **File:** `server/middleware/supabase-auth.ts`
- **Purpose:** Enforces student or admin role
- **Behavior:** Returns 403 if user role is not student or admin
- **Evidence:** `server/middleware/supabase-auth.ts`

**requireGuardianRole**
- **File:** `server/middleware/supabase-auth.ts`
- **Purpose:** Enforces guardian or admin role
- **Behavior:** Returns 403 if user role is not guardian or admin
- **Evidence:** `server/middleware/supabase-auth.ts`

**requireSupabaseAdmin**
- **File:** `server/middleware/supabase-auth.ts`
- **Purpose:** Enforces admin-only access
- **Behavior:** Returns 403 if user is not admin
- **Evidence:** `server/middleware/supabase-auth.ts:427-469`

### Entitlement Enforcement Middleware

**requireGuardianEntitlement**
- **File:** `server/middleware/guardian-entitlement.ts`
- **Purpose:** Enforces paid entitlement on linked student account
- **Behavior:**
  - Checks guardian's linked student account
  - Validates student has active/trialing subscription
  - Returns 402 PAYMENT_REQUIRED if entitlement missing or inactive
- **Evidence:** `server/middleware/guardian-entitlement.ts:65-135`

**checkPracticeLimit()**
- **File:** `server/middleware/usage-limits.ts`
- **Purpose:** Enforces practice session usage limits
- **Behavior:**
  - Free tier: 10 practice sessions per day
  - Entitled tier: Unlimited
  - Admin: Unlimited
  - Returns 429 if limit exceeded
- **Evidence:** `server/middleware/usage-limits.ts:6-75`, `server/lib/account.ts:298-325`

**checkAiChatLimit()**
- **File:** `server/middleware/usage-limits.ts`
- **Purpose:** Enforces AI chat usage limits
- **Behavior:**
  - Free tier: 5 AI chat messages per day
  - Entitled tier: Unlimited
  - Admin: Unlimited
  - Returns 429 if limit exceeded
- **Evidence:** `server/middleware/usage-limits.ts:70-75`, `server/lib/account.ts:298-325`

---

## Admin Access Model

**Admin role = Full access to everything**

Admins have unrestricted access to:
- All student features (dashboard, practice, chat, etc.)
- All guardian features (student monitoring, calendar, etc.)
- All admin-only features (question review, system stats, etc.)

**Key Properties:**
- Admins bypass ALL entitlement checks
- Admins bypass ALL usage limits
- Admins can access any role-gated surface
- Admin access is still authenticated (requires valid Supabase session)

**Implementation:**
- Client: AdminGuard checks `user.isAdmin`
- Server: requireSupabaseAdmin checks role === 'admin'
- Entitlements: Admin role bypasses `checkUsageLimit` checks

**Evidence:**
- `client/src/components/auth/AdminGuard.tsx:6-78`
- `server/middleware/supabase-auth.ts:427-469`
- `server/lib/account.ts:298-325` (admin bypass in usage limits)

---

## Notes

### Mirror Principle
Client gates and server gates **must mirror each other**:
- If a route uses RequireRole on client, the backing API must use requireSupabaseAuth + role middleware
- If a feature has a client paywall, the backing API must enforce entitlement server-side
- Never rely on client-only security

### Defense in Depth
- **Client gates** = UX optimization (prevent unnecessary API calls)
- **Server gates** = Security enforcement (canonical source of truth)
- Always enforce security server-side, even if client has gates

### Free Tier vs Entitled Tier
- **Free tier** routes are accessible without payment but may have usage limits
- **Entitled tier** routes/features require active paid subscription
- Usage limits are implemented via middleware, not route-level blocking
- This allows graceful degradation (show UI, enforce limit at API level)

---

**Maintainer:** Development Team  
**Update Frequency:** On every route or entitlement change
