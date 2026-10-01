import { FormEvent, useEffect, useMemo, useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, UserRound } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  PROFILE_QUERY_KEY,
  useProfileQuery,
  type ProfileRole,
} from "@/hooks/useProfileQuery";
import { resolveOnboardingErrorMessage } from "@/lib/api-error";
import {
  postAuthDestination,
  returnPathFromSearch,
} from "@lyceon/shared/return-path";

interface ProfileCompletionResponse {
  success: boolean;
  profile: {
    role: ProfileRole;
  };
  guardianConsentRequired: boolean;
}

function calculateAge(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null;
  const birthDate = new Date(dateOfBirth);
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }
  return age;
}

/**
 * @spec [AS-5; AS-3 landing matrix; register UI-03] | @implemented [2026-09-29]
 * plain English: where a completed profile lands. The return path that rode through onboarding
 * (`/profile/complete?next=…`, written by the login page, RequireRole or the OAuth callback) is
 * read from THIS page's query and re-sanitised by the shared module; it wins only when the role
 * may open it — a guardian is never sent to a student page. Otherwise the role default. An
 * unknown role is treated as a student, as before. Read at call time (not captured at mount)
 * so it is always the current URL.
 *
 * G2-04 (merged from `main`): an under-13 student with no active guardian link goes to the
 * linking page ahead of any return path — the server refuses every learning request until a
 * guardian connects, so the return path would only bounce.
 */
function resolvePostCompletionPath(
  role: ProfileRole | undefined,
  guardianLinkRequired: boolean,
): string {
  if (role !== "guardian" && role !== "admin" && guardianLinkRequired) {
    return "/guardian-required";
  }
  const next =
    typeof window !== "undefined"
      ? returnPathFromSearch(window.location.search)
      : null;
  return postAuthDestination({
    role: role ?? "student",
    needsOnboarding: false,
    next,
  });
}

export default function ProfileComplete() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { refreshUser } = useSupabaseAuth();

  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"student" | "guardian">("student");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isInitialized, setIsInitialized] = useState(false);

  // @spec [student-ui register UI-14] | @implemented [2026-09-29] | plain English: the one
  // shared profile query; its 401/403 → `{ authenticated: false }` answer is the one this page
  // already redirected on.
  const { data: hydration, isLoading, error, refetch } = useProfileQuery();

  const profile = hydration?.user ?? null;
  const isAuthenticated = hydration?.authenticated !== false && !!profile;

  useEffect(() => {
    if (!profile || isInitialized) {
      return;
    }

    setDisplayName(profile.display_name ?? "");
    setRole(profile.role === "guardian" ? "guardian" : "student");

    // @spec [Doc-01_V8 §9 Login and signup flows / §37.1 Under-13 gating] | @implemented [2026-06-17] | plain English: DOB picker
    // defaults to current_date − 13y (dynamically computed at render time, never hardcoded —
    // the threshold drifts with calendar time per the owner ruling).
    const defaultDob = new Date();
    defaultDob.setFullYear(defaultDob.getFullYear() - 13);
    setDateOfBirth(defaultDob.toISOString().split("T")[0]);

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
          // G1-02 (R10): guardians give their date of birth too, through the same field.
          dateOfBirth,
          marketingOptIn,
        }),
      });

      return response.json() as Promise<ProfileCompletionResponse>;
    },
    onSuccess: async (result) => {
      setErrorMessage("");
      await queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });

      toast({
        title: "Profile completed",
        description: result.guardianConsentRequired
          ? "Next, connect a guardian to your account."
          : "Your onboarding is now complete.",
      });
      // G1-02: the session's role must be the one just written BEFORE navigating. The
      // guardian dashboard gates on the auth context's `isGuardian`; without this refresh it
      // still read the pre-completion 'student' and bounced a new guardian to /dashboard.
      await refreshUser();
      navigate(
        resolvePostCompletionPath(
          result.profile.role,
          result.guardianConsentRequired,
        ),
      );
    },
    onError: (error: unknown) => {
      // @spec [contracts/auth-standard-flow.contract.md AS-2, AS-3 / §0] | @implemented 2026-06-20
      // plain English: completion errors route through the onboarding chokepoint — server 400/403
      // validation conditions map to curated, actionable copy; everything else (5xx, leaky, unknown)
      // falls back to a generic recoverable message. The raw HttpApiError.message is never shown.
      const message = resolveOnboardingErrorMessage(error, "save");
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

    if (!dateOfBirth) {
      setErrorMessage("Please enter your date of birth to continue.");
      return;
    }

    completionMutation.mutate();
  };

  if (!isLoading && !isAuthenticated) {
    return <Redirect to="/login" />;
  }

  if (profile?.role === "admin") {
    return <Redirect to={resolvePostCompletionPath("admin", false)} />;
  }

  /**
   * G-NEW-03: an ALREADY-completed profile redirects on render — but not the one this page is
   * completing. `onSuccess` refetches `/api/profile` before `refreshUser()` has updated the
   * session role, so for that interval the refetched profile said "completed guardian" while
   * the auth context still said "student". Redirecting on it sent the new guardian to
   * /guardian as a student; `RequireRole` bounced them to /dashboard, whose widgets called
   * `/api/progress/kpis` and `/projection` (403 `guardian_blocked`, production 2026-09-29).
   * While the completion is in flight or done, the one navigation is `onSuccess`'s, after
   * the refresh.
   */
  const completing =
    completionMutation.isPending || completionMutation.isSuccess;
  if (
    !completing &&
    profile?.requiredProfileComplete &&
    profile?.profileCompletedAt
  ) {
    return (
      <Redirect
        to={resolvePostCompletionPath(
          profile.role,
          profile.guardianConsentRequired === true,
        )}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">
            Loading profile completion...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    // Profile-load failures route through the same onboarding chokepoint (load variant) — the raw
    // server/exception string is never rendered in the CardDescription.
    const message = resolveOnboardingErrorMessage(error, "load");
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
            <Button
              className="w-full"
              variant="outline"
              onClick={() => navigate("/login")}
            >
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
          {errorMessage && (
            <Alert
              className="border-amber-200 bg-amber-50"
              data-testid="alert-error"
            >
              <AlertCircle className="h-4 w-4 text-amber-700" />
              <AlertDescription className="text-amber-800">
                {errorMessage}
              </AlertDescription>
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
              <Select
                value={role}
                onValueChange={(value) =>
                  setRole(value as "student" | "guardian")
                }
              >
                <SelectTrigger id="role-select" data-testid="select-role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="guardian">Guardian</SelectItem>
                </SelectContent>
              </Select>
            </div>

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
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="text-under-13-next-step"
                >
                  Under 13: after this step you&apos;ll connect a guardian with
                  your link code before you can start practising.
                </p>
              )}
            </div>

            <div className="flex items-start space-x-2 pt-1">
              <Checkbox
                id="marketing-opt-in"
                data-testid="checkbox-marketing-opt-in"
                checked={marketingOptIn}
                onCheckedChange={(checked) =>
                  setMarketingOptIn(Boolean(checked))
                }
              />
              <Label
                htmlFor="marketing-opt-in"
                className="text-sm font-normal leading-5"
              >
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
