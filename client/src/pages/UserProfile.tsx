import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GuardianShell } from "@/components/layout/GuardianShell";
import { guardianPaths } from "@/features/guardian/paths";
import { PageCard } from "@/components/common/page-card";
import { EmptyState } from "@/components/common/empty-state";
import { FullPageLoader } from "@/components/student-ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  User,
  Settings,
  CreditCard,
  Shield,
  LogOut,
  Calendar,
  AlertCircle,
  CheckCircle,
  Mail,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { SUPPORT_EMAIL } from "@/lib/support-contact";
import { RecoveryNotice } from "@/components/feedback/RecoveryNotice";
import { SessionNotice } from "@/components/feedback/SessionNotice";
import { DeleteAccountCard } from "@/components/account-deletion/DeleteAccountCard";
import { EmailNotificationsCard } from "@/components/account/EmailNotificationsCard";
import { CookiesAnalyticsCard } from "@/components/account/CookiesAnalyticsCard";
import { isSessionError, toUserFacingMessage } from "@/lib/api-error";
import { useProfileQuery } from "@/hooks/useProfileQuery";

type RoleSwitchTarget = "student" | "guardian" | "teacher";

function buildRoleSwitchTemplate(args: {
  currentRole: string;
  requestedRole: RoleSwitchTarget;
  accountEmail: string;
  displayName?: string;
}) {
  return [
    "Hello Lyceon Support Team,",
    "",
    "I am requesting a role update for my account.",
    `Current role: ${args.currentRole}`,
    `Requested role: ${args.requestedRole}`,
    `Account email: ${args.accountEmail}`,
    `Account name: ${args.displayName || "Not provided"}`,
    "",
    "Reason for request:",
    "- Please review and update my account role as appropriate.",
    "",
    "Thank you,",
    args.displayName || args.accountEmail,
  ].join("\n");
}

export function formatMemberSince(createdAt?: string): string {
  if (!createdAt) return "Unavailable";
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return parsed.toLocaleDateString();
}

/**
 * The GUARDIAN's /profile (G4-08).
 *
 * @spec [Guardian_Closure_Plan G4-08, G4-10; student-UI register UI-58] | @implemented
 *       [2026-09-30; narrowed to the guardian 2026-10-03]
 *
 * plain English: a guardian's /profile is a guardian page: the guardian shell (one shell on
 * every guardian page, G4-01) with guardian sections only, and billing pointing to Linked
 * students & billing (G4-10). Since UI-58 a student's /profile is the Settings page
 * (`pages/settings.tsx`), chosen by role in App.tsx's `ProfileRoute`, so the student-only parts
 * that lived here are gone: the Progress tab of placeholders, the link-code and linked-guardian
 * panels (Settings → Guardian), and the student billing card (Settings → Billing, F-40).
 * Presentation only; every read on this page is authorised server-side.
 */
export default function UserProfile() {
  const [activeTab, setActiveTab] = useState("profile");
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { user, signOut } = useSupabaseAuth();
  const Shell = GuardianShell;
  const [roleSwitchTarget, setRoleSwitchTarget] =
    useState<RoleSwitchTarget>("student");
  const [roleSwitchMessage, setRoleSwitchMessage] = useState("");

  // @spec [student-ui register UI-14] | @implemented [2026-09-29] | plain English: the shared
  // profile and billing-status queries — one key and one fetch function each, shared with the
  // route guard, the auth provider and the premium prompt, so this page adds no request for
  // data they already hold.
  const {
    data: userProfile,
    isLoading: profileLoading,
    isError: profileError,
    error: profileErrorObj,
    refetch: refetchProfile,
  } = useProfileQuery({ enabled: !!user });

  // Logout handler
  const handleLogout = async () => {
    try {
      await signOut();
      queryClient.clear();
      navigate("/login");
      toast({
        title: "Logged Out",
        description: "You have been successfully logged out.",
      });
    } catch (error) {
      const notice = toUserFacingMessage(error);
      toast({
        title: notice.title,
        description: notice.message,
      });
    }
  };

  const profileUser = userProfile?.user;

  // G2-02: no default. This page renders only for a signed-in user whose role the route guard
  // already parsed; an absent role is shown as absent, never guessed as "student".
  const currentRole = user?.role ?? "unknown";
  const accountEmail = user?.email || profileUser?.email || "";
  const accountName = profileUser?.name || user?.display_name || "";
  // `/api/profile` has never sent a creation date (see `ProfileHydrationUser`); the auth
  // context's `created_at` is the only field that names one.
  const memberSinceLabel = formatMemberSince(user?.created_at);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "profile" || tab === "settings" || tab === "billing") {
      setActiveTab(tab);
    }
  }, [location]);

  useEffect(() => {
    if (!accountEmail) {
      return;
    }

    setRoleSwitchMessage(
      buildRoleSwitchTemplate({
        currentRole,
        requestedRole: roleSwitchTarget,
        accountEmail,
        displayName: accountName || undefined,
      }),
    );
  }, [accountEmail, accountName, currentRole, roleSwitchTarget]);

  const roleSwitchSubject = `Role update request: ${currentRole} -> ${roleSwitchTarget}`;
  const roleSwitchMailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(roleSwitchSubject)}&body=${encodeURIComponent(roleSwitchMessage)}`;
  const roleSwitchPreview = [
    `To: ${SUPPORT_EMAIL}`,
    `Subject: ${roleSwitchSubject}`,
    "",
    roleSwitchMessage,
  ].join("\n");

  if (profileLoading) {
    return (
      <Shell>
        {/* @spec [student-UI register UI-46; audit §6.2 "Full-page spinner"] |
            @implemented [2026-10-03] — the shared loader, in its region form inside the
            page's own shell; light-locked until Wave 5 (UI-58) themes this page. */}
        <FullPageLoader
          fill="region"
          themeLock="light"
          label="Loading your profile..."
        />
      </Shell>
    );
  }

  if (profileError) {
    const profileMessage =
      (profileErrorObj as Error)?.message ??
      toUserFacingMessage(profileErrorObj).message;
    return (
      <Shell>
        <div className="min-h-[60vh] flex items-center justify-center px-4">
          {isSessionError(profileErrorObj) ? (
            <SessionNotice
              title="Your profile session needs to be refreshed."
              message={profileMessage}
              onRefreshSession={() => window.location.reload()}
            />
          ) : (
            <RecoveryNotice
              title="We couldn’t load your profile."
              message={profileMessage}
              onRetry={() => void refetchProfile()}
            />
          )}
        </div>
      </Shell>
    );
  }

  // Empty state when no profile data
  if (!profileUser) {
    return (
      <Shell>
        <div className="min-h-[60vh] flex items-center justify-center px-4">
          <EmptyState
            title="No Profile Data"
            description="Your profile information could not be found. Please try refreshing or contact support if the issue persists."
            action={{
              label: "Refresh",
              onClick: () => refetchProfile(),
            }}
          />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8 max-w-6xl">
        {/* Page Header */}
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-2">
            Account Center
          </p>
          <h1
            className="text-3xl font-bold text-foreground mb-2"
            data-testid="page-title"
          >
            Profile & Settings
          </h1>
          <p className="text-muted-foreground">
            Manage your account identity, guardian linking, and current
            runtime-backed settings.
          </p>
        </div>
        {/* Profile Header */}
        {profileUser && (
          <PageCard className="mb-8 bg-card/80 border-border/60">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <div className="relative">
                <Avatar className="h-24 w-24">
                  <AvatarFallback className="text-lg">
                    {profileUser.name?.charAt(0) ||
                      user?.email?.charAt(0) ||
                      "U"}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className="flex-1">
                <h2
                  className="text-2xl font-bold mb-1"
                  data-testid="text-profile-name"
                >
                  {profileUser.name || user?.email}
                </h2>
                <p
                  className="text-muted-foreground mb-3"
                  data-testid="text-profile-email"
                >
                  {user?.email}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {profileUser.isAdmin && (
                    <Badge variant="secondary" data-testid="badge-admin">
                      <Shield className="h-3 w-3 mr-1" />
                      Administrator
                    </Badge>
                  )}
                  <Badge variant="outline" data-testid="badge-member-since">
                    <Calendar className="h-3 w-3 mr-1" />
                    Member since {memberSinceLabel}
                  </Badge>
                </div>
              </div>
              <div className="self-start">
                <Button
                  variant="outline"
                  onClick={handleLogout}
                  data-testid="button-logout"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </Button>
              </div>
            </div>
          </PageCard>
        )}

        {/* Profile Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-6"
        >
          <TabsList className="grid w-full grid-cols-3 bg-secondary/60">
            <TabsTrigger value="profile" data-testid="tab-profile">
              <User className="h-4 w-4 mr-2" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </TabsTrigger>
            <TabsTrigger value="billing" data-testid="tab-billing">
              <CreditCard className="h-4 w-4 mr-2" />
              Billing
            </TabsTrigger>
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Personal Information</CardTitle>
                <CardDescription>
                  Your profile information (editing coming soon)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input
                      id="name"
                      value={profileUser?.name || ""}
                      disabled
                      data-testid="input-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      value={profileUser?.username || ""}
                      disabled
                      data-testid="input-username"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      value={user?.email || ""}
                      disabled
                      data-testid="input-email"
                    />
                    <p className="text-xs text-muted-foreground">
                      Email changes are currently support-managed
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Account Security */}
            <Card>
              <CardHeader>
                <CardTitle>Account Security</CardTitle>
                <CardDescription>
                  Account authentication status and protections
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    <Shield className="h-5 w-5 text-green-500" />
                    <div>
                      <p className="font-medium">Authentication Enabled</p>
                      <p className="text-sm text-muted-foreground">
                        Session and role protections are active
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">Active</Badge>
                </div>
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    This account is protected by runtime authentication
                    controls. Use the password reset/update flow for credential
                    changes when using email sign-in.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Request Role Change</CardTitle>
                <CardDescription>
                  Role changes are support-mediated and are not applied directly
                  in-app.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    No in-product role switch is available. Use this request
                    form to draft an email to {SUPPORT_EMAIL}.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label htmlFor="role-switch-target">Requested Role</Label>
                  <Select
                    value={roleSwitchTarget}
                    onValueChange={(value) =>
                      setRoleSwitchTarget(value as RoleSwitchTarget)
                    }
                  >
                    <SelectTrigger
                      id="role-switch-target"
                      data-testid="select-role-switch-target"
                    >
                      <SelectValue placeholder="Select target role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="student">student</SelectItem>
                      <SelectItem value="guardian">guardian</SelectItem>
                      <SelectItem value="teacher">teacher</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="role-switch-message">Message</Label>
                  <Textarea
                    id="role-switch-message"
                    value={roleSwitchMessage}
                    onChange={(event) =>
                      setRoleSwitchMessage(event.target.value)
                    }
                    className="min-h-[220px]"
                    data-testid="textarea-role-switch-message"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="role-switch-preview">Email Preview</Label>
                  <pre
                    id="role-switch-preview"
                    className="rounded-lg border bg-muted p-4 text-xs leading-6 whitespace-pre-wrap"
                    data-testid="preview-role-switch-email"
                  >
                    {roleSwitchPreview}
                  </pre>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button asChild data-testid="button-role-switch-send">
                    <a href={roleSwitchMailto}>
                      <Mail className="h-4 w-4 mr-2" />
                      Send to Support
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setRoleSwitchMessage(
                        buildRoleSwitchTemplate({
                          currentRole,
                          requestedRole: roleSwitchTarget,
                          accountEmail,
                          displayName: accountName || undefined,
                        }),
                      )
                    }
                    data-testid="button-role-switch-reset"
                  >
                    Reset Template
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Data & Privacy</CardTitle>
                <CardDescription>
                  Manage your data and privacy preferences
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* SCL-090 as ruled 2026-09-17: a do-not-contact request outlives the account it
                    came from and silences password resets too, so the one surface that can
                    explain it lives here, above the control that creates it. Renders nothing
                    unless this address is actually suppressed. */}
                <EmailNotificationsCard />
                <CookiesAnalyticsCard />
                <DeleteAccountCard />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Billing Tab */}
          <TabsContent value="billing" className="space-y-6">
            {/* G4-10: a guardian's billing is per student and lives with the students. */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Billing
                </CardTitle>
                <CardDescription className="text-base">
                  Each student&rsquo;s subscription, and billing for every
                  student you pay for, are on Linked students &amp; billing.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="min-h-[48px] text-base">
                  <Link
                    href={guardianPaths.students}
                    data-testid="profile-guardian-billing"
                  >
                    Linked students &amp; billing
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Shell>
  );
}
