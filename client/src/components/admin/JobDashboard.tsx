import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { 
  RefreshCw, 
  Database, 
  CheckCircle, 
  XCircle, 
  Clock,
  AlertTriangle,
  BarChart3,
  Settings,
  Filter
} from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import RouteTracer from '@/components/dev/RouteTracer';
import { SafeBoundary } from '@/components/common/SafeBoundary';
import { AdminGuard } from '@/components/auth/AdminGuard';

interface IngestJob {
  jobId: string
  status: 'queued' | 'running' | 'done' | 'failed'
  total?: number
  processed?: number                     // Legacy field - now means "inserted count"
  insertedCount?: number                 // New: count of newly inserted items  
  duplicatesCount?: number               // New: count of duplicate items skipped
  totalProcessed?: number                // New: total items processed (inserted + duplicates)
  // Task G: Per-type metrics for MC/FR support
  multipleChoiceCount?: number           // MC questions processed 
  freeResponseCount?: number             // FR questions processed
  validationSkipped?: number             // Questions that failed validation
  error?: string
  createdAt: string
  updatedAt: string
}

interface JobStats {
  totalJobs: number
  successfulJobs: number
  failedJobs: number
  runningJobs: number
  questionsProcessed: number
  questionsInserted: number
  questionsDuplicated: number
  // Task G: Per-type aggregated statistics
  multipleChoiceProcessed: number        // Total MC questions across all jobs
  freeResponseProcessed: number          // Total FR questions across all jobs
  validationSkippedTotal: number         // Total validation failures across all jobs
}

export function JobDashboard() {
  const [jobs, setJobs] = useState<IngestJob[]>([])
  const [filteredJobs, setFilteredJobs] = useState<IngestJob[]>([])
  const [typeFilter, setTypeFilter] = useState<string>('all') // Task G: Type filter
  const [stats, setStats] = useState<JobStats>({
    totalJobs: 0,
    successfulJobs: 0,
    failedJobs: 0,
    runningJobs: 0,
    questionsProcessed: 0,
    questionsInserted: 0,
    questionsDuplicated: 0,
    // Task G: Initialize per-type statistics
    multipleChoiceProcessed: 0,
    freeResponseProcessed: 0,
    validationSkippedTotal: 0
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Task G: Filter jobs by question type
  const filterJobs = (allJobs: IngestJob[], filter: string) => {
    switch (filter) {
      case 'mc-only':
        return allJobs.filter(job => 
          (job.multipleChoiceCount || 0) > 0 && (job.freeResponseCount || 0) === 0
        );
      case 'fr-only':
        return allJobs.filter(job => 
          (job.freeResponseCount || 0) > 0 && (job.multipleChoiceCount || 0) === 0
        );
      case 'mixed':
        return allJobs.filter(job => 
          (job.multipleChoiceCount || 0) > 0 && (job.freeResponseCount || 0) > 0
        );
      case 'all':
      default:
        return allJobs;
    }
  };

  const fetchJobs = async () => {
    try {
      setLoading(true)
      // Fetch real job data from the v3 API using Supabase session (cookie-based auth)
      const response = await fetch('/api/ingest/jobs', {
        credentials: 'include', // Include session cookies for Supabase auth
      })
      
      if (!response.ok) {
        throw new Error(`Failed to fetch jobs: ${response.status} ${response.statusText}`)
      }
      
      const jobs: IngestJob[] = await response.json()
      setJobs(jobs)
      
      // Task G: Apply filtering
      const filtered = filterJobs(jobs, typeFilter);
      setFilteredJobs(filtered);
      
      // Calculate stats from real job data using enhanced metrics
      const stats: JobStats = {
        totalJobs: jobs.length,
        successfulJobs: jobs.filter(j => j.status === 'done').length,
        failedJobs: jobs.filter(j => j.status === 'failed').length,
        runningJobs: jobs.filter(j => j.status === 'running').length,
        // Use enhanced metrics when available, fallback to legacy for old jobs
        questionsProcessed: jobs.reduce((sum, job) => sum + (job.totalProcessed || job.processed || 0), 0),
        questionsInserted: jobs.reduce((sum, job) => sum + (job.insertedCount || job.processed || 0), 0),
        questionsDuplicated: jobs.reduce((sum, job) => sum + (job.duplicatesCount || 0), 0),
        // Task G: Calculate per-type aggregated statistics
        multipleChoiceProcessed: jobs.reduce((sum, job) => sum + (job.multipleChoiceCount || 0), 0),
        freeResponseProcessed: jobs.reduce((sum, job) => sum + (job.freeResponseCount || 0), 0),
        validationSkippedTotal: jobs.reduce((sum, job) => sum + (job.validationSkipped || 0), 0)
      }
      setStats(stats)
      setError(null)
      
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const createTestJob = async () => {
    try {
      const response = await fetch('/api/ingest-llm/test', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include session cookies for Supabase auth
        body: JSON.stringify({ maxQuestions: 3 })
      })
      
      const result = await response.json()
      
      if (response.ok) {
        await fetchJobs() // Refresh jobs after creating
      } else {
        setError(result.error || 'Failed to create job')
      }
    } catch (err: any) {
      setError(err.message)
    }
  }

  const retryFailedJob = async (jobId: string) => {
    try {
      const response = await fetch(`/api/ingest-llm/retry/${jobId}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include session cookies for Supabase auth
      });
      
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to retry job');
      }
      
      await fetchJobs();
    } catch (err: any) {
      setError(err.message);
    }
  }

  // Task G: Apply filtering when typeFilter changes
  useEffect(() => {
    if (jobs.length > 0) {
      const filtered = filterJobs(jobs, typeFilter);
      setFilteredJobs(filtered);
    }
  }, [typeFilter, jobs]);

  useEffect(() => {
    fetchJobs()
    // Poll for updates every 10 seconds
    const interval = setInterval(fetchJobs, 10000)
    return () => clearInterval(interval)
  }, [])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'done': return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'failed': return <XCircle className="h-4 w-4 text-red-500" />
      case 'running': return <Clock className="h-4 w-4 text-blue-500" />
      default: return <Clock className="h-4 w-4 text-gray-400" />
    }
  }

  const getStatusBadge = (status: string) => {
    const variants = {
      done: 'default',
      failed: 'destructive',
      running: 'secondary',
      queued: 'outline'
    } as const
    
    return (
      <Badge variant={variants[status as keyof typeof variants] || 'outline'}>
        {status.toUpperCase()}
      </Badge>
    )
  }

  return (
    <SafeBoundary fallback={<div className="p-6">Admin page failed to load.</div>}>
      <RouteTracer name="/admin-ingest-jobs" />
      <AdminGuard>
        <div className="space-y-6" data-testid="job-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Job Dashboard</h2>
          <p className="text-muted-foreground">
            Monitor ingestion jobs and question processing pipeline
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {/* Task G: Type filter dropdown */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40" data-testid="select-type-filter">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Jobs</SelectItem>
                <SelectItem value="mc-only">MC Only</SelectItem>
                <SelectItem value="fr-only">FR Only</SelectItem>
                <SelectItem value="mixed">Mixed (MC + FR)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <Button 
            variant="outline" 
            size="sm" 
            onClick={fetchJobs}
            disabled={loading}
            data-testid="button-refresh-jobs"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button 
            size="sm" 
            onClick={createTestJob}
            data-testid="button-create-test-job"
          >
            <Settings className="h-4 w-4 mr-2" />
            Create Test Job
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Jobs</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total-jobs">
              {stats.totalJobs}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Successful</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="stat-successful-jobs">
              {stats.successfulJobs}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600" data-testid="stat-failed-jobs">
              {stats.failedJobs}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Questions Processed</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-questions-processed">
              {stats.questionsProcessed}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Questions Inserted</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="stat-questions-inserted">
              {stats.questionsInserted}
            </div>
            <p className="text-xs text-muted-foreground">New questions added</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Duplicates Skipped</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600" data-testid="stat-questions-duplicated">
              {stats.questionsDuplicated}
            </div>
            <p className="text-xs text-muted-foreground">Already existed</p>
          </CardContent>
        </Card>

        {/* Task G: Per-type question metrics */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Multiple Choice</CardTitle>
            <CheckCircle className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600" data-testid="stat-multiple-choice-processed">
              {stats.multipleChoiceProcessed}
            </div>
            <p className="text-xs text-muted-foreground">MC questions processed</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Free Response</CardTitle>
            <Database className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600" data-testid="stat-free-response-processed">
              {stats.freeResponseProcessed}
            </div>
            <p className="text-xs text-muted-foreground">FR questions processed</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Validation Failed</CardTitle>
            <XCircle className="h-4 w-4 text-gray-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-600" data-testid="stat-validation-skipped">
              {stats.validationSkippedTotal}
            </div>
            <p className="text-xs text-muted-foreground">Questions skipped</p>
          </CardContent>
        </Card>
      </div>

      {/* Error Display */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-800 flex items-center">
              <AlertTriangle className="h-4 w-4 mr-2" />
              Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-700" data-testid="error-message">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Jobs List */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Jobs</CardTitle>
          <CardDescription>
            Ingestion jobs and their current status
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && jobs.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin mr-2" />
              Loading jobs...
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No jobs found. Create a test job to get started.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredJobs.map((job) => (
                <div 
                  key={job.jobId}
                  className="flex items-center justify-between p-4 border rounded-lg"
                  data-testid={`job-${job.jobId}`}
                >
                  <div className="flex items-center space-x-4">
                    {getStatusIcon(job.status)}
                    <div>
                      <div className="font-medium">Job {job.jobId}</div>
                      <div className="text-sm text-muted-foreground">
                        Created {new Date(job.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-4">
                    {job.total && (
                      <div className="text-right min-w-[120px]">
                        <div className="text-sm">
                          {job.processed || 0} / {job.total} questions
                        </div>
                        <Progress 
                          value={((job.processed || 0) / job.total) * 100} 
                          className="w-24 h-2 mt-1"
                        />
                      </div>
                    )}
                    
                    <div className="flex items-center space-x-2">
                      {getStatusBadge(job.status)}
                      
                      {job.status === 'failed' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => retryFailedJob(job.jobId)}
                          data-testid={`button-retry-${job.jobId}`}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Retry
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  {job.error && (
                    <div className="w-full mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                      <strong>Error:</strong> {job.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
      </AdminGuard>
    </SafeBoundary>
  )
}