import React from "react";
import { PracticeShell } from "@/components/layout/PracticeShell";
import QuestionRenderer from "@/components/question-renderer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCanonicalPractice, PracticeSectionParam } from "@/hooks/useCanonicalPractice";
import DesmosCalculator from "@/components/math/DesmosCalculator";
import MathReferenceSheet from "@/components/math/MathReferenceSheet";
import { Badge } from "@/components/ui/badge";
import { Calculator, Flag, Loader2 } from "lucide-react";
import RuntimeContractDisabledCard from "@/components/RuntimeContractDisabledCard";
import { RecoveryNotice } from "@/components/feedback/RecoveryNotice";

function isMathSection(section: string | null | undefined): boolean {
  if (!section) return false;
  const normalized = section.trim().toLowerCase();
  return normalized === "math" || normalized === "m" || normalized === "m1" || normalized === "m2";
}

export default function CanonicalPracticePage(props: {
  title: string;
  badgeLabel: string;
  section: PracticeSectionParam;
  targetMinutes?: number;
  sessionId?: string | null;
}) {
  const sessionSpec = React.useMemo(
    () => (typeof props.targetMinutes === "number" ? { targetMinutes: props.targetMinutes } : undefined),
    [props.targetMinutes],
  );

  const {
    question,
    isLoading,
    error,
    selectedAnswer,
    setSelectedAnswer,
    freeResponseAnswer,
    setFreeResponseAnswer,
    isSubmitting,
    showResult,
    isCorrect,
    correctOptionId,
    explanation,
    score,
    currentIndex,
    totalQuestions,
    canSubmit,
    fetchNextQuestion,
    submitAnswer,
    nextQuestion,
    handleMissingMcChoices,
    terminateSession,
    calculatorState,
    persistCalculatorState,
    runtimeDisabled,
    setForceTakeover,
  } = useCanonicalPractice(props.section, sessionSpec, props.sessionId);

  const [isEndingSession, setIsEndingSession] = React.useState(false);
  const [isCalculatorExpanded, setIsCalculatorExpanded] = React.useState(false);
  const [isReferenceOpen, setIsReferenceOpen] = React.useState(false);
  const [localCalculatorState, setLocalCalculatorState] = React.useState<unknown | null>(null);

  React.useEffect(() => {
    setLocalCalculatorState(calculatorState ?? null);
  }, [calculatorState]);

  const endSession = React.useCallback(async () => {
    if (isEndingSession) return;
    setIsEndingSession(true);
    try {
      await terminateSession();
      window.location.assign("/practice");
    } finally {
      setIsEndingSession(false);
    }
  }, [isEndingSession, terminateSession]);

  const onCalculatorStateChange = React.useCallback(
    (nextState: unknown) => {
      setLocalCalculatorState(nextState);
      void persistCalculatorState(nextState).catch(() => {
        // Keep practice flow resilient even if calculator persistence fails.
      });
    },
    [persistCalculatorState],
  );

  // Error handling for conflict or limit
  const typedError = error as any;
  const isConflict = typedError?.code === "CLIENT_INSTANCE_CONFLICT";
  const isLimit = typedError?.code === "SESSION_LIMIT_EXCEEDED";

  const handleForceTakeover = React.useCallback(() => {
    setForceTakeover(true);
    setTimeout(() => {
      fetchNextQuestion();
    }, 10);
  }, [fetchNextQuestion, setForceTakeover]);

  const showCalculator = isMathSection(question?.section);
  return (
    <PracticeShell
      title={props.title}
      backLink="/practice"
      backLabel="Back to Practice"
      score={{
        correct: score.correct,
        incorrect: score.incorrect,
        skipped: score.skipped,
        total: score.total,
        streak: score.streak,
      }}
      currentIndex={currentIndex}
      totalQuestions={totalQuestions}
    >
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <Card className="xl:col-span-8 rounded-2xl border border-border/60 bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="uppercase tracking-wider text-[10px] font-semibold">
                Question {currentIndex + 1}
                {typeof totalQuestions === "number" ? ` / ${totalQuestions}` : ""}
              </Badge>
              <Badge className="bg-primary-container text-primary-foreground">{props.badgeLabel}</Badge>
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Flag className="h-3.5 w-3.5" />
              Review tagging is available in full-length exam mode.
            </div>
          </div>

          {runtimeDisabled ? (
            <RuntimeContractDisabledCard domain="practice" code={runtimeDisabled.code} />
          ) : isLoading && !question ? (
            <div className="flex flex-col items-center justify-center py-14 text-slate-600">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="mt-3 text-sm">Loading your practice session...</p>
            </div>
          ) : isConflict ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
              <AlertCircle className="h-10 w-10 text-amber-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-amber-900 mb-2">Session Conflict</h3>
              <p className="text-sm text-amber-700 mb-6">
                This session is currently active in another browser tab or device.
                Resuming here will disconnect the other instance.
              </p>
              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={() => window.location.assign("/practice")}>
                  Go Back
                </Button>
                <Button onClick={handleForceTakeover}>
                  Resume Here
                </Button>
              </div>
            </div>
          ) : isLimit ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
              <AlertCircle className="h-10 w-10 text-red-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-red-900 mb-2">Session Limit Exceeded</h3>
              <p className="text-sm text-red-700 mb-6">
                {typedError.message}
              </p>
              <Button onClick={() => window.location.assign("/practice")}>
                Manage Sessions
              </Button>
            </div>
          ) : error && !question ? (
            <RecoveryNotice
              title="Unable to load session."
              message={String(error)}
              onRetry={() => void fetchNextQuestion()}
              retryLabel="Retry"
            />
          ) : !question ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p className="font-medium">No questions available right now.</p>
              <p className="mt-1">Try again in a moment or switch sections.</p>
              <Button className="mt-4" onClick={fetchNextQuestion} disabled={isLoading}>
                Check Again
              </Button>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">{error}</div>
              )}

              <QuestionRenderer
                question={question}
                selectedAnswer={selectedAnswer}
                onSelectAnswer={setSelectedAnswer}
                freeResponseAnswer={freeResponseAnswer}
                onFreeResponseAnswerChange={setFreeResponseAnswer}
                showResult={showResult}
                isCorrect={isCorrect}
                correctOptionId={correctOptionId}
                explanation={explanation}
                disabled={isSubmitting || isLoading}
                onMissingMcChoices={handleMissingMcChoices}
              />

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                {!showResult ? (
                  <>
                    <Button
                      variant="outline"
                      disabled={isSubmitting || isLoading || isEndingSession}
                      onClick={() => submitAnswer({ skipped: true })}
                    >
                      Skip
                    </Button>

                    <Button
                      variant="ghost"
                      disabled={isSubmitting || isLoading || isEndingSession}
                      onClick={endSession}
                    >
                      End Session
                    </Button>

                    <Button
                      disabled={isSubmitting || isLoading || !canSubmit || isEndingSession}
                      onClick={() => submitAnswer({ skipped: false })}
                    >
                      Check Answer
                    </Button>
                  </>
                ) : (
                  <Button 
                    className="w-full" 
                    disabled={isSubmitting || isLoading || isEndingSession} 
                    onClick={() => {
                      if (currentIndex + 1 === totalQuestions) {
                        endSession();
                      } else {
                        nextQuestion();
                      }
                    }}
                  >
                    {currentIndex + 1 === totalQuestions ? "Done" : "Next Question"}
                  </Button>
                )}
              </div>
            </>
          )}
        </Card>

        <div className="xl:col-span-4 space-y-4">
          <Card className="rounded-2xl border border-border/60 bg-card p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">Session Guidance</p>
            <p className="text-sm text-foreground/90 leading-relaxed">
              Responses submit directly to canonical practice endpoints. If you leave and return, Lyceon restores your unresolved state from runtime session truth.
            </p>
          </Card>

          {showCalculator && (
            <Card className="rounded-2xl border border-border/60 bg-card p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Math Tools</p>
                <div className="flex gap-2">
                  <Button variant="outline" type="button" size="sm" onClick={() => setIsReferenceOpen(true)}>
                    Reference Sheet
                  </Button>
                  <Button
                    variant="outline"
                    type="button"
                    size="sm"
                    onClick={() => setIsCalculatorExpanded((prev) => !prev)}
                    aria-expanded={isCalculatorExpanded}
                    data-testid="practice-calculator-toggle"
                  >
                    <Calculator className="h-3.5 w-3.5 mr-1" />
                    {isCalculatorExpanded ? "Hide" : "Open"}
                  </Button>
                </div>
              </div>
              <DesmosCalculator
                expanded={isCalculatorExpanded}
                initialState={localCalculatorState}
                onStateChange={onCalculatorStateChange}
                className="w-full"
              />
            </Card>
          )}
        </div>
      </div>
      <MathReferenceSheet open={isReferenceOpen} onOpenChange={setIsReferenceOpen} />
    </PracticeShell>
  );
}
