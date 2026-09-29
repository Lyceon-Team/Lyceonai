import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Flame, Target } from "lucide-react";

interface PracticeShellProps {
  children: ReactNode;
  title?: string;
  /** The small uppercase line above the title. Practice's wording is the default. */
  eyebrow?: string;
  backLink?: string;
  backLabel?: string;
  score: {
    correct: number;
    incorrect?: number;
    skipped?: number;
    total: number;
    streak: number;
  };
  currentIndex: number;
  totalQuestions?: number;
  /**
   * W4-4: review with LISA shares the width between the question, the
   * calculator and LISA, which needs more than max-w-7xl (1280px) can give.
   * Off by default — practice keeps its width.
   */
  wide?: boolean;
}

export function PracticeShell({
  children,
  title = "Practice",
  eyebrow = "Academic Practice Runner",
  backLink = "/practice",
  backLabel = "Back to Practice",
  score,
  currentIndex,
  totalQuestions,
  wide = false,
}: PracticeShellProps) {
  const widthClass = wide ? "max-w-[1600px]" : "max-w-7xl";
  const progressPercent = totalQuestions
    ? ((currentIndex + 1) / totalQuestions) * 100
    : 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/95 backdrop-blur">
        <div className={`container mx-auto px-4 py-4 ${widthClass}`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.location.assign(backLink)}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                {backLabel}
              </Button>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {eyebrow}
                </p>
                <h1 className="text-lg sm:text-xl font-bold text-foreground truncate">
                  {title}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {/*
                @spec [SCL-186 (strikes Doc 05 Parent §12.2 "your recency-weighted
                accuracy is Y%"); owner ruling 6, 2026-09-29; Doc 05 AC#20] |
                @implemented [2026-09-29] | plain English: this pill used to show the
                session's accuracy ("75%") and correct-over-total ("3/4"), both raw
                accuracy figures. It now shows only how many questions the student has
                answered this session, a count of their own activity. Practice and review
                runners both render through this shell, so both lose the figure.
              */}
              <div className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5">
                <Target className="h-3.5 w-3.5 text-foreground/80" />
                <span className="text-xs font-semibold text-foreground">
                  {score.total} answered
                </span>              </div>

              <div className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5">
                <Flame className="h-3.5 w-3.5 text-foreground/80" />
                <span className="text-xs font-semibold text-foreground">
                  {score.streak}
                </span>
              </div>

              {totalQuestions && (
                <div className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-foreground">
                  {currentIndex + 1} / {totalQuestions}
                </div>
              )}
            </div>
          </div>

          {totalQuestions && (
            <div className="mt-3">
              <Progress value={progressPercent} className="h-1.5" />
            </div>
          )}
        </div>
      </header>

      <main className={`flex-1 container mx-auto px-4 py-6 ${widthClass}`}>
        {children}
      </main>
    </div>
  );
}

export default PracticeShell;
