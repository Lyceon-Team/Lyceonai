import { ReactNode, useEffect } from 'react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { LogIn } from 'lucide-react';
import { useLocation } from 'wouter';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, authLoading } = useSupabaseAuth();
  const [location] = useLocation();

  // Log state changes for debugging
  useEffect(() => {
    console.log('[REQUIRE_AUTH] State:', { 
      authLoading, 
      hasUser: !!user, 
      userId: user?.id,
      location 
    });
  }, [authLoading, user, location]);

  // Loading state - show spinner
  if (authLoading) {
    console.log('[REQUIRE_AUTH] Showing loading spinner');
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Not authenticated → show login prompt (don't redirect, just show prompt)
  // Note: authLoading state ensures we've checked backend session validity
  // via fetchUserFromBackend() before showing this prompt
  if (!user) {
    console.log('[REQUIRE_AUTH] No user, showing login prompt');
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="p-8 bg-card rounded-xl border border-border shadow-sm text-center max-w-md" data-testid="auth-required-prompt">
          <div className="inline-flex p-4 bg-muted rounded-full mb-4">
            <LogIn className="h-8 w-8 text-foreground" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-3">Please sign in</h1>
          <p className="text-sm text-muted-foreground mb-6">
            You need to be signed in to access this page.
          </p>
          <a 
            href="/login" 
            className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors"
            data-testid="button-go-to-login"
          >
            Sign In
          </a>
        </div>
      </div>
    );
  }

  // Authenticated - render protected content
  console.log('[REQUIRE_AUTH] User authenticated, rendering children');
  return <>{children}</>;
}

export default RequireAuth;
