/**
 * "Your free diagnostic": the Home card that starts (or resumes) the diagnostic.
 *
 * @spec [DESIGN.md §4 Home; evidence/wiring-table.md §3 Home (diagnostic card: practice
 *       `/sessions/open` diagnostic row; start: POST /api/practice/diagnostic/sessions); OQ-68 (d)
 *       (the numbers in the copy come from the server); owner brief "Question of the Day on Home"
 *       (Karl, 2026-10-08/09) "Home" 5: free or paid, no diagnostic → Diagnostic]
 *       | @implemented [2026-10-03; moved out of FreeHome.tsx 2026-10-09]
 *
 * plain English: the card the free Home always drew while the student had no baseline, now one
 * component so the paid Home draws the same card in the same case (the brief's "paid + no
 * diagnostic → Diagnostic then Set up your study plan"). "Start diagnostic" is the page's one
 * primary action while the card shows. The open-sessions read is the PARENT's, passed in: a
 * second observer mounting on that query after it failed would refetch it, put the Home back in
 * its loading state, unmount this card, and loop.
 */
import { useLocation } from "wouter";
import { RulerProgress, rulerFill } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import type { useActiveSessions } from "@/hooks/useActiveSessions";
import { useDiagnosticStart } from "@/hooks/useDiagnosticStart";
import { STARTING_LABEL } from "@/lib/pending-copy";
import { answeredLine, diagnosticCardLine } from "./home-model";

type PracticeRead = Pick<
  ReturnType<typeof useActiveSessions>,
  "sessions" | "diagnosticTotalQuestions" | "diagnosticPerDomain"
>;

export function DiagnosticCard({
  practice,
}: {
  practice: PracticeRead;
}): JSX.Element {
  const [, navigate] = useLocation();
  const diagnostic = useDiagnosticStart();
  const openDiagnostic =
    practice.sessions.find((s) => s.mode === "diagnostic") ?? null;

  const startDiagnostic = async (): Promise<void> => {
    const sessionId = await diagnostic.startDiagnostic();
    if (sessionId) navigate(`/practice/session/${sessionId}`);
  };

  return (
    <section
      aria-labelledby="home-diag-h"
      className="flex flex-col gap-[22px] rounded-lg border border-lyc-rule bg-lyc-sheet px-6 py-7 sm:px-10 sm:py-9"
      data-testid="home-diagnostic"
    >
      <h2
        id="home-diag-h"
        className="m-0 font-lyc-serif text-[30px] font-semibold leading-tight text-lyc-ink-strong"
      >
        Your free diagnostic
      </h2>
      <p
        className="m-0 max-w-[600px] text-[18px] leading-relaxed text-lyc-ink"
        data-testid="home-diagnostic-length"
      >
        {diagnosticCardLine(
          practice.diagnosticTotalQuestions,
          practice.diagnosticPerDomain,
        )}
      </p>
      <div className="flex flex-col gap-2.5">
        <RulerProgress
          size="card"
          filled={
            openDiagnostic === null
              ? 0
              : rulerFill(
                  openDiagnostic.answered_items,
                  openDiagnostic.total_items,
                )
          }
          data-testid="home-diagnostic-ruler"
        />
        {openDiagnostic !== null ? (
          <span className="text-base text-lyc-muted">
            {answeredLine(
              openDiagnostic.answered_items,
              openDiagnostic.total_items,
            )}
          </span>
        ) : null}
      </div>
      {diagnostic.error ? (
        <p role="alert" className="m-0 text-base text-lyc-danger">
          {diagnostic.error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button
          type="button"
          variant="lyc-primary"
          size="lyc-lg"
          pending={diagnostic.isStarting}
          onClick={() => void startDiagnostic()}
          data-testid="home-start-diagnostic"
        >
          {diagnostic.isStarting ? STARTING_LABEL : "Start diagnostic"}
        </Button>
        <span className="text-base text-lyc-muted">
          You can stop and pick up where you left off.
        </span>
      </div>
    </section>
  );
}
