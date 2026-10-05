/**
 * The session hub: /tests/:sessionId — begin, Module 2 hand-off, break.
 *
 * @spec [Doc-04A_V2.2 §5, §7.3, §12, §15.1; SCL-134 (break: skippable in both
 *        modes; bounded in strict — the server starts Math Module 1 at the break's
 *        end; unbounded in lenient)]
 *       [E7b owner ruling 3: no break opt-out at start; "Resume testing now" is the
 *        skip] | @implemented [2026-09-25]
 *       [student-UI register UI-54, OQ-49: inside the Focus shell, on the student tokens, off the
 *        light lock (route-shells.ts); "Reading & Writing" per OQ-51] | @implemented [2026-10-03]
 *
 * plain English: renders what the server position calls for and nothing else. An
 * active module or a finished session redirects to its own screen. The break counts
 * down from the server's break_remaining_ms on the monotonic clock; under test-day
 * timing the page asks the server again at zero and follows it into Math Module 1
 * (the server has already started it); under practice timing the break waits.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Redirect, useLocation, useParams } from "wouter";
import type {
  ExamSection,
  ExamSessionResponse,
} from "@lyceon/shared/exam-runtime-schema";
import { FocusBarContext } from "@/components/layout/FocusShell";
import { Button } from "@/components/ui/button";
import { sectionDisplayLabel } from "@shared/section-display";
import {
  fetchExamForms,
  fetchExamSession,
  startExamModule,
} from "../api/exam-api";
import { examKeys } from "../api/keys";
import {
  examPosition,
  modulePath,
  pathForPosition,
} from "../lib/exam-position";
import { formatClock, spokenClock } from "../lib/countdown";
import { MODE_LABEL, minutesLabel } from "../lib/labels";
import { useExamClock } from "../hooks/useExamClock";
import { ExamLoadError, ExamLoading } from "../components/ExamStatus";

export default function ExamSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const session = useQuery({
    queryKey: examKeys.session(sessionId),
    queryFn: () => fetchExamSession(sessionId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (session.isPending) return <ExamLoading />;
  if (session.isError)
    return (
      <ExamLoadError
        error={session.error}
        onRetry={() => void session.refetch()}
      />
    );

  const position = examPosition(session.data);
  switch (position.kind) {
    case "module":
    case "finished":
      return <Redirect to={pathForPosition(sessionId, position)} replace />;
    case "not_started":
      return <StartModule session={session.data} section="RW" module="1" />;
    case "module2_ready":
      return (
        <StartModule
          session={session.data}
          section={position.section}
          module="2"
        />
      );
    case "break":
      return <BreakScreen key={session.dataUpdatedAt} session={session.data} />;
  }
}

/**
 * UI-54: the Focus shell brings the chrome (back arrow, "Full-Length"); the timing this sitting
 * runs under goes in its context slot. Replaces the page's own "Lyceon" header bar.
 */
function Shell({ children, top }: { children: React.ReactNode; top: string }) {
  return (
    <>
      <FocusBarContext>
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-5">
          <span
            aria-hidden="true"
            className="hidden h-7 w-px shrink-0 bg-lyc-rule sm:block"
          />
          <span
            className="truncate text-lyc-body text-lyc-muted"
            data-testid="exam-session-mode"
          >
            {top}
          </span>
        </div>
      </FocusBarContext>
      <div className="flex min-h-full items-center justify-center px-4 py-10">
        {children}
      </div>
    </>
  );
}

function useStart(sessionId: string, section: ExamSection, module: "1" | "2") {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setPending(true);
    setError(null);
    try {
      await startExamModule(sessionId, section, module);
      await queryClient.invalidateQueries({
        queryKey: examKeys.session(sessionId),
      });
      navigate(modulePath(sessionId, section, module), { replace: true });
    } catch {
      setPending(false);
      setError(
        "We couldn't start the module. Check your connection and try again.",
      );
      await queryClient.invalidateQueries({
        queryKey: examKeys.session(sessionId),
      });
    }
  };
  return { start, pending, error };
}

/** Before Reading and Writing Module 1, or a reload between Module 1 and Module 2. */
function StartModule({
  session,
  section,
  module,
}: {
  session: ExamSessionResponse;
  section: ExamSection;
  module: "1" | "2";
}) {
  const { start, pending, error } = useStart(
    session.session_id,
    section,
    module,
  );
  return (
    <Shell top={MODE_LABEL[session.mode]}>
      <div className="flex w-full max-w-lg flex-col gap-5 rounded-lg border border-lyc-rule bg-lyc-sheet p-8">
        <h1 className="m-0 font-lyc-serif text-lyc-section font-semibold text-lyc-ink-strong">
          {sectionDisplayLabel(section)} · Module {module} of 2
        </h1>
        <p className="m-0 text-[17px] leading-relaxed text-lyc-muted">
          {module === "1"
            ? "The timer starts when you begin. Once a module is submitted you cannot return to it."
            : "Module 1 is submitted. The timer for Module 2 starts when you continue."}
        </p>
        {error !== null && (
          <p role="alert" className="m-0 text-lyc-body text-lyc-danger">
            {error}
          </p>
        )}
        <Button
          type="button"
          variant="lyc-primary"
          size="lyc-lg"
          onClick={() => void start()}
          disabled={pending}
          data-testid="exam-begin"
        >
          {module === "1"
            ? `Begin ${sectionDisplayLabel(section) ?? ""}`
            : "Continue to Module 2"}
        </Button>
      </div>
    </Shell>
  );
}

function BreakScreen({ session }: { session: ExamSessionResponse }) {
  const queryClient = useQueryClient();
  const { start, pending, error } = useStart(session.session_id, "M", "1");
  const forms = useQuery({
    queryKey: examKeys.forms(),
    queryFn: fetchExamForms,
    staleTime: 60_000,
  });
  const math = forms.data?.forms
    .find((f) => f.test_form_id === session.test_form_id)
    ?.sections.find((s) => s.section === "M");
  const strict = session.mode === "strict";

  const clock = useExamClock(session.break_remaining_ms ?? 0, () => {
    // Test-day: the server starts Math Module 1 at the break's end (SCL-134); ask it.
    if (strict)
      void queryClient.invalidateQueries({
        queryKey: examKeys.session(session.session_id),
      });
  });
  const over = clock.remainingMs === 0;

  return (
    <Shell top={MODE_LABEL[session.mode]}>
      <div
        className="flex w-full max-w-xl flex-col items-center gap-6 text-center"
        data-testid="exam-break"
      >
        <p className="m-0 text-lyc-meta-lg font-semibold uppercase tracking-[0.09em] text-lyc-muted">
          Reading and Writing complete
        </p>
        <h1 className="m-0 font-lyc-serif text-[40px] font-semibold text-lyc-ink-strong">
          Break
        </h1>
        <div
          role="timer"
          aria-label={`Break time remaining: ${spokenClock(clock.remainingMs)}`}
          className="font-mono text-[56px] font-medium tabular-nums text-lyc-ink-strong"
        >
          {formatClock(clock.remainingMs)}
        </div>
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[17px] leading-relaxed text-lyc-muted">
          <li>
            {strict
              ? "Math begins when the break ends. You may start early. Under test-day timing the break ends on its own and Math Module 1 starts."
              : over
                ? "Your break time is up. Under practice timing, Math starts when you're ready."
                : "Math begins when you're ready. You may start early."}
          </li>
          <li>
            Your Reading and Writing answers are submitted and cannot be
            changed.
          </li>
          {strict && (
            <li>
              Leave this tab open. Closing it under test-day timing does not
              pause anything.
            </li>
          )}
          {math !== undefined && (
            <li>
              Math is 2 modules of {math.questions_per_module} questions,{" "}
              {minutesLabel(math.module1_ms)} each.
            </li>
          )}
        </ul>
        {error !== null && (
          <p role="alert" className="m-0 text-lyc-body text-lyc-danger">
            {error}
          </p>
        )}
        <Button
          type="button"
          variant="lyc-primary"
          size="lyc-lg"
          onClick={() => void start()}
          disabled={pending}
          data-testid="exam-resume-now"
        >
          Resume testing now
        </Button>
      </div>
    </Shell>
  );
}
