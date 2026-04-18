import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { SupabaseProfile } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { clearCsrfToken, csrfFetch } from '@/lib/csrf';

type SignUpResult =
  | {
    status: 'authenticated';
    message?: string;
    requiresConsent?: boolean;
  }
  | {
    status: 'verification_required';
    message: string;
    requiresConsent?: boolean;
  };

interface SupabaseAuthContextType {
  user: SupabaseProfile | null;
  isLoading: boolean;
  authLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isGuardian: boolean;
  requiresConsent: boolean;
  signUp: (email: string, password: string, displayName?: string, isUnder13?: boolean, guardianEmail?: string, role?: 'student' | 'guardian') => Promise<SignUpResult>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  submitConsent: (guardianEmail: string, consent: boolean) => Promise<void>;
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
      };
    } catch (error) {
      console.error('[AUTH] Network error fetching user from backend:', error);
      return null;
    }
  };

  // Initialize auth on mount
  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      console.log('[AUTH] Starting initialization');

      // First try to get user from backend (if cookies exist from previous session)
      const backendUser = await fetchUserFromBackend();

      if (mounted && backendUser) {
        console.log('[AUTH] Found user from backend cookies');
        setUser(backendUser);
        setAuthLoading(false);
        isInitializing.current = false;
        return;
      }

      console.log('[AUTH] No existing backend cookie session found');
      if (mounted) {
        clearAuthState();
        setAuthLoading(false);
        isInitializing.current = false;
      }
    };

    initializeAuth();

    return () => {
      mounted = false;
    };
  }, [queryClient]);

  const signUp = async (
    email: string,
    password: string,
    displayName?: string,
    isUnder13: boolean = false,
    guardianEmail?: string,
    role: 'student' | 'guardian' = 'student'
  ): Promise<SignUpResult> => {
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
          isUnder13,
          guardianEmail,
          role
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('[AUTH] Sign up failed:', data.error);
        throw new Error(data.error || 'Failed to sign up');
      }

      if (data?.status === 'verification_required') {
        clearAuthState();
        return {
          status: 'verification_required',
          message: data?.message || 'Check your email to confirm your account before signing in.',
          requiresConsent: !!data?.requiresConsent,
        };
      }

      if (data?.status !== 'authenticated') {
        throw new Error('Unexpected signup response from server');
      }

      clearCsrfToken();

      // Backend set canonical HTTP-only cookies for authenticated signups.
      // Fetch user from backend using the newly set cookies.
      const backendUser = await fetchUserFromBackend();
      if (backendUser) {
        setUser(backendUser);
      } else {
        clearAuthState();
        throw new Error('Failed to load user profile after sign-up');
      }

      return {
        status: 'authenticated',
        message: data?.message,
        requiresConsent: !!data?.requiresConsent,
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

  const signInWithGoogle = async () => {
    setAuthLoading(true);
    try {
      console.log('[AUTH] Redirecting to Google OAuth');
      window.location.href = '/api/auth/google/start';
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

  const submitConsent = async (guardianEmail: string, consent: boolean) => {
    if (!user?.is_under_13) {
      throw new Error('Consent is only required for users under 13');
    }

    setAuthLoading(true);
    try {
      const response = await csrfFetch('/api/auth/consent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          guardianConsent: consent,
          guardianEmail: guardianEmail,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit consent');
      }

      const updatedUser = await fetchUserFromBackend();
      setUser(updatedUser);
    } catch (error: any) {
      console.error('[AUTH] Consent submission error:', error);
      throw new Error(error.message || 'Failed to submit consent');
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
    requiresConsent: !!(user?.is_under_13 && !user?.guardian_consent),
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    resetPassword,
    updatePassword,
    submitConsent,
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
