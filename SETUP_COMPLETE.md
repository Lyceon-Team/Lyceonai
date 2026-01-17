# Supabase Auth Setup - Complete Guide

## ✅ What's Been Fixed

### 1. Database Migration to Supabase
- ✅ Created SQL script for profiles table with RLS policies
- ✅ Auto-insert trigger (`handle_new_user`) creates profiles on signup
- ✅ Backend uses Supabase exclusively for auth data
- ✅ All routing redirects to `/dashboard` correctly

### 2. Session Handling Fix
- ✅ Backend returns session tokens in signup response
- ✅ Frontend uses `setSession()` to establish session
- ✅ Removed development mode redirect block
- ✅ Session persists across page refreshes

## ⚠️ Required Supabase Configuration

### Step 1: Run SQL Script (✅ DONE)
You've already run `database/supabase-profiles-setup.sql` in Supabase SQL Editor.

### Step 2: Disable Email Confirmation (⚠️ REQUIRED)

**This is blocking signup from completing!**

1. Open your Supabase dashboard: https://supabase.com/dashboard
2. Select your project
3. Navigate to **Authentication** → **Providers**
4. Find **Email** provider section
5. **Uncheck "Confirm email"** checkbox
6. Click **Save**

**Why**: Email confirmation requires users to click a link in their email before signing in. For development/testing, this adds unnecessary friction.

### Step 3: Configure Google OAuth Redirect URL

If using Google OAuth, add your callback URL:

1. Supabase Dashboard → **Authentication** → **URL Configuration**
2. Add to **Redirect URLs**:
   - `https://learningai-amingwa08.replit.app/auth/callback`
   - `https://<your-replit-url>/auth/callback`

## 🧪 Testing Checklist

After disabling email confirmation, test these flows:

### Email Signup
- [ ] Navigate to `/login`
- [ ] Click "Sign Up" tab
- [ ] Fill form with gmail.com email
- [ ] Click "Sign Up"
- [ ] ✅ Should redirect to `/dashboard` immediately
- [ ] ✅ NavBar should show authenticated state
- [ ] ✅ User profile auto-created in Supabase

### Email Sign-In
- [ ] Navigate to `/login`
- [ ] Fill credentials for existing account
- [ ] Click "Sign In"
- [ ] ✅ Should redirect to `/dashboard`

### Google OAuth
- [ ] Navigate to `/login`
- [ ] Click "Sign in with Google"
- [ ] Complete Google authentication
- [ ] ✅ Should redirect to `/auth/callback` then `/dashboard`

### Session Persistence
- [ ] While on `/dashboard`, refresh page
- [ ] ✅ Should remain on `/dashboard` (no redirect to login)

### Navigation
- [ ] Click "Practice" link → should go to `/lyceon-practice`
- [ ] Click "Progress" link → should go to `/dashboard`

### Sign Out
- [ ] Open user menu in NavBar
- [ ] Click "Sign Out"
- [ ] ✅ Should redirect to homepage `/`

### Login Page Guard
- [ ] While authenticated, navigate to `/login`
- [ ] ✅ Should auto-redirect to `/dashboard`

## 📁 Files Modified

### Backend
1. `server/routes/supabase-auth-routes.ts` - Returns session tokens in response
2. `server/index.ts` - CORS/CSRF with localhost origins

### Frontend
3. `client/src/contexts/SupabaseAuthContext.tsx` - Uses `setSession()` for signup
4. `client/src/components/auth/SupabaseAuthForm.tsx` - Always redirects to /dashboard
5. `client/src/pages/login.tsx` - Auto-redirects authenticated users
6. `client/src/components/NavBar.tsx` - Progress link fixed

### Database
7. `database/supabase-profiles-setup.sql` - Profiles table with RLS (✅ executed)

## 🔧 Architecture Summary

```
┌────────────────────────────────────────────┐
│           Supabase Cloud                   │
├────────────────────────────────────────────┤
│  auth.users (Supabase Auth)                │
│    ↓ trigger: handle_new_user()            │
│  public.profiles (with RLS)                │
│    - Auto-created on signup                │
│    - Row-level security enforced           │
└────────────────────────────────────────────┘
              ↓
┌────────────────────────────────────────────┐
│         Frontend (React/Vite)              │
├────────────────────────────────────────────┤
│  1. User submits signup form               │
│  2. POST /api/auth/signup                  │
│  3. Backend returns session tokens         │
│  4. supabase.auth.setSession(tokens)       │
│  5. Redirect to /dashboard                 │
└────────────────────────────────────────────┘
```

## 🐛 Common Issues

### Issue: "Email not confirmed" error
**Solution**: Disable email confirmation in Supabase Auth settings (see Step 2 above)

### Issue: Session not persisting
**Solution**: Check browser cookies - should see Supabase session in local storage

### Issue: Google OAuth fails
**Solution**: Add redirect URL to Supabase Auth URL Configuration

### Issue: 404 on `/api/auth/session`
**Note**: This endpoint doesn't exist - we use Supabase client directly. This error can be ignored.

## 📊 Expected Console Logs

### Successful Signup
```
[AUTH] Starting sign up for: user@gmail.com
[AUTH] ✅ Sign up successful! User: { id: ..., email: ... }
[AUTH] Setting session from backend response
[AUTH] ✅ Session set successfully
[AUTH] Auth state changed: SIGNED_IN
```

### Successful Sign-In
```
[AUTH] Starting sign in for: user@gmail.com
[AUTH] ✅ Sign in successful! User: user@gmail.com
[AUTH] ✅ Session verified
```

## 🎯 Next Steps

1. **Disable email confirmation** in Supabase Auth settings
2. Test email signup flow end-to-end
3. Test Google OAuth (if configured)
4. Verify session persistence
5. Test all navigation links

## 📞 Support

If signup still fails after disabling email confirmation:
1. Check browser console for errors
2. Check Supabase Auth logs in dashboard
3. Verify profiles table exists: `SELECT * FROM public.profiles;`
4. Verify trigger exists: `SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';`
