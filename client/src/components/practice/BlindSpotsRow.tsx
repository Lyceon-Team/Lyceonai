/**
 * Practice: a compact "Find your blind spots" row below the filters card, until the diagnostic
 * is done.
 *
 * @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
 *       brief v2, Karl, 2026-10-13) §6 "a compact 'Find your blind spots' row, the size of a
 *       'resume session' row, below the filters card, shown only until the diagnostic is
 *       completed"] | @implemented [2026-10-13]
 *
 * plain English: the same size and parts as a "Pick up where you left off" row (title, a muted
 * line, a text action on the right). Whether to show it is decided by the caller with Home's own
 * rule (the projection's `no_baseline`), so the two pages never disagree. "Start" starts — or
 * resumes, the server decides — the diagnostic through the one start hook.
 */
import { useLocation } from "wouter";
import { useDiagnosticStart } from "@/hooks/useDiagnosticStart";
import { BLIND_SPOTS_NAME, blindSpotsSubtitle } from "@/lib/blind-spots-copy";
import { STARTING_LABEL } from "@/lib/pending-copy";

export function BlindSpotsRow({
  diagnosticTotal,
}: {
  diagnosticTotal: number | null;
}): JSX.Element {
  const [, navigate] = useLocation();
  const diagnostic = useDiagnosticStart();
  const start = async (): Promise<void> => {
    const sessionId = await diagnostic.startDiagnostic();
    if (sessionId) navigate(`/practice/session/${sessionId}`);
  };
  return (
    <section
      aria-label={BLIND_SPOTS_NAME}
      className="flex flex-col gap-2"
      data-testid="practice-blind-spots"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-y border-lyc-rule py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-lg font-semibold text-lyc-ink">
            {BLIND_SPOTS_NAME}
          </span>
          <span className="text-base text-lyc-muted">
            {blindSpotsSubtitle(diagnosticTotal)}
          </span>
        </div>
        <button
          type="button"
          className="bg-transparent p-0 text-[17px] font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline disabled:opacity-60"
          disabled={diagnostic.isStarting}
          onClick={() => void start()}
          data-testid="practice-blind-spots-start"
        >
          {diagnostic.isStarting ? STARTING_LABEL : "Start"}
        </button>
      </div>
      {diagnostic.error ? (
        <p role="alert" className="m-0 text-base text-lyc-danger">
          {diagnostic.error.message}
        </p>
      ) : null}
    </section>
  );
}
