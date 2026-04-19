import { useState, useEffect } from "react";
import { Redirect, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Progress } from "@/components/ui/progress";
import { BookOpen, AlertCircle, User, MapPin, Phone, Calendar, Globe, CheckCircle, ExternalLink, Shield, RefreshCw } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fetchUserAcceptances, hasAccepted, recordAcceptance } from "@/lib/legal";
import { csrfFetch } from "@/lib/csrf";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";

// Comprehensive profile validation schema
const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(50, "First name must be less than 50 characters"),
  lastName: z.string().min(1, "Last name is required").max(50, "Last name must be less than 50 characters"),
  phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/, "Please enter a valid phone number").optional().or(z.literal("")),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  address: z.object({
    street: z.string().optional(),
    city: z.string().min(1, "City is required"),
    state: z.string().min(1, "State/Province is required"),
    zipCode: z.string().min(1, "ZIP/Postal code is required"),
    country: z.string().min(1, "Country is required")
  }),
  timeZone: z.string().min(1, "Time zone is required"),
  preferredLanguage: z.string().default("en"),
  marketingOptIn: z.boolean().default(false),
  studentTermsAccepted: z.boolean().refine((val) => val === true, {
    message: "You must accept the Student Terms of Use"
  }),
  privacyPolicyAccepted: z.boolean().refine((val) => val === true, {
    message: "You must accept the Privacy Policy"
  }),
  honorCodeAccepted: z.boolean().refine((val) => val === true, {
    message: "You must accept the Honor Code"
  }),
  communityGuidelinesAccepted: z.boolean().refine((val) => val === true, {
    message: "You must accept the Community Guidelines"
  }),
  parentGuardianAccepted: z.boolean().default(false),
  password: z.string().min(6, "Password must be at least 6 characters").optional().or(z.literal("")),
});

type ProfileFormData = z.infer<typeof profileSchema>;

const REQUIRED_STUDENT_LEGAL_DOCS = [
  { docKey: "student_terms", version: "2024-12-20" },
  { docKey: "privacy_policy", version: "2024-12-22" },
  { docKey: "honor_code", version: "2024-12-22" },
  { docKey: "community_guidelines", version: "2024-12-22" },
] as const;

const REQUIRED_PARENT_GUARDIAN_DOC = {
  docKey: "parent_guardian_terms",
  version: "2024-12-22",
} as const;

type LegalAcceptanceRow = {
  doc_key: string;
  doc_version: string;
};

export function deriveLegalAcceptanceDefaults(args: {
  acceptances: LegalAcceptanceRow[];
  isMinor: boolean;
}): Pick<
  ProfileFormData,
  | "studentTermsAccepted"
  | "privacyPolicyAccepted"
  | "honorCodeAccepted"
  | "communityGuidelinesAccepted"
  | "parentGuardianAccepted"
> {
  return {
    studentTermsAccepted: hasAccepted(args.acceptances, "student_terms", "2024-12-20"),
    privacyPolicyAccepted: hasAccepted(args.acceptances, "privacy_policy", "2024-12-22"),
    honorCodeAccepted: hasAccepted(args.acceptances, "honor_code", "2024-12-22"),
    communityGuidelinesAccepted: hasAccepted(args.acceptances, "community_guidelines", "2024-12-22"),
    parentGuardianAccepted:
      args.isMinor &&
      hasAccepted(
        args.acceptances,
        REQUIRED_PARENT_GUARDIAN_DOC.docKey,
        REQUIRED_PARENT_GUARDIAN_DOC.version,
      ),
  };
}

interface AuthUserResponse {
  user?: {
    profileCompletedAt?: string;
    [key: string]: any;
  } | null;
  authenticated?: boolean;
}

function resolvePostCompletionPath(profile?: AuthUserResponse["user"] | null): string {
  const role = profile?.role;
  if (role === "guardian") return "/guardian";
  return "/dashboard";
}

function isAuthUserResponse(data: unknown): data is AuthUserResponse {
  return typeof data === 'object' && data !== null;
}

type RecordAcceptanceFn = typeof recordAcceptance;

function calculateAge(birthDate: string): number {
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export async function persistRequiredLegalAcceptances(args: {
  isMinor: boolean;
  parentGuardianAccepted: boolean;
  recordAcceptanceFn?: RecordAcceptanceFn;
}): Promise<void> {
  const recordFn = args.recordAcceptanceFn ?? recordAcceptance;

  for (const doc of REQUIRED_STUDENT_LEGAL_DOCS) {
    const result = await recordFn({
      docKey: doc.docKey,
      docVersion: doc.version,
      actorType: "student",
      minor: args.isMinor,
    });
    if (!result.success) {
      throw new Error(result.error || `Failed to record ${doc.docKey}`);
    }
  }

  if (args.isMinor && args.parentGuardianAccepted) {
    const guardianResult = await recordFn({
      docKey: REQUIRED_PARENT_GUARDIAN_DOC.docKey,
      docVersion: REQUIRED_PARENT_GUARDIAN_DOC.version,
      actorType: "parent",
      minor: true,
    });
    if (!guardianResult.success) {
      throw new Error(guardianResult.error || "Failed to record parent_guardian_terms");
    }
  }
}

export default function ProfileComplete() {
  const [, navigate] = useLocation();
  const [currentStep, setCurrentStep] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [legalDefaultsApplied, setLegalDefaultsApplied] = useState(false);
  const { toast } = useToast();
  const { updatePassword } = useSupabaseAuth();

  const totalSteps = 3;
  const progress = (currentStep / totalSteps) * 100;

  // Check if user is authenticated
  const { data: userProfile, isLoading: authLoading, error: authError, refetch: refetchUser } = useQuery<AuthUserResponse>({
    queryKey: ['/api/profile'],
    retry: false,
    queryFn: async () => {
      const response = await csrfFetch('/api/profile', { credentials: 'include' });

      if (response.status === 401 || response.status === 403) {
        return { authenticated: false, user: null };
      }

      if (!response.ok) {
        throw new Error(`Profile auth check failed: ${response.status}`);
      }

      return response.json();
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
    },
  });

  // Redirect if not authenticated
  if (!authLoading && !authError && !userProfile?.authenticated) {
    return <Redirect to="/login" />;
  }

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
      return;
    }

    try {
      await persistRequiredLegalAcceptances({
        isMinor: userIsMinor,
        parentGuardianAccepted: data.parentGuardianAccepted,
      });
    } catch (err: any) {
      const message = err?.message || "Failed to record required legal agreements.";
      setErrorMessage(message);
      toast({
        title: "Legal acceptance failed",
        description: message,
      });
      return;
    }

    if (data.password) {
      try {
        await updatePassword(data.password);
      } catch (err: any) {
        setErrorMessage(err.message || 'Failed to set password');
        toast({ title: 'Password setup failed', description: err.message || 'Failed to set password' });
        return;
      }
    }

    // Call the profile completion mutation
    await completeProfileMutation.mutateAsync(data);
  };

  const nextStep = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Step 1: Personal Information
  const renderPersonalInfo = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="firstName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>First Name *</FormLabel>
              <FormControl>
                <Input
                  placeholder="Enter your first name"
                  data-testid="input-first-name"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="lastName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Last Name *</FormLabel>
              <FormControl>
                <Input
                  placeholder="Enter your last name"
                  data-testid="input-last-name"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="phoneNumber"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Phone Number</FormLabel>
            <FormControl>
              <Input
                type="tel"
                placeholder="+1 (555) 123-4567"
                data-testid="input-phone"
                {...field}
              />
            </FormControl>
            <FormDescription>
              Optional. Used for important account notifications.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="dateOfBirth"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Date of Birth *</FormLabel>
            <FormControl>
              <Input
                type="date"
                data-testid="input-date-of-birth"
                {...field}
              />
            </FormControl>
            <FormDescription>
              {field.value && `Age: ${calculateAge(field.value)} years old`}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="password"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Set Password (Optional)</FormLabel>
            <FormControl>
              <Input
                type="password"
                placeholder="••••••••"
                data-testid="input-password"
                {...field}
              />
            </FormControl>
            <FormDescription>
              If you used an email link to sign in, set a password now to use next time.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );

  // Step 2: Location & Preferences
  const renderLocationPreferences = () => (
    <div className="space-y-4">
      <div className="space-y-4">
        <h3 className="text-lg font-medium flex items-center">
          <MapPin className="h-5 w-5 mr-2" />
          Address Information
        </h3>
        
        <FormField
          control={form.control}
          name="address.street"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Street Address</FormLabel>
              <FormControl>
                <Input
                  placeholder="123 Main Street, Apt 4B"
                  data-testid="input-street"
                  {...field}
                />
              </FormControl>
              <FormDescription>Optional</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="address.city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>City *</FormLabel>
                <FormControl>
                  <Input
                    placeholder="New York"
                    data-testid="input-city"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="address.state"
            render={({ field }) => (
              <FormItem>
                <FormLabel>State/Province *</FormLabel>
                <FormControl>
                  <Input
                    placeholder="NY"
                    data-testid="input-state"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="address.zipCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>ZIP/Postal Code *</FormLabel>
                <FormControl>
                  <Input
                    placeholder="10001"
                    data-testid="input-zip"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="address.country"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Country *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-country">
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="United States">United States</SelectItem>
                    <SelectItem value="Canada">Canada</SelectItem>
                    <SelectItem value="United Kingdom">United Kingdom</SelectItem>
                    <SelectItem value="Australia">Australia</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>

      <div className="space-y-4 border-t pt-4">
        <h3 className="text-lg font-medium flex items-center">
          <Globe className="h-5 w-5 mr-2" />
          Preferences
        </h3>
        
        <FormField
          control={form.control}
          name="timeZone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Time Zone *</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-timezone">
                    <SelectValue placeholder="Select your time zone" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                  <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                  <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                  <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                  <SelectItem value="America/Anchorage">Alaska Time</SelectItem>
                  <SelectItem value="Pacific/Honolulu">Hawaii Time</SelectItem>
                  <SelectItem value="Europe/London">GMT</SelectItem>
                  <SelectItem value="Europe/Paris">Central European Time</SelectItem>
                  <SelectItem value="Asia/Tokyo">Japan Standard Time</SelectItem>
                  <SelectItem value="Australia/Sydney">Australian Eastern Time</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="preferredLanguage"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Preferred Language</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-language">
                    <SelectValue placeholder="Select language" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="es">Spanish</SelectItem>
                  <SelectItem value="fr">French</SelectItem>
                  <SelectItem value="de">German</SelectItem>
                  <SelectItem value="zh">Chinese</SelectItem>
                  <SelectItem value="ja">Japanese</SelectItem>
                  <SelectItem value="ko">Korean</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="p-3 bg-primary/10 rounded-full">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-profile-title">
            Complete Your Profile
          </h1>
          <p className="text-muted-foreground">
            Help us personalize your SAT learning experience
          </p>
        </div>

        {/* Progress Bar */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-medium">
                <span>Step {currentStep} of {totalSteps}</span>
                <span>{Math.round(progress)}% Complete</span>
              </div>
              <Progress value={progress} className="w-full" data-testid="progress-bar" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Personal Info</span>
                <span>Location & Preferences</span>
                <span>Legal & Marketing</span>
              </div>
            </div>
          </CardContent>
        </Card>

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

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {currentStep === 1 && renderPersonalInfo()}
                {currentStep === 2 && renderLocationPreferences()}
                {currentStep === 3 && renderLegalMarketing()}

                {/* Navigation Buttons */}
                <div className="flex justify-between pt-6">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={prevStep}
                    disabled={currentStep === 1}
                    data-testid="button-previous"
                  >
                    Previous
                  </Button>
                  
                  {currentStep < totalSteps ? (
                    <Button
                      type="button"
                      onClick={nextStep}
                      data-testid="button-next"
                    >
                      Next
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      disabled={completeProfileMutation.isPending}
                      data-testid="button-complete"
                    >
                      {completeProfileMutation.isPending ? "Completing..." : "Complete Profile"}
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Skip Option */}
        <div className="text-center">
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => navigate(resolvePostCompletionPath(userProfile?.user))}
            data-testid="button-skip"
            className="text-muted-foreground hover:text-primary"
          >
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  );
}
