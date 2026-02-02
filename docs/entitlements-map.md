# Entitlements Map - Sprint 2

**Status**: ACTIVE  
**Last Updated**: 2026-02-02  
**Audit Trail**: Sprint 2 Closeout

---

## Overview

This document maps all routes and endpoints to their required entitlements (roles and permissions).

---

## Role Definitions

- **admin**: Full system access, can manage all resources
- **student**: Standard user account, can access learning features
- **guardian**: Parent/guardian account, can manage linked student accounts
- **public**: No authentication required

---

## Route Entitlements

### Public Routes (No Auth Required)

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | HomePage | Landing page |
| `/login` | Login | Authentication portal |
| `/auth/callback` | AuthCallback | OAuth callback handler |
| `/auth/debug` | AuthDebug | OAuth debugging (safe for production) |

### Student + Admin Routes

| Route | Component | Allowed Roles | Middleware |
|-------|-----------|---------------|------------|
| `/mastery` | MasteryPage | `student`, `admin` | `RequireRole(['student', 'admin'])` |
| `/dashboard` | LyceonDashboard | `student`, `admin` | Shows login prompt (no hard redirect) |
| `/lyceon-practice` | LyceonPractice | `student`, `admin` | Auth required (implicit) |
| `/chat` | ChatPage | `student`, `admin` | Auth required (implicit) |

### All Authenticated Users

| Route | Component | Allowed Roles | Middleware |
|-------|-----------|---------------|------------|
| `/profile` | UserProfile | `student`, `guardian`, `admin` | Auth required |
| `/profile/complete` | ProfileComplete | `student`, `guardian`, `admin` | `RequireRole(['student', 'guardian', 'admin'])` |

### Admin Only Routes

| Route | Component | Allowed Roles | Middleware |
|-------|-----------|---------------|------------|
| `/admin/*` | AdminPortal | `admin` | `RequireRole(['admin'])` |

---

## API Endpoint Entitlements

### Authentication Endpoints (Public)

| Endpoint | Method | Auth | CSRF | Purpose |
|----------|--------|------|------|---------|
| `/api/auth/signup` | POST | No | Yes | Create new account |
| `/api/auth/signin` | POST | No | Yes | Sign in with credentials |
| `/api/auth/signout` | POST | No | Yes | Sign out and clear session |
| `/api/auth/user` | GET | No | No | Get current user (from cookies) |
| `/api/auth/refresh` | POST | No | Yes | Refresh access token |
| `/api/auth/debug` | GET | No | No | OAuth debug information |

### Authentication Endpoints (Authenticated)

| Endpoint | Method | Auth | CSRF | Roles | Purpose |
|----------|--------|------|------|-------|---------|
| `/api/auth/consent` | POST | Yes | Yes | All | Submit guardian consent (under-13) |
| `/api/auth/complete-profile` | POST | Yes | Yes | All | Complete user profile |

### Mastery Endpoints (Student + Admin)

| Endpoint | Method | Auth | CSRF | Roles | Data Source |
|----------|--------|------|------|-------|-------------|
| `/api/me/mastery/skills` | GET | Yes | No | `student`, `admin` | `student_skill_mastery` table |
| `/api/me/mastery/weakest` | GET | Yes | No | `student`, `admin` | `student_skill_mastery` table (filtered) |
| `/api/me/mastery/summary` | GET | Yes | No | `student`, `admin` | `student_skill_mastery` table (aggregated) |
| `/api/me/mastery/add-to-plan` | POST | Yes | No | `student`, `admin` | `student_study_plan_days` table |

**Middleware Stack**:
```typescript
app.use("/api/me/mastery", requireSupabaseAuth, requireStudentOrAdmin, masteryRouter);
```

### Practice Endpoints (Student + Admin)

| Endpoint | Method | Auth | CSRF | Roles | Purpose |
|----------|--------|------|------|-------|---------|
| `/api/practice/*` | Various | Yes | Varies | `student`, `admin` | Practice session management |

### Account Endpoints (Authenticated)

| Endpoint | Method | Auth | CSRF | Roles | Purpose |
|----------|--------|------|------|-------|---------|
| `/api/account/bootstrap` | GET | Yes | No | `student`, `guardian` | Initialize account |
| `/api/account/status` | GET | Yes | No | `student`, `guardian` | Get account status |
| `/api/account/select` | POST | Yes | No | `guardian` only | Select active account |

### Admin Endpoints (Admin Only)

| Endpoint | Method | Auth | CSRF | Roles | Purpose |
|----------|--------|------|------|-------|---------|
| `/api/admin/*` | Various | Yes | Varies | `admin` | Admin-only operations |

---

## Middleware Enforcement

### Backend Middleware Stack

1. **requireSupabaseAuth**: Validates Supabase session from HTTP-only cookies
2. **requireStudentOrAdmin**: Restricts to student and admin roles only
3. **requireSupabaseAdmin**: Restricts to admin role only
4. **csrfGuard**: CSRF token validation on mutating endpoints
5. **requireConsentCompliance**: FERPA compliance check (under-13 users)

### Frontend Route Guards

1. **RequireRole**: Component wrapper that enforces role requirements
2. **Auth State Check**: Many components check `useAuth()` state directly

---

## Data Access Patterns

### Row-Level Security (RLS)

All Supabase tables use RLS policies to enforce data access:

- **student_skill_mastery**: Users can only read their own mastery data
- **profiles**: Users can only update their own profile
- **student_study_plan_days**: Users can only access their own study plans
- **practice_sessions**: Users can only access their own sessions

### Service Role Usage

Backend uses Supabase **service role** for:
- Admin operations
- Cross-user data aggregation
- Account management

**Security**: Service role key is **never** exposed to frontend.

---

## Entitlement Verification

### How to Verify Entitlements

1. **Grep for middleware**: Check which middleware is applied to each route
2. **Test auth boundaries**: Try accessing routes/endpoints without proper role
3. **Review RLS policies**: Check Supabase RLS policies for each table
4. **Audit logs**: Check logger output for auth failures

### Expected Behaviors

- ✅ Unauthenticated user accessing `/mastery` → Login prompt or redirect
- ✅ Student accessing `/admin/*` → 403 Forbidden
- ✅ Guardian accessing student-only endpoint → 403 Forbidden
- ✅ Request without CSRF token → 403 Forbidden

---

## Sprint 2 Compliance

All routes and endpoints verified to be:
- ✅ Properly authenticated
- ✅ Properly authorized (role-based)
- ✅ CSRF protected (where appropriate)
- ✅ RLS enforced on data access
- ✅ No placeholder or fake data
- ✅ No silent failures

---

## References

- **Auth Middleware**: `server/middleware/supabase-auth.ts`
- **Role Guards**: `client/src/components/auth/RequireRole.tsx`
- **RLS Policies**: `database/policies/*.sql`
- **Route Registry**: `docs/route-registry.md`
