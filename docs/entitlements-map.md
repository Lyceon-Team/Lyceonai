# Entitlements Map

**Single source of truth** for entitlement gates across client and server surfaces.

This document provides explicit mappings between:
- User roles (student/guardian/admin)
- Application surfaces (routes and features)
- Entitlement levels (free/entitled/admin-only)
- Client gate mechanisms
- Server gate mechanisms

**Last Updated:** 2026-03-17 (Canonical content/review runtime truth reconciliation)

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
| `/chat` | student, admin | entitled† | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin, tutor runtime budget/throttle gate | `client/src/App.tsx:87`, `server/index.ts` |
| `/full-test` | student, admin | free | RequireRole allow=['student', 'admin'] | None (UI-disabled stub) | `client/src/App.tsx:88` |
| `/practice` | student, admin | free | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin | `client/src/App.tsx:89`, `server/index.ts:478-480` |
| `/practice/math` | student, admin | entitled† | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin, checkPracticeLimit | `client/src/App.tsx:90` |
| `/practice/reading-writing` | student, admin | entitled† | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin, checkPracticeLimit | `client/src/App.tsx:91` |
| `/practice/random` | student, admin | entitled† | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin, checkPracticeLimit | `client/src/App.tsx:92` |
| `/math-practice` | student, admin | entitled† | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin, checkPracticeLimit | `client/src/App.tsx:93` |
| `/reading-writing-practice` | student, admin | entitled† | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin, checkPracticeLimit | `client/src/App.tsx:94` |
| `/mastery` | student, admin | free | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin | `client/src/App.tsx:95`, `server/index.ts:326` |
| `/review` | student, admin | free | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin | `client/src/App.tsx`, `server/index.ts` (`/api/review` mount) |
| `/review/session/:sessionId` | student, admin | free | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin | `client/src/App.tsx`, `server/index.ts` (`/api/review` mount) |
| `/flow-cards` | student, admin | entitled† | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin, checkPracticeLimit | `client/src/App.tsx:97` |
| `/structured-practice` | student, admin | entitled† | RequireRole allow=['student', 'admin'] | requireSupabaseAuth, requireStudentOrAdmin, checkPracticeLimit | `client/src/App.tsx:98` |
| **Profile Routes** | | | | | |
| `/profile` | student, guardian, admin | free | RequireRole allow=['student', 'guardian', 'admin'] | requireSupabaseAuth | `client/src/App.tsx:101`, `server/index.ts:286` |
| `/profile/complete` | student, guardian, admin | free | RequireRole allow=['student', 'guardian', 'admin'] | requireSupabaseAuth | `client/src/App.tsx:102` |
| **Guardian Routes** | | | | | |
| `/guardian` | guardian | free | RequireRole allow=['guardian'] | `GET /api/guardian/students`: requireSupabaseAuth, requireGuardianRole | `client/src/features/guardian/routes.tsx`, `server/routes/guardian-routes.ts` |
| `/guardian/students` | guardian | free | RequireRole allow=['guardian'] | `/api/guardian/*`: requireSupabaseAuth, requireGuardianRole | `client/src/features/guardian/routes.tsx`, `server/routes/guardian-routes.ts` |
| `/guardian/:studentId` | guardian | entitled (the STUDENT's) | RequireRole allow=['guardian'], GuardianShell | `/api/students/:studentId/*`: requireSupabaseAuth, resolveSubject, entitlementGate | `client/src/features/guardian/routes.tsx`, `server/routes/student-resources.ts` |
| `/guardian/:studentId/calendar` | guardian | entitled (the STUDENT's `calendar_access`) | RequireRole allow=['guardian'], GuardianShell | requireSupabaseAuth, resolveSubject, entitlementGate | `client/src/features/guardian/routes.tsx`, `server/routes/student-resources.ts` (`readGuardianCalendar`) |
| `/guardian/:studentId/exams` | guardian | entitled (the STUDENT's `exam_full_length`) | RequireRole allow=['guardian'], GuardianShell | requireSupabaseAuth, resolveSubject, entitlementGate | `client/src/features/guardian/routes.tsx`, `server/routes/student-resources.ts` |
| `/guardian/:studentId/exams/:sessionId` | guardian | entitled (the STUDENT's `exam_full_length`) | RequireRole allow=['guardian'], GuardianShell | requireSupabaseAuth, resolveSubject, entitlementGate | `client/src/features/guardian/routes.tsx`, `server/routes/student-resources.ts` |

(Guardian rows updated 2026-10-01, guardian closeout: admins are refused on every guardian route (G2-01); the client paywall component and `requireGuardianEntitlement` are gone.)

**†** entitled = Free tier has daily usage limits; entitled tier has unlimited access

---

## API Endpoint Entitlement Map

### Authentication & Profile APIs

| Endpoint | Role | Entitlement | Server Gate | Evidence |
|----------|------|-------------|-------------|----------|
| `POST /api/auth/signup` | public | free | None (public) | `server/routes/supabase-auth-routes.ts` |
| `POST /api/auth/signin` | public | free | None (public) | `server/routes/supabase-auth-routes.ts` |
| `POST /api/auth/signout` | any | free | csrfProtection (public route, clears cookies) | `server/routes/supabase-auth-routes.ts` |
| `GET /api/auth/google/start` | public | free | None (public) | `server/routes/google-oauth-routes.ts` |
| `POST /api/auth/consent` | any | free | requireSupabaseAuth, csrfProtection | `server/routes/supabase-auth-routes.ts` |
| `POST /api/auth/refresh` | public | free | None (public) | `server/routes/supabase-auth-routes.ts` |
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
| `GET /api/practice/next` | student, admin | entitled† | requireSupabaseAuth, requireStudentOrAdmin, checkPracticeLimit | `server/routes/practice-canonical.ts:219-306` |
| `POST /api/practice/answer` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/routes/practice-canonical.ts` |
| `GET /api/practice/topics` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:479` |
| `GET /api/practice/reference/questions` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:480` |
| `POST /api/tutor/messages` | student, admin | entitled† | requireSupabaseAuth, requireStudentOrAdmin, tutor runtime budget/throttle gate | `server/index.ts` |
| `POST /api/tutor/conversations` | student, admin | entitled† | requireSupabaseAuth, requireStudentOrAdmin, tutor runtime budget/throttle gate | `server/index.ts` |
| `GET /api/questions` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:374` |
| `GET /api/questions/:id` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:416` |
| `GET /api/questions/stats` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts` |
| `POST /api/questions/validate` | student, admin | free | UNMOUNTED in runtime (404 contract) | `server/index.ts` (no mount), `tests/ci/canonical-content.publish.contract.test.ts:237-246` |
| `POST /api/questions/feedback` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:430` |
| `GET /api/questions/feed` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:410` |
| `GET /api/review/pool` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection | `server/index.ts` (`/api/review` mount) |
| `POST /api/review/sessions` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection | `server/index.ts` (`/api/review` mount) |
| `GET /api/review/sessions/open` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection | `server/index.ts` (`/api/review` mount) |
| `GET /api/review/sessions/:sessionId/state` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection | `server/index.ts` (`/api/review` mount) |
| `GET /api/review/sessions/:sessionId/next` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection | `server/index.ts` (`/api/review` mount) |
| `POST /api/review/sessions/:sessionId/resume` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection | `server/index.ts` (`/api/review` mount) |
| `POST /api/review/sessions/:sessionId/terminate` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection | `server/index.ts` (`/api/review` mount) |
| `POST /api/review/sessions/:sessionId/calculator-state` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection | `server/index.ts` (`/api/review` mount) |
| `POST /api/review/sessions/:sessionId/skip` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection | `server/index.ts` (`/api/review` mount) |
| `POST /api/review/answer` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection | `server/index.ts` (`/api/review` mount) |
| `GET /api/students/{{studentId}}/mastery/domains` | student, admin | premium (`mastery_domains`) | requireSupabaseAuth, requireStudentOrAdmin, `ensurePremiumMasteryAccess` | `server/index.ts:326` |
| `GET /api/students/:studentId/mastery/skills` | student, admin | premium (`mastery_skills`) | requireSupabaseAuth, requireStudentOrAdmin, `ensurePremiumMasteryAccess` | `server/index.ts:326` |
| `GET /api/students/{{studentId}}/mastery/skills` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:325` |
| `GET /api/me/weakness/clusters` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/index.ts:325` |
| `GET /api/notifications` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/routes/notification-routes.ts:17` |
| `GET /api/notifications/unread-count` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin | `server/routes/notification-routes.ts:114` |
| `PATCH /api/notifications/:id/read` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin, csrfProtection | `server/routes/notification-routes.ts:169` |
| `PATCH /api/notifications/mark-all-read` | student, admin | free | requireSupabaseAuth, requireStudentOrAdmin, csrfProtection | `server/routes/notification-routes.ts:231` |

### Guardian APIs

| Endpoint | Role | Entitlement | Server Gate | Evidence |
|----------|------|-------------|-------------|----------|
| `GET /api/guardian/students` | guardian | free | requireSupabaseAuth, requireGuardianRole | `server/routes/guardian-routes.ts` |
| `POST /api/guardian/link/redeem` | guardian | free | requireSupabaseAuth, requireGuardianRole, guardianLinkCodeEntryRateLimit | `server/routes/guardian-routes.ts` |
| `DELETE /api/guardian/link/:studentId` | guardian | free | requireSupabaseAuth, requireGuardianRole | `server/routes/guardian-routes.ts` |
| `GET /api/students/:studentId/kpi/overall` | student, guardian | free for the student; guardian needs the student's active entitlement | requireSupabaseAuth, resolveSubject | `server/routes/student-resources.ts` (guardian gets the streak only, SCL-188) |
| `GET /api/students/:studentId/mastery/domains` | student, guardian | `mastery_detail` (the STUDENT's) | requireSupabaseAuth, resolveSubject, entitlementGate | `server/routes/student-resources.ts` |
| `GET /api/students/:studentId/calendar` | student, guardian | `calendar_access` (the STUDENT's) | requireSupabaseAuth, resolveSubject, entitlementGate | `server/routes/student-resources.ts` |
| `GET /api/students/:studentId/tests` | student, guardian | `exam_full_length` (the STUDENT's) | requireSupabaseAuth, resolveSubject, entitlementGate | `server/routes/student-resources.ts` |
| `GET /api/students/:studentId/tests/:sessionId/report` | student, guardian | `exam_full_length` (the STUDENT's) | requireSupabaseAuth, resolveSubject, entitlementGate | `server/routes/student-resources.ts` |

A guardian is admitted to `/api/students/:studentId/*` only when `guardian_view_decision` returns `allow` (active link AND active student entitlement). Unlinked → 404; linked but unentitled → 402. `/mastery/skills` refuses a guardian with 403 (SCL-194).

### Admin APIs

| Endpoint | Role | Entitlement | Server Gate | Evidence |
|----------|------|-------------|-------------|----------|
| `GET /api/admin/db-health` | admin | admin-only | requireSupabaseAdmin | `server/index.ts:351` |

### Billing APIs

| Endpoint | Role | Entitlement | Server Gate | Evidence |
|----------|------|-------------|-------------|----------|
| `GET /api/billing/prices` | public | free | None (public) | `server/routes/billing-routes.ts` |
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
  - Wrong role → role-specific dashboard (`/guardian` or `/dashboard`)

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

### Guardian lapsed state
(updated 2026-10-01, guardian closeout: `SubscriptionPaywall` and `guardian-dashboard.tsx` no longer exist.)

**File:** `client/src/features/guardian/GuardianStates.tsx`

**Purpose:** Shows the lapsed state when a per-student read answers 402, or the roster reports `has_active_entitlement: false`.

**Behavior:**
- Classifies a failed read: 402 → lapsed, 404 → revoked, anything else → error
- Lapsed state links to the plan chooser for that student
- UI only; the server refuses every gated read regardless

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
- **File:** `server/middleware/guardian-role.ts`
- **Purpose:** Enforces guardian role (admins are refused, G2-01)
- **Behavior:** Returns 403 if user role is not guardian
- **Evidence:** `server/middleware/guardian-role.ts`

**requireSupabaseAdmin**
- **File:** `server/middleware/supabase-auth.ts`
- **Purpose:** Enforces admin-only access
- **Behavior:** Returns 403 if user is not admin
- **Evidence:** `server/middleware/supabase-auth.ts:427-469`

### Entitlement Enforcement Middleware

**resolveSubject** (guardian reads of a student)
- **File:** `server/middleware/subject-resolver.ts`
- **Purpose:** Decides whether the caller may read this student's data
- **Behavior:**
  - Self → admitted as `via: 'self'`
  - Otherwise calls SQL `guardian_view_decision(uuid, uuid)` via `server/services/guardian-subject.ts`
  - Not linked → 404; linked but student unentitled → 402 PAYMENT_REQUIRED
  - Writes a `guardian_subject_access` row to `audit_logs`; fails closed (500) if it cannot
- **Evidence:** `server/middleware/subject-resolver.ts`, `server/services/guardian-subject.ts`

**entitlementGate** (per-feature, on the STUDENT)
- **File:** `server/routes/student-resources.ts`
- **Purpose:** Applies the `requiresEntitlement` route table (`mastery_detail`, `calendar_access`, `exam_full_length`) to the subject's entitlement
- **Behavior:** Returns 402 when the student lacks the feature
- **Evidence:** `server/routes/student-resources.ts` (`requiresEntitlement`, `entitlementGate`)

(updated 2026-10-01, guardian closeout: `requireGuardianEntitlement` / `server/middleware/guardian-entitlement.ts` no longer exist.)

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
- **Purpose:** Enforces tutor chat usage limits
- **Behavior:**
  - Free tier: 5 tutor chat messages per day
  - Entitled tier: Unlimited
  - Admin: Unlimited
  - Returns 429 if limit exceeded
- **Evidence:** `server/middleware/usage-limits.ts:70-75`, `server/lib/account.ts:298-325`

---

## Admin Access Model

**Admin role = Full access to everything**

Admins have unrestricted access to:
- All student features (dashboard, practice, chat, etc.)
- Not guardian features: guardian routes admit `role = 'guardian'` only, and the subject resolver has no admin bypass (G2-01; owner ruling 2026-08-26 R5)
- Admin-only endpoints (for example `/api/admin/db-health`)

**Key Properties:**
- Admins bypass ALL entitlement checks
- Admins bypass ALL usage limits
- Admins can access any role-gated surface
- Admin access is still authenticated (requires valid Supabase session)

**Implementation:**
- Server: requireSupabaseAdmin checks role === 'admin'
- Entitlements: Admin role bypasses `checkUsageLimit` checks

**Evidence:**
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
