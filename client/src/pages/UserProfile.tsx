import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/app-shell';
import { PageCard } from '@/components/common/page-card';
import { EmptyState } from '@/components/common/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  User, Settings, CreditCard, Bell, Shield, LogOut,
  Calendar,
  Trophy, Target, BookOpen, Clock, TrendingUp, Star,
  AlertCircle, CheckCircle,
  Copy, Mail, Users
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { SUPPORT_EMAIL } from '@/lib/support-contact';

interface UserProfile {
  id: string;
  username?: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  isAdmin?: boolean;
  createdAt?: string;
  lastLoginAt?: string;
  studentLinkCode?: string | null;
}


type RoleSwitchTarget = 'student' | 'guardian' | 'teacher';

function buildRoleSwitchTemplate(args: {
  currentRole: string;
  requestedRole: RoleSwitchTarget;
  accountEmail: string;
  displayName?: string;
}) {
  return [
    'Hello Lyceon Support Team,',
    '',
    'I am requesting a role update for my account.',
    `Current role: ${args.currentRole}`,
    `Requested role: ${args.requestedRole}`,
    `Account email: ${args.accountEmail}`,
    `Account name: ${args.displayName || 'Not provided'}`,
    '',
    'Reason for request:',
    '- Please review and update my account role as appropriate.',
    '',
    'Thank you,',
    args.displayName || args.accountEmail,
  ].join('\n');
}
// Note: UserStats are not currently tracked by backend
// Progress tracking uses /api/progress/kpis and /api/progress/projection
// These features are temporarily disabled and shown as placeholders

export default function UserProfile() {
  const [activeTab, setActiveTab] = useState('profile');
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { user, signOut } = useSupabaseAuth();
  const [roleSwitchTarget, setRoleSwitchTarget] = useState<RoleSwitchTarget>('student');
  const [roleSwitchMessage, setRoleSwitchMessage] = useState('');

  // Get user profile from canonical endpoint
  const {
    data: userProfile,
    isLoading: profileLoading,
    isError: profileError,
    error: profileErrorObj,
    refetch: refetchProfile,
  } = useQuery<{ user: UserProfile; authenticated: boolean }>({
    queryKey: ['/api/profile'],
    enabled: !!user,
  });

  // Logout handler
  const handleLogout = async () => {
    try {
      await signOut();
      queryClient.clear();
      navigate('/login');
      toast({
        title: "Logged Out",
        description: "You have been successfully logged out.",
      });
    } catch (error) {
      toast({
        title: "Logout Failed",
        description: "Failed to log out. Please try again.",
        variant: "destructive",
      });
    }
  };

  const profileUser = userProfile?.user;

  const currentRole = user?.role || 'student';
  const accountEmail = user?.email || profileUser?.email || '';
  const accountName = profileUser?.name || user?.display_name || '';

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
  const roleSwitchPreview = [`To: ${SUPPORT_EMAIL}`, `Subject: ${roleSwitchSubject}`, '', roleSwitchMessage].join('\n');

  if (profileLoading) {
    return (
      <AppShell>
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground border-t-transparent mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Loading your profile...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (profileError) {
    return (
      <AppShell>
        <div className="min-h-[60vh] flex items-center justify-center px-4">
          <Card className="max-w-md w-full text-center">
            <CardHeader>
              <CardTitle className="flex items-center justify-center gap-2">
                <AlertCircle className="h-5 w-5 text-red-500" />
                Unable to load profile
              </CardTitle>
              <CardDescription>
                {(profileErrorObj as Error)?.message ?? "Please try again."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => refetchProfile()}>Retry</Button>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  // Empty state when no profile data
  if (!profileUser) {
    return (
      <AppShell>
        <div className="min-h-[60vh] flex items-center justify-center px-4">
          <EmptyState
            title="No Profile Data"
            description="Your profile information could not be found. Please try refreshing or contact support if the issue persists."
            action={{
              label: "Refresh",
              onClick: () => refetchProfile()
            }}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8 max-w-6xl">
        {/* Page Header */}
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-2">Account Center</p>
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="page-title">
            Profile & Settings
          </h1>
          <p className="text-muted-foreground">
            Manage your account identity, guardian linking, and current runtime-backed settings.
          </p>
        </div>
        {/* Profile Header */}
        {profileUser && (
          <PageCard className="mb-8 bg-card/80 border-border/60">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <div className="relative">
                <Avatar className="h-24 w-24">
                  <AvatarImage src={profileUser.avatarUrl} alt={profileUser.name || user?.email} />
                  <AvatarFallback className="text-lg">
                    {profileUser.name?.charAt(0) || user?.email?.charAt(0) || 'U'}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold mb-1" data-testid="text-profile-name">
                  {profileUser.name || user?.email}
                </h2>
                <p className="text-muted-foreground mb-3" data-testid="text-profile-email">
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
                    Member since {new Date(profileUser.createdAt || '').toLocaleDateString()}
                  </Badge>
                </div>
                {user?.role === 'student' && profileUser?.studentLinkCode && (
                  <div className="mt-4 p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Users className="h-4 w-4" />
                      <span>Guardian Link Code</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="text-lg font-mono font-bold tracking-wider">
                        {profileUser.studentLinkCode}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          navigator.clipboard.writeText(profileUser.studentLinkCode || '');
                          toast({
                            title: "Copied!",
                            description: "Link code copied to clipboard",
                          });
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Share this code with your parent/guardian to link accounts
                    </p>
                  </div>
                )}
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
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 bg-secondary/60">
            <TabsTrigger value="profile" data-testid="tab-profile">
              <User className="h-4 w-4 mr-2" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="progress" data-testid="tab-progress">
              <TrendingUp className="h-4 w-4 mr-2" />
              Progress
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
                      value={profileUser?.name || ''}
                      disabled
                      data-testid="input-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      value={profileUser?.username || ''}
                      disabled
                      data-testid="input-username"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      value={user?.email || ''}
                      disabled
                      data-testid="input-email"
                    />
                    <p className="text-xs text-muted-foreground">
                      Email cannot be changed as it's linked to your Google account
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
                  Your account is secured with Google OAuth
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    <Shield className="h-5 w-5 text-green-500" />
                    <div>
                      <p className="font-medium">Google OAuth</p>
                      <p className="text-sm text-muted-foreground">
                        Secured with Google authentication
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">Active</Badge>
                </div>
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    Your account is protected by Google's security infrastructure.
                    You can manage your password and 2FA settings in your Google account.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Request Role Change</CardTitle>
                <CardDescription>
                  Role changes are support-mediated and are not applied directly in-app.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    No in-product role switch is available. Use this request form to draft an email to {SUPPORT_EMAIL}.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label htmlFor="role-switch-target">Requested Role</Label>
                  <Select
                    value={roleSwitchTarget}
                    onValueChange={(value) => setRoleSwitchTarget(value as RoleSwitchTarget)}
                  >
                    <SelectTrigger id="role-switch-target" data-testid="select-role-switch-target">
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
                    onChange={(event) => setRoleSwitchMessage(event.target.value)}
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

          {/* Progress Tab */}
          <TabsContent value="progress" className="space-y-6">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Detailed progress tracking on this page is intentionally disabled until the rebuild is complete.
                Visit the Dashboard for the current live KPI truth.
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-yellow-500" />
                    Overall Score
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-primary" data-testid="text-overall-score">
                    —
                  </div>
                  <p className="text-sm text-muted-foreground">Check Dashboard</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-blue-500" />
                    Questions Answered
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-primary" data-testid="text-questions-total">
                    —
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Check Dashboard
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-green-500" />
                    Study Time
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-primary" data-testid="text-study-time">
                    —
                  </div>
                  <p className="text-sm text-muted-foreground">Check Dashboard</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Subject Progress</CardTitle>
                <CardDescription>
                  Your progress across different SAT sections
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <EmptyState
                  title="Coming Soon"
                  description="Subject-specific progress tracking will be available soon. Keep practicing!"
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  Notifications
                </CardTitle>
                <CardDescription>
                  Configure how you receive updates and reminders
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Notification settings UI is not yet wired to a persistent backend contract.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Data & Privacy</CardTitle>
                <CardDescription>
                  Manage your data and privacy preferences
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Data export/reset/delete controls are intentionally withheld until safe ownership flows are finalized.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Billing Tab */}
          <TabsContent value="billing" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Subscription
                </CardTitle>
                <CardDescription>
                  Manage your subscription and billing information
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Plan details are not runtime-backed on this page yet. Use the guardian dashboard paywall and billing portal flow for live subscription state.
                  </AlertDescription>
                </Alert>

                <Alert>
                  <Star className="h-4 w-4" />
                  <AlertDescription>
                    Billing management is currently handled outside this settings surface.
                    When in-product controls are fully runtime-backed, they will appear here.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

