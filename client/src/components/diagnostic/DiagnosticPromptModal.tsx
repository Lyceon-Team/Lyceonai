/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20–24 diagnostic prompting]
 * @implemented 2026-08-14
 *
 * plain English: dismissible Dialog modal shown on dashboard load when the
 * student has no diagnostic baseline (estimateStatus === 'no_baseline') AND
 * hasn't dismissed it this browser session. On dismiss, a sessionStorage key
 * is set so the modal won't re-pop within the same session — but it reappears
 * on a fresh visit if the diagnostic is still not done. NOT a permanent
 * "never show again" — the student still needs to do it.
 *
 * expected outcome: fresh-account user lands on dashboard → sees a centered
 * modal prompting them to work on the diagnostic with projected-score payoff
 * copy. They can dismiss (X or Cancel) and browse freely, or click the action
 * button to start/resume the diagnostic via the shared useDiagnosticStart hook.
 *
 * trade-offs: sessionStorage is the lightest-weight persistence that survives
 * in-page navigation but resets on tab close. No permanent suppression (AADC
 * trust moat — invited, never trapped). The persistent DiagnosticCTACard on
 * the dashboard remains visible even after the modal is dismissed.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Target } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDiagnosticStart } from "@/hooks/useDiagnosticStart";

const DISMISS_KEY = "lyceon:diagnostic_modal_dismissed";

type DiagnosticPromptModalProps = {
  /** True when estimateStatus === 'no_baseline' */
  shouldShow: boolean;
};

export function DiagnosticPromptModal({
  shouldShow,
}: DiagnosticPromptModalProps) {
  const [, setLocation] = useLocation();
  const {
    startDiagnostic,
    isStarting,
    error: startError,
  } = useDiagnosticStart();

  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  const isOpen = shouldShow && !dismissed;

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // sessionStorage unavailable (private browsing edge case) — state-only
      // dismiss is still effective for this page lifetime.
    }
  }, []);

  const handleStart = async (): Promise<void> => {
    const sessionId = await startDiagnostic();
    if (sessionId) {
      setLocation(`/practice/session/${sessionId}`);
    }
  };

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleDismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#FFFAEF]">
            <Target
              className="h-6 w-6 text-[#0F2E48]"
              aria-hidden="true"
            />
          </div>
          <DialogTitle className="text-center text-lg">
            Get your projected SAT score
          </DialogTitle>
          <DialogDescription className="text-center">
            Work on your diagnostic assessment — 40 questions across all SAT
            domains. On completion, you&apos;ll unlock your starting score
            projection and personalized study plan.
          </DialogDescription>
        </DialogHeader>

        {startError && (
          <p
            className="text-sm font-medium text-center text-foreground"
            role="alert"
          >
            {startError.message}
          </p>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            type="button"
            className="w-full bg-[#0F2E48] text-white hover:bg-[#0F2E48]/90"
            disabled={isStarting}
            onClick={handleStart}
          >
            {isStarting ? (
              <>
                <Loader2
                  className="mr-1.5 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
                Starting…
              </>
            ) : (
              "Work on Diagnostic"
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={isStarting}
            onClick={handleDismiss}
          >
            Maybe later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
