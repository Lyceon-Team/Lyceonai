import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Flame, Target } from "lucide-react";

interface PracticeShellProps {
  children: ReactNode;
  title?: string;
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
}

export function PracticeShell({
  children,
  title = "Practice",
  backLink = "/practice",
  backLabel = "Back to Practice",
  score,
  currentIndex,
  totalQuestions,
}: PracticeShellProps) {
  const progressPercent = totalQuestions ? ((currentIndex + 1) / totalQuestions) * 100 : 0;
  const accuracyPercent = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 py-4 max-w-7xl">
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
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Academic Practice Runner</p>
                <h1 className="text-lg sm:text-xl font-bold text-foreground truncate">{title}</h1>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5">
                <Target className="h-3.5 w-3.5 text-foreground/80" />
                <span className="text-xs font-semibold text-foreground">{accuracyPercent}%</span>
                <span className="text-[11px] text-muted-foreground">{score.correct}/{score.total}</span>
              </div>

              <div className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5">
                <Flame className="h-3.5 w-3.5 text-foreground/80" />
                <span className="text-xs font-semibold text-foreground">{score.streak}</span>
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

      <main className="flex-1 container mx-auto px-4 py-6 max-w-7xl">
        {children}
      </main>
    </div>
  );
}

export default PracticeShell;
