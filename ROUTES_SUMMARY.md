# Routes & Navigation Summary

## Route Mapping Table

| Route Path | Component | Guard | Redirect Behavior |
|------------|-----------|-------|-------------------|
| `/` | HomePage | None (public) | None - landing page |
| `/login` | Login | Redirect if authenticated | → `/dashboard` if authenticated |
| `/dashboard` | LyceonDashboard | Show login prompt if not auth | Renders login prompt (no redirect) |
| `/lyceon-practice` | LyceonPractice | None | None |
| `/profile` | UserProfile | None | None |
| `/profile-complete` | ProfileComplete | None | None |
| `/chat` | ChatPage | None | None |
| `/dashboard-old` | Dashboard (legacy) | None | None |
| `/auth/callback` | AuthCallback | None | → `/dashboard` after OAuth success |
| `/auth/debug` | AuthDebug | None | None |
| `/admin/*` | AdminPortal | Admin only | None |

## Navigation Links (NavBar)

| Link Label | Target Path | Component | Line |
|------------|-------------|-----------|------|
| Lyceon (logo) | `/` | NavBar.tsx | - |
| Practice | `/lyceon-practice` | NavBar.tsx | 34 |
| Progress | `/dashboard` | NavBar.tsx | 35 |
| Profile (menu) | `/profile` | NavBar.tsx | 73 |
| Settings (menu) | `/profile` | NavBar.tsx | 77 |
| Admin Dashboard (menu) | `/admin/dashboard` | NavBar.tsx | 84 |

## Post-Authentication Redirects

All authentication flows now redirect to `/dashboard`:

| Auth Method | File | Line | Redirect To |
|-------------|------|------|-------------|
| Login page (route guard) | login.tsx | 19 | `/dashboard` |
| Email sign-in | SupabaseAuthForm.tsx | 43 | `/dashboard` |
| Email sign-up | SupabaseAuthForm.tsx | 78 | `/dashboard` |
| Google OAuth callback | auth-callback.tsx | 41 | `/dashboard` |

## SPA Fallback

**File**: `server/index.ts` (lines 514-522)

All non-API routes serve `index.html` for React routing:
```typescript
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(staticPath, 'index.html'));
});
```

## Auth Flow Summary

### Email/Password Signup:
```
User fills form
  ↓
POST /api/auth/signup (backend)
  ↓
supabase.auth.signUp() creates user
  ↓
Supabase trigger creates profile
  ↓
HTTP-only cookies set
  ↓
Redirect to /dashboard
```

### Google OAuth:
```
Click "Sign in with Google"
  ↓
supabase.auth.signInWithOAuth({ provider: 'google' })
  ↓
Redirect to Google
  ↓
User authenticates
  ↓
Redirect to /auth/callback
  ↓
exchangeCodeForSession()
  ↓
Session created
  ↓
Redirect to /dashboard
```

### Sign Out:
```
Click sign out
  ↓
supabase.auth.signOut()
  ↓
Clear cookies
  ↓
Redirect to / (homepage)
```

## Guard Implementation

### Login Page Guard
**File**: `client/src/pages/login.tsx`
```typescript
useEffect(() => {
  if (isAuthenticated && !requiresConsent && !isLoading) {
    navigate("/dashboard");
  }
}, [isAuthenticated, requiresConsent, isLoading, navigate]);
```

### Dashboard Guard
**File**: `client/src/pages/lyceon-dashboard.tsx`

Shows login prompt instead of redirecting (prevents loops):
```typescript
if (!authLoading && !user) {
  return <LoginPrompt />;
}
```

## CORS/CSRF Configuration

**File**: `server/index.ts` (lines 101-126)

Development mode allows:
- Replit domain (http/https)
- localhost:5000 (http/https)
- 127.0.0.1:5000 (http/https)

Production mode:
- Only explicitly configured ALLOWED_ORIGINS

## Key Files Changed

### Frontend Routing Fixes:
1. `client/src/pages/login.tsx` - Redirect to /dashboard
2. `client/src/components/auth/SupabaseAuthForm.tsx` - Post-auth redirects
3. `client/src/components/NavBar.tsx` - Progress link correction
4. `client/src/pages/auth-callback.tsx` - OAuth redirect to /dashboard

### Backend Auth Migration:
5. `server/routes/supabase-auth-routes.ts` - Use Supabase trigger for profiles
6. `server/index.ts` - CORS/CSRF localhost support

### Database Setup:
7. `database/supabase-profiles-setup.sql` - **Run in Supabase SQL Editor**

## Testing Verification Points

✅ **Login Loop Fixed**: Authenticated users redirected to /dashboard, not /
✅ **OAuth Flow**: Google login → callback → /dashboard (no loop)
✅ **NavBar Links**: All links navigate correctly
✅ **Guards Work**: Login page redirects away, dashboard shows prompt
✅ **Session Persistence**: Refresh maintains authentication
✅ **Sign Out**: Clears session and returns to homepage

⚠️ **Database Setup Required**: Run SQL script in Supabase before testing signup
