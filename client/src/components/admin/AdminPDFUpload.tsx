/**
 * AdminPDFUpload - PDF Ingestion component for admin users
 * 
 * Uses v3 ingestion endpoints exclusively:
 * - POST /api/ingest/pdf (upload)
 * - GET /api/ingest-llm/status/:jobId (status)
 * - GET /api/ingest-llm/jobs (jobs list)
 */

import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { 
  Upload, FileText, CheckCircle, XCircle, Clock, 
  RefreshCw, AlertCircle, Loader2, ChevronDown, ChevronUp
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface IngestionJob {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  questionsImported?: number;
  error?: string | null;
  createdAt?: string;
  finishedAt?: string;
  metrics?: {
    totalDocAiDrafts?: number;
    docAiGoodCount?: number;
    needsVisionFallbackCount?: number;
    visionUsedCount?: number;
    finalAcceptedCount?: number;
    finalRejectedCount?: number;
    timings?: {
      totalMs?: number;
      docaiMs?: number;
      parseMs?: number;
      qa1Ms?: number;
      visionMs?: number;
      qa2Ms?: number;
    };
  };
}

export function AdminPDFUpload() {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [showJobs, setShowJobs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: jobs = [], isLoading: jobsLoading } = useQuery<IngestionJob[]>({
    queryKey: ['/api/ingest-llm/jobs'],
    refetchInterval: activeJobId ? 5000 : false,
  });

  const { data: activeJob } = useQuery<IngestionJob>({
    queryKey: ['/api/ingest-llm/status', activeJobId],
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 3000;
      return data.status === 'processing' || data.status === 'pending' ? 3000 : false;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      const adminToken = import.meta.env.VITE_INGEST_ADMIN_TOKEN || 'changeme';
      
      const response = await fetch('/api/ingest/pdf', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
        },
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Upload failed');
      }

      return response.json();
    },
    onSuccess: (data) => {
      setActiveJobId(data.jobId);
      queryClient.invalidateQueries({ queryKey: ['/api/ingest-llm/jobs'] });
      toast({
        title: 'Upload Started',
        description: `Job ${data.jobId} is processing. Questions will be imported shortly.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Upload Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      setIsUploading(true);
      uploadMutation.mutate(file, {
        onSettled: () => setIsUploading(false),
      });
    } else {
      toast({
        title: 'Invalid File',
        description: 'Please upload a PDF file.',
        variant: 'destructive',
      });
    }
  }, [uploadMutation]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsUploading(true);
      uploadMutation.mutate(file, {
        onSettled: () => setIsUploading(false),
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      case 'processing':
        return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Processing</Badge>;
      default:
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    }
  };

  const isActiveJobComplete = activeJob?.status === 'completed' || activeJob?.status === 'failed';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          PDF Ingestion
        </CardTitle>
        <CardDescription>
          Upload SAT practice PDFs for question extraction (v3 pipeline)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`
            border-2 border-dashed rounded-lg p-8 text-center transition-colors
            ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
            ${isUploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}
          `}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => !isUploading && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
          
          {isUploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Uploading...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <FileText className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium">Drop a PDF here or click to browse</p>
              <p className="text-sm text-muted-foreground">Supports SAT practice test PDFs</p>
            </div>
          )}
        </div>

        {activeJob && (
          <div className="p-4 border rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">Current Job: {activeJob.jobId}</span>
              {getStatusBadge(activeJob.status)}
            </div>

            {activeJob.status === 'processing' && (
              <Progress value={33} className="h-2" />
            )}

            {isActiveJobComplete && activeJob.metrics && (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Questions Found:</span>
                  <span className="font-medium">{activeJob.metrics.totalDocAiDrafts || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Imported:</span>
                  <span className="font-medium text-green-600">{activeJob.questionsImported || activeJob.metrics.finalAcceptedCount || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rejected:</span>
                  <span className="font-medium text-red-600">{activeJob.metrics.finalRejectedCount || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Time:</span>
                  <span className="font-medium">{activeJob.metrics.timings?.totalMs ? `${(activeJob.metrics.timings.totalMs / 1000).toFixed(1)}s` : '-'}</span>
                </div>
              </div>
            )}

            {activeJob.status === 'failed' && activeJob.error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
                <AlertCircle className="h-4 w-4 inline mr-1" />
                {activeJob.error}
              </div>
            )}
          </div>
        )}

        <Separator />

        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowJobs(!showJobs)}
            className="w-full justify-between"
          >
            <span className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Recent Jobs ({jobs.length})
            </span>
            {showJobs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>

          {showJobs && (
            <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
              {jobsLoading ? (
                <div className="text-center py-4 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                </div>
              ) : jobs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No ingestion jobs yet</p>
              ) : (
                jobs.slice(0, 10).map((job) => (
                  <div
                    key={job.jobId}
                    className="flex items-center justify-between p-2 border rounded text-sm"
                  >
                    <div>
                      <code className="text-xs">{job.jobId}</code>
                      <p className="text-muted-foreground text-xs">
                        {job.questionsImported || 0} questions
                      </p>
                    </div>
                    {getStatusBadge(job.status)}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default AdminPDFUpload;
