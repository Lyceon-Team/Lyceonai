import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { AlertCircle } from "lucide-react";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { SupabaseAuthForm } from "@/components/auth/SupabaseAuthForm";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { humanAuthError } from "@/lib/auth-error-messages";
import { returnPathFromSearch } from "@lyceon/shared/return-path";

export default function Login() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, authLoading } = useSupabaseAuth();
  const hasRedirected = useRef(false);

  // AS-3: a failed auth redirect lands here with ?error=<code>. Show a human, recoverable message
  // (never the raw code). The code stays server-side only (logs/diagnostics).
  const errorMessage =
    typeof window !== "undefined"
      ? humanAuthError(new URLSearchParams(window.location.search).get("error"))
      : null;

  useEffect(() => {
    if (!authLoading && isAuthenticated && user && !hasRedirected.current) {
      hasRedirected.current = true;

      // Determine destination based on onboarding status
      // A SECOND COPY OF THE GATE LIVED HERE, and it outlived the first.
      // `user.requiredConsentsComplete === false` sent anyone with an
      // outstanding document to /profile/complete straight after sign-in — so
      // removing the wall in RequireRole alone would have left this one standing
      // and the behaviour unchanged for exactly the people it was meant to free.
      // No legal document appears here now. What remains is an incomplete
      // account, and the under-13 rule, which is a condition of the Terms rather
      // than a consent state.
      const needsOnboarding =
        user.guardianConsentRequired === true ||
        user.requiredProfileComplete === false ||
        !user.profile_completed_at;

      let destination = user.role === "guardian" ? "/guardian" : "/dashboard";

      // @spec [AS-5 allowlisted `next`; owner brief 2026-09-15 Part B] | @implemented [2026-09-15]
      // A return path captured by RequireRole (`/login?next=…`) wins over the role default —
      // but only after it passes the ONE shared sanitiser (same-origin, relative, allowlisted),
      // and never ahead of onboarding: an incomplete account still goes to /profile/complete.
      const returnPath =
        typeof window !== "undefined"
          ? returnPathFromSearch(window.location.search)
          : null;
      if (returnPath) destination = returnPath;

      // Admins bypass onboarding requirements
      if (user.role !== "admin" && needsOnboarding) {
        destination = "/profile/complete";
      }

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
      <div className="w-full max-w-md mx-auto space-y-4">
        {errorMessage && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-800">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        <SupabaseAuthForm />
      </div>
    </div>
  );
}
