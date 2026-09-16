import { ReactNode, useState } from "react";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { Redirect, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { csrfFetch } from "@/lib/csrf";
import { loginPathWithReturn } from "@lyceon/shared/return-path";
import { ReconsentModal } from "@/components/legal/ReconsentModal";
import { outstandingLegalSchema } from "@shared/legal-consent";
import {
  dismissReconsent,
  isReconsentDismissed,
} from "@/components/legal/reconsent-dismissal";

type UserRole = "student" | "guardian" | "admin";

interface RequireRoleProps {
  allow: UserRole[];
  children: ReactNode;
}

interface AuthUserResponse {
  authenticated?: boolean;
  user?: {
    profileCompletedAt?: string | null;
    requiredProfileComplete?: boolean;
    requiredConsentsComplete?: boolean;
    guardianConsentRequired?: boolean;
    outstandingLegal?: unknown;
    [key: string]: any;
  } | null;
}

export function RequireRole({ allow, children }: RequireRoleProps) {
  const { user, authLoading, isAdmin, isGuardian, signOut } = useSupabaseAuth();
  const [location] = useLocation();

  // Was the guardian re-consent prompt waved away? Two sources, deliberately.
  // State answers within this mount, so dismissing hides it at once. Storage
  // answers across mounts — wouter remounts RequireRole on every navigation, so
  // without it one dismissal would last exactly until the next click. Reading
  // storage during render is a read, not an effect; deriving this with
  // `useEffect` would be the derived-state anti-pattern (Coding Standards §11.4).
  const [dismissedThisMount, setDismissedThisMount] = useState(false);

  // Fetch profile completion status from canonical /api/profile endpoint
  const { data: authData, isLoading: profileLoading } =
    useQuery<AuthUserResponse>({
      queryKey: ["/api/profile"],
      retry: false,
      enabled: !!user, // only fetch when user is authenticated
      queryFn: async () => {
        const response = await csrfFetch("/api/profile", {
          credentials: "include",
        });

        if (response.status === 401 || response.status === 403) {
          return { authenticated: false, user: null };
        }

        if (!response.ok) {
          throw new Error(`Profile hydration failed: ${response.status}`);
        }

        return response.json();
      },
    });

  if (authLoading || (user && profileLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    // @spec [AS-5 allowlisted `next`; owner brief 2026-09-15 Part B] | @implemented [2026-09-15]
    // Carry the intended destination — path AND query — into the login redirect so the guardian
    // deep link (`/guardian?code=…`) survives sign-in. The value is sanitised by the ONE shared
    // return-path module before it is written and again where it is read; an off-origin or
    // un-allowlisted destination collapses to plain /login.
    const intended =
      typeof window === "undefined"
        ? location
        : `${window.location.pathname}${window.location.search}`;
    return <Redirect to={loginPathWithReturn(intended)} replace />;
  }

  const userRole: UserRole = isAdmin
    ? "admin"
    : isGuardian
      ? "guardian"
      : "student";

  const isAllowed =
    allow.includes(userRole) || (isAdmin && allow.includes("admin"));

  if (!isAllowed) {
    if (isGuardian) {
      return <Redirect to="/guardian" replace />;
    }
    if (isAdmin) {
      return <Redirect to="/dashboard" replace />;
    }
    return <Redirect to="/dashboard" replace />;
  }

  // Enforce profile completion (includes terms acceptance) for non-admin users.
  // Skip this check if we're already on /profile/complete to avoid redirect loops.
  const isProfileCompletePage = location === "/profile/complete";
  const profileCompletedAt = authData?.user?.profileCompletedAt;
  const requiredProfileComplete = authData?.user?.requiredProfileComplete;
  const guardianConsentRequired = authData?.user?.guardianConsentRequired;

  // ONBOARDING vs RE-CONSENT ARE DIFFERENT STATES AND USED TO SHARE ONE BRANCH.
  // `requiredConsentsComplete === false` sat in this list, so publishing a new
  // version of Student Terms would have thrown every existing user — profile
  // filled in, date of birth given, guardian consent on file — back to
  // /profile/complete to re-do all of it. That page exists to collect a profile
  // nobody has yet. A person who has one owes an agreement, not a form.
  //
  // The flag is not simply dropped: it is `requiredLegalAccepted &&
  // !guardianConsentRequired`, and both halves are still enforced —
  // guardianConsentRequired on the line below, requiredLegalAccepted by
  // outstandingLegal further down. No state stops being guarded.
  const needsOnboarding =
    guardianConsentRequired === true ||
    requiredProfileComplete === false ||
    !profileCompletedAt;

  if (!isAdmin && !isProfileCompletePage && needsOnboarding) {
    return <Redirect to="/profile/complete" replace />;
  }

  // @spec [LYCEON consent capture §6]
  //
  // Parsed, not trusted: this is a wire payload, and the shared schema is the
  // same one the server's own type is inferred from. A malformed entry becomes
  // an empty list rather than a modal rendering `undefined` at someone.
  const outstanding = outstandingLegalSchema.safeParse(
    authData?.user?.outstandingLegal ?? [],
  );
  const outstandingLegal = outstanding.success ? outstanding.data : [];

  // WHO GETS A WALL AND WHO GETS A PROMPT. Owner ruling, 2026-09-16.
  //
  // A GUARDIAN IS PROMPTED, NOT BLOCKED. They are already linked, already hold a
  // previous version, and may be paying for the subscription. A version bump is
  // continued use under an agreement they have, with notice — not use with no
  // agreement at all. Locking them out of a dashboard they paid for, over a
  // revision, punishes them for our editing schedule.
  //
  // KEYED ON ROLE, NOT ON DOCUMENT, and that is a real consequence worth seeing:
  // `requiredLegalDocsForUse` gives EVERY account Student Terms and Privacy
  // Policy, and adds Parent / Guardian Terms only for a linked guardian. So a
  // guardian who owes a new Privacy Policy can also dismiss, while a student
  // owing that same Privacy Policy cannot. That follows from the ruling's own
  // words — "they keep full access to their dashboard whether or not they
  // accept" — which a per-document rule would contradict. Reported for review.
  //
  // EVERYONE ELSE IS STILL WALLED, and the children are still not rendered
  // behind it: an overlay with the application mounted underneath blocks a mouse
  // and not a keyboard, so "cannot be dismissed" has to mean "there is nothing
  // behind it" or the invariant is a visual effect. Admins stay exempt, as they
  // are from the onboarding gate above — locking the only account that can
  // investigate a bad publish out of the admin surface is the wrong failure mode.
  if (!isAdmin && !isProfileCompletePage && outstandingLegal.length > 0) {
    if (!isGuardian) {
      return (
        <ReconsentModal documents={outstandingLegal} onSignOut={signOut} />
      );
    }
    // Dismissed for this tab-session: the dashboard renders with no prompt. The
    // dismissal recorded nothing, and `clearReconsentDismissal` on sign-out
    // means the next sign-in is prompted again.
    const reconsentDismissed =
      dismissedThisMount || isReconsentDismissed(user.id);
    if (!reconsentDismissed) {
      return (
        <>
          {children}
          <ReconsentModal
            documents={outstandingLegal}
            dismissible
            onDismiss={() => {
              dismissReconsent(user.id);
              setDismissedThisMount(true);
            }}
          />
        </>
      );
    }
  }

  return <>{children}</>;
}

export default RequireRole;
