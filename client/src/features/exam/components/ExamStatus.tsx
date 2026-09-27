/**
 * Loading and error states shared by every exam screen.
 * @implemented [2026-09-25]
 */
import { Link } from "wouter";
import { examErrorStatus } from "../api/exam-api";

export function ExamLoading({ label = "Loading your test…" }: { label?: string }) {
  return (
    <div className="exam-root flex min-h-screen items-center justify-center" role="status" aria-live="polite">
      <p className="text-[var(--exam-muted)]">{label}</p>
    </div>
  );
}

export function ExamLoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const status = examErrorStatus(error);
  const message =
    status === 403
      ? "This test isn't available to your account."
      : status === 404
        ? "We couldn't find this test."
        : "We couldn't load your test. Check your connection and try again.";
  return (
    <div className="exam-root flex min-h-screen items-center justify-center px-4">
      <div role="alert" className="flex max-w-md flex-col items-center gap-4 text-center">
        <p className="text-lg font-semibold">{message}</p>
        <div className="flex gap-3">
          {onRetry !== undefined && status !== 403 && (
            <button type="button" onClick={onRetry} className="min-h-[44px] rounded-full bg-[var(--exam-accent)] px-6 text-sm font-medium text-white">
              Try again
            </button>
          )}
          <Link href="/tests" className="flex min-h-[44px] items-center rounded-full border border-[var(--exam-line)] px-6 text-sm font-medium">
            Back to tests
          </Link>
        </div>
      </div>
    </div>
  );
}
