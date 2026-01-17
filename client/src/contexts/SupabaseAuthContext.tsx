import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { AuthUser, SupabaseProfile } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';

interface SupabaseAuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  authLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isGuardian: boolean;
  requiresConsent: boolean;
  signUp: (email: string, password: string, displayName?: string, isUnder13?: boolean, guardianEmail?: string, role?: 'student' | 'guardian') => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  submitConsent: (guardianEmail: string, consent: boolean) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const SupabaseAuthContext = createContext<SupabaseAuthContextType | undefined>(undefined);

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true); // Default true as requested
  const queryClient = useQueryClient();
  const isInitializing = useRef(true); // Flag to prevent auth state changes during init

  // Fetch user profile from backend
  const fetchUserFromBackend = async (): Promise<AuthUser | null> => {
    try {
      const tryFetchUser = async (): Promise<Response> => {
        return fetch('/api/auth/user', { credentials: 'include' });
      };

      let response = await tryFetchUser();

      // If access token expired, attempt one server-side refresh using httpOnly cookie
      if (response.status === 401 || response.status === 403) {
        console.log('[AUTH] Access token expired, attempting server-side refresh');
        const refreshResp = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}), // server will fall back to cookie
        });

        if (refreshResp.ok) {
          console.log('[AUTH] Token refreshed, retrying user fetch');
          response = await tryFetchUser();
        }
      }

      if (response.status === 401 || response.status === 403) {
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
        isAdmin: backendUser.isAdmin === true,
        isGuardian: backendUser.isGuardian === true || backendUser.role === 'guardian',
        is_under_13: backendUser.is_under_13,
        guardian_consent: backendUser.guardian_consent,
        student_link_code: backendUser.student_link_code,
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
        setUser(null);
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
  ) => {
    setAuthLoading(true);
    try {
      const response = await fetch('/api/auth/signup', {
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

      // Backend already set HTTP-only cookies
      // Fetch user from backend using the newly set cookies
      const backendUser = await fetchUserFromBackend();
      if (backendUser) {
        setUser(backendUser);
      }
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
      const response = await fetch('/api/auth/signin', {
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

      const backendUser = await fetchUserFromBackend();
      if (backendUser) {
        setUser(backendUser);
      } else {
        setUser(null);
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
      try {
        await fetch('/api/auth/signout', {
          method: 'POST',
          credentials: 'include',
        });
      } catch (err) {
        console.warn('[AUTH] Backend signout failed:', err);
      }
      
      setUser(null);
      queryClient.invalidateQueries();
    } catch (error: any) {
      console.error('[AUTH] Sign out error:', error);
      throw new Error(error.message || 'Failed to sign out');
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
      const response = await fetch('/api/auth/consent', {
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
    isAdmin: user?.isAdmin === true,
    isGuardian: user?.isGuardian === true || user?.role === 'guardian',
    requiresConsent: !!(user?.is_under_13 && !user?.guardian_consent),
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
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
