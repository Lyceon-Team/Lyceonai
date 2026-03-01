import { ReactNode } from 'react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { Redirect, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';

type UserRole = 'student' | 'guardian' | 'admin';

interface RequireRoleProps {
  allow: UserRole[];
  children: ReactNode;
}

interface AuthUserResponse {
  authenticated?: boolean;
  user?: {
    profileCompletedAt?: string | null;
    [key: string]: any;
  } | null;
}

export function RequireRole({ allow, children }: RequireRoleProps) {
  const { user, authLoading, isAdmin, isGuardian } = useSupabaseAuth();
  const [location] = useLocation();

  // Fetch profile completion status from /api/auth/user
  const { data: authData, isLoading: profileLoading } = useQuery<AuthUserResponse>({
    queryKey: ['/api/auth/user'],
    retry: false,
    enabled: !!user, // only fetch when user is authenticated
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
      return <Redirect to="/admin" replace />;
    }
    return <Redirect to="/dashboard" replace />;
  }

  // Enforce profile completion (includes terms acceptance) for non-admin users.
  // Skip this check if we're already on /profile/complete to avoid redirect loops.
  const isProfileCompletePage = location === '/profile/complete';
  const profileCompletedAt = authData?.user?.profileCompletedAt;

  if (!isAdmin && !isProfileCompletePage && !profileCompletedAt) {
    return <Redirect to="/profile/complete" replace />;
  }

  return <>{children}</>;
}

export default RequireRole;

