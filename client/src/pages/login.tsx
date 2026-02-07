import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { SupabaseAuthForm } from "@/components/auth/SupabaseAuthForm";
import { ConsentGate } from "@/components/auth/ConsentGate";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function Login() {
  const [, navigate] = useLocation();
  const { isAuthenticated, authLoading, requiresConsent, isGuardian } = useSupabaseAuth();
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated && !requiresConsent && !hasRedirected.current) {
      hasRedirected.current = true;
      const destination = isGuardian ? "/guardian" : "/dashboard";
      console.log('[LOGIN] Redirecting authenticated user to', destination);
      navigate(destination);
    }
  }, [isAuthenticated, requiresConsent, authLoading, isGuardian, navigate]);

  // Show consent gate if required
  if (isAuthenticated && requiresConsent) {
    return <ConsentGate />;
  }

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
