import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  ReactNode,
} from "react";
import type { SupabaseProfile } from "@/lib/supabase";
import { authError } from "@/lib/auth-error-messages";
import { useQueryClient } from "@tanstack/react-query";
import { clearCsrfToken, csrfFetch, getCsrfToken } from "@/lib/csrf";
import { getSessionCookieHint } from "@/lib/session-hint";
import { firstTouchSource } from "@/lib/analytics/first-touch";
import {
  runtimeRoleSchema,
  ROLE_UNRECOGNIZED,
} from "@lyceon/shared/runtime-role-schema";
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

/** The allowlisted return path on the current URL, if any (the sign-up form's `next`). */
function signupReturnPath(): string | null {
  return typeof window === "undefined"
    ? null
    : returnPathFromSearch(window.location.search);
}
import {
  AUTH_ROLE_PARAM,
  type SignupRoleIntent,
} from "@lyceon/shared/auth-entry";

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

/**
 * @spec [SCL-222] | @implemented [2026-10-09] | plain English: the consent source that labels the
 * acceptance rows the server writes when an account is created. There is no checkbox to report:
 * the sign-in notice under the buttons is what the person agrees to, and whether a row is written
 * is decided on the server (account creation), never by this value.
 */
export interface SignupLegalConsent {
  consentSource?: ConsentSource;
}

interface SupabaseAuthContextType {
  user: SupabaseProfile | null;
  isLoading: boolean;
  authLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isGuardian: boolean;
  /**
   * G2-02: the server refused this session as ROLE_UNRECOGNIZED (or returned a role outside the
   * shared schema). There is no user, and the route guard shows a neutral screen, not /login.
   */
  accountUnavailable: boolean;
  signUp: (
    email: string,
    password: string,
    legalConsent: SignupLegalConsent,
    displayName?: string,
    roleIntent?: SignupRoleIntent | null,
  ) => Promise<SignupResult>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (
    legalConsent: SignupLegalConsent,
    roleIntent?: SignupRoleIntent | null,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const SupabaseAuthContext = createContext<SupabaseAuthContextType | undefined>(
  undefined,
);

/**
 * G-NEW-11: the channel on which a tab says "the signed-in person changed here". It carries no
 * id and no profile — only the fact — and every other tab answers by asking the server who is
 * signed in now. Absent where the browser has no BroadcastChannel; focus re-validation remains.
 */
const AUTH_CHANGE_CHANNEL = "lyceon-auth-change";

function openAuthChangeChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === "function"
    ? new BroadcastChannel(AUTH_CHANGE_CHANNEL)
    : null;
}

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<SupabaseProfile | null>(null);
  const [accountUnavailable, setAccountUnavailable] = useState(false);
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
  const authChannel = useRef<BroadcastChannel | null>(null);
  const setUser = (next: SupabaseProfile | null): void => {
    const nextId = next?.id ?? null;
    if (cacheOwnerId.current !== null && cacheOwnerId.current !== nextId) {
      queryClient.clear();
    }
    if (cacheOwnerId.current !== nextId) {
      authChannel.current?.postMessage("changed");
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
    } catch {
      // A failed read is "no user" for every caller (the semantics documented above). Nothing is
      // written: there is no approved client logger, and the console is not one (Brief 5).
      return null;
    }

    // AUTH-001: there is no longer a custom /api/auth/refresh path. Session refresh is native —
    // the server's @supabase/ssr middleware transparently refreshes the session (and rotates the
    // httpOnly session cookie) on every authenticated request. A 401/403 here therefore means the
    // session is genuinely absent/expired, so we clear local state and treat the user as signed out.
    // `=== false`, not falsiness: only the shared function's 401/403 answer means signed out,
    // exactly as the status check this replaced. A 2xx body is a session, whatever it omits.
    //
    // G2-02 (merged from `main`): a 403 ROLE_UNRECOGNIZED is not a sign-out. Record it so the
    // route guard shows the neutral screen instead of sending the person to a login that would
    // loop back here. The shared fetch function carries the 403's refusal code for this.
    if (data.authenticated === false) {
      if (data.status === 403) {
        setAccountUnavailable(data.code === ROLE_UNRECOGNIZED);
      }
      clearAuthState();
      return null;
    }

    const backendUser = data.user;
    if (!backendUser) return null;
    // G2-02: parse, never assume. A role outside the shared schema is not "probably a student".
    if (!runtimeRoleSchema.safeParse(backendUser.role).success) {
      setAccountUnavailable(true);
      clearAuthState();
      return null;
    }
    setAccountUnavailable(false);

    return {
      id: backendUser.id,
      email: backendUser.email ?? "",
      display_name: backendUser.display_name,
      role: backendUser.role,
      is_under_13: backendUser.is_under_13,
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
        // A failed warm-up is not an error: `csrfFetch` fetches the token again on the first
        // mutation, so boot continues either way.
        await getCsrfToken().catch(() => undefined);

        // Bail out early if unmounted (StrictMode cleanup)
        if (abortController.signal.aborted) return;

        // @spec [SEO plan F8] | @implemented [2026-10-05] | plain English: when the CSRF
        // bootstrap says no session cookie came with the request, there is no session to read,
        // so boot proceeds signed out without the profile read that would only answer 401 (on
        // every public page, for every visitor). An unknown hint (`null`) reads the profile as
        // before. The server stays authoritative: protected routes still read the profile
        // through the route guard, and a later sign-in reads it directly.
        if (getSessionCookieHint() === false) {
          clearAuthState();
          return;
        }

        // Add a safety timeout to profile fetch to prevent boot-hangs if Supabase/API is slow.
        const profileFetchPromise = fetchUserFromBackend();
        const timeoutPromise = new Promise<null>((resolve) => {
          // A slow profile read proceeds as unauthenticated.
          timeoutId = setTimeout(() => resolve(null), 8000);
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
      } catch {
        // Boot could not establish a session: proceed signed out, the same answer a failed or
        // slow profile read gives above.
        if (mounted && !abortController.signal.aborted) {
          clearAuthState();
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

  /**
   * @spec [Guardian_Closure_Plan G-NEW-11; audit G-AUD-01 (G1-03)] | @implemented [2026-09-30]
   *
   * plain English: the session cookie is shared by every tab, so the signed-in person can change
   * where this tab's own sign-in functions never ran — another tab, or an emailed sign-in link
   * that opens one. Before this, the tab kept the previous person's id until a reload, and the
   * Settings panels asked the server for that person's link code and links with the new
   * person's cookie (production, 2026-09-30 02:19Z: 404, 404). So the tab asks the server who is
   * signed in whenever another tab announces a change, and whenever this tab regains focus or
   * becomes visible; a different answer goes through `setUser`, which clears the query cache.
   *
   * edge cases: a network failure or 5xx changes nothing (the next focus asks again); a 401 is a
   * real sign-out and `fetchUserFromBackend` clears the state itself; the same person answering
   * changes nothing, so a focus costs one profile read and no re-render. One read at a time. Not
   * run while the first load or an in-tab sign-in is still settling — those set the user already.
   */
  const revalidating = useRef<Promise<void> | null>(null);
  // @spec [SEO plan F8] | @implemented [2026-10-05] | plain English: a signed-out tab asks the
  // CSRF bootstrap (a 200) whether a session cookie has appeared since — a sign-in in another tab
  // or from an emailed link sets one — and reads the profile only if it has. Without this, every
  // focus of a signed-out tab answered 401. A signed-in tab reads the profile directly, as before,
  // so a sign-out or account switch elsewhere is still detected. An unknown hint reads the profile.
  const sessionMayExist = async (): Promise<boolean> => {
    if (cacheOwnerId.current !== null) return true;
    clearCsrfToken();
    await getCsrfToken().catch(() => undefined);
    return getSessionCookieHint() !== false;
  };
  const revalidateSession = (): Promise<void> => {
    if (isInitializing.current) return Promise.resolve();
    revalidating.current ??= sessionMayExist()
      .then((mayExist) => (mayExist ? fetchUserFromBackend() : null))
      .then((current) => {
        if (current && current.id !== cacheOwnerId.current) {
          clearCsrfToken();
          setUser(current);
        }
      })
      .finally(() => {
        revalidating.current = null;
      });
    return revalidating.current;
  };
  const revalidateRef = useRef(revalidateSession);
  revalidateRef.current = revalidateSession;

  useEffect(() => {
    const revalidate = (): void => {
      void revalidateRef.current();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") revalidate();
    };
    const channel = openAuthChangeChannel();
    authChannel.current = channel;
    channel?.addEventListener("message", revalidate);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", onVisibility);
      channel?.removeEventListener("message", revalidate);
      channel?.close();
      authChannel.current = null;
    };
  }, []);

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
    roleIntent?: SignupRoleIntent | null,
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
            consentSource: legalConsent.consentSource ?? "email_signup_form",
          },
          // SCL-201 IS 6: the first-touch channel (kept for the tab session only with analytics
          // consent; see lib/analytics/first-touch.ts).
          signupSource: firstTouchSource(),
          // Owner brief 2026-10-10 rule 2: the account type the sign-up asked for (the server
          // re-parses it against the same allowlist; absent or unknown is a student).
          ...(roleIntent ? { role: roleIntent } : {}),
          // Owner brief 2026-10-10: the page this sign-up came from (`/login?mode=signup&next=…`),
          // so the email-confirmation link can bring the person back to it. Already sanitised
          // here; the server re-sanitises.
          ...(signupReturnPath() ? { next: signupReturnPath() } : {}),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // The displayed copy is generic and non-enumerable.
        throw authError(
          response.status === 503 ? "signup_consent_failed" : "signup_failed",
        );
      }

      // G-NEW-12: the CSRF token is bound to the session identifier, and a successful sign-up
      // can start a session — so the token minted before it is dead, exactly as after `signIn`.
      // Drop it here too, or the first write after sign-up is refused and silently retried.
      clearCsrfToken();

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

  const signInWithGoogle = async (
    legalConsent: SignupLegalConsent,
    roleIntent?: SignupRoleIntent | null,
  ) => {
    setAuthLoading(true);
    try {
      // Native Supabase OAuth (PKCE). Supabase owns the Google OAuth callback at
      // <ref>.supabase.co/auth/v1/callback; redirectTo is OUR post-login landing route, where the
      // server exchanges the PKCE code for a session. The Google client secret lives only in the
      // Supabase dashboard — never in app code (HALT-3).
      const consentSource =
        legalConsent.consentSource ?? "google_continue_click";
      const callbackParams = new URLSearchParams({
        consentSource,
        // SCL-201 IS 6: recorded by the callback only on a new, not-yet-onboarded account.
        signupSource: firstTouchSource(),
      });
      // @spec [AS-5; owner brief 2026-09-15 Part B] the login page's `?next=` (written by
      // RequireRole) rides along to the server callback, which re-sanitises it with the SAME
      // shared module before honouring it after the onboarding gate. Off-origin → dropped here.
      const returnPath = returnPathFromSearch(window.location.search);
      if (returnPath) callbackParams.set(RETURN_PATH_PARAM, returnPath);
      // Owner brief 2026-10-10 rule 2: the role intent rides the same callback URL as `next`;
      // the server applies it only to the account this sign-in creates.
      if (roleIntent) callbackParams.set(AUTH_ROLE_PARAM, roleIntent);
      const redirectTo = `${window.location.origin}/auth/callback?${callbackParams.toString()}`;

      // @spec [SEO plan F8 (public-page weight); OAUTH-001] | @implemented [2026-10-07] |
      // plain English: the browser Supabase client exists only to start this redirect, so it is
      // loaded here, on the click, instead of with the entry every public page downloads (about
      // 55 KB gzip). The session stays server-held either way; nothing else in the app uses it.
      const { getSupabaseBrowserClient } = await import("@/lib/supabase");
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

      setAccountUnavailable(false);
      clearAuthState();
      // G1-03: remove every cached response, not just mark it stale. `clearAuthState` has
      // already cleared via `setUser(null)` when a user was set; this also covers a sign-out
      // before the profile ever loaded.
      queryClient.clear();
    } catch {
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
        throw authError("reset_password_failed");
      }

      // Successful response should be JSON, but let's be safe
      return await response.json().catch(() => ({ success: true }));
    } catch (error) {
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
        throw authError("update_password_failed");
      }

      return await response.json().catch(() => ({ success: true }));
    } catch (error) {
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
    accountUnavailable,
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
