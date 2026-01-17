import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/app-shell';
import { PageCard } from '@/components/common/page-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { 
  User, Settings, CreditCard, Bell, Shield, LogOut, 
  Edit3, Save, Camera, Mail, Phone, MapPin, Calendar,
  Trophy, Target, BookOpen, Clock, TrendingUp, Star,
  Download, Upload, RefreshCw, AlertCircle, CheckCircle,
  Eye, EyeOff, Trash2, RotateCcw, FileText, Copy, Users
} from 'lucide-react';
import { AdminPDFUpload } from '@/components/admin/AdminPDFUpload';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';

interface UserProfile {
  id: string;
  username?: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  isAdmin?: boolean;
  createdAt?: string;
  lastLoginAt?: string;
}

interface UserStats {
  totalQuestions: number;
  correctAnswers: number;
  averageScore: number;
  studyTime: number;
  streak: number;
  mathProgress: number;
  readingProgress: number;
  writingProgress: number;
}

interface NotificationSettings {
  emailNotifications: boolean;
  pushNotifications: boolean;
  studyReminders: boolean;
  progressUpdates: boolean;
  weeklyReports: boolean;
}

export default function UserProfile() {
  const [activeTab, setActiveTab] = useState('profile');
  const [isEditing, setIsEditing] = useState(false);
  const [editedProfile, setEditedProfile] = useState<Partial<UserProfile>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { user, signOut } = useSupabaseAuth();

  // Get user stats
  const { data: userProfile, isLoading: profileLoading } = useQuery<{ user: UserProfile; authenticated: boolean }>({
    queryKey: ['/api/auth/user'],
    enabled: !!user,
  });

  // Get user stats
  const { data: userStats } = useQuery<UserStats>({
    queryKey: ['/api/progress/detailed'],
    enabled: !!userProfile?.authenticated,
  });

  // Get notification settings
  const { data: notificationSettings, isLoading: settingsLoading } = useQuery<NotificationSettings>({
    queryKey: ['/api/user/notification-settings'],
    enabled: !!userProfile?.authenticated,
  });

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (updates: Partial<UserProfile>) => {
      return apiRequest('/api/user/profile', {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      setIsEditing(false);
      toast({
        title: "Profile Updated",
        description: "Your profile has been successfully updated.",
      });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update your profile. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Update notification settings mutation
  const updateNotificationsMutation = useMutation({
    mutationFn: async (settings: NotificationSettings) => {
      return apiRequest('/api/user/notification-settings', {
        method: 'PATCH',
        body: JSON.stringify(settings),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user/notification-settings'] });
      toast({
        title: "Settings Updated",
        description: "Your notification preferences have been saved.",
      });
    },
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

  useEffect(() => {
    if (userProfile?.user) {
      setEditedProfile(userProfile.user);
    }
  }, [userProfile]);

  const handleProfileSave = () => {
    updateProfileMutation.mutate(editedProfile);
  };

  const handleNotificationChange = (key: keyof NotificationSettings, value: boolean) => {
    if (!notificationSettings) return;
    
    const updatedSettings = {
      ...notificationSettings,
      [key]: value,
    };
    updateNotificationsMutation.mutate(updatedSettings);
  };

  const profileUser = userProfile?.user;

  return (
    <AppShell>
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8 max-w-6xl">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="page-title">
            Profile & Settings
          </h1>
          <p className="text-muted-foreground">
            Manage your account, track your progress, and customize your experience
          </p>
        </div>
        {/* Profile Header */}
        {profileUser && (
          <PageCard className="mb-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <div className="relative">
                <Avatar className="h-24 w-24">
                  <AvatarImage src={profileUser.avatarUrl} alt={profileUser.name || user?.email} />
                  <AvatarFallback className="text-lg">
                    {profileUser.name?.charAt(0) || user?.email?.charAt(0) || 'U'}
                  </AvatarFallback>
                </Avatar>
                <Button
                  size="icon"
                  variant="outline"
                  className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full"
                  data-testid="button-change-avatar"
                >
                  <Camera className="h-4 w-4" />
                </Button>
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
                {user?.role === 'student' && user?.student_link_code && (
                  <div className="mt-4 p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Users className="h-4 w-4" />
                      <span>Guardian Link Code</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="text-lg font-mono font-bold tracking-wider">
                        {user.student_link_code}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          navigator.clipboard.writeText(user.student_link_code || '');
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
          <TabsList className="grid w-full grid-cols-4">
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
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Personal Information</CardTitle>
                    <CardDescription>
                      Manage your personal details and account information
                    </CardDescription>
                  </div>
                  <Button
                    variant={isEditing ? "default" : "outline"}
                    onClick={isEditing ? handleProfileSave : () => setIsEditing(true)}
                    disabled={updateProfileMutation.isPending}
                    data-testid={isEditing ? "button-save" : "button-edit"}
                  >
                    {isEditing ? (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        {updateProfileMutation.isPending ? 'Saving...' : 'Save'}
                      </>
                    ) : (
                      <>
                        <Edit3 className="h-4 w-4 mr-2" />
                        Edit
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input
                      id="name"
                      value={isEditing ? editedProfile.name || '' : profileUser?.name || ''}
                      onChange={(e) => setEditedProfile(prev => ({ ...prev, name: e.target.value }))}
                      disabled={!isEditing}
                      data-testid="input-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      value={isEditing ? editedProfile.username || '' : profileUser?.username || ''}
                      onChange={(e) => setEditedProfile(prev => ({ ...prev, username: e.target.value }))}
                      disabled={!isEditing}
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
          </TabsContent>

          {/* Progress Tab */}
          <TabsContent value="progress" className="space-y-6">
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
                    {userStats?.averageScore || 0}%
                  </div>
                  <p className="text-sm text-muted-foreground">Average performance</p>
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
                    {userStats?.totalQuestions || 0}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {userStats?.correctAnswers || 0} correct
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
                    {Math.round((userStats?.studyTime || 0) / 60)}h
                  </div>
                  <p className="text-sm text-muted-foreground">Total practice time</p>
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
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Math</span>
                    <span>{userStats?.mathProgress || 0}%</span>
                  </div>
                  <Progress value={userStats?.mathProgress || 0} className="h-2" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Reading</span>
                    <span>{userStats?.readingProgress || 0}%</span>
                  </div>
                  <Progress value={userStats?.readingProgress || 0} className="h-2" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Writing</span>
                    <span>{userStats?.writingProgress || 0}%</span>
                  </div>
                  <Progress value={userStats?.writingProgress || 0} className="h-2" />
                </div>
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
                {notificationSettings && Object.entries(notificationSettings).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor={key} className="text-sm font-medium">
                        {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {key === 'emailNotifications' && 'Receive notifications via email'}
                        {key === 'pushNotifications' && 'Receive browser push notifications'}
                        {key === 'studyReminders' && 'Get reminders to study'}
                        {key === 'progressUpdates' && 'Receive progress milestone updates'}
                        {key === 'weeklyReports' && 'Get weekly progress reports'}
                      </p>
                    </div>
                    <Switch
                      id={key}
                      checked={value}
                      onCheckedChange={(checked) => handleNotificationChange(key as keyof NotificationSettings, checked)}
                      data-testid={`switch-${key.toLowerCase()}`}
                    />
                  </div>
                ))}
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
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Export Your Data</p>
                    <p className="text-sm text-muted-foreground">
                      Download all your practice data and progress
                    </p>
                  </div>
                  <Button variant="outline" data-testid="button-export-data">
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </Button>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Reset Progress</p>
                    <p className="text-sm text-muted-foreground">
                      Clear all practice history and start fresh
                    </p>
                  </div>
                  <Button variant="outline" data-testid="button-reset-progress">
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Reset
                  </Button>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-destructive">Delete Account</p>
                    <p className="text-sm text-muted-foreground">
                      Permanently delete your account and all data
                    </p>
                  </div>
                  <Button variant="destructive" data-testid="button-delete-account">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Admin-only PDF Ingestion */}
            {profileUser?.isAdmin && (
              <AdminPDFUpload />
            )}
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
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">Free Plan</h3>
                      <p className="text-sm text-muted-foreground">
                        Access to basic SAT practice features
                      </p>
                    </div>
                    <Badge variant="secondary">Current Plan</Badge>
                  </div>
                </div>
                
                <Alert>
                  <Star className="h-4 w-4" />
                  <AlertDescription>
                    Upgrade to Premium for unlimited practice tests, detailed analytics, 
                    and personalized study plans.
                  </AlertDescription>
                </Alert>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Premium Monthly</CardTitle>
                      <CardDescription>Best for short-term intensive study</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">$19.99/month</div>
                      <ul className="mt-4 space-y-1 text-sm">
                        <li>✓ Unlimited practice tests</li>
                        <li>✓ Detailed performance analytics</li>
                        <li>✓ Personalized study plans</li>
                        <li>✓ Priority support</li>
                      </ul>
                      <Button className="w-full mt-4" data-testid="button-upgrade-monthly">
                        Choose Monthly
                      </Button>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Premium Annual</CardTitle>
                      <CardDescription>Save 40% with annual billing</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">$11.99/month</div>
                      <div className="text-sm text-muted-foreground">Billed annually at $143.88</div>
                      <ul className="mt-4 space-y-1 text-sm">
                        <li>✓ Everything in Monthly</li>
                        <li>✓ Save 40% annually</li>
                        <li>✓ Free SAT prep book (PDF)</li>
                        <li>✓ Exclusive webinars</li>
                      </ul>
                      <Button className="w-full mt-4" data-testid="button-upgrade-annual">
                        Choose Annual
                        <Badge variant="secondary" className="ml-2">Best Value</Badge>
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}