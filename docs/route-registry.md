# Route Registry - Sprint 2

**Status**: ACTIVE  
**Last Updated**: 2026-02-02  
**Audit Trail**: Sprint 2 Closeout

---

## Route Classification

Routes are classified as:
- **ACTIVE**: Fully wired to real backend data, production-ready
- **STUBBED**: UI exists but intentionally not wired to backend (no fetch)
- **DISABLED**: Route removed or blocked

---

## Active Routes

### `/mastery`
- **Status**: ✅ ACTIVE
- **Component**: `MasteryPage` (`client/src/pages/mastery.tsx`)
- **Backend Endpoints**:
  - `GET /api/me/mastery/skills` - Fetch all skill mastery data
  - `GET /api/me/mastery/weakest` - Get weakest skills for focus areas
  - `POST /api/me/mastery/add-to-plan` - Add skill to study plan
- **Data Source**: `student_skill_mastery` table (Supabase)
- **Auth Required**: Yes (`requireSupabaseAuth`, `requireStudentOrAdmin`)
- **Entitlement**: Student or Admin role
- **UI States**:
  - ✅ Loading state (skeleton)
  - ✅ Error state (graceful message)
  - ✅ Empty state ("Start practicing to see your progress!")
  - ✅ Populated state (skill heatmap with real data)
- **Backend Implementation**: `apps/api/src/routes/mastery.ts`
- **Mounted At**: `server/index.ts` line 308

### `/dashboard`
- **Status**: ✅ ACTIVE
- **Component**: `LyceonDashboard` (`client/src/pages/lyceon-dashboard.tsx`)
- **Backend Endpoints**: Various dashboard data endpoints
- **Auth Required**: Yes (shows login prompt if not authenticated)
- **UI States**: Full implementation with real data

### `/lyceon-practice`
- **Status**: ✅ ACTIVE
- **Component**: `LyceonPractice`
- **Backend Endpoints**: Practice session endpoints
- **Auth Required**: Yes
- **Data Source**: Real practice questions from canonical pipeline

### `/profile`
- **Status**: ✅ ACTIVE
- **Component**: `UserProfile`
- **Backend Endpoints**: User profile data
- **Auth Required**: Yes

### `/profile/complete`
- **Status**: ✅ ACTIVE
- **Component**: `ProfileComplete` (`client/src/pages/profile-complete.tsx`)
- **Backend Endpoints**:
  - `POST /api/auth/complete-profile` - Submit profile completion data
- **Data Source**: `profiles` table (Supabase)
- **Auth Required**: Yes
- **UI States**:
  - ✅ Multi-step form (3 steps)
  - ✅ Real backend persistence
  - ✅ Legal document acceptance tracking
  - ✅ Error handling
- **Backend Implementation**: `server/routes/supabase-auth-routes.ts`

### `/login`
- **Status**: ✅ ACTIVE
- **Component**: `Login`
- **Backend Endpoints**: Supabase auth endpoints
- **Auth Required**: No (redirects if authenticated)

### `/` (Homepage)
- **Status**: ✅ ACTIVE
- **Component**: `HomePage`
- **Backend Endpoints**: Public content
- **Auth Required**: No

### `/chat`
- **Status**: ✅ ACTIVE
- **Component**: `ChatPage`
- **Backend Endpoints**: AI tutor endpoints
- **Auth Required**: Yes

### `/auth/callback`
- **Status**: ✅ ACTIVE
- **Component**: `AuthCallback`
- **Purpose**: OAuth callback handler
- **Auth Required**: No

### `/admin/*`
- **Status**: ✅ ACTIVE
- **Component**: `AdminPortal`
- **Backend Endpoints**: Admin-only endpoints
- **Auth Required**: Yes (Admin only)

---

## Stubbed Routes

*(None currently - all routes are either ACTIVE or removed)*

---

## Removed Routes

### Former Ingestion Routes
- **Status**: ❌ DISABLED/REMOVED
- **Reason**: Ingestion v4 cleanup - no longer needed
- **References Removed**: Sprint 2 cleanup
- **Verification**: `npm run audit:no-ingest` confirms no lingering code

---

## Route Validation

All routes can be validated by:

1. **Grep Audit**: `grep -r "Route path=" client/src/App.tsx`
2. **Backend Endpoint Check**: Verify each backend endpoint in server code
3. **Manual Testing**: Load each route and verify real data loads

---

## API Endpoint Mapping

| Client Route | Backend Endpoints | Mount Point | Implementation |
|--------------|------------------|-------------|----------------|
| `/mastery` | `/api/me/mastery/*` | `server/index.ts:308` | `apps/api/src/routes/mastery.ts` |
| `/profile/complete` | `/api/auth/complete-profile` | `server/index.ts:301` | `server/routes/supabase-auth-routes.ts` |
| `/dashboard` | Various `/api/me/*` endpoints | Multiple | Multiple route files |
| `/lyceon-practice` | `/api/practice/*` | `server/index.ts` | `server/routes/practice-canonical.ts` |

---

## Notes

- All ACTIVE routes must be backed by real Supabase data
- No mock data, no "coming soon" placeholders
- All endpoints require proper authentication and entitlement checks
- CSRF protection enabled on all mutating endpoints
- All routes follow the same auth pattern (HTTP-only cookies)
