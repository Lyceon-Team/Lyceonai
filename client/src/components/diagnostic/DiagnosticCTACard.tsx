/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20–24 diagnostic prompting]
 * @implemented 2026-08-14
 *
 * plain English: reusable warm-gold CTA card prompting undiagnosed students to
 * work on (start or resume) their diagnostic assessment. Action-neutral copy
 * fits both 201 (fresh) and 409 (seamless resume). Gated by the caller on
 * estimateStatus === 'no_baseline' — when the baseline exists, this card must
 * not render.
 *
 * expected outcome: a prominent, attention-drawing card surfaces the diagnostic
 * offer with projected-score payoff copy. Clicking calls the shared
 * useDiagnosticStart hook, navigating to the practice session on success.
 *
 * trade-offs: the hook is called internally so the card is self-contained; the
 * caller only needs to gate visibility on estimateStatus.
 */
import { Loader2, Target } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDiagnosticStart } from "@/hooks/useDiagnosticStart";

type DiagnosticCTACardProps = {
  className?: string;
};

export function DiagnosticCTACard({ className }: DiagnosticCTACardProps) {
  const [, setLocation] = useLocation();
  const {
    startDiagnostic,
    isStarting,
    error: startError,
  } = useDiagnosticStart();

  const handleStart = async (): Promise<void> => {
    const sessionId = await startDiagnostic();
    if (sessionId) {
      setLocation(`/practice/session/${sessionId}`);
    }
  };

  return (
    <Card
      className={`border-[#0F2E48]/25 bg-[#FFFAEF] text-[#0F2E48] ${className ?? ""}`}
    >
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 shrink-0 rounded-lg bg-[#0F2E48]/10 p-2">
            <Target className="h-5 w-5 text-[#0F2E48]" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-base leading-tight">
              Get your projected SAT score
            </p>
            <p className="mt-1.5 text-sm text-[#0F2E48]/80">
              Work on your diagnostic assessment to unlock your starting score
              projection and personalized study recommendations.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                className="bg-[#0F2E48] text-white hover:bg-[#0F2E48]/90"
                disabled={isStarting}
                onClick={handleStart}
              >
                {isStarting ? (
                  <>
                    <Loader2
                      className="mr-1.5 h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                    Starting…
                  </>
                ) : (
                  "Work on Diagnostic"
                )}
              </Button>
            </div>
            {startError && (
              <p
                className="mt-2 text-sm font-medium text-[#0F2E48]"
                role="alert"
              >
                {startError.message}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
