import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { Redirect } from 'wouter';

export function RoleRedirect() {
  const { user, authLoading, isAdmin, isGuardian, isAuthenticated } = useSupabaseAuth();

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

  if (!isAuthenticated || !user) {
    return null;
  }

  if (isGuardian) {
    return <Redirect to="/guardian" replace />;
  }

  if (isAdmin) {
    return <Redirect to="/admin" replace />;
  }

  return <Redirect to="/dashboard" replace />;
}

export default RoleRedirect;
