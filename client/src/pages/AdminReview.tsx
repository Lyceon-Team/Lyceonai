import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, XCircle, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { SafeBoundary } from '@/components/common/SafeBoundary';
import { AdminGuard } from '@/components/auth/AdminGuard';

interface ParsingMetadata {
  anchorsDetected?: string[];
  patternMatches?: Record<string, boolean>;
  warnings?: string[];
  originalText?: string;
}

interface Question {
  id: string;
  stem: string;
  options?: Array<{ key: string; text: string }>;
  answer: string;
  explanation?: string;
  confidence?: number;
  needsReview?: boolean;
  parsingMetadata?: ParsingMetadata;
  section?: string;
  difficulty?: string;
}

interface Statistics {
  total: number;
  averageConfidence: number;
  needsReview: number;
  reviewed: number;
  pending: number;
  confidenceDistribution: {
    low: number;
    medium: number;
    high: number;
  };
}

interface StatisticsResponse {
  success: boolean;
  statistics: Statistics;
}

interface QuestionsResponse {
  success: boolean;
  questions: Question[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export default function AdminReview() {
  const { toast } = useToast();
  const [page, setPage] = useState(0);
  const limit = 10;

  // Fetch statistics
  const { data: statsData, isError: statsError, error: statsErrorObj, refetch: refetchStats } = useQuery<StatisticsResponse>({
    queryKey: ['/api/admin/questions/statistics'],
  });

  // Fetch questions needing review - encode pagination in URL
  const { data: questionsData, isLoading, isError: questionsError, error: questionsErrorObj, refetch } = useQuery<QuestionsResponse>({
    queryKey: [`/api/admin/questions/needs-review?limit=${limit}&offset=${page * limit}`],
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/admin/questions/${id}/approve`, { method: 'POST' });
    },
    onSuccess: () => {
      // Invalidate all paginated needs-review queries
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/admin/questions/needs-review');
        }
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/questions/statistics'] });
      toast({
        title: 'Question approved',
        description: 'The question has been approved successfully.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to approve question',
        variant: 'destructive',
      });
    },
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/admin/questions/${id}/reject`, { method: 'POST' });
    },
    onSuccess: () => {
      // Invalidate all paginated needs-review queries
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/admin/questions/needs-review');
        }
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/questions/statistics'] });
      toast({
        title: 'Question rejected',
        description: 'The question has been deleted.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to reject question',
        variant: 'destructive',
      });
    },
  });

  const statistics: Statistics | undefined = statsData?.statistics;
  const questions: Question[] = questionsData?.questions || [];
  const pagination = questionsData?.pagination || { total: 0, hasMore: false };

  const getConfidenceBadge = (confidence?: number) => {
    if (!confidence) return null;
    const percent = Math.round(confidence * 100);
    if (confidence >= 0.8) {
      return <Badge variant="default" className="bg-green-500">High ({percent}%)</Badge>;
    } else if (confidence >= 0.6) {
      return <Badge variant="secondary">Medium ({percent}%)</Badge>;
    } else {
      return <Badge variant="destructive">Low ({percent}%)</Badge>;
    }
  };

  return (
    <SafeBoundary fallback={<div className="p-6">Admin page failed to load.</div>}>
      <AdminGuard>
        <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-admin-review-title">Admin Question Review</h1>
        <p className="text-muted-foreground">Review and approve questions parsed with low confidence</p>
      </div>

      {/* Statistics Cards */}
      {statistics && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card data-testid="card-stat-total">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Questions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{statistics.total}</div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-pending">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-500">{statistics.pending}</div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-reviewed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Reviewed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">{statistics.reviewed}</div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-avg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Avg Confidence</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{(statistics.averageConfidence * 100).toFixed(1)}%</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Error Alerts */}
      {statsError && (
        <Alert variant="destructive" className="mb-4" data-testid="alert-stats-error">
          <AlertDescription>
            Failed to load statistics: {(statsErrorObj as any)?.message || 'Unknown error'}
            <Button onClick={() => refetchStats()} variant="outline" size="sm" className="ml-2" data-testid="button-retry-stats">
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {questionsError && (
        <Alert variant="destructive" className="mb-4" data-testid="alert-questions-error">
          <AlertDescription>
            Failed to load questions: {(questionsErrorObj as any)?.message || 'Unknown error'}
            <Button onClick={() => refetch()} variant="outline" size="sm" className="ml-2" data-testid="button-retry">
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Questions List */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold mb-4" data-testid="text-questions-header">
          Questions Needing Review ({pagination?.total || 0})
        </h2>

        {questionsError ? null : isLoading ? (
          <>
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2 mt-2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-20 w-full" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : questions.length === 0 ? (
          <Alert data-testid="alert-no-questions">
            <AlertDescription>
              No questions need review at this time. Great job!
            </AlertDescription>
          </Alert>
        ) : (
          questions.map((question) => (
            <Card key={question.id} data-testid={`card-question-${question.id}`}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <CardTitle className="text-lg">Question ID: {question.id}</CardTitle>
                      {getConfidenceBadge(question.confidence)}
                      {question.needsReview && (
                        <Badge variant="outline" className="border-orange-500 text-orange-500">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Needs Review
                        </Badge>
                      )}
                    </div>
                    <CardDescription>
                      Section: {question.section || 'N/A'} | Difficulty: {question.difficulty || 'N/A'}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Question Stem */}
                <div>
                  <h4 className="font-semibold mb-2">Question:</h4>
                  <p className="text-sm" data-testid={`text-stem-${question.id}`}>{question.stem}</p>
                </div>

                {/* Options */}
                {question.options && question.options.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">Options:</h4>
                    <div className="space-y-1">
                      {question.options.map((opt) => (
                        <div 
                          key={opt.key} 
                          className={`text-sm p-2 rounded ${opt.key === question.answer ? 'bg-green-50 border border-green-200' : 'bg-gray-50'}`}
                          data-testid={`option-${question.id}-${opt.key}`}
                        >
                          <span className="font-semibold">{opt.key})</span> {opt.text}
                          {opt.key === question.answer && (
                            <Badge variant="default" className="ml-2 bg-green-500">Correct</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Answer */}
                <div>
                  <h4 className="font-semibold mb-1">Answer:</h4>
                  <p className="text-sm font-mono" data-testid={`text-answer-${question.id}`}>{question.answer}</p>
                </div>

                {/* Parsing Metadata */}
                {question.parsingMetadata && (
                  <div className="bg-gray-50 p-3 rounded text-xs">
                    <h4 className="font-semibold mb-2">Parsing Details:</h4>
                    {question.parsingMetadata.anchorsDetected && (
                      <p className="mb-1">
                        <span className="font-medium">Anchors:</span> {question.parsingMetadata.anchorsDetected.join(', ')}
                      </p>
                    )}
                    {question.parsingMetadata.warnings && question.parsingMetadata.warnings.length > 0 && (
                      <p className="text-orange-600">
                        <span className="font-medium">Warnings:</span> {question.parsingMetadata.warnings.join(', ')}
                      </p>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => approveMutation.mutate(question.id)}
                    disabled={approveMutation.isPending}
                    className="bg-green-500 hover:bg-green-600"
                    data-testid={`button-approve-${question.id}`}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Approve
                  </Button>
                  <Button
                    onClick={() => rejectMutation.mutate(question.id)}
                    disabled={rejectMutation.isPending}
                    variant="destructive"
                    data-testid={`button-reject-${question.id}`}
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}

        {/* Pagination */}
        {pagination.total > limit && (
          <div className="flex justify-between items-center pt-4">
            <Button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              variant="outline"
              data-testid="button-prev-page"
            >
              <ChevronLeft className="w-4 h-4 mr-2" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {Math.ceil(pagination.total / limit)}
            </span>
            <Button
              onClick={() => setPage((p) => p + 1)}
              disabled={!pagination.hasMore}
              variant="outline"
              data-testid="button-next-page"
            >
              Next
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        )}
      </div>
    </div>
      </AdminGuard>
    </SafeBoundary>
  );
}
