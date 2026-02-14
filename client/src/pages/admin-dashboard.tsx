import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  RefreshCw, CheckCircle, AlertCircle, Loader, BarChart3, 
  Files, Settings, Database, BookOpen, Target, Brain, Clock,
  PieChart, TrendingUp, HelpCircle
} from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { SafeBoundary } from '@/components/common/SafeBoundary';
import { AdminGuard } from "@/components/auth/AdminGuard";

interface IngestionStats {
  questions: {
    total: number;
    freeResponse: number;
    undefinedType: number;
    multipleChoice: number;
    sectionsCount: number;
    uniqueDocuments: number;
  };
  sections: Array<{
    name: string;
    count: number;
  }>;
  documents: {
    total: number;
    recentUploads: number;
  };
  system: {
    lastUpdated: string;
    ocrProvider: string;
    embedProvider: string;
  };
}

interface StatsResponse {
  success: boolean;
  stats: IngestionStats;
  timestamp: string;
}

export default function AdminDashboard() {
  // Fetch ingestion statistics
  const { data: statsData, isLoading: statsLoading, refetch: refetchStats } = useQuery<StatsResponse>({
    queryKey: ['/api/admin/stats'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const stats = statsData?.stats;
  const isLoading = statsLoading;

  const getQuestionTypeCard = (title: string, count: number, icon: React.ComponentType<any>, color: string) => {
    const Icon = icon;
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <Icon className={`h-4 w-4 ${color}`} />
        </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${color}`} data-testid={`text-${title.toLowerCase().replace(/\s/g, '-')}`}>
          {isLoading ? <Loader className="w-6 h-6 animate-spin" /> : count}
        </div>
      </CardContent>
    </Card>
    );
  };

  const getSectionBadge = (section: { name: string; count: number }) => {
    const colors = {
      'Math': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      'Reading': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      'Reading and Writing': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
    };
    
    return (
      <Badge 
        variant="outline" 
        className={colors[section.name as keyof typeof colors] || 'bg-gray-100 text-gray-800'}
        data-testid={`badge-section-${section.name.toLowerCase().replace(/\s/g, '-')}`}
      >
        {section.name}: {section.count}
      </Badge>
    );
  };

  return (
    <SafeBoundary fallback={<div className="p-6">Admin page failed to load.</div>}>
      <AdminGuard>
        <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="border-b bg-card/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground" data-testid="text-admin-dashboard">
                Admin Dashboard
              </h1>
              <p className="text-muted-foreground mt-1">
                SAT Learning Copilot - Ingestion Statistics & System Overview
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Button
                onClick={() => refetchStats()}
                variant="outline"
                size="sm"
                disabled={isLoading}
                data-testid="button-refresh"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Link href="/admin-pdf-monitor">
                <Button variant="outline" size="sm" data-testid="link-pdf-monitor">
                  <BarChart3 className="w-4 h-4 mr-2" />
                  PDF Monitor
                </Button>
              </Link>
              <Link href="/admin-system-config">
                <Button variant="outline" size="sm" data-testid="link-system-config">
                  <Settings className="w-4 h-4 mr-2" />
                  System Config
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Questions Statistics Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {getQuestionTypeCard("Total Questions", stats?.questions.total || 0, Database, "text-blue-600")}
          {getQuestionTypeCard("Free Response", stats?.questions.freeResponse || 0, Target, "text-green-600")}
          {getQuestionTypeCard("Multiple Choice", stats?.questions.multipleChoice || 0, CheckCircle, "text-purple-600")}
          {getQuestionTypeCard("Need Review", stats?.questions.undefinedType || 0, HelpCircle, "text-orange-600")}
        </div>

        {/* System Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                SAT Sections
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Total Sections:</span>
                  <Badge variant="outline" data-testid="text-sections-count">
                    {stats?.questions.sectionsCount || 0}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {stats?.sections.map((section) => getSectionBadge(section)) || (
                    <span className="text-sm text-muted-foreground">No sections data</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Files className="h-5 w-5" />
                Document Sources
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Unique Documents:</span>
                  <span className="text-2xl font-bold" data-testid="text-unique-documents">
                    {stats?.questions.uniqueDocuments || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Total Documents:</span>
                  <span className="text-sm font-medium" data-testid="text-total-documents">
                    {stats?.documents.total || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Recent Uploads:</span>
                  <span className="text-sm font-medium" data-testid="text-recent-uploads">
                    {stats?.documents.recentUploads || 0}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                System Configuration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">OCR Provider:</span>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700" data-testid="text-ocr-provider">
                    {stats?.system.ocrProvider?.toUpperCase() || 'AUTO'}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Embed Provider:</span>
                  <Badge variant="outline" className="bg-green-50 text-green-700" data-testid="text-embed-provider">
                    {stats?.system.embedProvider?.toUpperCase() || 'GEMINI'}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Last Updated:</span>
                  <span className="text-xs text-muted-foreground" data-testid="text-last-updated">
                    {stats?.system.lastUpdated ? format(new Date(stats.system.lastUpdated), 'MMM dd, HH:mm') : 'N/A'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detailed Statistics */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5" />
              Ingestion Performance Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600 mb-2" data-testid="text-ingestion-success-rate">
                  {stats ? Math.round(((stats.questions.freeResponse + stats.questions.multipleChoice) / Math.max(stats.questions.total, 1)) * 100) : 0}%
                </div>
                <div className="text-sm text-muted-foreground">Processing Success Rate</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {stats?.questions.freeResponse || 0} + {stats?.questions.multipleChoice || 0} categorized
                </div>
              </div>
              
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600 mb-2" data-testid="text-questions-per-document">
                  {stats ? Math.round((stats.questions.total / Math.max(stats.questions.uniqueDocuments, 1))) : 0}
                </div>
                <div className="text-sm text-muted-foreground">Avg Questions/Document</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Extraction efficiency metric
                </div>
              </div>
              
              <div className="text-center">
                <div className="text-3xl font-bold text-purple-600 mb-2" data-testid="text-section-coverage">
                  {stats?.questions.sectionsCount || 0}/3
                </div>
                <div className="text-sm text-muted-foreground">SAT Section Coverage</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Math, Reading, Writing covered
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="border-t pt-6 mt-6">
              <div className="flex flex-wrap gap-3">
                <Link href="/admin-questions">
                  <Button variant="outline" size="sm" data-testid="link-manage-questions">
                    <Database className="w-4 h-4 mr-2" />
                    Manage Questions
                  </Button>
                </Link>
                
                <Link href="/admin-ingest-jobs">
                  <Button variant="outline" size="sm" data-testid="link-ingest-jobs">
                    <TrendingUp className="w-4 h-4 mr-2" />
                    View Ingest Jobs
                  </Button>
                </Link>
                
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => window.open('/api/health', '_blank')}
                  data-testid="button-system-health"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  System Health
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Status Footer */}
        <div className="mt-8 text-center text-sm text-muted-foreground">
          <div className="flex items-center justify-center gap-2">
            <Clock className="w-4 h-4" />
            <span>Last updated: {statsData?.timestamp ? format(new Date(statsData.timestamp), 'MMM dd, yyyy HH:mm:ss') : 'Never'}</span>
          </div>
          {stats && (
            <div className="mt-2">
              <span>Database contains {stats.questions.total} questions across {stats.questions.sectionsCount} SAT sections from {stats.questions.uniqueDocuments} unique documents</span>
            </div>
          )}
        </div>
      </div>
    </div>
      </AdminGuard>
    </SafeBoundary>
  );
}