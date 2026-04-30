import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { SupabaseProfile } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { clearCsrfToken, csrfFetch, getCsrfToken } from '@/lib/csrf';
// CSRF handshake utilities
import type { ConsentSource } from '@shared/legal-consent';

export type SignupOutcome = 'authenticated' | 'verification_required';

export interface SignupResult {
  outcome: SignupOutcome;
  message?: string;
  nextPath?: string;
  user?: {
    id: string;
    email: string | null;
  };
}

export interface SignupLegalConsent {
  studentTermsAccepted: boolean;
  privacyPolicyAccepted: boolean;
  consentSource?: ConsentSource;
}

interface SupabaseAuthContextType {
  user: SupabaseProfile | null;
  isLoading: boolean;
  authLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isGuardian: boolean;
  signUp: (email: string, password: string, legalConsent: SignupLegalConsent, displayName?: string) => Promise<SignupResult>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (legalConsent: SignupLegalConsent) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const SupabaseAuthContext = createContext<SupabaseAuthContextType | undefined>(undefined);

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SupabaseProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true); // Default true as requested
  const queryClient = useQueryClient();
  const isInitializing = useRef(true); // Flag to prevent auth state changes during init
  const clearAuthState = () => {
    clearCsrfToken();
    setUser(null);
  };

  // Fetch user profile from backend
  const fetchUserFromBackend = async (): Promise<SupabaseProfile | null> => {
    try {
      const tryFetchUserProfile = async (): Promise<Response> => {
        return csrfFetch('/api/profile', { credentials: 'include' });
      };

      let response = await tryFetchUserProfile();

      // If access token expired, attempt one server-side refresh using httpOnly cookie
      if (response.status === 401 || response.status === 403) {
        console.log('[AUTH] Access token expired, attempting server-side refresh');
        const refreshResp = await csrfFetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}), // server will fall back to cookie
        });

        if (refreshResp.ok) {
          clearCsrfToken();
          console.log('[AUTH] Token refreshed, retrying user fetch');
          response = await tryFetchUserProfile();
        } else {
          clearAuthState();
          return null;
        }
      }

      if (response.status === 401 || response.status === 403) {
        clearAuthState();
        return null;
      }

      if (!response.ok) {
        console.error('[AUTH] Server error fetching user:', response.status);
        return null;
      }

      const data = await response.json();
      const backendUser = data.user;
      if (!backendUser) return null;

      return {
        id: backendUser.id,
        email: backendUser.email,
        display_name: backendUser.display_name,
        role: backendUser.role,
        is_under_13: backendUser.is_under_13,
        guardian_consent: backendUser.guardian_consent,
        student_link_code: backendUser.student_link_code,
        created_at: backendUser.created_at,
        last_login_at: backendUser.last_login_at,
        guardian_email: backendUser.guardian_email,
        updated_at: backendUser.updated_at,
        // Map additional onboarding status flags
        profile_completed_at: backendUser.profileCompletedAt,
        requiredConsentsComplete: backendUser.requiredConsentsComplete,
        requiredProfileComplete: backendUser.requiredProfileComplete,
        guardianConsentRequired: backendUser.guardianConsentRequired,
      };
    } catch (error) {
      console.error('[AUTH] Network error fetching user from backend:', error);
      return null;
    }
  };

  // Initialize auth on mount
  useEffect(() => {
    let mounted = true;
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const initializeAuth = async () => {
      console.log('[AUTH] Starting initialization');

      try {
        // Pre-fetch CSRF token to "warm up" the handshake and detect connectivity issues early.
        // This avoids a race condition where the first mutating request (login) hangs on the handshake.
        console.log('[AUTH] Pre-fetching CSRF token...');
        await getCsrfToken().catch(err => {
          if (!abortController.signal.aborted) {
            console.warn('[AUTH] CSRF pre-fetch failed, will retry on first mutation:', err);
          }
        });

        // Bail out early if unmounted (StrictMode cleanup)
        if (abortController.signal.aborted) return;

        // Add a safety timeout to profile fetch to prevent boot-hangs if Supabase/API is slow.
        const profileFetchPromise = fetchUserFromBackend();
        const timeoutPromise = new Promise<null>((resolve) => {
          timeoutId = setTimeout(() => {
            console.warn('[AUTH] Profile fetch timed out, proceeding as unauthenticated');
            resolve(null);
          }, 8000);
        });

        const backendUser = await Promise.race([profileFetchPromise, timeoutPromise]);

        // Clear the timeout so it doesn't fire after the race has resolved
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        // Bail out if unmounted during the async work
        if (!mounted || abortController.signal.aborted) return;

        if (backendUser) {
          console.log('[AUTH] Found user from backend cookies');
          setUser(backendUser);
        } else {
          console.log('[AUTH] No existing session found or fetch timed out');
          clearAuthState();
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error('[AUTH] Initialization failed:', error);
        }
      } finally {
        if (mounted && !abortController.signal.aborted) {
          setAuthLoading(false);
          isInitializing.current = false;
          console.log('[AUTH] Initialization complete');
        }
      }
    };

    initializeAuth();

    return () => {
      mounted = false;
      abortController.abort();
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [queryClient]);

  const signUp = async (
    email: string,
    password: string,
    legalConsent: SignupLegalConsent,
    displayName?: string,
  ): Promise<SignupResult> => {
    setAuthLoading(true);
    try {
      const response = await csrfFetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          password,
          displayName,
          legalConsent: {
            studentTermsAccepted: legalConsent.studentTermsAccepted,
            privacyPolicyAccepted: legalConsent.privacyPolicyAccepted,
            consentSource: legalConsent.consentSource ?? 'email_signup_form',
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('[AUTH] Sign up failed:', data.error);
        throw new Error(data.error || 'Failed to sign up');
      }

      const outcome = data?.outcome as SignupOutcome | undefined;
      if (outcome === 'verification_required') {
        setUser(null);
        return {
          outcome: 'verification_required',
          message: data?.message || 'Please verify your email to continue.',
          user: data?.user,
        };
      }

      // Authenticated signup: hydrate canonical profile from backend cookies.
      const backendUser = await fetchUserFromBackend();
      if (!backendUser) {
        setUser(null);
        throw new Error('Failed to load user profile after signup');
      }

      setUser(backendUser);
      return {
        outcome: 'authenticated',
        message: data?.message,
        nextPath: data?.nextPath,
        user: data?.user,
      };
    } catch (error: any) {
      console.error('[AUTH] Sign up error:', error);
      throw new Error(error.message || 'Failed to sign up');
    } finally {
      setAuthLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    setAuthLoading(true);
    try {
      const response = await csrfFetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('[AUTH] Server sign in failed:', data?.error || data);
        throw new Error(data?.error || 'Invalid email or password');
      }

      clearCsrfToken();

      const backendUser = await fetchUserFromBackend();
      if (backendUser) {
        setUser(backendUser);
      } else {
        clearAuthState();
        throw new Error('Failed to load user profile after sign-in');
      }

      console.log('[AUTH] Server sign in successful');
    } finally {
      setAuthLoading(false);
    }
  };

  const signInWithGoogle = async (legalConsent: SignupLegalConsent) => {
    if (!legalConsent.studentTermsAccepted || !legalConsent.privacyPolicyAccepted) {
      throw new Error('You must accept Terms and Privacy before continuing with Google');
    }

    setAuthLoading(true);
    try {
      const params = new URLSearchParams({
        termsAccepted: 'true',
        privacyAccepted: 'true',
        consentSource: legalConsent.consentSource ?? 'google_continue_pre_oauth',
      });
      console.log('[AUTH] Redirecting to Google OAuth');
      window.location.href = `/api/auth/google/start?${params.toString()}`;
    } catch (error: any) {
      console.error('[AUTH] Google sign in error:', error);
      setAuthLoading(false);
      throw new Error(error.message || 'Failed to sign in with Google');
    }
  };

  const signOut = async () => {
    setAuthLoading(true);
    try {
      const response = await csrfFetch('/api/auth/signout', {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Sign out failed with status ${response.status}`);
      }

      clearAuthState();
      queryClient.invalidateQueries();
    } catch (error: any) {
      console.error('[AUTH] Sign out error:', error);
      throw new Error(error.message || 'Failed to sign out');
    } finally {
      setAuthLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    setAuthLoading(true);
    try {
      const response = await csrfFetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        let errorMsg = 'Failed to send reset email';
        try {
          const data = await response.json();
          errorMsg = data.error || errorMsg;
        } catch (e) {
          errorMsg = `Server error (${response.status}): ${response.statusText || 'No response body'}`;
        }
        throw new Error(errorMsg);
      }

      // Successful response should be JSON, but let's be safe
      return await response.json().catch(() => ({ success: true }));
    } catch (error: any) {
      console.error('[AUTH] Reset password error:', error);
      throw new Error(error.message || 'Failed to send reset email');
    } finally {
      setAuthLoading(false);
    }
  };

  const updatePassword = async (password: string) => {
    setAuthLoading(true);
    try {
      const response = await csrfFetch('/api/auth/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        let errorMsg = 'Failed to update password';
        try {
          const data = await response.json();
          errorMsg = data.error || errorMsg;
        } catch (e) {
          errorMsg = `Server error (${response.status}): ${response.statusText || 'No response body'}`;
        }
        throw new Error(errorMsg);
      }

      return await response.json().catch(() => ({ success: true }));
    } catch (error: any) {
      console.error('[AUTH] Update password error:', error);
      throw new Error(error.message || 'Failed to update password');
    } finally {
      setAuthLoading(false);
    }
  };

  const refreshUser = async () => {
    const updatedUser = await fetchUserFromBackend();
    setUser(updatedUser);
  };

  const value = {
    user,
    isLoading: authLoading,
    authLoading,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    isGuardian: user?.role === 'guardian',
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    resetPassword,
    updatePassword,
    refreshUser,
  };

  return (
    <SupabaseAuthContext.Provider value={value}>
      {children}
    </SupabaseAuthContext.Provider>
  );
}

export function useSupabaseAuth() {
  const context = useContext(SupabaseAuthContext);
  if (context === undefined) {
    throw new Error('useSupabaseAuth must be used within a SupabaseAuthProvider');
  }
  return context;
}
