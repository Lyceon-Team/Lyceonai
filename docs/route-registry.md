# Route Registry

This document provides a comprehensive registry of all frontend routes and their backing API endpoints.

## Frontend Routes Overview

| Route Path | Component | Purpose | Status |
|------------|-----------|---------|--------|
| `/` | HomePage | Landing page | ✅ Active |
| `/login` | Login | User authentication | ✅ Active |
| `/dashboard` | LyceonDashboard | Student dashboard | ✅ Active |
| `/profile` | UserProfile | User profile & settings | ✅ Active |
| `/practice` | Practice pages | SAT practice | ✅ Active |
| `/flow-cards` | FlowCards | TikTok-style practice | ✅ Active |
| `/chat` | ChatPage | AI tutor chat | ✅ Active |
| `/calendar` | Calendar | Study planning | ✅ Active |
| `/admin/*` | AdminPortal | Admin dashboard | ✅ Active |

---

## `/dashboard` - Student Dashboard

**Component:** `client/src/pages/lyceon-dashboard.tsx`

**Purpose:** Main student dashboard showing progress, calendar, and practice recommendations.

### Backing API Endpoints

#### Real Endpoints (Implemented)
- **GET `/api/progress/kpis`** - Weekly KPIs and recency statistics
  - Returns: Practice sessions, questions solved, accuracy for the week
  - Used for: "This Week" stats card
  
- **GET `/api/progress/projection`** - SAT score projection
  - Returns: Projected SAT score based on current performance
  - Used by: `ScoreProjectionCard` component
  
- **GET `/api/calendar/profile`** - Calendar profile data
  - Returns: User timezone, baseline score, target score, exam date
  - Used for: Profile information, study goals
  
- **GET `/api/calendar/month`** - Monthly calendar data
  - Returns: Daily study plans, streak information
  - Used for: Today's plan, streak display
  
- **POST `/api/student/analyze-question`** - AI question analysis
  - Returns: AI analysis of uploaded question
  - Used by: `QuestionUpload` component (Ask AI About My Question)

### Removed/Non-Existent Endpoints
- ❌ `/api/progress` - Never existed
- ❌ `/api/progress/detailed` - Never existed
- ❌ `/api/recent-activity` - Never existed

### Component Dependencies
```
LyceonDashboard
├── ScoreProjectionCard → /api/progress/projection
├── QuestionUpload → /api/student/analyze-question
└── Calendar queries → /api/calendar/profile, /api/calendar/month
```

---

## `/profile` - User Profile & Settings

**Component:** `client/src/pages/UserProfile.tsx`

**Purpose:** User profile management, settings, progress overview, and billing.

### Backing API Endpoints

#### Real Endpoints (Implemented)
- **GET `/api/profile`** - Canonical user profile endpoint
  - Returns: User ID, email, display name, role, admin status, guardian info
  - Replaces: `/api/auth/user` (still exists for legacy auth flow)
  - Authentication: Required (JWT via httpOnly cookie)
  - Response structure:
    ```json
    {
      "authenticated": true,
      "user": {
        "id": "uuid",
        "email": "user@example.com",
        "display_name": "Display Name",
        "name": "Display Name",
        "username": "user",
        "role": "student|admin|guardian",
        "isAdmin": false,
        "isGuardian": false,
        "is_under_13": false,
        "guardian_consent": false
      }
    }
    ```

### Removed/Non-Existent Endpoints
- ❌ `/api/progress/detailed` - Removed (never existed)
  - Was: Disabled query for user statistics
  - Now: Progress shown on Dashboard using `/api/progress/kpis`
  
- ❌ `/api/user/notification-settings` - Removed (never existed)
  - Was: Disabled query for notification preferences
  - Now: Stubbed feature with "Coming Soon" message

### Stubbed Features

The following profile features are intentionally stubbed (UI shown but not functional):

1. **Progress Tab**
   - Shows "Coming Soon" message
   - Directs users to Dashboard for current stats
   - Will be implemented when `/api/progress/detailed` is created

2. **Notification Settings**
   - Shows "Coming Soon" alert
   - No backend endpoint yet
   - Will be implemented when `/api/user/notification-settings` is created

3. **Profile Updates**
   - Edit button exists but throws error
   - No PATCH `/api/profile` endpoint yet
   - Will be implemented when profile editing is added

### Component Structure
```
UserProfile
├── Profile Tab → /api/profile (GET only, no updates)
├── Progress Tab → STUBBED (shows "Check Dashboard")
├── Settings Tab → STUBBED (shows "Coming Soon")
└── Billing Tab → Static content (no API)
```

---

## Authentication Endpoints

### Active Endpoints
- **GET `/api/auth/user`** - Legacy user authentication check
  - Still used by auth flow
  - Returns user + profile data similar to `/api/profile`
  
- **GET `/api/profile`** - Canonical profile endpoint
  - Preferred for profile fetching in UI
  - Simpler, focused response

- **POST `/api/auth/signup`** - Email/password signup
- **POST `/api/auth/signin`** - Email/password signin
- **POST `/api/auth/signout`** - Sign out current user
- **GET `/api/auth/callback`** - OAuth callback handler

---

## API Endpoint Inventory

### Progress & Analytics
| Endpoint | Method | Status | Used By |
|----------|--------|--------|---------|
| `/api/progress/kpis` | GET | ✅ Active | Dashboard |
| `/api/progress/projection` | GET | ✅ Active | Dashboard (ScoreProjectionCard) |
| `/api/progress/detailed` | GET | ❌ Never existed | N/A |

### Calendar & Planning
| Endpoint | Method | Status | Used By |
|----------|--------|--------|---------|
| `/api/calendar/profile` | GET | ✅ Active | Dashboard |
| `/api/calendar/month` | GET | ✅ Active | Dashboard, Calendar |

### User & Profile
| Endpoint | Method | Status | Used By |
|----------|--------|--------|---------|
| `/api/profile` | GET | ✅ Active | Profile page |
| `/api/profile` | PATCH | ⏳ Not implemented | N/A |
| `/api/auth/user` | GET | ✅ Active | Auth flow |
| `/api/user/notification-settings` | GET/PATCH | ❌ Never existed | N/A |

### Student Features
| Endpoint | Method | Status | Used By |
|----------|--------|--------|---------|
| `/api/student/analyze-question` | POST | ✅ Active | Dashboard (QuestionUpload) |

---

## Migration Notes

### Profile Page Migration (Completed)
- **Before:** Used `/api/auth/user` with disabled queries to non-existent endpoints
- **After:** Uses `/api/profile` exclusively, stubbed features clearly marked
- **Changes:**
  1. Replaced `/api/auth/user` → `/api/profile` as primary endpoint
  2. Removed disabled query: `/api/progress/detailed`
  3. Removed disabled query: `/api/user/notification-settings`
  4. Added "Coming Soon" messages for stubbed features
  5. Updated `/api/profile` server endpoint to return complete user data

### Dashboard Verification (Confirmed)
- ✅ All endpoints are real and implemented
- ✅ No disabled or placeholder queries
- ✅ Uses only documented, working endpoints

---

## Validation Commands

To verify endpoint cleanup:

```bash
# Should return 0 hits (nonexistent endpoints removed)
grep -r "/api/progress/detailed" client/src
grep -r "/api/user/notification-settings" client/src

# Should show usage (real endpoints)
grep -n "/api/profile" client/src/pages/UserProfile.tsx
grep -nE "/api/progress/kpis|/api/progress/projection" client/src/pages/lyceon-dashboard.tsx
```

Expected output:
- `/api/progress/detailed`: **0 hits** ✅
- `/api/user/notification-settings`: **0 hits** ✅
- `/api/profile`: **2+ hits in UserProfile.tsx** ✅
- `/api/progress/kpis` or `/api/progress/projection`: **1+ hits in lyceon-dashboard.tsx** ✅

---

## Future Endpoint Candidates

These endpoints may be implemented in the future:

1. **PATCH `/api/profile`** - Update user profile (name, display_name)
2. **GET/PATCH `/api/user/notification-settings`** - Manage notification preferences
3. **GET `/api/progress/detailed`** - Detailed user statistics for Profile page
4. **GET `/api/user/activity/recent`** - Recent activity feed

When implementing these, update this registry and remove "Coming Soon" stubs from the UI.

---

**Last Updated:** 2026-02-02  
**Maintainer:** Development Team
