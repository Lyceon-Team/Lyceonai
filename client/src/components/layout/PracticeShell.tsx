import { ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Flame } from "lucide-react";

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
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" asChild>
                <Link href={backLink}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  {backLabel}
                </Link>
              </Button>
              <h1 className="text-lg font-semibold text-foreground hidden sm:block">
                {title}
              </h1>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-secondary px-3 py-1.5 rounded-full">
                <span className="text-sm font-medium text-foreground">
                  {accuracyPercent}%
                </span>
                <span className="text-xs text-muted-foreground">
                  ({score.correct}/{score.total})
                </span>
              </div>

              <div className="flex items-center gap-2 bg-secondary px-3 py-1.5 rounded-full">
                <Flame className="h-4 w-4 text-foreground" />
                <span className="text-sm font-bold text-foreground">{score.streak}</span>
              </div>

              {totalQuestions && (
                <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{currentIndex + 1} / {totalQuestions}</span>
                </div>
              )}
            </div>
          </div>

          {totalQuestions && (
            <div className="mt-2">
              <Progress value={progressPercent} className="h-1" />
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6">
        <div className="max-w-3xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

export default PracticeShell;
