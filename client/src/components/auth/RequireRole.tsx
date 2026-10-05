import { ReactNode, useEffect, useState } from "react";
import { runtimeRoleSchema } from "@lyceon/shared/runtime-role-schema";
import { AccountUnavailable } from "./AccountUnavailable";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { Redirect, useLocation } from "wouter";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { FullPageLoader } from "@/components/student-ui";
import { requireRoleLoaderThemeLock } from "@/lib/route-shells";
import {
  loginPathWithReturn,
  onboardingPathWithReturn,
} from "@lyceon/shared/return-path";
import { profileGateSchema } from "@lyceon/shared/profile-gate-schema";
import { ReconsentModal } from "@/components/legal/ReconsentModal";
import { outstandingLegalSchema } from "@shared/legal-consent";
import {
  dismissReconsent,
  isReconsentDismissed,
} from "@/components/legal/reconsent-dismissal";
import { enterSignedInSurface } from "@/lib/signed-in-surface";

type UserRole = "student" | "guardian" | "admin";

type RequireRoleProps = {
  allow: UserRole[];
  children: ReactNode;
};

/**
 * The path AND query the user was opening. wouter's `location` is the pathname only, so the
 * query (the guardian deep link's `?code=…`) comes from `window.location` where there is one.
 */
function intendedPath(location: string): string {
  return typeof window === "undefined"
    ? location
    : `${window.location.pathname}${window.location.search}`;
}

export function RequireRole({ allow, children }: RequireRoleProps) {
  const { user, authLoading, isAdmin, isGuardian, accountUnavailable } =
    useSupabaseAuth();
  const [location] = useLocation();

  // Owner ruling 2026-10-05 (SCL-213 IS 6): every role-gated page is a signed-in surface, where
  // PostHog autocapture records no element text. Registered for exactly as long as it is mounted.
  useEffect(() => enterSignedInSurface(), []);

  // Was the guardian re-consent prompt waved away? Two sources, deliberately.
  // State answers within this mount, so dismissing hides it at once. Storage
  // answers across mounts — wouter remounts RequireRole on every navigation, so
  // without it one dismissal would last exactly until the next click. Reading
  // storage during render is a read, not an effect; deriving this with
  // `useEffect` would be the derived-state anti-pattern (Coding Standards §11.4).
  const [dismissedThisMount, setDismissedThisMount] = useState(false);

  // @spec [student-ui register UI-14] | @implemented [2026-09-29] | plain English: the ONE
  // profile query (key, fetch function, 401/403 → `{ authenticated: false }`) shared with the
  // auth provider, which has already filled it by the time `user` is set — so this reads the
  // cache instead of issuing a second request.
  const { data: authData, isLoading: profileLoading } = useProfileQuery({
    enabled: !!user, // only fetch when user is authenticated
  });

  if (authLoading || (user && profileLoading)) {
    // @spec [student-UI register UI-46; audit §6.2 "Full-page spinner"; UI-59, OQ-60 (e) (owner
    // ruling 2026-10-05)] | @implemented [2026-10-03; Bare routes 2026-10-05]
    // The shared FullPageLoader (role="status", named by its label). This gate sits above the
    // shell, so the loader takes its lock from the route table: a Bare route's own lock (the
    // device theme since UI-59, so a dark device sees no light flash before the dark card), and
    // light everywhere else (guardian, admin and still-pinned pages share this gate).
    return requireRoleLoaderThemeLock(location) === "light" ? (
      <FullPageLoader themeLock="light" />
    ) : (
      <FullPageLoader />
    );
  }

  // G2-02: the server refused this session as ROLE_UNRECOGNIZED. Not a sign-out, so not /login —
  // the next sign-in would be refused the same way and loop back.
  if (!user && accountUnavailable) {
    return <AccountUnavailable />;
  }

  if (!user) {
    // @spec [AS-5 allowlisted `next`; owner brief 2026-09-15 Part B] | @implemented [2026-09-15]
    // Carry the intended destination — path AND query — into the login redirect so the guardian
    // deep link (`/guardian?code=…`) survives sign-in. The value is sanitised by the ONE shared
    // return-path module before it is written and again where it is read; an off-origin or
    // un-allowlisted destination collapses to plain /login.
    return (
      <Redirect to={loginPathWithReturn(intendedPath(location))} replace />
    );
  }

  // G2-02: the role is PARSED, never defaulted. This used to fall through to "student" for
  // anything that was not admin or guardian, so an unknown role saw student pages.
  const parsedRole = runtimeRoleSchema.safeParse(user.role);
  if (!parsedRole.success) {
    return <AccountUnavailable />;
  }
  const userRole: UserRole = parsedRole.data;

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
  // @spec [Coding Standards §3.2, §7.1; register UI-10] | @implemented [2026-09-29]
  // plain English: the wire payload is `unknown` and is parsed by the shared schema — this used
  // to be an `interface` with an untyped index signature. A payload that does not parse yields no
  // profile facts, so `needsOnboarding` below is true: the same fail-closed answer a missing
  // `profileCompletedAt` always gave.
  const gate = profileGateSchema.safeParse(authData);
  const gateUser = gate.success ? gate.data.user : null;
  const profileCompletedAt = gateUser?.profileCompletedAt;
  const requiredProfileComplete = gateUser?.requiredProfileComplete;
  const guardianConsentRequired = gateUser?.guardianConsentRequired;

  // NO LEGAL DOCUMENT APPEARS IN THIS LIST, AND NONE EVER SHOULD.
  // `requiredConsentsComplete === false` sat here once; it is gone, along with
  // the flag itself. What remains are two facts about an INCOMPLETE ACCOUNT —
  // no profile yet — and one condition from the Terms:
  //
  const needsOnboarding =
    requiredProfileComplete === false || !profileCompletedAt;

  if (!isAdmin && !isProfileCompletePage && needsOnboarding) {
    // @spec [AS-5; register UI-03] | @implemented [2026-09-29] | plain English: the page the
    // user was opening rides through onboarding as `?next=` (sanitised by the shared module;
    // an un-allowlisted location collapses to plain /profile/complete), and the onboarding
    // page lands on it when the profile is complete.
    return (
      <Redirect to={onboardingPathWithReturn(intendedPath(location))} replace />
    );
  }

  // `guardianConsentRequired` is the under-13 rule (R6, SCL-187): a student under
  // 13 cannot use LYCEON until a guardian link is active. That is not a consent
  // gate, it is the basis of the under-13 position, and it routes to a screen
  // built to get them connected — the link code, the email invite, the guardian
  // list — rather than a wall. The SERVER enforces it on every learning request
  // (403 GUARDIAN_LINK_REQUIRED); this only spares the student refused pages.
  const isGuardianRequiredPage = location === "/guardian-required";
  const needsGuardianLink =
    userRole === "student" && guardianConsentRequired === true;

  if (
    !isAdmin &&
    !isProfileCompletePage &&
    !isGuardianRequiredPage &&
    needsGuardianLink
  ) {
    return <Redirect to="/guardian-required" replace />;
  }

  // @spec [LYCEON consent capture §6]
  //
  // Parsed, not trusted: this is a wire payload, and the shared schema is the
  // same one the server's own type is inferred from. A malformed entry becomes
  // an empty list rather than a modal rendering `undefined` at someone.
  const outstanding = outstandingLegalSchema.safeParse(
    gateUser?.outstandingLegal ?? [],
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
