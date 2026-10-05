/**
 * Loading and error states shared by every exam screen.
 *
 * @spec [Doc-04A_V2.2 §16.2 (refusals by status); student-UI register UI-54; DESIGN.md §1, §2]
 * @implemented [2026-09-25; on the student tokens 2026-10-03, UI-54]
 *
 * plain English: drawn inside the Focus shell (route-shells.ts), so they fill the shell's main
 * column rather than the screen, and use the student tokens (DESIGN.md §1; the timed module's
 * shell pins them light). The copy is unchanged, except that the way out names the section
 * "Full-Length" (owner naming ruling, Karl, 2026-10-05: every student-facing "Tests" label
 * becomes "Full-Length"; the /tests route stays).
 */
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { examErrorStatus } from "../api/exam-api";

export function ExamLoading({
  label = "Loading your test…",
}: {
  label?: string;
}) {
  return (
    <div
      className="flex min-h-full items-center justify-center px-4 py-16"
      role="status"
      aria-live="polite"
    >
      <p className="m-0 text-lyc-body text-lyc-muted">{label}</p>
    </div>
  );
}

export function ExamLoadError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const status = examErrorStatus(error);
  const message =
    status === 403
      ? "This test isn't available to your account."
      : status === 404
        ? "We couldn't find this test."
        : "We couldn't load your test. Check your connection and try again.";
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-16">
      <div
        role="alert"
        className="flex max-w-md flex-col items-center gap-4 text-center"
      >
        <p className="m-0 text-[18px] font-semibold text-lyc-ink-strong">
          {message}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {onRetry !== undefined && status !== 403 && (
            <Button
              type="button"
              variant="lyc-primary"
              size="lyc"
              onClick={onRetry}
            >
              Try again
            </Button>
          )}
          <Button asChild variant="lyc-outline" size="lyc">
            <Link href="/tests" className="no-underline">
              Back to Full-Length
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
