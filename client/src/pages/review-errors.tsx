import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { ArrowLeft, ArrowRight, CheckCircle, SkipForward, RefreshCw, AlertCircle, BookOpen, XCircle } from "lucide-react";
import { Link } from "wouter";
import MathRenderer from "@/components/MathRenderer";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import RuntimeContractDisabledCard from "@/components/RuntimeContractDisabledCard";
import {
  parseRuntimeContractDisabledFromError,
  type RuntimeContractDisabledState,
} from "@/lib/runtime-contract-disable";

interface AttemptHistory {
  id: string;
  questionId: string;
  questionCanonicalId?: string | null;
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
  questionCanonicalId?: string | null;
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

type ReviewFilter = "all" | "incorrect" | "skipped";
type ReviewScope = "all_past_mistakes" | "by_practice_session" | "by_full_length_session";
type ReviewViewMode = "summary" | "sequential";

interface ReviewSessionQuestion {
  sessionItemId: string;
  stem: string;
  section: string;
  questionType: "multiple_choice";
  options: Array<{ id: string; text: string }>;
  difficulty: string | number | null;
  correct_answer: null;
  explanation: null;
}

interface ReviewSessionState {
  session: {
    id: string | null;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    abandonedAt: string | null;
    currentOrdinal: number | null;
    resolvedCount: number;
    totalCount: number;
  };
  currentItem: null | {
    id: string;
    ordinal: number;
    sourceOrigin: "practice" | "full_test";
    retryMode: "same_question" | "similar_question";
    question: ReviewSessionQuestion;
  };
}

interface ReviewStartResponse {
  replayed?: boolean;
  empty?: boolean;
  message?: string;
  session: { id: string } | null;
  state: ReviewSessionState;
}

interface SubmitResult {
  verified_is_correct: boolean;
  correctOptionId: string | null;
  correctAnswerText: string | null;
  explanation: string | null;
}

function buildClientInstanceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `review-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ReviewErrors() {
  const [mode, setMode] = useState<ReviewViewMode>("summary");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ReviewFilter>("all");
  const [reviewScope, setReviewScope] = useState<ReviewScope>("all_past_mistakes");
  const [practiceSessionId, setPracticeSessionId] = useState<string>("");
  const [fullLengthSessionId, setFullLengthSessionId] = useState<string>("");
  const [clientInstanceId] = useState<string>(() => buildClientInstanceId());
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [runStats, setRunStats] = useState({ correct: 0, incorrect: 0, skipped: 0, total: 0 });
  const [manualDisabledState, setManualDisabledState] = useState<RuntimeContractDisabledState | null>(null);

  const reviewScopeReady = useMemo(() => {
    if (reviewScope === "by_practice_session") {
      return Boolean(practiceSessionId.trim());
    }
    if (reviewScope === "by_full_length_session") {
      return Boolean(fullLengthSessionId.trim());
    }
    return true;
  }, [fullLengthSessionId, practiceSessionId, reviewScope]);

  const reviewSummaryUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("mode", reviewScope);
    if (reviewScope === "by_practice_session" && practiceSessionId.trim()) {
      params.set("practice_session_id", practiceSessionId.trim());
    }
    if (reviewScope === "by_full_length_session" && fullLengthSessionId.trim()) {
      params.set("full_length_session_id", fullLengthSessionId.trim());
    }
    const qs = params.toString();
    return qs ? `/api/review-errors?${qs}` : "/api/review-errors";
  }, [fullLengthSessionId, practiceSessionId, reviewScope]);

  const {
    data: reviewData,
    isLoading,
    isError,
    error: reviewError,
    refetch: refetchSummary,
  } = useQuery<ReviewErrorsResponse>({
    queryKey: [reviewSummaryUrl],
    enabled: reviewScopeReady,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const {
    data: sessionState,
    isLoading: stateLoading,
    refetch: refetchSessionState,
  } = useQuery<ReviewSessionState>({
    queryKey: ["/api/review-errors/sessions", activeSessionId, clientInstanceId],
    enabled: mode === "sequential" && !!activeSessionId,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const response = await apiRequest(`/api/review-errors/sessions/${activeSessionId}/state?client_instance_id=${encodeURIComponent(clientInstanceId)}`);
      return response.json();
    },
  });

  const reviewDisabledState = useMemo(
    () => manualDisabledState ?? parseRuntimeContractDisabledFromError("review", reviewError),
    [manualDisabledState, reviewError],
  );
  const reviewUnavailable = !!reviewDisabledState;
  const summary = reviewData?.summary;
  const incorrectAttempts = reviewData?.incorrectAttempts ?? [];
  const skippedAttempts = reviewData?.skippedAttempts ?? [];

  const currentItem = sessionState?.currentItem ?? null;
  const currentQuestion = currentItem?.question ?? null;

  const resetPerItemState = useCallback(() => {
    setSelectedOptionId(null);
    setSubmitResult(null);
    setRecordError(null);
  }, []);

  useEffect(() => {
    if (mode !== "sequential") return;
    setMode("summary");
    setActiveSessionId(null);
    resetPerItemState();
  }, [fullLengthSessionId, mode, practiceSessionId, resetPerItemState, reviewScope]);

  const startReview = useCallback(async (filter: ReviewFilter) => {
    if (reviewUnavailable) {
      setRecordError(reviewDisabledState?.message ?? "Review is temporarily unavailable.");
      return;
    }

    if (reviewScope === "by_practice_session" && !practiceSessionId.trim()) {
      setRecordError("Enter a practice session ID to start a session-scoped review.");
      return;
    }

    if (reviewScope === "by_full_length_session" && !fullLengthSessionId.trim()) {
      setRecordError("Enter a full-length session ID to start a session-scoped review.");
      return;
    }

    setActiveFilter(filter);
    setRecordError(null);

    try {
      const response = await apiRequest("/api/review-errors/sessions", {
        method: "POST",
        body: JSON.stringify({
          filter,
          mode: reviewScope,
          practice_session_id: reviewScope === "by_practice_session" ? practiceSessionId.trim() : null,
          full_length_session_id: reviewScope === "by_full_length_session" ? fullLengthSessionId.trim() : null,
          client_instance_id: clientInstanceId,
          idempotency_key: `review-session:${reviewScope}:${filter}:${clientInstanceId}`,
        }),
      });
      const payload = (await response.json()) as ReviewStartResponse;

      if (!response.ok) {
        setRecordError((payload as any)?.error || "Unable to start review session");
        return;
      }

      if (!payload.session?.id || payload.empty) {
        setRecordError(payload.message ?? "No unresolved review items right now.");
        return;
      }

      setActiveSessionId(payload.session.id);
      setRunStats({ correct: 0, incorrect: 0, skipped: 0, total: 0 });
      resetPerItemState();
      setMode("sequential");
    } catch (error) {
      const disabled = parseRuntimeContractDisabledFromError("review", error);
      if (disabled) {
        setManualDisabledState(disabled);
        setRecordError(disabled.message);
        return;
      }
      const message = error instanceof Error ? error.message : "Unable to start review session";
      setRecordError(message);
    }
  }, [
    clientInstanceId,
    fullLengthSessionId,
    practiceSessionId,
    resetPerItemState,
    reviewDisabledState?.message,
    reviewScope,
    reviewUnavailable,
  ]);

  const submitAnswer = useCallback(async () => {
    if (!activeSessionId || !currentItem || !selectedOptionId || isSubmitting) return;
    setIsSubmitting(true);
    setRecordError(null);

    try {
      const response = await apiRequest("/api/review-errors/attempt", {
        method: "POST",
        body: JSON.stringify({
          session_id: activeSessionId,
          review_session_item_id: currentItem.id,
          selected_option_id: selectedOptionId,
          source_context: "review_errors",
          client_attempt_id: `review-submit:${activeSessionId}:${currentItem.id}`,
          client_instance_id: clientInstanceId,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setRecordError(payload?.error || "Unable to submit answer");
        return;
      }

      const isCorrect = Boolean(payload.verified_is_correct);
      setRunStats((prev) => ({
        correct: prev.correct + (isCorrect ? 1 : 0),
        incorrect: prev.incorrect + (isCorrect ? 0 : 1),
        skipped: prev.skipped,
        total: prev.total + 1,
      }));

      setSubmitResult({
        verified_is_correct: isCorrect,
        correctOptionId: payload.correctOptionId ?? null,
        correctAnswerText: payload.correctAnswerText ?? null,
        explanation: payload.explanation ?? null,
      });
    } catch (error) {
      const disabled = parseRuntimeContractDisabledFromError("review", error);
      if (disabled) {
        setManualDisabledState(disabled);
        setRecordError(disabled.message);
        return;
      }
      const message = error instanceof Error ? error.message : "Unable to submit answer";
      setRecordError(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [activeSessionId, clientInstanceId, currentItem, isSubmitting, selectedOptionId]);

  const skipItem = useCallback(async () => {
    if (!activeSessionId || !currentItem || isSubmitting) return;
    setIsSubmitting(true);
    setRecordError(null);
    try {
      const response = await apiRequest("/api/review-errors/attempt", {
        method: "POST",
        body: JSON.stringify({
          session_id: activeSessionId,
          review_session_item_id: currentItem.id,
          action: "skip",
          source_context: "review_errors",
          client_attempt_id: `review-skip:${activeSessionId}:${currentItem.id}`,
          client_instance_id: clientInstanceId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRecordError(payload?.error || "Unable to skip review item");
        return;
      }
      setRunStats((prev) => ({ ...prev, skipped: prev.skipped + 1, total: prev.total + 1 }));
      resetPerItemState();
      await refetchSessionState();
    } catch (error) {
      const disabled = parseRuntimeContractDisabledFromError("review", error);
      if (disabled) {
        setManualDisabledState(disabled);
        setRecordError(disabled.message);
        return;
      }
      const message = error instanceof Error ? error.message : "Unable to skip review item";
      setRecordError(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [activeSessionId, clientInstanceId, currentItem, isSubmitting, refetchSessionState, resetPerItemState]);

  const nextAfterResult = useCallback(async () => {
    resetPerItemState();
    await refetchSessionState();
  }, [refetchSessionState, resetPerItemState]);

  const isComplete = useMemo(() => {
    if (!sessionState) return false;
    return sessionState.session.status === "completed" || (!sessionState.currentItem && sessionState.session.totalCount > 0);
  }, [sessionState]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-foreground" />
          <p className="text-muted-foreground">Loading your review queue...</p>
        </div>
      </div>
    );
  }

  if (reviewUnavailable) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="max-w-xl w-full space-y-4">
          <RuntimeContractDisabledCard domain="review" code={reviewDisabledState?.code ?? null} />
          <div className="flex justify-center">
            <Button variant="outline" asChild>
              <Link href="/practice">Back to Practice</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <AlertCircle className="h-10 w-10 mx-auto text-red-500 mb-2" />
            <CardTitle>Unable to load review data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{(reviewError as Error)?.message ?? "Please try again."}</p>
            <Button onClick={() => refetchSummary()}>Retry</Button>
            <Button variant="outline" asChild>
              <Link href="/practice">Back to Practice</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mode === "sequential") {
    if (isComplete) {
      return (
        <div className="min-h-screen bg-background">
          <div className="container mx-auto px-4 py-8 max-w-2xl">
            <Card>
              <CardHeader className="text-center">
                <CheckCircle className="h-16 w-16 mx-auto mb-4 text-green-600" />
                <CardTitle className="text-2xl">Review Complete</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20">
                    <p className="text-2xl font-bold text-green-600">{runStats.correct}</p>
                    <p className="text-sm text-muted-foreground">Correct</p>
                  </div>
                  <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20">
                    <p className="text-2xl font-bold text-red-600">{runStats.incorrect}</p>
                    <p className="text-sm text-muted-foreground">Incorrect</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted">
                    <p className="text-2xl font-bold text-muted-foreground">{runStats.skipped}</p>
                    <p className="text-sm text-muted-foreground">Skipped</p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    onClick={() => {
                      setMode("summary");
                      setActiveSessionId(null);
                      resetPerItemState();
                      refetchSummary();
                    }}
                    variant="outline"
                    className="flex-1"
                  >
                    Back to Review Queue
                  </Button>
                  <Button asChild className="flex-1">
                    <Link href="/practice">Start Practice</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }

    const progress = sessionState && sessionState.session.totalCount > 0
      ? ((sessionState.session.resolvedCount + 1) / sessionState.session.totalCount) * 100
      : 0;

    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8 max-w-3xl">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <Button variant="ghost" size="sm" onClick={() => setMode("summary")}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Exit Review
              </Button>
              <span className="text-sm text-muted-foreground">
                {sessionState?.session.currentOrdinal ?? 0} of {sessionState?.session.totalCount ?? 0}
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {stateLoading || !currentQuestion ? (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                <span>Loading question...</span>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-red-600" />
                  <Badge variant="secondary">{currentQuestion.section}</Badge>
                  <Badge variant="destructive">Review</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="text-lg">
                  <MathRenderer content={currentQuestion.stem} displayMode={false} />
                </div>

                <div className="space-y-3">
                  {currentQuestion.options.map((option) => {
                    const isSelected = selectedOptionId === option.id;
                    const isCorrect = submitResult?.correctOptionId === option.id;
                    const isWrongSelection = Boolean(submitResult) && isSelected && !isCorrect;
                    return (
                      <div
                        key={option.id}
                        className={`p-4 border rounded-lg transition-colors ${
                          submitResult
                            ? isCorrect
                              ? "bg-green-50 dark:bg-green-900/20 border-green-500"
                              : isWrongSelection
                              ? "bg-red-50 dark:bg-red-900/20 border-red-500"
                              : "bg-muted/50"
                            : isSelected
                            ? "bg-primary/10 border-primary"
                            : "bg-muted/50 hover:bg-muted cursor-pointer"
                        }`}
                        onClick={() => !submitResult && setSelectedOptionId(option.id)}
                      >
                        <MathRenderer content={option.text} displayMode={false} />
                      </div>
                    );
                  })}
                </div>

                {submitResult && (
                  <div className={`p-4 rounded-lg border ${submitResult.verified_is_correct ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"}`}>
                    <p className="font-medium mb-2">{submitResult.verified_is_correct ? "Correct" : "Incorrect"}</p>
                    {submitResult.correctAnswerText && (
                      <p className="text-sm text-muted-foreground"><strong>Correct answer:</strong> {submitResult.correctAnswerText}</p>
                    )}
                    {submitResult.explanation && (
                      <div className="text-sm text-muted-foreground mt-2">
                        <strong>Explanation:</strong>
                        <div className="mt-1"><MathRenderer content={submitResult.explanation} displayMode={false} /></div>
                      </div>
                    )}
                  </div>
                )}

                {recordError && (
                  <div className="p-4 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                    <p className="text-sm text-orange-700 dark:text-orange-300">{recordError}</p>
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-4 border-t">
                  {!submitResult ? (
                    <>
                      <Button variant="outline" onClick={skipItem} disabled={isSubmitting}>
                        <SkipForward className="h-4 w-4 mr-2" />
                        Skip
                      </Button>
                      <Button onClick={submitAnswer} disabled={!selectedOptionId || isSubmitting}>
                        Submit
                      </Button>
                    </>
                  ) : (
                    <Button onClick={nextAfterResult}>
                      Next
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  )}
                </div>
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
            <Link href="/practice">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Practice
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Review Errors</h1>
            <p className="text-muted-foreground">Review previously missed questions with server-owned session state.</p>
          </div>
        </div>

        {recordError && (
          <Card className="mb-6 border-orange-200">
            <CardContent className="pt-6 text-sm text-orange-700">{recordError}</CardContent>
          </Card>
        )}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Review Scope</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <Button
                variant={reviewScope === "all_past_mistakes" ? "default" : "outline"}
                onClick={() => setReviewScope("all_past_mistakes")}
              >
                All Past Mistakes
              </Button>
              <Button
                variant={reviewScope === "by_practice_session" ? "default" : "outline"}
                onClick={() => setReviewScope("by_practice_session")}
              >
                By Practice Session
              </Button>
              <Button
                variant={reviewScope === "by_full_length_session" ? "default" : "outline"}
                onClick={() => setReviewScope("by_full_length_session")}
              >
                By Full-Length Session
              </Button>
            </div>

            {reviewScope === "by_practice_session" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Practice Session ID</label>
                <Input
                  value={practiceSessionId}
                  onChange={(event) => setPracticeSessionId(event.target.value)}
                  placeholder="Enter practice session ID"
                />
              </div>
            )}

            {reviewScope === "by_full_length_session" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Full-Length Session ID</label>
                <Input
                  value={fullLengthSessionId}
                  onChange={(event) => setFullLengthSessionId(event.target.value)}
                  placeholder="Enter full-length session ID"
                />
              </div>
            )}

            {!reviewScopeReady && (
              <p className="text-sm text-muted-foreground">
                Enter a session ID to load a session-scoped review queue.
              </p>
            )}
          </CardContent>
        </Card>

        {reviewScopeReady && summary && summary.totalCount > 0 && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <div className="text-center p-4 rounded-lg bg-muted/50"><p className="text-2xl font-bold">{summary.totalCount}</p><p className="text-sm text-muted-foreground">Total</p></div>
                <div className="text-center p-4 rounded-lg bg-green-50 dark:bg-green-900/20"><p className="text-2xl font-bold text-green-600">{summary.correctCount}</p><p className="text-sm text-muted-foreground">Correct</p></div>
                <div className="text-center p-4 rounded-lg bg-red-50 dark:bg-red-900/20"><p className="text-2xl font-bold text-red-600">{summary.incorrectCount}</p><p className="text-sm text-muted-foreground">Incorrect</p></div>
                <div className="text-center p-4 rounded-lg bg-muted"><p className="text-2xl font-bold text-muted-foreground">{summary.skippedCount}</p><p className="text-sm text-muted-foreground">Skipped</p></div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button onClick={() => startReview("incorrect")} variant="destructive" className="flex-1">Review Incorrect ({incorrectAttempts.length})</Button>
                <Button onClick={() => startReview("skipped")} variant="outline" className="flex-1">Review Skipped ({skippedAttempts.length})</Button>
                <Button onClick={() => startReview("all")} className="flex-1">Review All ({incorrectAttempts.length + skippedAttempts.length})</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {reviewScopeReady ? (
          incorrectAttempts.length === 0 && skippedAttempts.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <BookOpen className="h-16 w-16 mx-auto mb-4 text-green-600" />
                <h3 className="text-xl font-semibold mb-2">No Questions to Review</h3>
                <p className="text-muted-foreground mb-6">You currently have no unresolved misses in your review queue.</p>
                <Button asChild><Link href="/practice">Start Practice</Link></Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle>Incorrect ({incorrectAttempts.length})</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {incorrectAttempts.slice(0, 10).map((attempt) => (
                    <div key={attempt.id} className="p-3 rounded border bg-muted/30">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline">{attempt.section}</Badge>
                        {attempt.difficulty ? <Badge variant="secondary">{attempt.difficulty}</Badge> : null}
                      </div>
                      <p className="text-sm text-foreground truncate">{attempt.questionText}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

export default ReviewErrors;
