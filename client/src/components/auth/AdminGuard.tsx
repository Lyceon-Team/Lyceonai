import { ReactNode } from 'react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { Shield, LogIn } from 'lucide-react';

export function AdminGuard({ children }: { children: ReactNode }) {
  const { user, authLoading, isAdmin } = useSupabaseAuth();

  // Loading state - show spinner (200 OK)
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Not authenticated → show friendly access-needed prompt (200 OK, no navigate)
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#EAF0FF] to-white">
        <div className="p-8 bg-white/80 rounded-2xl backdrop-blur-md shadow-lg text-center max-w-md" data-testid="admin-login-prompt">
          <div className="inline-flex p-4 bg-blue-100 rounded-full mb-4">
            <LogIn className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold text-neutral-800 mb-3">Please sign in</h1>
          <p className="text-sm text-neutral-600 mb-6">
            You need an account to view this page.
          </p>
          <a 
            href="/login" 
            className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
            data-testid="button-admin-login"
          >
            Sign In
          </a>
        </div>
      </div>
    );
  }

  // Authenticated but not admin → explicit Access Denied (200 OK, no navigate)
  if (!isAdmin) {
    console.warn('[ADMIN] Access denied for user', user.email);
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#EAF0FF] to-white">
        <div className="p-8 bg-white/80 rounded-2xl backdrop-blur-md shadow-lg text-center max-w-md" data-testid="admin-not-authorized">
          <div className="inline-flex p-4 bg-red-100 rounded-full mb-4">
            <Shield className="h-8 w-8 text-red-600" />
          </div>
          <h1 className="text-2xl font-semibold text-neutral-800 mb-3">Access Denied</h1>
          <p className="text-sm text-neutral-600 mb-6">
            You don't have permission to view this page. Administrator privileges are required.
          </p>
          <div className="flex gap-3 justify-center">
            <a 
              href="/dashboard" 
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              data-testid="button-go-dashboard"
            >
              Go to Dashboard
            </a>
            <a 
              href="/" 
              className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
              data-testid="button-go-home"
            >
              Go Home
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Admin user - render admin content
  return <>{children}</>;
}

export default AdminGuard;
