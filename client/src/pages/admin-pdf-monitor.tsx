import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Activity, RefreshCw, Clock, Zap, AlertTriangle, CheckCircle, 
  Loader, FileText, Database, Cpu, BarChart3, TrendingUp,
  Timer, Brain, Eye, Settings
} from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { SafeBoundary } from '@/components/common/SafeBoundary';
import { AdminGuard } from "@/components/auth/AdminGuard";

interface ProcessingDocument {
  id: string;
  filename: string;
  originalName: string;
  status: 'processing' | 'completed' | 'failed';
  uploadedAt: string;
  processedAt?: string;
  extractionMethod?: string;
  extractionConfidence?: number;
  totalQuestions?: number;
  pageCount?: number;
  size: number;
}

interface IngestionRun {
  id: string;
  source_pdf?: string;
  status: string;
  created_at: string;
  completed_at?: string;
  error_message?: string;
  questions_extracted?: number;
}

interface ProcessingStats {
  statusDistribution: Array<{ status: string; count: number; avg_processing_time?: number }>;
  extractionMethods: Array<{ extraction_method: string; count: number; avg_confidence?: number }>;
  recentActivity: Array<{ date: string; uploads: number; completed: number }>;
}

interface StatsResponse {
  success: boolean;
  stats: ProcessingStats;
}

interface PDFStatusResponse {
  success: boolean;
  documents: ProcessingDocument[];
  ingestionRuns: IngestionRun[];
  statistics: Array<{ status: string; count: number; avg_processing_time?: number }>;
}

export default function AdminPDFMonitor() {
  const [activeTab, setActiveTab] = useState("live");

  // Fetch PDF processing status with high refresh rate for real-time monitoring
  const { data: pdfStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery<PDFStatusResponse>({
    queryKey: ['/api/admin/pdf/status'],
    refetchInterval: 5000, // Refresh every 5 seconds for real-time updates
  });

  // Fetch document statistics
  const { data: statsData, isLoading: statsLoading } = useQuery<StatsResponse>({
    queryKey: ['/api/admin/documents/stats'],
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'processing':
        return <Loader className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'failed':
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      default:
        return <FileText className="w-4 h-4 text-gray-500" />;
    }
  };

  const getExtractionMethodIcon = (method?: string) => {
    switch (method) {
      case 'nougat':
        return <Brain className="w-4 h-4 text-purple-500" />;
      case 'document-ai':
        return <Eye className="w-4 h-4 text-blue-500" />;
      case 'mathpix':
        return <Zap className="w-4 h-4 text-green-500" />;
      case 'pdf-js':
        return <FileText className="w-4 h-4 text-orange-500" />;
      case 'tesseract':
        return <Cpu className="w-4 h-4 text-gray-500" />;
      default:
        return <Database className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const formatDuration = (start: string, end?: string) => {
    if (!end) {
      const elapsed = Math.floor((Date.now() - new Date(start).getTime()) / 1000);
      return `${elapsed}s (ongoing)`;
    }
    const duration = Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000);
    if (duration < 60) return `${duration}s`;
    if (duration < 3600) return `${Math.floor(duration / 60)}m ${duration % 60}s`;
    return `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const processingDocs = pdfStatus?.documents?.filter(doc => doc.status === 'processing') || [];
  const recentDocs = pdfStatus?.documents?.slice(0, 20) || [];
  const ingestionRuns = pdfStatus?.ingestionRuns || [];
  const stats = statsData?.stats || { statusDistribution: [], extractionMethods: [], recentActivity: [] };

  // Calculate live statistics
  const totalProcessing = processingDocs.length;
  const avgProcessingTime = pdfStatus?.statistics?.find(s => s.status === 'processing')?.avg_processing_time || 0;

  return (
    <SafeBoundary fallback={<div className="p-6">Admin page failed to load.</div>}>
      <AdminGuard>
        <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground" data-testid="text-pdf-monitor">
                PDF Processing Monitor
              </h1>
              <p className="text-muted-foreground mt-1">
                Real-time monitoring of PDF processing pipeline and extraction methods
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Button
                onClick={() => refetchStatus()}
                variant="outline"
                size="sm"
                disabled={statusLoading}
                data-testid="button-refresh"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${statusLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Link href="/admin-dashboard">
                <Button variant="outline" size="sm" data-testid="link-admin-dashboard">
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Dashboard
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
        {/* Live Status Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Processing</CardTitle>
              <Activity className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600" data-testid="text-active-processing">
                {totalProcessing}
              </div>
              <p className="text-xs text-muted-foreground">
                PDFs currently being processed
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Processing Time</CardTitle>
              <Timer className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600" data-testid="text-avg-time">
                {avgProcessingTime ? Math.round(avgProcessingTime / 60) : 0}m
              </div>
              <p className="text-xs text-muted-foreground">
                Current processing time
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Today's Uploads</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600" data-testid="text-todays-uploads">
                {stats.recentActivity[0]?.uploads || 0}
              </div>
              <p className="text-xs text-muted-foreground">
                PDFs uploaded today
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600" data-testid="text-success-rate">
                {stats.statusDistribution.length > 0 
                  ? Math.round((Number(stats.statusDistribution.find((s: any) => s.status === 'completed')?.count || 0) / 
                      stats.statusDistribution.reduce((sum: number, s: any) => sum + Number(s.count), 0)) * 100) 
                  : 0}%
              </div>
              <p className="text-xs text-muted-foreground">
                Successful processing rate
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="live" data-testid="tab-live">Live Processing</TabsTrigger>
            <TabsTrigger value="recent" data-testid="tab-recent">Recent Activity</TabsTrigger>
            <TabsTrigger value="methods" data-testid="tab-methods">Extraction Methods</TabsTrigger>
            <TabsTrigger value="queue" data-testid="tab-queue">Processing Queue</TabsTrigger>
          </TabsList>

          {/* Live Processing Tab */}
          <TabsContent value="live" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Live Processing Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                {statusLoading ? (
                  <div className="text-center py-8">
                    <Loader className="w-6 h-6 animate-spin mx-auto mb-2" />
                    <p className="text-muted-foreground">Loading processing status...</p>
                  </div>
                ) : processingDocs.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
                    <p className="text-muted-foreground">No documents currently processing</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {processingDocs.map((doc) => (
                      <div key={doc.id} className="border rounded-lg p-4 bg-muted/25" data-testid={`processing-doc-${doc.id}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(doc.status)}
                            <span className="font-medium text-sm">{doc.originalName}</span>
                          </div>
                          <Badge variant="outline">
                            {formatDuration(doc.uploadedAt)}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-muted-foreground">
                          <div>
                            <span className="block font-medium">Size</span>
                            {formatFileSize(doc.size)}
                          </div>
                          <div>
                            <span className="block font-medium">Pages</span>
                            {doc.pageCount || 'Unknown'}
                          </div>
                          <div>
                            <span className="block font-medium">Method</span>
                            <div className="flex items-center gap-1 mt-1">
                              {getExtractionMethodIcon(doc.extractionMethod)}
                              {doc.extractionMethod || 'Determining...'}
                            </div>
                          </div>
                          <div>
                            <span className="block font-medium">Progress</span>
                            <div className="mt-1">
                              <Progress value={doc.extractionMethod ? 75 : 25} className="h-2" />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Recent Activity Tab */}
          <TabsContent value="recent" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Recent Processing Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {recentDocs.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between p-3 border rounded" data-testid={`recent-doc-${doc.id}`}>
                      <div className="flex items-center gap-3">
                        {getStatusIcon(doc.status)}
                        <div>
                          <div className="font-medium text-sm">{doc.originalName}</div>
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(doc.uploadedAt), 'MMM dd, HH:mm')}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1">
                          {getExtractionMethodIcon(doc.extractionMethod)}
                          <span>{doc.extractionMethod || 'N/A'}</span>
                        </div>
                        <div className="text-muted-foreground">
                          {doc.processedAt ? formatDuration(doc.uploadedAt, doc.processedAt) : 'N/A'}
                        </div>
                        <div>
                          {doc.totalQuestions ? `${doc.totalQuestions} Q` : 'No Q'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Extraction Methods Tab */}
          <TabsContent value="methods" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Extraction Method Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {stats.extractionMethods.map((method: any, index: number) => (
                    <div key={index} className="flex items-center justify-between p-4 border rounded" data-testid={`method-${method.extraction_method}`}>
                      <div className="flex items-center gap-3">
                        {getExtractionMethodIcon(method.extraction_method)}
                        <div>
                          <div className="font-medium capitalize">{method.extraction_method}</div>
                          <div className="text-sm text-muted-foreground">
                            {method.count} documents processed
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">
                          {Math.round(Number(method.avg_confidence || 0))}% confidence
                        </div>
                        <Progress 
                          value={Number(method.avg_confidence || 0)} 
                          className="w-24 h-2 mt-1" 
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Processing Queue Tab */}
          <TabsContent value="queue" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Ingestion Runs</CardTitle>
              </CardHeader>
              <CardContent>
                {ingestionRuns.length === 0 ? (
                  <div className="text-center py-8">
                    <Database className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-muted-foreground">No ingestion runs found</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {ingestionRuns.map((run) => (
                      <div key={run.id} className="flex items-center justify-between p-3 border rounded" data-testid={`ingestion-run-${run.id}`}>
                        <div>
                          <div className="font-medium text-sm">{run.source_pdf || `Run ${run.id.slice(0, 8)}`}</div>
                          <div className="text-xs text-muted-foreground">
                            Started: {format(new Date(run.created_at), 'MMM dd, HH:mm')}
                            {run.questions_extracted !== undefined && ` • ${run.questions_extracted} questions`}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={run.status === 'completed' ? 'default' : run.status === 'failed' ? 'destructive' : 'secondary'}>
                            {run.status}
                          </Badge>
                          {run.completed_at && (
                            <span className="text-xs text-muted-foreground">
                              {formatDuration(run.created_at, run.completed_at)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
      </AdminGuard>
    </SafeBoundary>
  );
}