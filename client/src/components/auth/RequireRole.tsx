import { ReactNode } from 'react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { Redirect } from 'wouter';

type UserRole = 'student' | 'guardian' | 'admin';

interface RequireRoleProps {
  allow: UserRole[];
  children: ReactNode;
}

export function RequireRole({ allow, children }: RequireRoleProps) {
  const { user, authLoading, isAdmin, isGuardian } = useSupabaseAuth();

  if (authLoading) {
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

  return <>{children}</>;
}

export default RequireRole;
