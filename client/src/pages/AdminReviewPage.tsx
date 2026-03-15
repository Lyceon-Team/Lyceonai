import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle, XCircle, Edit, AlertTriangle, Loader2 } from 'lucide-react';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface Question {
  id: string;
  stem: string;
  options?: Array<{ key: string; text: string }>;
  answer: string;
  section: string;
  difficulty: string;
  questionType: string;
  needsReview: boolean;
  validationIssues?: ValidationIssue[];
}

interface ValidationIssue {
  severity: string;
  issueType: string;
  description: string;
}

export default function AdminReviewPage() {
  const [selectedTab, setSelectedTab] = useState('needs-review');
  const { toast } = useToast();

  // Fetch questions needing review
  const { data: reviewData, isLoading: reviewLoading } = useQuery<{ questions: Question[] }>({
    queryKey: ['/api/admin/questions/needs-review'],
    enabled: selectedTab === 'needs-review',
  });

  // Fetch duplicate questions
  const { data: duplicatesData, isLoading: duplicatesLoading } = useQuery({
    queryKey: ['/api/admin/questions/duplicates'],
    enabled: selectedTab === 'duplicates',
  });

  // Fetch statistics
  const { data: statsData } = useQuery({
    queryKey: ['/api/admin/questions/statistics'],
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async (questionId: string) => {
      return await apiRequest(`/api/admin/questions/${questionId}/approve`, 'POST');
    },
    onSuccess: () => {
      toast({ title: 'Question approved' });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/questions/needs-review'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/questions/statistics'] });
    },
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async (questionId: string) => {
      return await apiRequest(`/api/admin/questions/${questionId}/reject`, 'POST', {
        reason: 'Quality issue',
      });
    },
    onSuccess: () => {
      toast({ title: 'Question rejected' });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/questions/needs-review'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/questions/statistics'] });
    },
  });

  const getSeverityColor = (severity: string) => {
    const colorMap: Record<string, string> = {
      'error': 'bg-red-500',
      'warning': 'bg-yellow-500',
      'info': 'bg-blue-500',
    };
    return colorMap[severity] || 'bg-gray-500';
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Question Review</h1>
          <p className="text-muted-foreground mt-1">Review and approve imported questions</p>
        </div>
      </div>

      {/* Statistics Cards */}
      {statsData && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Questions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="stat-total-questions">
                {statsData.counts?.total || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Needs Review</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600" data-testid="stat-needs-review">
                {statsData.counts?.needsReview || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Approved</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600" data-testid="stat-approved">
                {statsData.counts?.approved || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Multiple Choice</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="stat-mc-questions">
                {statsData.counts?.multipleChoice || 0}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Review Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList>
          <TabsTrigger value="needs-review" data-testid="tab-needs-review">
            Needs Review ({statsData?.counts?.needsReview || 0})
          </TabsTrigger>
          <TabsTrigger value="duplicates" data-testid="tab-duplicates">
            Duplicates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="needs-review" className="mt-6">
          {reviewLoading ? (
            <div className="text-center py-12">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : !reviewData?.questions || reviewData.questions.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <div className="text-center text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
                  <p className="text-lg font-medium">All caught up!</p>
                  <p className="text-sm">No questions need review at the moment.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {reviewData.questions.map((question) => (
                <Card key={question.id} data-testid={`card-question-${question.id}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge>{question.section}</Badge>
                          <Badge variant="outline">{question.difficulty}</Badge>
                          <Badge variant="outline">{question.questionType}</Badge>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600 hover:text-green-700"
                          onClick={() => approveMutation.mutate(question.id)}
                          disabled={approveMutation.isPending}
                          data-testid={`button-approve-${question.id}`}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => rejectMutation.mutate(question.id)}
                          disabled={rejectMutation.isPending}
                          data-testid={`button-reject-${question.id}`}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`button-edit-${question.id}`}
                        >
                          <Edit className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Question Stem */}
                    <div>
                      <p className="text-sm font-medium mb-2">Question:</p>
                      <p className="text-sm" data-testid={`text-stem-${question.id}`}>
                        {question.stem}
                      </p>
                    </div>

                    {/* Options (if multiple choice) */}
                    {question.options && question.options.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">Options:</p>
                        <div className="space-y-1">
                          {question.options.map((option) => (
                            <div
                              key={option.key}
                              className={`text-sm p-2 rounded ${
                                option.key === question.answer
                                  ? 'bg-green-50 dark:bg-green-950 font-medium'
                                  : 'bg-gray-50 dark:bg-gray-900'
                              }`}
                              data-testid={`option-${question.id}-${option.key}`}
                            >
                              <span className="font-medium mr-2">{option.key}.</span>
                              {option.text}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Answer */}
                    <div>
                      <p className="text-sm font-medium mb-1">Correct Answer:</p>
                      <Badge className="bg-green-600" data-testid={`badge-answer-${question.id}`}>
                        {question.answer}
                      </Badge>
                    </div>

                    {/* Validation Issues */}
                    {question.validationIssues && question.validationIssues.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-yellow-500" />
                          Validation Issues:
                        </p>
                        <div className="space-y-2">
                          {question.validationIssues.map((issue, idx) => (
                            <div
                              key={idx}
                              className="flex items-start gap-2 text-sm p-2 rounded bg-yellow-50 dark:bg-yellow-950"
                              data-testid={`issue-${question.id}-${idx}`}
                            >
                              <Badge className={getSeverityColor(issue.severity)}>
                                {issue.severity}
                              </Badge>
                              <div>
                                <p className="font-medium">{issue.issueType}</p>
                                <p className="text-muted-foreground">{issue.description}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="duplicates" className="mt-6">
          {duplicatesLoading ? (
            <div className="text-center py-12">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : (
            <Card>
              <CardContent className="py-12">
                <div className="text-center text-muted-foreground">
                  <p>Duplicate detection coming soon</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
