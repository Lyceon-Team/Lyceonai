import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, CheckCircle2, XCircle, RefreshCw, Loader2 } from 'lucide-react';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface IngestionJob {
  jobId: string;
  status: string;
  progress: number;
  sourcePdfs: string[];
  totalQuestions?: number;
  insertedQuestions?: number;
  needsReviewCount?: number;
  queuedAt: string;
  completedAt?: string;
  errorMessage?: string;
  multipleChoiceCount?: number;
  freeResponseCount?: number;
  validationSkipped?: number;
}

export default function AdminIngestPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { toast } = useToast();

  // Fetch all jobs from v3 API
  const { data: jobsData, isLoading } = useQuery<{ jobs: IngestionJob[] }>({
    queryKey: ['/api/ingest-llm/jobs'],
    refetchInterval: 3000, // Poll every 3 seconds
  });

  // Upload mutation - uses v3 API
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      
      const adminToken = import.meta.env.VITE_INGEST_ADMIN_TOKEN || 'changeme';
      
      const response = await fetch('/api/ingest/pdf', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Upload successful',
        description: 'PDF processing started',
      });
      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ['/api/ingest-llm/jobs'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Upload failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Retry mutation - uses v3 API
  const retryMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const adminToken = import.meta.env.VITE_INGEST_ADMIN_TOKEN || 'changeme';
      const response = await fetch(`/api/ingest-llm/retry/${jobId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Retry failed');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: 'Job retry initiated' });
      queryClient.invalidateQueries({ queryKey: ['/api/ingest-llm/jobs'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Retry failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== 'application/pdf') {
        toast({
          title: 'Invalid file type',
          description: 'Please select a PDF file',
          variant: 'destructive',
        });
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      uploadMutation.mutate(selectedFile);
    }
  };

  const getStatusColor = (status: string) => {
    const statusMap: Record<string, string> = {
      'queued': 'bg-gray-500',
      'ocr_docai': 'bg-blue-500',
      'parsing': 'bg-yellow-500',
      'qa': 'bg-purple-500',
      'embed': 'bg-indigo-500',
      'done': 'bg-green-500',
      'failed': 'bg-red-500',
    };
    return statusMap[status] || 'bg-gray-500';
  };

  const getStatusLabel = (status: string) => {
    const labelMap: Record<string, string> = {
      'queued': 'Queued',
      'ocr_docai': 'OCR Processing',
      'parsing': 'Parsing Questions',
      'qa': 'QA Validation',
      'embed': 'Generating Embeddings',
      'done': 'Completed',
      'failed': 'Failed',
    };
    return labelMap[status] || status;
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">PDF Ingestion v3</h1>
          <p className="text-muted-foreground mt-1">Upload and process SAT practice PDFs</p>
        </div>
      </div>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload PDF
          </CardTitle>
          <CardDescription>
            Select a SAT practice PDF to process through the ingestion pipeline
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <label 
              htmlFor="pdf-upload" 
              className="flex-1 cursor-pointer"
              data-testid="label-pdf-upload"
            >
              <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors">
                {selectedFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="h-8 w-8 text-primary" />
                    <div>
                      <p className="font-medium" data-testid="text-selected-filename">{selectedFile.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Click to select a PDF file
                    </p>
                  </div>
                )}
              </div>
              <input
                id="pdf-upload"
                type="file"
                accept="application/pdf"
                onChange={handleFileSelect}
                className="hidden"
                data-testid="input-pdf-file"
              />
            </label>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || uploadMutation.isPending}
              data-testid="button-upload-pdf"
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload & Process
                </>
              )}
            </Button>
            {selectedFile && (
              <Button 
                variant="outline" 
                onClick={() => setSelectedFile(null)}
                data-testid="button-clear-file"
              >
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Jobs List */}
      <Card>
        <CardHeader>
          <CardTitle>Ingestion Jobs</CardTitle>
          <CardDescription>
            Monitor the status of all PDF processing jobs
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : !jobsData?.jobs || jobsData.jobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No ingestion jobs found. Upload a PDF to get started.
            </div>
          ) : (
            <div className="space-y-4">
              {jobsData.jobs.map((job) => (
                <Card key={job.jobId} data-testid={`card-job-${job.jobId}`}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className={getStatusColor(job.status)}>
                            {getStatusLabel(job.status)}
                          </Badge>
                          {job.status === 'done' && (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          )}
                          {job.status === 'failed' && (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground" data-testid={`text-job-id-${job.jobId}`}>
                          Job ID: {job.jobId.substring(0, 8)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Started: {new Date(job.queuedAt).toLocaleString()}
                        </p>
                      </div>

                      {job.status === 'failed' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => retryMutation.mutate(job.jobId)}
                          disabled={retryMutation.isPending}
                          data-testid={`button-retry-${job.jobId}`}
                        >
                          <RefreshCw className="h-4 w-4 mr-1" />
                          Retry
                        </Button>
                      )}
                    </div>

                    {/* Progress Bar */}
                    {job.status !== 'done' && job.status !== 'failed' && (
                      <div className="space-y-2 mb-4">
                        <div className="flex justify-between text-sm">
                          <span>Progress</span>
                          <span className="font-medium">{job.progress}%</span>
                        </div>
                        <Progress value={job.progress} data-testid={`progress-job-${job.jobId}`} />
                      </div>
                    )}

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Questions Found</p>
                        <p className="text-lg font-semibold" data-testid={`stat-questions-${job.jobId}`}>
                          {job.totalQuestions || 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Inserted</p>
                        <p className="text-lg font-semibold text-green-600" data-testid={`stat-inserted-${job.jobId}`}>
                          {job.insertedQuestions || 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Needs Review</p>
                        <p className="text-lg font-semibold text-yellow-600" data-testid={`stat-review-${job.jobId}`}>
                          {job.needsReviewCount || 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Skipped</p>
                        <p className="text-lg font-semibold text-red-600" data-testid={`stat-skipped-${job.jobId}`}>
                          {job.validationSkipped || 0}
                        </p>
                      </div>
                    </div>

                    {/* Error Message */}
                    {job.errorMessage && (
                      <div className="mt-4 p-3 bg-red-50 dark:bg-red-950 rounded-md">
                        <p className="text-sm text-red-600 dark:text-red-400" data-testid={`error-message-${job.jobId}`}>
                          {job.errorMessage}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
