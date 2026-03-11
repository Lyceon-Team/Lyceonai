import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, ArrowRight, Clock, XCircle, RefreshCw, BookOpen, CheckCircle, SkipForward, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import MathRenderer from "@/components/MathRenderer";
import { useState, useCallback, useMemo } from "react";
import { apiRequest } from "@/lib/queryClient";
import type { StudentQuestion, StudentMcQuestion } from "@shared/schema";

interface AttemptHistory {
  id: string;
  questionId: string;
  questionText: string;
  section: string;
  difficulty: string;
  isCorrect: boolean;
  outcome?: string;
  attemptedAt: Date;
  documentName: string;
}

interface ReviewQueueItem {
  questionId: string;
  outcome: string;
  attemptId: string;
}

interface SessionSummary {
  sessionId: string | null;
  sessionStartedAt: string | null;
  sessionMode?: string;
  sessionSection?: string;
  correctCount: number;
  incorrectCount: number;
  skippedCount: number;
  totalCount: number;
}

interface ReviewErrorsResponse {
  attempts: AttemptHistory[];
  incorrectAttempts: AttemptHistory[];
  skippedAttempts: AttemptHistory[];
  reviewQueue: ReviewQueueItem[];
  summary: SessionSummary;
  message?: string;
}

interface ValidationResult {
  isCorrect: boolean;
  mode: 'mc' | 'fr';
  correctAnswerKey: string | null;
  feedback: string;
  explanation?: string | null;
}

type ReviewMode = 'summary' | 'sequential';
type ReviewFilter = 'all' | 'incorrect' | 'skipped';

interface ReviewRunResult {
  outcome: 'correct' | 'incorrect' | 'skipped';
  validatedAt: Date;
}

function ReviewErrors() {
  const [mode, setMode] = useState<ReviewMode>('summary');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [freeResponseAnswer, setFreeResponseAnswer] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [reviewResults, setReviewResults] = useState<Record<string, ReviewRunResult>>({});
  const [recordError, setRecordError] = useState<string | null>(null);

  const {
    data: reviewData,
    isLoading,
    isError,
    error: reviewError,
    refetch,
  } = useQuery<ReviewErrorsResponse>({
    queryKey: ['/api/review-errors'],
  });

  const incorrectAttempts = reviewData?.incorrectAttempts ?? [];
  const skippedAttempts = reviewData?.skippedAttempts ?? [];
  const summary = reviewData?.summary;

  const currentQueue = useMemo(() => {
    if (reviewFilter === 'incorrect') {
      return incorrectAttempts.map(a => ({ questionId: a.questionId, outcome: 'incorrect', attemptId: a.id }));
    }
    if (reviewFilter === 'skipped') {
      return skippedAttempts.map(a => ({ questionId: a.questionId, outcome: 'skipped', attemptId: a.id }));
    }
    return reviewData?.reviewQueue ?? [];
  }, [reviewFilter, incorrectAttempts, skippedAttempts, reviewData?.reviewQueue]);

  const currentItem = currentQueue[currentIndex];

  const { data: fullQuestion, isLoading: questionLoading } = useQuery<StudentQuestion>({
    queryKey: ['/api/questions', currentItem?.questionId],
    enabled: mode === 'sequential' && !!currentItem?.questionId,
  });

  const resetQuestionState = useCallback(() => {
    setSelectedAnswer(null);
    setFreeResponseAnswer("");
    setShowResult(false);
    setValidationResult(null);
    setRecordError(null);
  }, []);

  const startReview = useCallback((filter: ReviewFilter) => {
    setReviewFilter(filter);
    setCurrentIndex(0);
    setReviewResults({});
    resetQuestionState();
    setMode('sequential');
  }, [resetQuestionState]);

  const handleSubmit = async () => {
    if (!fullQuestion || isValidating || !currentItem) return;
    
    setIsValidating(true);
    try {
      const isMc = fullQuestion.question_type === 'multiple_choice';
      const studentAnswer = isMc ? selectedAnswer : freeResponseAnswer.trim();
      
      const response = await apiRequest('/api/questions/validate', {
        method: 'POST',
        body: JSON.stringify({
          questionId: fullQuestion.id,
          studentAnswer,
        }),
      });
      
      const result: ValidationResult = await response.json();
      setValidationResult(result);
      setShowResult(true);
      
      const reviewOutcome = result.isCorrect ? 'correct' : 'incorrect';
      setReviewResults(prev => ({
        ...prev,
        [currentItem.questionId]: {
          outcome: reviewOutcome,
          validatedAt: new Date(),
        },
      }));
      
      try {
        const recordResponse = await apiRequest('/api/review-errors/attempt', {
          method: 'POST',
          body: JSON.stringify({
            question_id: currentItem.questionId,
            selected_answer: selectedAnswer,
            is_correct: result.isCorrect,
            seconds_spent: null,
            source_context: 'review_errors',
            client_attempt_id: `${currentItem.questionId}-${Date.now()}`,
          }),
        });
        
        if (!recordResponse.ok) {
          const errorData = await recordResponse.json().catch(() => ({}));
          setRecordError(errorData.error || 'Failed to record attempt');
        }
      } catch (compError: unknown) {
        console.warn('Failed to record review competency event:', compError);
        const errorMessage = compError instanceof Error ? compError.message : 'Failed to record attempt';
        setRecordError(errorMessage);
      }
    } catch (error) {
      console.error('Error validating answer:', error);
      setShowResult(true);
    } finally {
      setIsValidating(false);
    }
  };

  const handleSkip = useCallback(async () => {
    if (!currentItem) return;
    setReviewResults(prev => ({
      ...prev,
      [currentItem.questionId]: {
        outcome: 'skipped',
        validatedAt: new Date(),
      },
    }));
    
    try {
      await apiRequest('/api/review-errors/attempt', {
        method: 'POST',
        body: JSON.stringify({
          question_id: currentItem.questionId,
          selected_answer: null,
          is_correct: false,
          seconds_spent: null,
          source_context: 'review_errors',
          client_attempt_id: `${currentItem.questionId}-skip-${Date.now()}`,
        }),
      });
    } catch (compError) {
      console.warn('Failed to record review skip event:', compError);
    }
    
    if (currentIndex < currentQueue.length - 1) {
      setCurrentIndex(prev => prev + 1);
      resetQuestionState();
    }
  }, [currentItem, currentIndex, currentQueue.length, resetQuestionState]);

  const handleNext = useCallback(() => {
    if (currentIndex < currentQueue.length - 1) {
      setCurrentIndex(prev => prev + 1);
      resetQuestionState();
    } else {
      resetQuestionState();
    }
  }, [currentIndex, currentQueue.length, resetQuestionState]);

  const handleBack = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      resetQuestionState();
    }
  }, [currentIndex, resetQuestionState]);

  const handleBackToSummary = useCallback(() => {
    setMode('summary');
    setCurrentIndex(0);
    resetQuestionState();
  }, [resetQuestionState]);

  const reviewRunStats = useMemo(() => {
    const results = Object.values(reviewResults);
    return {
      correct: results.filter(r => r.outcome === 'correct').length,
      incorrect: results.filter(r => r.outcome === 'incorrect').length,
      skipped: results.filter(r => r.outcome === 'skipped').length,
      total: results.length,
    };
  }, [reviewResults]);

  const isReviewComplete = currentIndex >= currentQueue.length - 1 && showResult;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-foreground" />
          <p className="text-muted-foreground">Loading your recent session...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full text-center" data-testid="card-review-error">
          <CardHeader>
            <AlertCircle className="h-10 w-10 mx-auto text-red-500 mb-2" />
            <CardTitle>Unable to load review data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {(reviewError as Error)?.message ?? "Please try again."}
            </p>
            <Button onClick={() => refetch()} data-testid="button-review-retry">
              Retry
            </Button>
            <Button variant="outline" asChild>
              <Link href="/practice">Back to Practice</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mode === 'sequential' && currentQueue.length > 0 && Object.keys(reviewResults).length === currentQueue.length && !showResult) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8 max-w-2xl">
          <Card data-testid="card-review-complete">
            <CardHeader className="text-center">
              <CheckCircle className="h-16 w-16 mx-auto mb-4 text-green-600" />
              <CardTitle className="text-2xl">Review Complete!</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20">
                  <p className="text-2xl font-bold text-green-600">{reviewRunStats.correct}</p>
                  <p className="text-sm text-muted-foreground">Correct</p>
                </div>
                <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20">
                  <p className="text-2xl font-bold text-red-600">{reviewRunStats.incorrect}</p>
                  <p className="text-sm text-muted-foreground">Incorrect</p>
                </div>
                <div className="p-4 rounded-lg bg-muted">
                  <p className="text-2xl font-bold text-muted-foreground">{reviewRunStats.skipped}</p>
                  <p className="text-sm text-muted-foreground">Skipped</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button onClick={handleBackToSummary} variant="outline" className="flex-1" data-testid="button-back-errors">
                  Back to Errors List
                </Button>
                <Button asChild className="flex-1" data-testid="button-start-practice">
                  <Link href="/practice">Start Practice</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (mode === 'sequential') {
    const progress = currentQueue.length > 0 ? ((currentIndex + 1) / currentQueue.length) * 100 : 0;
    
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8 max-w-3xl">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <Button variant="ghost" size="sm" onClick={handleBackToSummary} data-testid="button-exit-review">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Exit Review
              </Button>
              <span className="text-sm text-muted-foreground">
                Question {currentIndex + 1} of {currentQueue.length}
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {questionLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                <span>Loading question...</span>
              </CardContent>
            </Card>
          ) : fullQuestion ? (
            <Card data-testid="card-sequential-review">
              <CardHeader>
                <div className="flex items-center gap-2">
                  {currentItem?.outcome === 'skipped' ? (
                    <SkipForward className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-600" />
                  )}
                  <Badge variant="secondary">{fullQuestion.section}</Badge>
                  <Badge variant={currentItem?.outcome === 'skipped' ? 'outline' : 'destructive'}>
                    {currentItem?.outcome === 'skipped' ? 'Skipped' : 'Incorrect'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="text-lg">
                  <MathRenderer content={fullQuestion.stem} displayMode={false} />
                </div>

                {fullQuestion.question_type === 'multiple_choice' && 'options' in fullQuestion && (fullQuestion as StudentMcQuestion).options.length > 0 ? (
                  <div className="space-y-3">
                    {(fullQuestion as StudentMcQuestion).options.map((option, index) => {
                      const optionKey = String.fromCharCode(65 + index);
                      const isSelected = selectedAnswer === optionKey;
                      const isCorrect = showResult && validationResult?.correctAnswerKey === optionKey;
                      const isWrongSelection = showResult && isSelected && !isCorrect;
                      
                      return (
                        <div
                          key={optionKey}
                          className={`p-4 border rounded-lg transition-colors ${
                            showResult
                              ? isCorrect
                                ? 'bg-green-50 dark:bg-green-900/20 border-green-500'
                                : isWrongSelection
                                ? 'bg-red-50 dark:bg-red-900/20 border-red-500'
                                : 'bg-muted/50'
                              : isSelected
                              ? 'bg-primary/10 border-primary'
                              : 'bg-muted/50 hover:bg-muted cursor-pointer'
                          }`}
                          onClick={() => !showResult && setSelectedAnswer(optionKey)}
                          data-testid={`option-${optionKey.toLowerCase()}`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-sm shrink-0">{optionKey}.</span>
                            <div className="flex-1 min-w-0">
                              <MathRenderer content={option.text || String(option)} displayMode={false} />
                            </div>
                            {showResult && isCorrect && (
                              <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
                            )}
                            {showResult && isWrongSelection && (
                              <XCircle className="h-5 w-5 text-red-600 shrink-0" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="text-sm font-medium">Your Answer:</label>
                    <Input
                      value={freeResponseAnswer}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFreeResponseAnswer(e.target.value)}
                      placeholder="Enter your answer"
                      disabled={showResult}
                      data-testid="input-free-response"
                    />
                  </div>
                )}

                {showResult && validationResult && (
                  <div className={`p-4 rounded-lg ${
                    validationResult.isCorrect
                      ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                      : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      {validationResult.isCorrect ? (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-600" />
                      )}
                      <span className="font-medium">
                        {validationResult.isCorrect ? 'Correct!' : 'Incorrect'}
                      </span>
                    </div>
                    {validationResult.correctAnswerKey && (
                      <p className="text-sm text-muted-foreground">
                        <strong>Correct Answer:</strong> {validationResult.correctAnswerKey}
                      </p>
                    )}
                    {fullQuestion.explanation && (
                      <div className="text-sm text-muted-foreground mt-2">
                        <strong>Explanation:</strong>
                        <div className="mt-1">
                          <MathRenderer content={fullQuestion.explanation} displayMode={false} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {recordError && (
                  <div className="p-4 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-orange-600" />
                      <span className="font-medium text-orange-600">Warning</span>
                    </div>
                    <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                      {recordError}. Your answer was validated, but we couldn't save it to your progress.
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={handleBack}
                    disabled={currentIndex === 0}
                    data-testid="button-back"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                  </Button>
                  
                  <div className="flex gap-3">
                    {!showResult ? (
                      <>
                        <Button
                          variant="outline"
                          onClick={handleSkip}
                          data-testid="button-skip"
                        >
                          <SkipForward className="h-4 w-4 mr-2" />
                          Skip
                        </Button>
                        <Button
                          onClick={handleSubmit}
                          disabled={!selectedAnswer && !freeResponseAnswer.trim()}
                          data-testid="button-submit"
                        >
                          Submit
                        </Button>
                      </>
                    ) : (
                      <Button onClick={handleNext} data-testid="button-next">
                        {isReviewComplete ? 'Finish' : 'Next'}
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <AlertCircle className="h-6 w-6 mr-2 text-muted-foreground" />
                <span>Question not found</span>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/practice" data-testid="button-back-practice">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Practice
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Review Errors</h1>
            <p className="text-muted-foreground">
              Review mistakes from your most recent session
              {summary?.sessionStartedAt && (
                <span className="ml-2 text-sm">
                  ({new Date(summary.sessionStartedAt).toLocaleDateString()})
                </span>
              )}
            </p>
          </div>
        </div>

        {summary && summary.totalCount > 0 && (
          <Card className="mb-6" data-testid="card-session-summary">
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <div className="text-center p-4 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold">{summary.totalCount}</p>
                  <p className="text-sm text-muted-foreground">Total</p>
                </div>
                <div className="text-center p-4 rounded-lg bg-green-50 dark:bg-green-900/20">
                  <p className="text-2xl font-bold text-green-600">{summary.correctCount}</p>
                  <p className="text-sm text-muted-foreground">Correct</p>
                </div>
                <div className="text-center p-4 rounded-lg bg-red-50 dark:bg-red-900/20">
                  <p className="text-2xl font-bold text-red-600">{summary.incorrectCount}</p>
                  <p className="text-sm text-muted-foreground">Incorrect</p>
                </div>
                <div className="text-center p-4 rounded-lg bg-muted">
                  <p className="text-2xl font-bold text-muted-foreground">{summary.skippedCount}</p>
                  <p className="text-sm text-muted-foreground">Skipped</p>
                </div>
              </div>
              
              {(incorrectAttempts.length > 0 || skippedAttempts.length > 0) && (
                <div className="flex flex-col sm:flex-row gap-3">
                  {incorrectAttempts.length > 0 && (
                    <Button 
                      onClick={() => startReview('incorrect')} 
                      variant="destructive"
                      className="flex-1"
                      data-testid="button-review-incorrect"
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Review Incorrect ({incorrectAttempts.length})
                    </Button>
                  )}
                  {skippedAttempts.length > 0 && (
                    <Button 
                      onClick={() => startReview('skipped')} 
                      variant="outline"
                      className="flex-1"
                      data-testid="button-review-skipped"
                    >
                      <SkipForward className="h-4 w-4 mr-2" />
                      Review Skipped ({skippedAttempts.length})
                    </Button>
                  )}
                  {incorrectAttempts.length + skippedAttempts.length > 0 && (
                    <Button 
                      onClick={() => startReview('all')} 
                      className="flex-1"
                      data-testid="button-review-all"
                    >
                      <BookOpen className="h-4 w-4 mr-2" />
                      Review All ({incorrectAttempts.length + skippedAttempts.length})
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {incorrectAttempts.length === 0 && skippedAttempts.length === 0 ? (
          <Card className="text-center py-12" data-testid="card-no-errors">
            <CardContent>
              <BookOpen className="h-16 w-16 mx-auto mb-4 text-green-600" />
              <h3 className="text-xl font-semibold mb-2">No Questions to Review!</h3>
              <p className="text-muted-foreground mb-6">
                You haven't answered any questions incorrectly or skipped any. Keep practicing!
              </p>
              <Button asChild data-testid="button-start-practice">
                <Link href="/practice">Start Practice</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {incorrectAttempts.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-red-600" />
                    Incorrect ({incorrectAttempts.length})
                  </h2>
                  <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                </div>
                <div className="space-y-3">
                  {incorrectAttempts.map((attempt, index) => (
                    <Card
                      key={attempt.id}
                      className="hover:shadow-md transition-shadow cursor-pointer"
                      onClick={() => {
                        setReviewFilter('incorrect');
                        setCurrentIndex(index);
                        setReviewResults({});
                        resetQuestionState();
                        setMode('sequential');
                      }}
                      data-testid={`card-incorrect-${attempt.id}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <XCircle className="h-4 w-4 text-red-600 mt-1 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge variant="outline" className="text-xs">{attempt.section}</Badge>
                              {attempt.difficulty && (
                                <Badge variant="secondary" className="text-xs">{attempt.difficulty}</Badge>
                              )}
                            </div>
                            <p className="text-sm text-foreground truncate">{attempt.questionText}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <Clock className="h-3 w-3" />
                              {new Date(attempt.attemptedAt).toLocaleString()}
                            </p>
                          </div>
                          <Button variant="ghost" size="sm" className="shrink-0">
                            Review
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {skippedAttempts.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
                  <SkipForward className="h-5 w-5 text-muted-foreground" />
                  Skipped ({skippedAttempts.length})
                </h2>
                <div className="space-y-3">
                  {skippedAttempts.map((attempt, index) => (
                    <Card
                      key={attempt.id}
                      className="hover:shadow-md transition-shadow cursor-pointer"
                      onClick={() => {
                        setReviewFilter('skipped');
                        setCurrentIndex(index);
                        setReviewResults({});
                        resetQuestionState();
                        setMode('sequential');
                      }}
                      data-testid={`card-skipped-${attempt.id}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <SkipForward className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge variant="outline" className="text-xs">{attempt.section}</Badge>
                              {attempt.difficulty && (
                                <Badge variant="secondary" className="text-xs">{attempt.difficulty}</Badge>
                              )}
                            </div>
                            <p className="text-sm text-foreground truncate">{attempt.questionText}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <Clock className="h-3 w-3" />
                              {new Date(attempt.attemptedAt).toLocaleString()}
                            </p>
                          </div>
                          <Button variant="ghost" size="sm" className="shrink-0">
                            Review
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ReviewErrors;

