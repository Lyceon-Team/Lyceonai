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
    guardianConsentRequired?: boolean;
    outstandingLegal?: unknown;
    [key: string]: any;
  } | null;
}

export function RequireRole({ allow, children }: RequireRoleProps) {
  const { user, authLoading, isAdmin, isGuardian } = useSupabaseAuth();
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

  // NO LEGAL DOCUMENT APPEARS IN THIS LIST, AND NONE EVER SHOULD.
  // `requiredConsentsComplete === false` sat here once; it is gone, along with
  // the flag itself. What remains are two facts about an INCOMPLETE ACCOUNT —
  // no profile yet — and one condition from the Terms:
  //
  // `guardianConsentRequired` is the under-13 rule: a student under 13 cannot
  // use LYCEON until a guardian connects. That is not a consent gate, it is the
  // basis of the under-13 position, and it routes to a screen built to get them
  // connected — link code, guardian email — rather than a wall.
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

  // NOTHING HERE WITHHOLDS ANYTHING. Owner ruling, 2026-09-16.
  //
  // This block held a wall: for a student it returned the modal INSTEAD of
  // `children`, and for a guardian it rendered both. Both are gone. The prompt
  // is a popup on a live page, for every role, and `children` render either way.
  //
  // Consent is captured where it is given — at signup, at guardian link
  // redemption, at checkout — and each of those is part of an action the person
  // chose to take. A periodic prompt is not, so it asks and does not insist.
  // "Not knowing what someone owes is never a reason to refuse them anything"
  // applies doubly when we DO know and they simply have not answered yet.
  const showReconsent =
    !isAdmin &&
    !isProfileCompletePage &&
    outstandingLegal.length > 0 &&
    !(dismissedThisMount || isReconsentDismissed(user.id));

  return (
    <>
      {children}
      {showReconsent && (
        <ReconsentModal
          documents={outstandingLegal}
          onDismiss={() => {
            dismissReconsent(user.id);
            setDismissedThisMount(true);
          }}
        />
      )}
    </>
  );
}

export default RequireRole;
