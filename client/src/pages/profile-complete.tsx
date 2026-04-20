import { FormEvent, useEffect, useMemo, useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, ShieldAlert, UserRound } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { csrfFetch } from "@/lib/csrf";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ProfileRole = "student" | "guardian" | "admin";

interface ProfileHydrationResponse {
  authenticated?: boolean;
  user?: {
    id: string;
    email?: string | null;
    display_name?: string | null;
    role?: ProfileRole;
    guardianConsentRequired?: boolean;
    requiredConsentsComplete?: boolean;
    requiredProfileComplete?: boolean;
    profileCompletedAt?: string | null;
  } | null;
}

interface ProfileCompletionResponse {
  success: boolean;
  profile: {
    role: ProfileRole;
  };
  guardianConsentRequired: boolean;
  guardianConsentRequestId?: string | null;
}

function calculateAge(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null;
  const birthDate = new Date(dateOfBirth);
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
}

function resolvePostCompletionPath(role: ProfileRole | undefined): string {
  return role === "guardian" ? "/guardian" : "/dashboard";
}

export default function ProfileComplete() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"student" | "guardian">("student");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isInitialized, setIsInitialized] = useState(false);

  const {
    data: hydration,
    isLoading,
    error,
    refetch,
  } = useQuery<ProfileHydrationResponse>({
    queryKey: ["/api/profile"],
    retry: false,
    queryFn: async () => {
      const response = await csrfFetch("/api/profile", { credentials: "include" });

      if (response.status === 401 || response.status === 403) {
        return { authenticated: false, user: null };
      }

      if (!response.ok) {
        throw new Error(`Failed to load profile (${response.status})`);
      }

      return response.json();
    },
  });

  const profile = hydration?.user ?? null;
  const isAuthenticated = hydration?.authenticated !== false && !!profile;

  useEffect(() => {
    if (!profile || isInitialized) {
      return;
    }

    setDisplayName(profile.display_name ?? "");
    setRole(profile.role === "guardian" ? "guardian" : "student");
    setIsInitialized(true);
  }, [profile, isInitialized]);

  const age = useMemo(() => calculateAge(dateOfBirth), [dateOfBirth]);
  const isUnder13 = role === "student" && age !== null && age < 13;

  const completionMutation = useMutation({
    mutationFn: async (): Promise<ProfileCompletionResponse> => {
      const response = await apiRequest("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: displayName.trim(),
          role,
          dateOfBirth: role === "student" ? dateOfBirth : null,
          guardianEmail: role === "student" ? guardianEmail.trim() || null : null,
          marketingOptIn,
        }),
      });

      return response.json() as Promise<ProfileCompletionResponse>;
    },
    onSuccess: async (result) => {
      setErrorMessage("");
      await queryClient.invalidateQueries({ queryKey: ["/api/profile"] });

      if (result.guardianConsentRequired) {
        toast({
          title: "Guardian verification sent",
          description: "A verification email was sent to the guardian address. We will unlock access after verification.",
        });
        return;
      }

      toast({
        title: "Profile completed",
        description: "Your onboarding is now complete.",
      });
      navigate(resolvePostCompletionPath(result.profile.role));
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "We could not complete your profile. Please try again.";
      setErrorMessage(message);
      toast({
        title: "Profile completion failed",
        description: message,
      });
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage("");

    if (!displayName.trim()) {
      setErrorMessage("Display name is required.");
      return;
    }

    if (role === "student" && !dateOfBirth) {
      setErrorMessage("Date of birth is required for student accounts.");
      return;
    }

    if (isUnder13 && !guardianEmail.trim()) {
      setErrorMessage("Guardian email is required for users under 13.");
      return;
    }

    completionMutation.mutate();
  };

  if (!isLoading && !isAuthenticated) {
    return <Redirect to="/login" />;
  }

  if (profile?.role === "admin") {
    return <Redirect to="/dashboard" />;
  }

  if (profile?.requiredProfileComplete && profile?.profileCompletedAt) {
    return <Redirect to={resolvePostCompletionPath(profile.role)} />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Loading profile completion...</p>
        </div>
      </div>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : "Failed to load profile";
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#0F2E48]">
              <AlertCircle className="h-5 w-5 text-amber-700" />
              Unable To Load
            </CardTitle>
            <CardDescription>{message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full" onClick={() => refetch()}>
              Retry
            </Button>
            <Button className="w-full" variant="outline" onClick={() => navigate("/login")}>
              Back To Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="h-5 w-5 text-primary" />
            Complete Your Profile
          </CardTitle>
          <CardDescription>
            Finish basic setup to continue into Lyceon.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {profile?.guardianConsentRequired && (
            <Alert data-testid="alert-guardian-consent-pending">
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription>
                Guardian verification is still required for this account. Submitting this form again will resend a verification request if needed.
              </AlertDescription>
            </Alert>
          )}

          {errorMessage && (
            <Alert className="border-amber-200 bg-amber-50" data-testid="alert-error">
              <AlertCircle className="h-4 w-4 text-amber-700" />
              <AlertDescription className="text-amber-800">{errorMessage}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="display-name">Display Name</Label>
              <Input
                id="display-name"
                data-testid="input-display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Your name"
                maxLength={120}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role-select">Role</Label>
              <Select value={role} onValueChange={(value) => setRole(value as "student" | "guardian")}>
                <SelectTrigger id="role-select" data-testid="select-role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="guardian">Guardian</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {role === "student" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="date-of-birth">Date Of Birth</Label>
                  <Input
                    id="date-of-birth"
                    data-testid="input-date-of-birth"
                    type="date"
                    value={dateOfBirth}
                    onChange={(event) => setDateOfBirth(event.target.value)}
                    required
                  />
                  {age !== null && (
                    <p className="text-xs text-muted-foreground">
                      Age detected: {age}
                    </p>
                  )}
                </div>

                {isUnder13 && (
                  <div className="space-y-2">
                    <Label htmlFor="guardian-email">Guardian Email</Label>
                    <Input
                      id="guardian-email"
                      data-testid="input-guardian-email"
                      type="email"
                      value={guardianEmail}
                      onChange={(event) => setGuardianEmail(event.target.value)}
                      placeholder="guardian@example.com"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      We only mark guardian consent after verified guardian flow completion.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-start space-x-2 pt-1">
              <Checkbox
                id="marketing-opt-in"
                data-testid="checkbox-marketing-opt-in"
                checked={marketingOptIn}
                onCheckedChange={(checked) => setMarketingOptIn(Boolean(checked))}
              />
              <Label htmlFor="marketing-opt-in" className="text-sm font-normal leading-5">
                Send me optional product updates and study news.
              </Label>
            </div>

            <Button
              type="submit"
              data-testid="button-complete-profile"
              className="w-full"
              disabled={completionMutation.isPending}
            >
              {completionMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : profile?.guardianConsentRequired ? (
                "Resend Guardian Verification"
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Complete Profile
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
