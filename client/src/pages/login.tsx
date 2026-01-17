import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { SupabaseAuthForm } from "@/components/auth/SupabaseAuthForm";
import { ConsentGate } from "@/components/auth/ConsentGate";

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

  // Always show auth form on login page (even if loading)
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SupabaseAuthForm />
    </div>
  );
}
