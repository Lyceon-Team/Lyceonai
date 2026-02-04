import React from "react";
import { PracticeShell } from "@/components/layout/PracticeShell";
import QuestionRenderer from "@/components/question-renderer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCanonicalPractice, PracticeSectionParam } from "@/hooks/useCanonicalPractice";

export default function CanonicalPracticePage(props: {
  title: string;
  badgeLabel: string;
  section: PracticeSectionParam;
}) {
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
    correctAnswerKey,
    explanation,
    score,
    currentIndex,
    totalQuestions,
    canSubmit,
    fetchNextQuestion,
    submitAnswer,
    nextQuestion,
    handleMissingMcChoices,
  } = useCanonicalPractice(props.section);

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
      <Card className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-slate-600">
            Question {currentIndex + 1}
            {typeof totalQuestions === "number" ? ` / ${totalQuestions}` : ""}
          </div>
          <div className="text-xs font-medium rounded-full bg-slate-100 px-3 py-1 text-slate-700">
            {props.badgeLabel}
          </div>
        </div>

        {isLoading && !question ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-600">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
            <p className="mt-3 text-sm">Loading your next question...</p>
          </div>
        ) : error && !question ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p className="font-medium">Unable to load a question.</p>
            <p className="mt-1">{error}</p>
            <Button className="mt-4" onClick={fetchNextQuestion} disabled={isLoading}>
              Retry
            </Button>
          </div>
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
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                {error}
              </div>
            )}
            <QuestionRenderer
              question={question}
              selectedAnswer={selectedAnswer}
              onSelectAnswer={setSelectedAnswer}
              freeResponseAnswer={freeResponseAnswer}
              onFreeResponseAnswerChange={setFreeResponseAnswer}
              showResult={showResult}
              isCorrect={isCorrect}
              correctAnswerKey={correctAnswerKey}
              explanation={explanation}
              disabled={isSubmitting || isLoading}
              onMissingMcChoices={handleMissingMcChoices}
            />

            <div className="mt-6 flex items-center justify-between">
              {!showResult ? (
                <>
                  <Button
                    variant="outline"
                    disabled={isSubmitting || isLoading}
                    onClick={() => submitAnswer({ skipped: true })}
                  >
                    Skip
                  </Button>

                  <Button
                    disabled={isSubmitting || isLoading || !canSubmit}
                    onClick={() => submitAnswer({ skipped: false })}
                  >
                    Check Answer
                  </Button>
                </>
              ) : (
                <Button className="w-full" disabled={isSubmitting || isLoading} onClick={nextQuestion}>
                  Next Question
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
    </PracticeShell>
  );
}
