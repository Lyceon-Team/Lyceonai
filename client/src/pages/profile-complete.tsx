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
<<<<<<< HEAD
=======
    }
  });

  // Profile form
  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      phoneNumber: "",
      dateOfBirth: "",
      address: {
        street: "",
        city: "",
        state: "",
        zipCode: "",
        country: "United States"
      },
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      preferredLanguage: "en",
      marketingOptIn: false,
      studentTermsAccepted: false,
      privacyPolicyAccepted: false,
      honorCodeAccepted: false,
      communityGuidelinesAccepted: false,
      parentGuardianAccepted: false,
      password: "",
    }
  });

  // Profile completion mutation
  const completeProfileMutation = useMutation({
    mutationFn: async (data: ProfileFormData) => {
      const response = await apiRequest('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: {
          'Content-Type': 'application/json',
        },
      });
      return response;
    },
    onSuccess: () => {
      toast({ 
        title: "Profile completed!", 
        description: "Welcome to Lyceon! Let's start improving your SAT scores." 
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/profile"] }).then(() => {
        navigate(resolvePostCompletionPath(userProfile?.user));
      });
    },
    onError: (error: any) => {
      const errorMessage = error.message || 'Failed to complete profile. Please try again.';
      setErrorMessage(errorMessage);
      toast({ title: "Profile completion failed", description: errorMessage });
    }
  });

  const { data: legalAcceptances = [], isLoading: legalAcceptancesLoading, error: legalAcceptancesError } = useQuery<LegalAcceptanceRow[]>({
    queryKey: ['/api/legal/acceptances'],
    enabled: Boolean(userProfile?.authenticated),
    retry: false,
    queryFn: async () => {
      const result = await fetchUserAcceptances();
      if (result.error) {
        throw new Error(result.error);
      }
      return result.acceptances;
>>>>>>> 8acb2add0221722e9c0895b0dce6c2778f44c4fc
    },
  });

  const profile = hydration?.user ?? null;
  const isAuthenticated = hydration?.authenticated !== false && !!profile;

<<<<<<< HEAD
  useEffect(() => {
    if (!profile || isInitialized) {
=======
  // Show error state if auth check failed
  if (authError && !authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#0F2E48]">
              <AlertCircle className="h-5 w-5" />
              Authentication Error
            </CardTitle>
            <CardDescription>
              Failed to verify your authentication status
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-amber-200 bg-amber-50">
              <AlertCircle className="h-4 w-4 text-amber-700" />
              <AlertDescription className="text-amber-800">
                {authError instanceof Error ? authError.message : 'Unable to connect to authentication service'}
              </AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Button
                onClick={() => refetchUser()}
                className="flex-1"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/login')}
                className="flex-1"
              >
                Back to Login
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Redirect if profile already completed
  if (userProfile?.user?.profileCompletedAt) {
    return <Redirect to={resolvePostCompletionPath(userProfile?.user)} />;
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Empty state when no auth payload
  if (!userProfile || !userProfile?.user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <CardTitle className="flex items-center justify-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              No Profile Data
            </CardTitle>
            <CardDescription>
              Unable to load your profile information. Please sign in to continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Button
                onClick={() => refetchUser()}
                className="flex-1"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/login')}
                className="flex-1"
              >
                Back to Login
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const onSubmit = async (data: ProfileFormData) => {
    setErrorMessage("");
    
    const age = calculateAge(data.dateOfBirth);
    const userIsMinor = age < 18;
    
    if (userIsMinor && !data.parentGuardianAccepted) {
      setErrorMessage("Parent/Guardian consent is required for users under 18.");
>>>>>>> 8acb2add0221722e9c0895b0dce6c2778f44c4fc
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

<<<<<<< HEAD
    if (role === "student" && !dateOfBirth) {
      setErrorMessage("Date of birth is required for student accounts.");
      return;
=======
    if (data.password) {
      try {
        await updatePassword(data.password);
      } catch (err: any) {
        setErrorMessage(err.message || 'Failed to set password');
        toast({ title: 'Password setup failed', description: err.message || 'Failed to set password' });
        return;
      }
>>>>>>> 8acb2add0221722e9c0895b0dce6c2778f44c4fc
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
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
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
<<<<<<< HEAD
    );
  }
=======
    </div>
  );

  const dateOfBirth = form.watch("dateOfBirth");
  const isMinor = dateOfBirth ? calculateAge(dateOfBirth) < 18 : false;

  useEffect(() => {
    if (legalDefaultsApplied || legalAcceptancesLoading) return;
    const defaults = deriveLegalAcceptanceDefaults({
      acceptances: legalAcceptances,
      isMinor,
    });
    form.setValue("studentTermsAccepted", defaults.studentTermsAccepted, {
      shouldDirty: false,
      shouldValidate: false,
    });
    form.setValue("privacyPolicyAccepted", defaults.privacyPolicyAccepted, {
      shouldDirty: false,
      shouldValidate: false,
    });
    form.setValue("honorCodeAccepted", defaults.honorCodeAccepted, {
      shouldDirty: false,
      shouldValidate: false,
    });
    form.setValue("communityGuidelinesAccepted", defaults.communityGuidelinesAccepted, {
      shouldDirty: false,
      shouldValidate: false,
    });
    setLegalDefaultsApplied(true);
  }, [form, isMinor, legalAcceptances, legalAcceptancesLoading, legalDefaultsApplied]);

  const currentVersionAcceptance = deriveLegalAcceptanceDefaults({
    acceptances: legalAcceptances,
    isMinor,
  });
  const acceptedStudentDocCount = [
    currentVersionAcceptance.studentTermsAccepted,
    currentVersionAcceptance.privacyPolicyAccepted,
    currentVersionAcceptance.honorCodeAccepted,
    currentVersionAcceptance.communityGuidelinesAccepted,
  ].filter(Boolean).length;
  const priorParentAcceptance = hasAccepted(
    legalAcceptances,
    REQUIRED_PARENT_GUARDIAN_DOC.docKey,
    REQUIRED_PARENT_GUARDIAN_DOC.version,
  );

  // Step 3: Legal & Marketing
  const renderLegalMarketing = () => (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-medium">Legal Agreements</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Please review and accept the following documents to continue. Each link opens in a new tab.
        </p>
        {legalAcceptancesLoading ? (
          <p className="text-xs text-muted-foreground mb-4">
            Loading your recorded legal acceptances...
          </p>
        ) : legalAcceptancesError ? (
          <Alert className="mb-4 border-amber-200 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-700" />
            <AlertDescription className="text-amber-800">
              Could not load previously recorded legal acceptances. You can still continue by accepting all required agreements below.
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-xs text-muted-foreground mb-4">
            Current-version student agreements on file: {acceptedStudentDocCount}/{REQUIRED_STUDENT_LEGAL_DOCS.length}.
            Required acceptances are persisted before profile completion is finalized.
          </p>
        )}
        
        <FormField
          control={form.control}
          name="studentTermsAccepted"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-3 rounded-lg border">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  data-testid="checkbox-student-terms"
                />
              </FormControl>
              <div className="space-y-1 leading-none flex-1">
                <FormLabel className="text-sm font-normal">
                  I agree to the{" "}
                  <a 
                    href="/legal/student-terms" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary underline hover:no-underline inline-flex items-center gap-1"
                  >
                    Student Terms of Use
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  {" "}*
                </FormLabel>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="privacyPolicyAccepted"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-3 rounded-lg border">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  data-testid="checkbox-privacy"
                />
              </FormControl>
              <div className="space-y-1 leading-none flex-1">
                <FormLabel className="text-sm font-normal">
                  I agree to the{" "}
                  <a 
                    href="/legal/privacy-policy" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary underline hover:no-underline inline-flex items-center gap-1"
                  >
                    Privacy Policy
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  {" "}*
                </FormLabel>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="honorCodeAccepted"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-3 rounded-lg border">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  data-testid="checkbox-honor-code"
                />
              </FormControl>
              <div className="space-y-1 leading-none flex-1">
                <FormLabel className="text-sm font-normal">
                  I agree to the{" "}
                  <a 
                    href="/legal/honor-code" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary underline hover:no-underline inline-flex items-center gap-1"
                  >
                    Honor Code
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  {" "}*
                </FormLabel>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="communityGuidelinesAccepted"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-3 rounded-lg border">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  data-testid="checkbox-community-guidelines"
                />
              </FormControl>
              <div className="space-y-1 leading-none flex-1">
                <FormLabel className="text-sm font-normal">
                  I agree to the{" "}
                  <a 
                    href="/legal/community-guidelines" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary underline hover:no-underline inline-flex items-center gap-1"
                  >
                    Community Guidelines
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  {" "}*
                </FormLabel>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />
      </div>

      {isMinor && (
        <div className="space-y-4 border-t pt-4">
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4 rounded-lg">
            <h4 className="font-medium text-amber-800 dark:text-amber-200 mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Parent/Guardian Consent Required
            </h4>
            <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">
              Because you are under 18, a parent or legal guardian must consent to your use of Lyceon.
            </p>
            {priorParentAcceptance && (
              <p className="text-xs text-amber-700 dark:text-amber-300 mb-3">
                A current parent/guardian terms acceptance is already on file for this account.
              </p>
            )}
             
            <FormField
              control={form.control}
              name="parentGuardianAccepted"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 bg-white dark:bg-background p-3 rounded-lg border">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="checkbox-parent-guardian"
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none flex-1">
                    <FormLabel className="text-sm font-normal">
                      I am the parent or legal guardian of this user. I have read and agree to the{" "}
                      <a 
                        href="/legal/parent-guardian-terms" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary underline hover:no-underline inline-flex items-center gap-1"
                      >
                        Parent / Guardian Terms
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      , the{" "}
                      <a 
                        href="/legal/student-terms" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary underline hover:no-underline"
                      >
                        Student Terms of Use
                      </a>
                      , and the{" "}
                      <a 
                        href="/legal/privacy-policy" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary underline hover:no-underline"
                      >
                        Privacy Policy
                      </a>
                      , and I consent to my child's use of the Lyceon platform. *
                    </FormLabel>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
          </div>
        </div>
      )}

      <div className="space-y-4 border-t pt-4">
        <h3 className="text-lg font-medium">Communication Preferences</h3>
        
        <FormField
          control={form.control}
          name="marketingOptIn"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-3 rounded-lg border">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  data-testid="checkbox-marketing"
                />
              </FormControl>
              <div className="space-y-1 leading-none flex-1">
                <FormLabel className="text-sm font-normal">
                  Send me study tips, SAT updates, and feature announcements
                </FormLabel>
                <FormDescription>
                  Optional. You can unsubscribe at any time.
                </FormDescription>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />
      </div>

      <div className="bg-muted/50 p-4 rounded-lg">
        <p className="text-sm text-muted-foreground">
          <strong>Your Privacy Matters:</strong> We use your information to personalize your SAT learning experience. 
          Your data is protected with industry-standard security measures and will never be sold to third parties.
          View our full <a href="/legal" className="text-primary underline hover:no-underline">Legal Hub</a> for more details.
        </p>
      </div>
    </div>
  );
>>>>>>> 8acb2add0221722e9c0895b0dce6c2778f44c4fc

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
            <Alert variant="destructive" data-testid="alert-error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{errorMessage}</AlertDescription>
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

<<<<<<< HEAD
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
=======
        {/* Main Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              {currentStep === 1 && <><User className="h-5 w-5 mr-2" />Personal Information</>}
              {currentStep === 2 && <><MapPin className="h-5 w-5 mr-2" />Location & Preferences</>}
              {currentStep === 3 && <><CheckCircle className="h-5 w-5 mr-2" />Legal & Marketing</>}
            </CardTitle>
            <CardDescription>
              {currentStep === 1 && "Tell us about yourself"}
              {currentStep === 2 && "Where are you located and what are your preferences?"}
              {currentStep === 3 && "Review and accept our terms"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Error Alert */}
            {errorMessage && (
              <Alert className="mb-4 border-amber-200 bg-amber-50" data-testid="alert-error">
                <AlertCircle className="h-4 w-4 text-amber-700" />
                <AlertDescription className="text-amber-800">{errorMessage}</AlertDescription>
              </Alert>
            )}
>>>>>>> 8acb2add0221722e9c0895b0dce6c2778f44c4fc

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
