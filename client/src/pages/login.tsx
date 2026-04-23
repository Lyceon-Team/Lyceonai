import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { SupabaseAuthForm } from "@/components/auth/SupabaseAuthForm";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function Login() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, authLoading } = useSupabaseAuth();
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated && user && !hasRedirected.current) {
      hasRedirected.current = true;

      // Determine destination based on onboarding status
      const needsOnboarding =
        user.guardianConsentRequired === true ||
        user.requiredConsentsComplete === false ||
        user.requiredProfileComplete === false ||
        !user.profile_completed_at;

      let destination = user.role === "guardian" ? "/guardian" : "/dashboard";

      // Admins bypass onboarding requirements
      if (user.role !== 'admin' && needsOnboarding) {
        destination = "/profile/complete";
      }

      console.log("[LOGIN] Redirecting authenticated user to", destination);
      navigate(destination);
    }
  }, [isAuthenticated, authLoading, user, navigate]);

  // Show loading skeleton while checking auth state
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md mx-auto">
          <CardHeader>
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-full mt-2" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show auth form when ready
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SupabaseAuthForm />
    </div>
  );
}
