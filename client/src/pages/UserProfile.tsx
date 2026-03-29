import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Switch } from '@/components/ui/switch';
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
import { apiRequest } from '@/lib/queryClient';
import { SUPPORT_EMAIL } from '@/lib/support-contact';
import type { NotificationDigestFrequency, UserNotificationPreferences } from '@shared/schema';

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

interface NotificationPreferencesFormState {
  emailEnabled: boolean;
  studyRemindersEnabled: boolean;
  streakEnabled: boolean;
  planUpdatesEnabled: boolean;
  guardianUpdatesEnabled: boolean;
  marketingEnabled: boolean;
  digestFrequency: NotificationDigestFrequency;
  quietHoursStart: string;
  quietHoursEnd: string;
}

const DEFAULT_NOTIFICATION_PREFERENCES_FORM: NotificationPreferencesFormState = {
  emailEnabled: false,
  studyRemindersEnabled: true,
  streakEnabled: true,
  planUpdatesEnabled: true,
  guardianUpdatesEnabled: true,
  marketingEnabled: false,
  digestFrequency: 'daily',
  quietHoursStart: '',
  quietHoursEnd: '',
};

function readQuietHoursPreference(value: UserNotificationPreferences['quietHours']): {
  start: string;
  end: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { start: '', end: '' };
  }

  const record = value as Record<string, unknown>;

  return {
    start: typeof record.start === 'string' ? record.start : '',
    end: typeof record.end === 'string' ? record.end : '',
  };
}

function notificationPreferencesToForm(
  preferences: UserNotificationPreferences | null | undefined,
): NotificationPreferencesFormState {
  if (!preferences) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES_FORM };
  }

  const quietHours = readQuietHoursPreference(preferences.quietHours);

  return {
    emailEnabled: preferences.emailEnabled,
    studyRemindersEnabled: preferences.studyRemindersEnabled,
    streakEnabled: preferences.streakEnabled,
    planUpdatesEnabled: preferences.planUpdatesEnabled,
    guardianUpdatesEnabled: preferences.guardianUpdatesEnabled,
    marketingEnabled: preferences.marketingEnabled,
    digestFrequency: preferences.digestFrequency,
    quietHoursStart: quietHours.start,
    quietHoursEnd: quietHours.end,
  };
}

function formStateToPreferencesPayload(formState: NotificationPreferencesFormState) {
  const quietHoursStart = formState.quietHoursStart.trim();
  const quietHoursEnd = formState.quietHoursEnd.trim();

  return {
    emailEnabled: formState.emailEnabled,
    studyRemindersEnabled: formState.studyRemindersEnabled,
    streakEnabled: formState.streakEnabled,
    planUpdatesEnabled: formState.planUpdatesEnabled,
    guardianUpdatesEnabled: formState.guardianUpdatesEnabled,
    marketingEnabled: formState.marketingEnabled,
    digestFrequency: formState.digestFrequency,
    quietHours:
      quietHoursStart && quietHoursEnd
        ? { start: quietHoursStart, end: quietHoursEnd }
        : null,
  };
}

function areNotificationPreferencesEqual(
  a: NotificationPreferencesFormState,
  b: NotificationPreferencesFormState,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function formatMemberSince(createdAt?: string): string {
  if (!createdAt) return "Unavailable";
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return parsed.toLocaleDateString();
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
  const [notificationPreferencesForm, setNotificationPreferencesForm] = useState<NotificationPreferencesFormState>(
    DEFAULT_NOTIFICATION_PREFERENCES_FORM,
  );

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

  const {
    data: notificationPreferencesResponse,
    isLoading: notificationPreferencesLoading,
    isError: notificationPreferencesError,
    error: notificationPreferencesErrorObj,
    refetch: refetchNotificationPreferences,
  } = useQuery<{ preferences: UserNotificationPreferences }>({
    queryKey: ['/api/notifications/preferences'],
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
  const notificationPreferences = notificationPreferencesResponse?.preferences ?? null;

  const currentRole = user?.role || 'student';
  const accountEmail = user?.email || profileUser?.email || '';
  const accountName = profileUser?.name || user?.display_name || '';
  const memberSinceLabel = formatMemberSince(profileUser?.createdAt);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'profile' || tab === 'progress' || tab === 'settings' || tab === 'billing') {
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

  useEffect(() => {
    setNotificationPreferencesForm(notificationPreferencesToForm(notificationPreferences));
  }, [notificationPreferences]);

  const notificationPreferencesBaseline = notificationPreferencesToForm(notificationPreferences);
  const notificationPreferencesDirty = !areNotificationPreferencesEqual(
    notificationPreferencesForm,
    notificationPreferencesBaseline,
  );

  const updateNotificationPreferencesMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('/api/notifications/preferences', {
        method: 'PATCH',
        body: JSON.stringify(formStateToPreferencesPayload(notificationPreferencesForm)),
      });

      return response.json() as Promise<{ preferences: UserNotificationPreferences }>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['/api/notifications/preferences'], data);
      setNotificationPreferencesForm(notificationPreferencesToForm(data.preferences));
      toast({
        title: 'Notification preferences saved',
        description: 'Your reminder and delivery preferences are now persisted.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Unable to save notification preferences',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    },
  });

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
                    Member since {memberSinceLabel}
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
                    This account is protected by runtime authentication controls.
                    Use the password reset/update flow for credential changes when using email sign-in.
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
                  Notification Preferences
                </CardTitle>
                <CardDescription>
                  Load and save persisted notification preferences for this account.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {notificationPreferencesLoading ? (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>Loading saved notification preferences...</AlertDescription>
                  </Alert>
                ) : notificationPreferencesError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="flex items-center justify-between gap-3">
                      <span>
                        {(notificationPreferencesErrorObj as Error)?.message ?? 'Failed to load notification preferences.'}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => refetchNotificationPreferences()}>
                        Retry
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-lg border p-4 flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <Label className="text-base">Email notifications</Label>
                          <p className="text-sm text-muted-foreground">
                            Allow notification delivery by email when the writer emits email-origin updates.
                          </p>
                        </div>
                        <Switch
                          checked={notificationPreferencesForm.emailEnabled}
                          onCheckedChange={(checked) =>
                            setNotificationPreferencesForm((current) => ({ ...current, emailEnabled: checked }))
                          }
                          data-testid="switch-email-notifications"
                        />
                      </div>

                      <div className="rounded-lg border p-4 flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <Label className="text-base">Study reminders</Label>
                          <p className="text-sm text-muted-foreground">
                            Keep study-plan nudges and reminders on for active planning windows.
                          </p>
                        </div>
                        <Switch
                          checked={notificationPreferencesForm.studyRemindersEnabled}
                          onCheckedChange={(checked) =>
                            setNotificationPreferencesForm((current) => ({ ...current, studyRemindersEnabled: checked }))
                          }
                          data-testid="switch-study-reminders"
                        />
                      </div>

                      <div className="rounded-lg border p-4 flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <Label className="text-base">Streak updates</Label>
                          <p className="text-sm text-muted-foreground">
                            Receive streak milestones and recovery nudges.
                          </p>
                        </div>
                        <Switch
                          checked={notificationPreferencesForm.streakEnabled}
                          onCheckedChange={(checked) =>
                            setNotificationPreferencesForm((current) => ({ ...current, streakEnabled: checked }))
                          }
                          data-testid="switch-streak-notifications"
                        />
                      </div>

                      <div className="rounded-lg border p-4 flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <Label className="text-base">Plan updates</Label>
                          <p className="text-sm text-muted-foreground">
                            Send plan-generated and plan-refreshed updates.
                          </p>
                        </div>
                        <Switch
                          checked={notificationPreferencesForm.planUpdatesEnabled}
                          onCheckedChange={(checked) =>
                            setNotificationPreferencesForm((current) => ({ ...current, planUpdatesEnabled: checked }))
                          }
                          data-testid="switch-plan-updates"
                        />
                      </div>

                      <div className="rounded-lg border p-4 flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <Label className="text-base">Guardian updates</Label>
                          <p className="text-sm text-muted-foreground">
                            Share guardian-specific updates when they are emitted.
                          </p>
                        </div>
                        <Switch
                          checked={notificationPreferencesForm.guardianUpdatesEnabled}
                          onCheckedChange={(checked) =>
                            setNotificationPreferencesForm((current) => ({ ...current, guardianUpdatesEnabled: checked }))
                          }
                          data-testid="switch-guardian-updates"
                        />
                      </div>

                      <div className="rounded-lg border p-4 flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <Label className="text-base">Marketing</Label>
                          <p className="text-sm text-muted-foreground">
                            Opt into non-study marketing notifications.
                          </p>
                        </div>
                        <Switch
                          checked={notificationPreferencesForm.marketingEnabled}
                          onCheckedChange={(checked) =>
                            setNotificationPreferencesForm((current) => ({ ...current, marketingEnabled: checked }))
                          }
                          data-testid="switch-marketing-notifications"
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="digest-frequency">Digest frequency</Label>
                        <Select
                          value={notificationPreferencesForm.digestFrequency}
                          onValueChange={(value) =>
                            setNotificationPreferencesForm((current) => ({
                              ...current,
                              digestFrequency: value as NotificationDigestFrequency,
                            }))
                          }
                        >
                          <SelectTrigger id="digest-frequency" data-testid="select-digest-frequency">
                            <SelectValue placeholder="Select digest frequency" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="never">Never</SelectItem>
                            <SelectItem value="daily">Daily</SelectItem>
                            <SelectItem value="weekly">Weekly</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Quiet hours</Label>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label htmlFor="quiet-hours-start" className="text-xs uppercase tracking-wide text-muted-foreground">
                              Start
                            </Label>
                            <Input
                              id="quiet-hours-start"
                              type="time"
                              value={notificationPreferencesForm.quietHoursStart}
                              onChange={(event) =>
                                setNotificationPreferencesForm((current) => ({
                                  ...current,
                                  quietHoursStart: event.target.value,
                                }))
                              }
                              data-testid="input-quiet-hours-start"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="quiet-hours-end" className="text-xs uppercase tracking-wide text-muted-foreground">
                              End
                            </Label>
                            <Input
                              id="quiet-hours-end"
                              type="time"
                              value={notificationPreferencesForm.quietHoursEnd}
                              onChange={(event) =>
                                setNotificationPreferencesForm((current) => ({
                                  ...current,
                                  quietHoursEnd: event.target.value,
                                }))
                              }
                              data-testid="input-quiet-hours-end"
                            />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Leave both blank to disable quiet hours.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        onClick={() => updateNotificationPreferencesMutation.mutate()}
                        disabled={!notificationPreferencesDirty || updateNotificationPreferencesMutation.isPending}
                        data-testid="button-save-notification-preferences"
                      >
                        {updateNotificationPreferencesMutation.isPending ? 'Saving...' : 'Save preferences'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setNotificationPreferencesForm(notificationPreferencesBaseline)}
                        disabled={!notificationPreferencesDirty || updateNotificationPreferencesMutation.isPending}
                        data-testid="button-reset-notification-preferences"
                      >
                        Reset
                      </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Changes persist to the canonical `user_notification_preferences` table and drive the central writer.
                    </p>
                  </div>
                )}
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

