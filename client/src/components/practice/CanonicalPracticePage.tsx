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

        {!question ? (
          <div className="text-slate-700">No question loaded.</div>
        ) : (
          <>
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
              disabled={isSubmitting}
              onMissingMcChoices={handleMissingMcChoices}
            />

            <div className="mt-6 flex items-center justify-between">
              {!showResult ? (
                <>
                  <Button variant="outline" disabled={isSubmitting} onClick={() => submitAnswer({ skipped: true })}>
                    Skip
                  </Button>

                  <Button disabled={isSubmitting || !canSubmit} onClick={() => submitAnswer({ skipped: false })}>
                    Check Answer
                  </Button>
                </>
              ) : (
                <Button className="w-full" disabled={isSubmitting} onClick={nextQuestion}>
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
