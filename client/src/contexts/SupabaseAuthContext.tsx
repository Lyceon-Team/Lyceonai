import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  ReactNode,
} from "react";
import { SupabaseProfile, getSupabaseBrowserClient } from "@/lib/supabase";
import { authError } from "@/lib/auth-error-messages";
import { useQueryClient } from "@tanstack/react-query";
import { clearCsrfToken, csrfFetch, getCsrfToken } from "@/lib/csrf";
import { clearReconsentDismissal } from "@/components/legal/reconsent-dismissal";
import {
  clearProfileQuery,
  profileQuery,
  type ProfileHydration,
} from "@/hooks/useProfileQuery";
import { clearBillingStatusQuery } from "@/hooks/useBillingStatusQuery";
// CSRF handshake utilities
import type { ConsentSource } from "@shared/legal-consent";
import {
  RETURN_PATH_PARAM,
  returnPathFromSearch,
} from "@lyceon/shared/return-path";

/**
 * The provider's one log channel. The client has no structured logger (see
 * `features/calendar/api/client.ts`), so this writes to the console — and takes only an event
 * name and flat string/number detail, so a response body, token or credential cannot reach it
 * (Coding Standards §12.1). An error is reduced to its message, which for this provider is an
 * `authError` code or a status line.
 */
function authLog(
  level: "warn" | "error",
  event: string,
  detail: Record<string, string | number> = {},
): void {
  // eslint-disable-next-line no-console -- the only client-side error channel; see above.
  (level === "warn" ? console.warn : console.error)(`[AUTH] ${event}`, detail);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}

export type SignupOutcome = "authenticated" | "verification_required";

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
  signUp: (
    email: string,
    password: string,
    legalConsent: SignupLegalConsent,
    displayName?: string,
  ) => Promise<SignupResult>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (legalConsent: SignupLegalConsent) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const SupabaseAuthContext = createContext<SupabaseAuthContextType | undefined>(
  undefined,
);

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<SupabaseProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true); // Default true as requested
  const queryClient = useQueryClient();
  const isInitializing = useRef(true); // Flag to prevent auth state changes during init
  /**
   * G1-03 (audit G-AUD-01): the id whose data the query cache currently holds.
   *
   * Every cached response belongs to one signed-in person. When the person changes —
   * sign-out, or a different account signing in on the same tab — the cache is CLEARED,
   * synchronously, before the new user is set, so no component can mount against the
   * previous person's data. `invalidateQueries()` was not enough: it only marks entries
   * stale, and with `staleTime: Infinity` a remounting query renders the stale entry while
   * it refetches — which is exactly how guardian B was shown guardian A's students.
   */
  const cacheOwnerId = useRef<string | null>(null);
  const setUser = (next: SupabaseProfile | null): void => {
    const nextId = next?.id ?? null;
    if (cacheOwnerId.current !== null && cacheOwnerId.current !== nextId) {
      queryClient.clear();
    }
    cacheOwnerId.current = nextId;
    setUserState(next);
  };
  const clearAuthState = () => {
    clearCsrfToken();
    setUser(null);
    // @spec [student-ui register UI-14] | @implemented [2026-09-29] | plain English: the profile
    // and billing status are cached for 30 s now, not re-read on every consumer mount — so a
    // sign-out that left them would let the next account in this tab be routed on the previous
    // account's onboarding flags and shown its entitlement. Removed, not invalidated: an
    // invalidation would re-read them for a session that no longer exists. `setUser(null)`
    // above already clears the whole cache when a user WAS set (G1-03); these two cover the
    // paths where none was — a 401 or a timeout during boot, after the provider's own read
    // has cached the signed-out answer.
    clearProfileQuery(queryClient);
    clearBillingStatusQuery(queryClient);
    // The guardian re-consent prompt is dismissible for a tab-session, and a
    // sign-out ends that session. Without this, signing out and back in within
    // the same tab would inherit the dismissal and skip a prompt that is
    // supposed to return until it is accepted. sessionStorage alone does not
    // cover it — it survives sign-out and dies only with the tab.
    clearReconsentDismissal();
  };

  // @spec [student-ui register UI-14; Doc-01_V8 §40.3] | @implemented [2026-09-29] | plain
  // English: the provider reads `/api/profile` THROUGH the query cache, with the same key and
  // fetch function as `RequireRole`, `profile-complete` and the profile page — so by the time
  // `user` is set and those mount, the answer is already cached and they issue no request of
  // their own. This read was a plain `csrfFetch` outside React Query, which is why every
  // signed-in load requested the profile at least twice.
  //
  // `staleTime: 0` for THIS read only: sign-in, sign-up and `refreshUser` exist to learn what
  // the server says now, not what was cached a few seconds ago. An in-flight read is still
  // shared, so a consumer mounting during it does not start a second one.
  //
  // Semantics kept from the plain fetch: 401/403 (the shared function's `{ authenticated:
  // false }`) clears local auth state; any other failure logs and yields no user without
  // clearing it. The pendingDeletion and feature-flag mapping is unchanged.
  const fetchUserFromBackend = async (): Promise<SupabaseProfile | null> => {
    let data: ProfileHydration;
    try {
      data = await queryClient.fetchQuery({ ...profileQuery, staleTime: 0 });
    } catch (error) {
      authLog("error", "Profile fetch failed", { error: errorMessage(error) });
      return null;
    }

    // AUTH-001: there is no longer a custom /api/auth/refresh path. Session refresh is native —
    // the server's @supabase/ssr middleware transparently refreshes the session (and rotates the
    // httpOnly session cookie) on every authenticated request. A 401/403 here therefore means the
    // session is genuinely absent/expired, so we clear local state and treat the user as signed out.
    // `=== false`, not falsiness: only the shared function's 401/403 answer means signed out,
    // exactly as the status check this replaced. A 2xx body is a session, whatever it omits.
    if (data.authenticated === false) {
      clearAuthState();
      return null;
    }

    const backendUser = data.user;
    if (!backendUser) return null;

    return {
      id: backendUser.id,
      email: backendUser.email ?? "",
      display_name: backendUser.display_name,
      role: backendUser.role,
      is_under_13: backendUser.is_under_13,
      guardian_consent: backendUser.guardian_consent,
      student_link_code: backendUser.student_link_code,
      // Map additional onboarding status flags
      profile_completed_at: backendUser.profileCompletedAt,
      requiredProfileComplete: backendUser.requiredProfileComplete,
      guardianConsentRequired: backendUser.guardianConsentRequired,
      // §40 server-authority flags + grace-window state (top-level on the /api/profile response).
      accountDeletionLifecycleV2:
        data.featureFlags?.accountDeletionLifecycleV2 ?? false,
      pendingDeletion: data.pendingDeletion ?? null,
    };
  };

  // Initialize auth on mount
  useEffect(() => {
    let mounted = true;
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const initializeAuth = async () => {
      try {
        // Pre-fetch CSRF token to "warm up" the handshake and detect connectivity issues early.
        // This avoids a race condition where the first mutating request (login) hangs on the handshake.
        await getCsrfToken().catch((err) => {
          if (!abortController.signal.aborted) {
            authLog(
              "warn",
              "CSRF pre-fetch failed, will retry on first mutation",
              {
                error: errorMessage(err),
              },
            );
          }
        });

        // Bail out early if unmounted (StrictMode cleanup)
        if (abortController.signal.aborted) return;

        // Add a safety timeout to profile fetch to prevent boot-hangs if Supabase/API is slow.
        const profileFetchPromise = fetchUserFromBackend();
        const timeoutPromise = new Promise<null>((resolve) => {
          timeoutId = setTimeout(() => {
            authLog(
              "warn",
              "Profile fetch timed out, proceeding as unauthenticated",
            );
            resolve(null);
          }, 8000);
        });

        const backendUser = await Promise.race([
          profileFetchPromise,
          timeoutPromise,
        ]);

        // Clear the timeout so it doesn't fire after the race has resolved
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        // Bail out if unmounted during the async work
        if (!mounted || abortController.signal.aborted) return;

        if (backendUser) {
          setUser(backendUser);
        } else {
          clearAuthState();
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          authLog("error", "Initialization failed", {
            error: errorMessage(error),
          });
        }
      } finally {
        if (mounted && !abortController.signal.aborted) {
          setAuthLoading(false);
          isInitializing.current = false;
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

  // @spec [contracts/auth-standard-flow.contract.md AS-3, AS1-OUTBOX-DROP-001] | @implemented 2026-06-20
  // plain English: the email/password + Google auth mutations. On a handled failure they throw a CODED
  // error (authError(code) — code specific for logging, status-derived) instead of the raw server
  // string; the display layer maps it via resolveAuthErrorMessage, so the UI is always human,
  // recoverable, and non-enumerable.
  const signUp = async (
    email: string,
    password: string,
    legalConsent: SignupLegalConsent,
    displayName?: string,
  ): Promise<SignupResult> => {
    setAuthLoading(true);
    try {
      const response = await csrfFetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
          displayName,
          legalConsent: {
            studentTermsAccepted: legalConsent.studentTermsAccepted,
            privacyPolicyAccepted: legalConsent.privacyPolicyAccepted,
            consentSource: legalConsent.consentSource ?? "email_signup_form",
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // code is specific for logging; the displayed copy is generic + non-enumerable.
        authLog("error", "Sign up failed", { status: response.status });
        throw authError(
          response.status === 503 ? "signup_consent_failed" : "signup_failed",
        );
      }

      const outcome = data?.outcome as SignupOutcome | undefined;
      if (outcome === "verification_required") {
        setUser(null);
        return {
          outcome: "verification_required",
          message: data?.message || "Please verify your email to continue.",
          user: data?.user,
        };
      }

      // Authenticated signup: hydrate canonical profile from backend cookies.
      const backendUser = await fetchUserFromBackend();
      if (!backendUser) {
        setUser(null);
        throw new Error("Failed to load user profile after signup");
      }

      setUser(backendUser);
      return {
        outcome: "authenticated",
        message: data?.message,
        nextPath: data?.nextPath,
        user: data?.user,
      };
    } catch (error) {
      authLog("error", "Sign up error", { error: errorMessage(error) });
      throw error instanceof Error ? error : authError("signup_failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    setAuthLoading(true);
    try {
      const response = await csrfFetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        authLog("error", "Server sign in failed", {
          status: response.status,
        });
        throw authError(response.status === 401 ? "signin_failed" : undefined);
      }

      clearCsrfToken();

      const backendUser = await fetchUserFromBackend();
      if (backendUser) {
        setUser(backendUser);
      } else {
        clearAuthState();
        throw new Error("Failed to load user profile after sign-in");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const signInWithGoogle = async (legalConsent: SignupLegalConsent) => {
    if (
      !legalConsent.studentTermsAccepted ||
      !legalConsent.privacyPolicyAccepted
    ) {
      throw new Error(
        "You must accept Terms and Privacy before continuing with Google",
      );
    }

    setAuthLoading(true);
    try {
      // Native Supabase OAuth (PKCE). Supabase owns the Google OAuth callback at
      // <ref>.supabase.co/auth/v1/callback; redirectTo is OUR post-login landing route, where the
      // server exchanges the PKCE code for a session. The Google client secret lives only in the
      // Supabase dashboard — never in app code (HALT-3).
      const consentSource =
        legalConsent.consentSource ?? "google_continue_pre_oauth";
      const callbackParams = new URLSearchParams({ consentSource });
      // @spec [AS-5; owner brief 2026-09-15 Part B] the login page's `?next=` (written by
      // RequireRole) rides along to the server callback, which re-sanitises it with the SAME
      // shared module before honouring it after the onboarding gate. Off-origin → dropped here.
      const returnPath = returnPathFromSearch(window.location.search);
      if (returnPath) callbackParams.set(RETURN_PATH_PARAM, returnPath);
      const redirectTo = `${window.location.origin}/auth/callback?${callbackParams.toString()}`;

      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });

      if (error) {
        throw authError("google_oauth_failed");
      }
      // On success the browser is redirected to Google; no further client work here.
    } catch (error) {
      authLog("error", "Google sign in error", { error: errorMessage(error) });
      setAuthLoading(false);
      throw error instanceof Error ? error : authError("google_oauth_failed");
    }
  };

  const signOut = async () => {
    setAuthLoading(true);
    try {
      const response = await csrfFetch("/api/auth/signout", {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Sign out failed with status ${response.status}`);
      }

      clearAuthState();
      // G1-03: remove every cached response, not just mark it stale. `clearAuthState` has
      // already cleared via `setUser(null)` when a user was set; this also covers a sign-out
      // before the profile ever loaded.
      queryClient.clear();
    } catch (error) {
      authLog("error", "Sign out error", { error: errorMessage(error) });
      throw authError("signout_failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    setAuthLoading(true);
    try {
      const response = await csrfFetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        authLog("error", "Reset password failed", {
          status: response.status,
        });
        throw authError("reset_password_failed");
      }

      // Successful response should be JSON, but let's be safe
      return await response.json().catch(() => ({ success: true }));
    } catch (error) {
      authLog("error", "Reset password error", { error: errorMessage(error) });
      throw error instanceof Error ? error : authError("reset_password_failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const updatePassword = async (password: string) => {
    setAuthLoading(true);
    try {
      const response = await csrfFetch("/api/auth/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        authLog("error", "Update password failed", {
          status: response.status,
        });
        throw authError("update_password_failed");
      }

      return await response.json().catch(() => ({ success: true }));
    } catch (error) {
      authLog("error", "Update password error", { error: errorMessage(error) });
      throw error instanceof Error
        ? error
        : authError("update_password_failed");
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
    isAdmin: user?.role === "admin",
    isGuardian: user?.role === "guardian",
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
    throw new Error(
      "useSupabaseAuth must be used within a SupabaseAuthProvider",
    );
  }
  return context;
}
