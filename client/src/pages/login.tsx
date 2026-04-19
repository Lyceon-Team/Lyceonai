import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { SupabaseAuthForm } from "@/components/auth/SupabaseAuthForm";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { csrfFetch } from "@/lib/csrf";

export default function Login() {
  const [, navigate] = useLocation();
  const { isAuthenticated, authLoading, isGuardian } = useSupabaseAuth();
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated && !hasRedirected.current) {
      hasRedirected.current = true;
      void (async () => {
        let destination = isGuardian ? "/guardian" : "/dashboard";

        try {
          const response = await csrfFetch("/api/profile", { credentials: "include" });
          if (response.ok) {
            const data = await response.json();
            const role = data?.user?.role;
            const profileCompletedAt = data?.user?.profileCompletedAt;
            const requiredProfileComplete = data?.user?.requiredProfileComplete;
            const requiredConsentsComplete = data?.user?.requiredConsentsComplete;
            const guardianConsentRequired = data?.user?.guardianConsentRequired;

            if (!requiredConsentsComplete || guardianConsentRequired || !requiredProfileComplete || !profileCompletedAt) {
              destination = "/profile/complete";
            } else {
              destination = role === "guardian" ? "/guardian" : "/dashboard";
            }
          }
        } catch (error) {
          console.error("[LOGIN] Failed to resolve post-auth destination", error);
        }

        console.log("[LOGIN] Redirecting authenticated user to", destination);
        navigate(destination);
      })();
    }
  }, [isAuthenticated, authLoading, isGuardian, navigate]);

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
