/**
 * Full-Length SAT Exam Runner
 * 
 * Main component for taking a full-length SAT exam.
 * Handles:
 * - Session state management
 * - Question display and navigation
 * - Timer display with server sync
 * - Answer submission
 * - Module transitions
 * - Break screen
 * - Results display
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import QuestionRenderer from "@/components/question-renderer";
import DesmosCalculator from "@/components/math/DesmosCalculator";
import MathReferenceSheet from "@/components/math/MathReferenceSheet";
import FullLengthResultsView from "@/components/full-length-exam/FullLengthResultsView";
import RuntimeContractDisabledCard from "@/components/RuntimeContractDisabledCard";
import {
  parseRuntimeContractDisabledFromError,
  type RuntimeContractDisabledState,
} from "@/lib/runtime-contract-disable";
import { 
  Clock, 
  ChevronRight, 
  CheckCircle2, 
  AlertCircle,
  Coffee,
  ArrowRight,
} from "lucide-react";
import { Link } from "wouter";

// ============================================================================
// TYPES
// ============================================================================

type SectionType = "rw" | "math" | "break";

interface ExamSession {
  id: string;
  status: string;
  current_section: SectionType | null;
  current_module: number | null;
  started_at: string | null;
  completed_at: string | null;
}

interface ExamModule {
  id: string;
  section: string;
  module_index: number;
  status: string;
  started_at: string | null;
  ends_at: string | null;
  submitted_at: string | null;
}

interface ExamQuestion {
  id: string;
  stem: string;
  section: string;
  question_type: "multiple_choice";
  options: Array<{ key: string; text: string }>;
  difficulty: 1 | 2 | 3 | null;
  orderIndex: number;
  moduleQuestionCount: number;
  answeredCount: number;
  // Previously submitted answer (for resume support)
  submittedAnswer?: {
    selectedAnswer?: string;
  };
}

interface SessionState {
  session: ExamSession;
  currentModule: ExamModule | null;
  currentQuestion: ExamQuestion | null;
  timeRemaining: number | null;
  breakTimeRemaining: number | null;
}

interface SubmitModuleResult {
  moduleId: string;
  correctCount: number;
  totalCount: number;
  nextModule: {
    section: string;
    moduleIndex: number;
    difficultyBucket?: string;
  } | null;
  isBreak: boolean;
}

interface CompleteExamResult {
  sessionId: string;
  rwScore: {
    module1: { correct: number; total: number };
    module2: { correct: number; total: number };
    totalCorrect: number;
    totalQuestions: number;
  };
  mathScore: {
    module1: { correct: number; total: number };
    module2: { correct: number; total: number };
    totalCorrect: number;
    totalQuestions: number;
  };
  overallScore: {
    totalCorrect: number;
    totalQuestions: number;
    percentageCorrect: number;
  };
  completedAt: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

interface ExamRunnerProps {
  sessionId: string;
  onExit?: () => void;
}

export default function ExamRunner({ sessionId, onExit }: ExamRunnerProps) {
  const { toast } = useToast();
  
  // State
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<CompleteExamResult | null>(null);
  const [isCalculatorExpanded, setIsCalculatorExpanded] = useState(false);
  const [isReferenceOpen, setIsReferenceOpen] = useState(false);
  const [calculatorStatesByModule, setCalculatorStatesByModule] = useState<Record<string, unknown>>({});
  const [runtimeDisabled, setRuntimeDisabled] = useState<RuntimeContractDisabledState | null>(null);
  const calculatorPersistTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Timer sync
  const [displayTime, setDisplayTime] = useState<number | null>(null);
  const lastSyncRef = useRef<number>(Date.now());
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Track last question ID to avoid clearing answers when re-fetching same question
  const lastQuestionIdRef = useRef<string | null>(null);
  const markRuntimeDisabled = useCallback((error: unknown): boolean => {
    const disabled = parseRuntimeContractDisabledFromError("full-length", error);
    if (!disabled) return false;
    setRuntimeDisabled(disabled);
    return true;
  }, []);
  
  // ============================================================================
  // SESSION MANAGEMENT
  // ============================================================================
  
  const fetchSessionState = useCallback(async () => {
    try {
      const response = await apiRequest(
        `/api/full-length/sessions/current?sessionId=${sessionId}`,
        { method: "GET" }
      );
      
      const payload = await response.json();
      if (!payload || typeof payload !== "object" || !("session" in payload)) {
        // Ignore malformed refresh payloads so we never clobber current UI state with non-session data.
        setLoading(false);
        return;
      }

      const data = payload as SessionState;
      setSessionState(data);

      const moduleId = data.currentModule?.id;
      const moduleSection = String(data.currentModule?.section ?? "").toLowerCase();
      const moduleCalculatorState = (data.currentModule as any)?.calculator_state;
      if (moduleId && moduleSection === "math" && moduleCalculatorState !== undefined) {
        setCalculatorStatesByModule((prev) => {
          if (Object.prototype.hasOwnProperty.call(prev, moduleId)) {
            return prev;
          }
          return { ...prev, [moduleId]: moduleCalculatorState };
        });
      }
      
      // Set display time from server
      if (data.timeRemaining !== null) {
        setDisplayTime(data.timeRemaining);
        lastSyncRef.current = Date.now();
      } else if (data.breakTimeRemaining !== null) {
        setDisplayTime(data.breakTimeRemaining);
        lastSyncRef.current = Date.now();
      }
      
      // Handle answer state restoration
      if (data.currentQuestion) {
        const currentQuestionId = data.currentQuestion.id;
        const questionChanged = lastQuestionIdRef.current !== currentQuestionId;
        
        if (questionChanged) {
          // Question changed - restore submitted answer if it exists, otherwise clear
          lastQuestionIdRef.current = currentQuestionId;
          
          if (data.currentQuestion.submittedAnswer) {
            // Resume: restore previously submitted answer
            setSelectedAnswer(data.currentQuestion.submittedAnswer.selectedAnswer || null);
          } else {
            // New question: clear inputs
            setSelectedAnswer(null);
          }
        }
        // If same question, keep current UI state (don't wipe on every poll)
      }
      
      setLoading(false);
    } catch (error: unknown) {
      if (markRuntimeDisabled(error)) {
        setLoading(false);
        return;
      }
      console.error("Failed to fetch session state:", error);
      const message = error instanceof Error ? error.message : "Failed to load exam session";
      toast({
        title: "Unable to load exam session",
        description: message,
      });
      setLoading(false);
    }
  }, [sessionId, toast]);
  
  // Initial load
  useEffect(() => {
    fetchSessionState();
  }, [fetchSessionState]);
  
  // Timer countdown
  useEffect(() => {
    if (displayTime === null || displayTime <= 0) return;
    
    const interval = setInterval(() => {
      setDisplayTime((prev) => {
        if (prev === null || prev <= 0) return 0;
        return Math.max(0, prev - 1000);
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [displayTime]);
  
  // Periodic server sync (every 30 seconds)
  useEffect(() => {
    if (!sessionState?.currentModule || sessionState.session.status !== "in_progress") {
      return;
    }
    
    const syncInterval = setInterval(() => {
      fetchSessionState();
    }, 30000); // 30 seconds
    
    syncIntervalRef.current = syncInterval;
    
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [sessionState, fetchSessionState]);

  useEffect(() => {
    return () => {
      if (calculatorPersistTimerRef.current) {
        clearTimeout(calculatorPersistTimerRef.current);
        calculatorPersistTimerRef.current = null;
      }
    };
  }, []);
  
  // ============================================================================
  // ANSWER SUBMISSION
  // ============================================================================
  
  const submitAnswer = useCallback(async (questionId: string) => {
    if (!sessionId || runtimeDisabled) return;
    
    setSubmitting(true);
    
    try {
      const response = await apiRequest(
        `/api/full-length/sessions/${sessionId}/answer`,
        {
          method: "POST",
          body: JSON.stringify({
            questionId,
            selectedAnswer: selectedAnswer || undefined,
          }),
        }
      );
      
      if (!response.ok) {
        throw new Error("Failed to submit answer");
      }
      
      // Refresh session state to get next question
      await fetchSessionState();
      
    } catch (error: unknown) {
      if (markRuntimeDisabled(error)) {
        return;
      }
      console.error("Failed to submit answer:", error);
      const message = error instanceof Error ? error.message : "Failed to submit answer";
      toast({
        title: "Unable to submit answer",
        description: message,
      });
    } finally {
      setSubmitting(false);
    }
  }, [fetchSessionState, markRuntimeDisabled, runtimeDisabled, selectedAnswer, sessionId, toast]);
  
  // ============================================================================
  // MODULE SUBMISSION
  // ============================================================================
  
  const submitModule = useCallback(async () => {
    if (!sessionId || runtimeDisabled) return;
    
    setSubmitting(true);
    
    try {
      const response = await apiRequest(
        `/api/full-length/sessions/${sessionId}/module/submit`,
        { method: "POST", body: JSON.stringify({}) }
      );
      
      if (!response.ok) {
        throw new Error("Failed to submit module");
      }
      
      const result: SubmitModuleResult = await response.json();
      
      toast({
        title: "Module Complete",
        description: `You answered ${result.correctCount} out of ${result.totalCount} questions correctly.`,
      });
      
      // Refresh session state
      await fetchSessionState();
      
    } catch (error: unknown) {
      if (markRuntimeDisabled(error)) {
        return;
      }
      console.error("Failed to submit module:", error);
      const message = error instanceof Error ? error.message : "Failed to submit module";
      toast({
        title: "Unable to submit module",
        description: message,
      });
    } finally {
      setSubmitting(false);
    }
  }, [fetchSessionState, markRuntimeDisabled, runtimeDisabled, sessionId, toast]);
  
  // ============================================================================
  // BREAK CONTINUATION
  // ============================================================================
  
  const continueFromBreak = useCallback(async () => {
    if (!sessionId || runtimeDisabled) return;
    
    setSubmitting(true);
    
    try {
      const response = await apiRequest(
        `/api/full-length/sessions/${sessionId}/break/continue`,
        { method: "POST", body: JSON.stringify({}) }
      );
      
      if (!response.ok) {
        throw new Error("Failed to continue from break");
      }
      
      toast({
        title: "Break Complete",
        description: "Starting Math Module 1",
      });
      
      // Refresh session state
      await fetchSessionState();
      
    } catch (error: unknown) {
      if (markRuntimeDisabled(error)) {
        return;
      }
      console.error("Failed to continue from break:", error);
      const message = error instanceof Error ? error.message : "Failed to continue from break";
      toast({
        title: "Unable to continue from break",
        description: message,
      });
    } finally {
      setSubmitting(false);
    }
  }, [fetchSessionState, markRuntimeDisabled, runtimeDisabled, sessionId, toast]);
  
  // ============================================================================
  // EXAM COMPLETION
  // ============================================================================
  
  const completeExam = useCallback(async () => {
    if (!sessionId || runtimeDisabled) return;
    
    setSubmitting(true);
    
    try {
      const response = await apiRequest(
        `/api/full-length/sessions/${sessionId}/complete`,
        { method: "POST", body: JSON.stringify({}) }
      );
      
      if (!response.ok) {
        throw new Error("Failed to complete exam");
      }
      
      const result: CompleteExamResult = await response.json();
      setResults(result);

      try {
        window.localStorage.setItem("lyceon:lastFullLengthSessionId", result.sessionId);
      } catch {
        // Ignore storage failures; session/runtime truth remains server-authoritative.
      }
      
      toast({
        title: "Exam Complete!",
        description: `Overall: ${result.overallScore.percentageCorrect.toFixed(1)}% correct`,
      });
      
    } catch (error: unknown) {
      if (markRuntimeDisabled(error)) {
        return;
      }
      console.error("Failed to complete exam:", error);
      const message = error instanceof Error ? error.message : "Failed to complete exam";
      toast({
        title: "Unable to complete exam",
        description: message,
      });
    } finally {
      setSubmitting(false);
    }
  }, [markRuntimeDisabled, runtimeDisabled, sessionId, toast]);

  // ============================================================================
  // AUTO-SUBMIT ON TIME EXPIRY
  // ============================================================================
  
  useEffect(() => {
    if (displayTime === 0 && sessionState?.currentModule?.status === "in_progress") {
      // Time expired - auto submit module
      toast({
        title: "Time's Up!",
        description: "Submitting current module...",
      });
      submitModule();
    }
  }, [displayTime, sessionState, submitModule, toast]);
  
  // ============================================================================
  // RENDER HELPERS
  // ============================================================================
  
  const formatTime = (ms: number | null): string => {
    if (ms === null) return "--:--";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };
  
  const getSectionLabel = (section: string | null, moduleIndex: number | null): string => {
    if (!section || !moduleIndex) return "";
    if (section === "rw") return `Reading & Writing Module ${moduleIndex}`;
    if (section === "math") return `Math Module ${moduleIndex}`;
    return "";
  };
  
  // ============================================================================
  // RENDER
  // ============================================================================
  
  if (runtimeDisabled) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 py-8 max-w-5xl">
          <RuntimeContractDisabledCard domain="full-length" code={runtimeDisabled.code} />
        </div>
      </AppShell>
    );
  }

  // Loading state
  if (loading) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 py-8 max-w-5xl">
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading exam...</p>
          </div>
        </div>
      </AppShell>
    );
  }
  
  // No session state
  if (!sessionState) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 py-8 max-w-5xl">
          <div className="text-center py-12">
            <AlertCircle className="h-16 w-16 text-amber-600 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-4">Session Not Found</h1>
            <Button onClick={onExit || (() => window.location.href = "/full-test")}>
              Return to Full Test
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }
  
  // Results screen
  if (results) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          <FullLengthResultsView
            data={results}
            title="Exam Complete"
            description="Results below reflect your completed runtime session data."
            shareEnabled
            actions={
              <>
                <Button asChild>
                  <Link href={`/full-test?reportSessionId=${encodeURIComponent(results.sessionId)}&reviewSessionId=${encodeURIComponent(results.sessionId)}`}>
                    Open Report Surface
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/dashboard">Return to Dashboard</Link>
                </Button>
                <Button variant="outline" onClick={onExit || (() => (window.location.href = "/full-test"))}>
                  Start New Exam
                </Button>
              </>
            }
          />
        </div>
      </AppShell>
    );
  }
  
  // Break screen
  if (sessionState.session.current_section === "break") {
    return (
      <AppShell>
        <div className="container mx-auto px-4 py-8 max-w-5xl">
          <div className="text-center mb-8">
            <Coffee className="h-20 w-20 text-primary mx-auto mb-4" />
            <h1 className="text-3xl font-bold mb-2">Break Time</h1>
            <p className="text-muted-foreground">
              You've completed the Reading & Writing section. Take a 10-minute break.
            </p>
          </div>
          
          <Card className="mb-8">
            <CardContent className="pt-6">
              <div className="text-center mb-6">
                <div className="text-4xl font-bold mb-2">
                  {formatTime(displayTime)}
                </div>
                <p className="text-sm text-muted-foreground">Time remaining</p>
              </div>
              
              <div className="space-y-4">
                <p className="text-center text-sm">
                  You can continue to the Math section at any time, or wait for the break to end.
                </p>
                
                <div className="flex justify-center">
                  <Button
                    size="lg"
                    onClick={continueFromBreak}
                    disabled={submitting}
                  >
                    Continue to Math Module 1
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }
  
  // Question screen
  const currentQuestion = sessionState.currentQuestion;
  const currentModule = sessionState.currentModule;
  
  if (!currentQuestion || !currentModule) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 py-8 max-w-5xl">
          <div className="text-center py-12">
            <p className="text-muted-foreground">No current question</p>
          </div>
        </div>
      </AppShell>
    );
  }
  
  const allAnswered = currentQuestion.answeredCount >= currentQuestion.moduleQuestionCount;
  const progressPercent = (currentQuestion.answeredCount / currentQuestion.moduleQuestionCount) * 100;
  const isMathModule = String(currentModule.section ?? sessionState.session.current_section ?? "").toLowerCase() === "math";
  const calculatorModuleKey = currentModule.id || `${sessionState.session.current_section ?? "none"}:${sessionState.session.current_module ?? 0}`;
  const calculatorState = calculatorStatesByModule[calculatorModuleKey] ?? null;

  const handleCalculatorStateChange = (nextState: unknown) => {
    setCalculatorStatesByModule((prev) => ({ ...prev, [calculatorModuleKey]: nextState }));

    if (!isMathModule || !currentModule?.id) {
      return;
    }

    if (calculatorPersistTimerRef.current) {
      clearTimeout(calculatorPersistTimerRef.current);
    }

    calculatorPersistTimerRef.current = setTimeout(async () => {
      try {
        await apiRequest(
          `/api/full-length/sessions/${sessionId}/modules/${currentModule.id}/calculator-state`,
          {
            method: "POST",
            body: JSON.stringify({
              calculator_state: nextState ?? null,
            }),
          }
        );
      } catch (error) {
        if (markRuntimeDisabled(error)) {
          return;
        }
        console.warn("Failed to persist full-length calculator state", error);
      }
    }, 500);
  };
  
  return (
    <AppShell>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              {getSectionLabel(sessionState.session.current_section, sessionState.session.current_module)}
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <span className="text-lg font-mono font-semibold">
                {formatTime(displayTime)}
              </span>
            </div>
            {displayTime !== null && displayTime < 5 * 60 * 1000 && (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                Low Time
              </Badge>
            )}
          </div>
        </div>
        
        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between text-sm text-muted-foreground mb-2">
            <span>
              Question {currentQuestion.orderIndex + 1} of {currentQuestion.moduleQuestionCount}
            </span>
            <span>
              {currentQuestion.answeredCount} answered
            </span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>
        
        <div className={`mb-6 ${isMathModule && isCalculatorExpanded ? "grid lg:grid-cols-2 gap-6" : "space-y-6"}`}>
          {/* Question */}
          <Card>
            <CardContent className="pt-6">
              <QuestionRenderer
                question={{
                  id: currentQuestion.id,
                  stem: currentQuestion.stem,
                  question_type: "multiple_choice",
                  section: currentQuestion.section,
                  options: currentQuestion.options,
                }}
                selectedAnswer={selectedAnswer}
                onSelectAnswer={setSelectedAnswer}
                freeResponseAnswer=""
                onFreeResponseAnswerChange={() => {}}
                showResult={false}
                disabled={submitting}
              />
            </CardContent>
          </Card>

          {isMathModule && (
            <Card>
              <CardContent className="pt-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Calculator</p>
                  <div className="flex gap-2">
                    <Button variant="outline" type="button" onClick={() => setIsReferenceOpen(true)}>
                      Reference Sheet
                    </Button>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => setIsCalculatorExpanded((prev) => !prev)}
                      aria-expanded={isCalculatorExpanded}
                      data-testid="full-length-calculator-toggle"
                    >
                      {isCalculatorExpanded ? "Hide Calculator" : "Open Calculator"}
                    </Button>
                  </div>
                </div>
                <DesmosCalculator
                  expanded={isCalculatorExpanded}
                  initialState={calculatorState}
                  onStateChange={handleCalculatorStateChange}
                />
              </CardContent>
            </Card>
          )}
        </div>
        
        {/* Navigation */}
        <div className="flex justify-between items-center">
          <div className="text-sm text-muted-foreground">
            {selectedAnswer ? (
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                Answer selected
              </span>
            ) : (
              <span>Select an answer to continue</span>
            )}
          </div>
          
          <div className="flex gap-3">
            {!allAnswered && (
              <Button
                onClick={() => submitAnswer(currentQuestion.id)}
                disabled={submitting || !selectedAnswer}
                size="lg"
              >
                {submitting ? "Submitting..." : "Next"}
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            )}
            
            {allAnswered && (
              <Button
                onClick={submitModule}
                disabled={submitting}
                size="lg"
                variant="default"
              >
                {submitting ? "Submitting..." : "Submit Module"}
                <CheckCircle2 className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        
        {/* Module end check */}
        {sessionState.currentModule?.status === "submitted" && 
          sessionState.session.current_section === "math" && 
          sessionState.session.current_module === 2 && (
          <div className="mt-8 text-center">
            <Button onClick={completeExam} size="lg" disabled={submitting}>
              Complete Exam
            </Button>
          </div>
        )}
      </div>
      <MathReferenceSheet open={isReferenceOpen} onOpenChange={setIsReferenceOpen} />
    </AppShell>
  );
}


