import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { SupabaseAuthForm } from "@/components/auth/SupabaseAuthForm";
import { Skeleton } from "@/components/ui/skeleton";
import { Notice } from "@/components/student-ui/Notice";
import { humanAuthError } from "@/lib/auth-error-messages";
import {
  postAuthDestination,
  returnPathFromSearch,
} from "@lyceon/shared/return-path";

/**
 * @spec [student-UI register UI-3A, UI-59; DESIGN.md §1, §2 "Bare card" (login, signup);
 *       contracts/auth-standard-flow.contract.md AS-3, AS-5] | @implemented [2026-10-03]
 * plain English: /login, inside the Bare card App.tsx wraps it in. UI-59 draws it with the
 * student tokens only: the AS-3 redirect error (`?error=<code>`, shown as human copy, never the
 * code) is a danger Notice (role="alert", as the amber shadcn Alert it replaces was), and the
 * loading state is the still student skeleton. The landing decision below is unchanged.
 */
export default function Login() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, authLoading } = useSupabaseAuth();
  const hasRedirected = useRef(false);

  // AS-3: a failed auth redirect lands here with ?error=<code>. Show a human, recoverable message
  // (never the raw code). The code stays server-side only (logs/diagnostics).
  const errorMessage =
    typeof window !== "undefined"
      ? humanAuthError(new URLSearchParams(window.location.search).get("error"))
      : null;

  useEffect(() => {
    if (!authLoading && isAuthenticated && user && !hasRedirected.current) {
      hasRedirected.current = true;

      // Determine destination based on onboarding status
      // A SECOND COPY OF THE GATE LIVED HERE, and it outlived the first.
      // `user.requiredConsentsComplete === false` sent anyone with an
      // outstanding document to /profile/complete straight after sign-in — so
      // removing the wall in RequireRole alone would have left this one standing
      // and the behaviour unchanged for exactly the people it was meant to free.
      // No legal document appears here now. What remains is an incomplete
      // account, and the under-13 rule, which is a condition of the Terms rather
      // than a consent state.
      const needsOnboarding =
        user.requiredProfileComplete === false || !user.profile_completed_at;
      // G2-04: an under-13 student with no active guardian link goes to the linking page.
      const needsGuardianLink =
        user.role === "student" && user.guardianConsentRequired === true;

      // @spec [AS-5 allowlisted `next`; owner brief 2026-09-15 Part B] | @implemented [2026-09-15]
      // A return path captured by RequireRole (`/login?next=…`) wins over the role default —
      // but only after it passes the ONE shared sanitiser (same-origin, relative, allowlisted),
      // and never ahead of onboarding: an incomplete account still goes to /profile/complete.
      //
      // @spec [AS-5; AS-3 landing matrix; register UI-03] | @implemented [2026-09-29]
      // plain English: the decision is the shared `postAuthDestination`. Onboarding no longer
      // drops the return path — it rides along as /profile/complete?next=… and the onboarding
      // page lands on it once the profile is complete. A return path the role cannot open
      // (a guardian with next=/calendar) falls back to the role default. Admins bypass
      // onboarding, as before.
      const next =
        typeof window !== "undefined"
          ? returnPathFromSearch(window.location.search)
          : null;

      // G2-04 (merged from `main`): a complete under-13 student with no active guardian link
      // goes to the linking page ahead of any return path; the server refuses every learning
      // request until a guardian connects, so a `next` there would only bounce. Onboarding
      // still comes first, exactly as on `main`.
      const onboardingFirst = user.role !== "admin" && needsOnboarding;
      navigate(
        !onboardingFirst && needsGuardianLink
          ? "/guardian-required"
          : postAuthDestination({
              role: user.role,
              needsOnboarding: onboardingFirst,
              next,
            }),
      );
    }
  }, [isAuthenticated, authLoading, user, navigate]);

  // Show loading skeleton while checking auth state.
  // UI-59: the student placeholder (`Skeleton variant="lyc"`: still, --seg-empty, aria-hidden)
  // inside a polite status region named for what is loading.
  if (authLoading) {
    return (
      <div
        role="status"
        aria-label="Loading..."
        className="flex flex-col gap-4"
        data-testid="login-loading"
      >
        <Skeleton variant="lyc" className="h-8 w-3/4" />
        <Skeleton variant="lyc" className="h-4 w-full" />
        <Skeleton variant="lyc" className="h-11 w-full" />
        <Skeleton variant="lyc" className="h-11 w-full" />
        <Skeleton variant="lyc" className="h-11 w-full" />
      </div>
    );
  }

  // Show auth form when ready
  return (
    <div className="flex flex-col gap-4">
      {errorMessage && (
        <Notice
          tone="danger"
          title={errorMessage}
          data-testid="login-redirect-error"
        />
      )}
      <SupabaseAuthForm />
    </div>
  );
}
