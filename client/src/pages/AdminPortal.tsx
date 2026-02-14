/**
 * Admin Portal - Streamlined administrative interface
 * Provides dashboard stats, PDF upload, and job monitoring
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  FileText, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  Activity,
  Upload, 
  Shield, 
  BarChart3, 
  Zap
} from 'lucide-react';
import AdminV4Operations from './admin-v4-operations';
import { SafeBoundary } from '@/components/common/SafeBoundary';
import { AdminGuard } from '@/components/auth/AdminGuard';
import { AdminPDFUpload } from '@/components/admin/AdminPDFUpload';

export function AdminPortal() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const queryClient = useQueryClient();

  // Dashboard stats
  const { data: dashboardStats, isLoading: statsLoading, error: statsError } = useQuery<{
    questions: { total: number; needsReview: number };
    ingestion: { total: number; pending: number; completed: number; failed: number };
    practice: { recentSessions: number };
  }>({
    queryKey: ['/api/admin/stats'],
    refetchInterval: 30000,
  });

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle }> = {
      'completed': { variant: 'default', icon: CheckCircle },
      'processing': { variant: 'secondary', icon: Activity },
      'pending': { variant: 'outline', icon: Clock },
      'failed': { variant: 'destructive', icon: AlertCircle }
    };
    
    const config = statusConfig[status] || statusConfig['pending'];
    const Icon = config.icon;
    
    return (
      <Badge variant={config.variant} className="inline-flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {status}
      </Badge>
    );
  };

  return (
    <SafeBoundary fallback={<div className="p-6">Admin page failed to load.</div>}>
      <AdminGuard>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
          <div className="container mx-auto px-4 py-8">
            {/* Header */}
            <div className="mb-8">
              <div className="flex items-center space-x-3 mb-4">
                <Shield className="w-8 h-8 text-blue-600" />
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                  Admin Portal
                </h1>
                <Badge variant="outline" className="ml-auto">
                  Full Backend Access
                </Badge>
              </div>
              <p className="text-gray-600 dark:text-gray-400">
                Monitor ingestion jobs, upload PDFs, and view system statistics.
              </p>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="dashboard" className="flex items-center gap-2" data-testid="tab-dashboard">
                  <BarChart3 className="w-4 h-4" />
                  Dashboard
                </TabsTrigger>
                <TabsTrigger value="pdf" className="flex items-center gap-2" data-testid="tab-pdf">
                  <FileText className="w-4 h-4" />
                  PDF Upload
                </TabsTrigger>
                <TabsTrigger value="v4" className="flex items-center gap-2" data-testid="tab-v4">
                  <Zap className="w-4 h-4" />
                  V4 Generator
                </TabsTrigger>
              </TabsList>

              {/* Dashboard Tab */}
              <TabsContent value="dashboard" className="space-y-6">
                {/* Error State */}
                {statsError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Failed to load dashboard statistics. Please try refreshing the page.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Total Questions</CardTitle>
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold" data-testid="stat-questions">
                        {statsLoading ? '...' : dashboardStats?.questions?.total || 0}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        SAT practice questions
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Needs Review</CardTitle>
                      <AlertCircle className="h-4 w-4 text-amber-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-amber-600" data-testid="stat-needs-review">
                        {statsLoading ? '...' : dashboardStats?.questions?.needsReview || 0}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Questions needing validation
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Active Jobs</CardTitle>
                      <Activity className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-blue-600" data-testid="stat-active-jobs">
                        {statsLoading ? '...' : (dashboardStats?.ingestion?.pending || 0)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Processing in queue
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Recent Sessions</CardTitle>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-green-600" data-testid="stat-sessions">
                        {statsLoading ? '...' : dashboardStats?.practice?.recentSessions || 0}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Practice sessions (24h)
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Ingestion Status */}
                {dashboardStats?.ingestion && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Ingestion Pipeline Status</CardTitle>
                      <CardDescription>
                        PDF processing jobs and their current status
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-4 gap-4">
                        <div className="text-center p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                          <div className="text-2xl font-bold">{dashboardStats.ingestion.total}</div>
                          <div className="text-sm text-gray-500">Total Jobs</div>
                        </div>
                        <div className="text-center p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                          <div className="text-2xl font-bold text-amber-600">{dashboardStats.ingestion.pending}</div>
                          <div className="text-sm text-gray-500">Pending</div>
                        </div>
                        <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                          <div className="text-2xl font-bold text-green-600">{dashboardStats.ingestion.completed}</div>
                          <div className="text-sm text-gray-500">Completed</div>
                        </div>
                        <div className="text-center p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                          <div className="text-2xl font-bold text-red-600">{dashboardStats.ingestion.failed}</div>
                          <div className="text-sm text-gray-500">Failed</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* PDF Upload Tab - Uses AdminPDFUpload for full v3 metrics */}
              <TabsContent value="pdf" className="space-y-6">
                <AdminPDFUpload />

                {/* V4 Generator Reference */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="w-5 h-5" />
                      Processing Monitor
                    </CardTitle>
                    <CardDescription>
                      View generation status in the V4 Generator tab for real-time updates
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center py-4">
                      <p className="text-gray-500 mb-4">
                        After uploading PDFs, switch to the V4 Generator tab to generate questions.
                      </p>
                      <Button 
                        variant="outline" 
                        onClick={() => setActiveTab('v4')}
                        data-testid="button-view-v4"
                      >
                        <Zap className="w-4 h-4 mr-2" />
                        Open V4 Generator
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* V4 Operations Tab */}
              <TabsContent value="v4" className="space-y-6">
                <AdminV4Operations />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </AdminGuard>
    </SafeBoundary>
  );
}
