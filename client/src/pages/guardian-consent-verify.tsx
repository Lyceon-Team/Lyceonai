import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Shield, CheckCircle2, AlertTriangle, Loader2, Sparkles } from "lucide-react";
import PublicLayout from "@/components/layout/PublicLayout";
import { Container, Card } from "@/components/layout/primitives";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import { useToast } from "@/hooks/use-toast";

interface ConsentRequest {
  id: string;
  childName: string;
  guardianEmail: string;
  status: string;
}

export default function GuardianConsentVerify() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  
  const params = new URLSearchParams(search);
  const requestId = params.get("requestId");
  const sessionId = params.get("sessionId");
  const isCanceled = params.get("canceled") === "true";

  const [checkedItems, setCheckedItems] = useState({
    isGuardian: false,
    consentPrivacy: false,
    revokeAccess: false,
    agreeTerms: false
  });

  const allChecked = Object.values(checkedItems).every(Boolean);

  // Fetch request details
  const { data: request, isLoading: requestLoading, error: requestError } = useQuery<ConsentRequest>({
    queryKey: ["/api/consent/request", requestId],
    queryFn: async () => {
      if (!requestId) throw new Error("Missing request ID");
      const res = await fetch(`/api/consent/request/${requestId}`);
      if (!res.ok) throw new Error("Failed to fetch consent request");
      return res.json();
    },
    enabled: !!requestId
  });

  // Verify Stripe Session
  const verifyMutation = useMutation({
    mutationFn: async (sid: string) => {
      const res = await fetch("/api/consent/verify-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, sessionId: sid })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Verification failed");
      }
      return res.json();
    }
  });

  // Create Checkout Session
  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/consent/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId })
      });
      if (!res.ok) throw new Error("Failed to initialize verification");
      const { url } = await res.json();
      return url;
    },
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    }
  });

  useEffect(() => {
    if (sessionId && requestId && !verifyMutation.isSuccess && !verifyMutation.isPending && !verifyMutation.isError) {
      verifyMutation.mutate(sessionId);
    }
  }, [sessionId, requestId]);

  if (!requestId) {
    return (
      <PublicLayout>
        <Container className="py-24 text-center">
          <AlertTriangle className="w-12 h-12 mx-auto text-yellow-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Invalid Link</h1>
          <p className="text-muted-foreground">This verification link is missing required information.</p>
        </Container>
      </PublicLayout>
    );
  }

  if (requestLoading || verifyMutation.isPending) {
    return (
      <PublicLayout>
        <Container className="py-24 text-center">
          <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">
            {verifyMutation.isPending ? "Verifying your identity..." : "Loading request details..."}
          </p>
        </Container>
      </PublicLayout>
    );
  }

  if (verifyMutation.isSuccess) {
    return (
      <PublicLayout>
        <Container className="py-24">
          <Card className="max-w-xl mx-auto p-8 text-center border-green-100 bg-green-50/30">
            <CheckCircle2 className="w-16 h-16 mx-auto text-green-500 mb-6" />
            <h1 className="text-3xl font-bold mb-4 text-green-900">Verification Successful</h1>
            <p className="text-lg text-green-800 mb-8">
              Thank you! You have successfully verified your identity and granted consent for <strong>{request?.childName}</strong> to use Lyceon.
            </p>
            <div className="space-y-4">
              <p className="text-sm text-green-700">
                A parent account has been created for you at <strong>{request?.guardianEmail}</strong>. 
                Please check your email for a link to set your password and access your dashboard.
              </p>
              <Button onClick={() => setLocation("/login")} className="w-full">
                Go to Sign In
              </Button>
            </div>
          </Card>
        </Container>
      </PublicLayout>
    );
  }

  if (requestError || (verifyMutation.isError && !isCanceled)) {
    return (
      <PublicLayout>
        <Container className="py-24">
          <Card className="max-w-xl mx-auto p-8 text-center">
            <AlertTriangle className="w-16 h-16 mx-auto text-red-500 mb-6" />
            <h1 className="text-2xl font-bold mb-4">Verification Error</h1>
            <p className="text-muted-foreground mb-8">
              {requestError ? "We couldn't find this consent request. It may have expired or been already approved." : 
               (verifyMutation.error as Error)?.message || "Something went wrong during verification."}
            </p>
            <Button onClick={() => window.location.reload()} variant="outline">
              Try Again
            </Button>
          </Card>
        </Container>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <SEO 
        title="Guardian Consent | Lyceon" 
        description="Provide parental consent for your child to use Lyceon's AI SAT tutoring platform."
      />
      <Container className="py-16 lg:py-24">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-10">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider mb-4">
              <Shield className="w-3 h-3" />
              COPPA Compliance
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold mb-4">Guardian Consent</h1>
            <p className="text-muted-foreground text-lg">
              Give <strong>{request?.childName}</strong> permission to use Lyceon's AI SAT Tutoring platform.
            </p>
          </div>

          <Card className="p-8 shadow-xl border-border/50">
            <div className="space-y-8">
              <div className="bg-secondary/50 rounded-xl p-4 border border-border/50">
                <div className="flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Why is this required?</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Federal law (COPPA) requires us to obtain verifiable parental consent before collecting personal information from children under 13.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex items-start space-x-3 group cursor-pointer" onClick={() => setCheckedItems(prev => ({ ...prev, isGuardian: !prev.isGuardian }))}>
                  <Checkbox 
                    id="isGuardian" 
                    checked={checkedItems.isGuardian}
                    className="mt-1"
                  />
                  <div className="grid gap-1.5 leading-none">
                    <label htmlFor="isGuardian" className="text-sm font-medium leading-none cursor-pointer">
                      I am the parent or legal guardian of the child named above.
                    </label>
                  </div>
                </div>

                <div className="flex items-start space-x-3 group cursor-pointer" onClick={() => setCheckedItems(prev => ({ ...prev, consentPrivacy: !prev.consentPrivacy }))}>
                  <Checkbox 
                    id="consentPrivacy" 
                    checked={checkedItems.consentPrivacy}
                    className="mt-1"
                  />
                  <div className="grid gap-1.5 leading-none">
                    <label htmlFor="consentPrivacy" className="text-sm font-medium leading-none cursor-pointer">
                      I consent to the collection and use of my child's personal information as described in Lyceon's <a href="/legal/privacy-policy" target="_blank" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>Privacy Policy</a>.
                    </label>
                  </div>
                </div>

                <div className="flex items-start space-x-3 group cursor-pointer" onClick={() => setCheckedItems(prev => ({ ...prev, revokeAccess: !prev.revokeAccess }))}>
                  <Checkbox 
                    id="revokeAccess" 
                    checked={checkedItems.revokeAccess}
                    className="mt-1"
                  />
                  <div className="grid gap-1.5 leading-none">
                    <label htmlFor="revokeAccess" className="text-sm font-medium leading-none cursor-pointer">
                      I understand that I can revoke this consent or request deletion of my child's data at any time by contacting hello@lyceon.ai.
                    </label>
                  </div>
                </div>

                <div className="flex items-start space-x-3 group cursor-pointer" onClick={() => setCheckedItems(prev => ({ ...prev, agreeTerms: !prev.agreeTerms }))}>
                  <Checkbox 
                    id="agreeTerms" 
                    checked={checkedItems.agreeTerms}
                    className="mt-1"
                  />
                  <div className="grid gap-1.5 leading-none">
                    <label htmlFor="agreeTerms" className="text-sm font-medium leading-none cursor-pointer">
                      I have read and agree to the <a href="/legal/parent-guardian-terms" target="_blank" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>Parent/Guardian Terms of Service</a>.
                    </label>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-border">
                <div className="mb-6">
                  <h4 className="font-semibold mb-2">Identity Verification</h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    To satisfy legal requirements for "verifiable parental consent," we use a credit card charge of $0.50 to confirm you are an adult.
                  </p>
                  <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-3 text-xs text-yellow-800 flex gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span>This charge will be immediately cancelled/voided. It only appears on your statement as "Lyceon Verification".</span>
                  </div>
                </div>

                <Button 
                  className="w-full h-12 text-lg font-semibold shadow-inner transition-transform active:scale-95"
                  disabled={!allChecked || checkoutMutation.isPending}
                  onClick={() => checkoutMutation.mutate()}
                >
                  {checkoutMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Redirecting...</>
                  ) : (
                    "Verify My Identity & Grant Consent"
                  )}
                </Button>
                
                {isCanceled && (
                  <p className="text-center text-xs text-red-500 mt-4">
                    Verification was canceled. Please try again when you are ready to complete the process.
                  </p>
                )}
              </div>
            </div>
          </Card>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            Still have questions? Read our <a href="/trust" className="text-primary hover:underline">Trust & Safety guide</a>.
          </p>
        </div>
      </Container>
    </PublicLayout>
  );
}
