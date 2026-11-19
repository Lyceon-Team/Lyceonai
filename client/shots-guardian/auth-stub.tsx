/**
 * Screenshot-harness stand-in for `@/contexts/SupabaseAuthContext` — NOT shipped.
 * The scene (see main.tsx) sets `window.__shotUser` before rendering; every component that
 * calls `useSupabaseAuth()` reads it. Only the fields the photographed screens read are set.
 */
export type ShotUser = {
  id: string;
  role: "guardian" | "student";
  display_name: string;
  email: string;
  requiredProfileComplete: boolean;
  profile_completed_at: string;
};

declare global {
  interface Window {
    __shotUser?: ShotUser | null;
  }
}

const noop = async (): Promise<void> => undefined;

export function useSupabaseAuth() {
  const user = window.__shotUser ?? null;
  return {
    user,
    isLoading: false,
    authLoading: false,
    isAuthenticated: user !== null,
    isAdmin: false,
    isGuardian: user?.role === "guardian",
    accountUnavailable: false,
    signOut: noop,
    refreshUser: noop,
  };
}
