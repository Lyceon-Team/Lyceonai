import { ReactNode } from 'react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { Redirect, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { csrfFetch } from '@/lib/csrf';
import { ReconsentModal } from '@/components/legal/ReconsentModal';
import { outstandingLegalSchema } from '@shared/legal-consent';

type UserRole = 'student' | 'guardian' | 'admin';

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

  // Fetch profile completion status from canonical /api/profile endpoint
  const { data: authData, isLoading: profileLoading } = useQuery<AuthUserResponse>({
    queryKey: ['/api/profile'],
    retry: false,
    enabled: !!user, // only fetch when user is authenticated
    queryFn: async () => {
      const response = await csrfFetch('/api/profile', { credentials: 'include' });

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
    return <Redirect to="/login" replace />;
  }

  const userRole: UserRole = isAdmin ? 'admin' : isGuardian ? 'guardian' : 'student';

  const isAllowed =
    allow.includes(userRole) ||
    (isAdmin && allow.includes('admin'));

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
  const isProfileCompletePage = location === '/profile/complete';
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

  // THE CHILDREN ARE NOT RENDERED BEHIND IT, DELIBERATELY. An overlay with the
  // application still mounted underneath is blocking to a mouse and no obstacle
  // at all to a keyboard: tab past the dialog and the product is right there.
  // "Cannot be dismissed" has to mean "there is nothing behind it", or the
  // invariant is a visual effect. Admins are exempt because they are exempt from
  // the onboarding gate above, and locking the only account that can investigate
  // a bad publish out of the admin surface is the wrong failure mode.
  if (!isAdmin && !isProfileCompletePage && outstandingLegal.length > 0) {
    return <ReconsentModal documents={outstandingLegal} onSignOut={signOut} />;
  }

  return <>{children}</>;
}

export default RequireRole;


