/**
 * The guardian surface's non-data states — one set, every surface, each naming the student.
 *
 * @spec [Guardian_Closure_Plan G4-06 (G-AUD-06, 14): "a state matrix on every surface, with
 *       guardian-addressed copy naming the student: no students, loading, error, lapsed (named
 *       CTA), revoked (R7), calendar not set up, no exams yet"; R7 / G3-04 (a 404 means "no
 *       longer linked": drop the student's reads, refetch the roster); Doc 01 V8 §31.3 and
 *       CLAUDE.md guardian model (visibility = link active AND the student's entitlement active)]
 * @implemented [2026-09-30]
 *
 * plain English: before this, each guardian page wrote its own copy for the same states and
 * addressed nobody in particular — "the student", "your calendar", a student-facing upgrade
 * card on a parent's screen. Every state now says whose data it is about, and the two states
 * the server decides are read from the server's answers only:
 *   - lapsed: a 402 on a per-student read, or the roster's `has_active_entitlement: false`.
 *     The call to action is named — "Choose a plan for Ada" — and goes to the Linked students
 *     & billing page with Ada selected (G4-10). Never `/upgrade`, which a guardian is bounced
 *     from.
 *   - revoked: a 404 on a per-student read (the resolver's single answer for "not yours"), or
 *     a roster that no longer lists the student. `useGuardianReadFailure` drops the student's
 *     cached reads and refetches the roster, once per student (G3-04).
 *
 * edge cases: nothing here gates access — the server refuses every read these states stand
 * in for. A name is always the roster's label; where the roster no longer has the student the
 * last name the page saw is used, and "This student" only when there was never one.
 */
import * as React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useForgetGuardianStudent } from "@/hooks/useGuardianStudents";
import { isApiError } from "@/lib/api-error";
import { guardianPaths } from "./paths";

// ── The student the page is about ────────────────────────────────────────────────────────

type CurrentStudent = { id: string; name: string };

export const CurrentStudentContext = React.createContext<CurrentStudent | null>(
  null,
);

/** The name of the student the page is about; "your student" outside a student layout. */
export function useCurrentStudentName(): string {
  return React.useContext(CurrentStudentContext)?.name ?? "your student";
}

/** "Ada" → "Ada's"; "James" → "James'"; the generic fallback keeps its own grammar. */
export function possessive(name: string): string {
  if (name === "your student") return "your student's";
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

// ── Classifying a failed per-student read ────────────────────────────────────────────────

type GuardianReadFailure = "lapsed" | "revoked" | "error";

/** The server's answer, classified: 402 lapsed, 404 revoked, anything else an error. */
function classifyGuardianReadError(error: unknown): GuardianReadFailure {
  if (isApiError(error) && error.status === 402) return "lapsed";
  if (isApiError(error) && error.status === 404) return "revoked";
  return "error";
}

/**
 * The failure a per-student read ended in, or null. On "revoked" it forgets the student once
 * (G3-04): the roster refetch that follows is what moves the whole page to the revoked state.
 */
export function useGuardianReadFailure(
  studentId: string,
  error: unknown,
): GuardianReadFailure | null {
  const failure =
    error === null || error === undefined
      ? null
      : classifyGuardianReadError(error);
  const forget = useForgetGuardianStudent();
  const forgotten = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (failure !== "revoked" || forgotten.current === studentId) return;
    forgotten.current = studentId;
    forget(studentId);
  }, [failure, studentId, forget]);
  return failure;
}

// ── The states ───────────────────────────────────────────────────────────────────────────

function StateCard({
  testId,
  title,
  children,
  action,
  alert = false,
}: {
  testId: string;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  alert?: boolean;
}): JSX.Element {
  return (
    // An empty-state message centres on a phone, its action with it (owner decision
    // 2026-10-01, item 10); from 640px up it reads left-aligned like the cards around it.
    <section
      className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-5 text-center sm:items-stretch sm:text-left"
      data-testid={testId}
      data-guardian-state={testId.replace(/^guardian-state-/, "")}
    >
      <h2 className="m-0 text-xl font-semibold">{title}</h2>
      <p
        className="m-0 text-base text-muted-foreground"
        role={alert ? "alert" : undefined}
      >
        {children}
      </p>
      {action}
    </section>
  );
}

export function GuardianLoadingState({ what }: { what: string }): JSX.Element {
  return (
    <p
      className="m-0 py-6 text-base text-muted-foreground"
      data-testid="guardian-state-loading"
      data-guardian-state="loading"
      aria-busy="true"
    >
      Loading {what}…
    </p>
  );
}

export function GuardianErrorState({
  what,
  onRetry,
}: {
  /** Whose and what, already worded: "Ada's mastery". */
  what: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <StateCard
      testId="guardian-state-error"
      title={`We couldn't load ${what}`}
      alert
      action={
        onRetry ? (
          <Button
            variant="outline"
            className="min-h-[44px] w-fit text-base"
            onClick={onRetry}
          >
            Try again
          </Button>
        ) : undefined
      }
    >
      Check your connection and try again. If it keeps happening, refresh the
      page.
    </StateCard>
  );
}

export function GuardianLapsedState({
  name,
  studentId,
  ended,
}: {
  name: string;
  studentId: string;
  /** True when a subscription existed and stopped; false when there never was one. */
  ended: boolean;
}): JSX.Element {
  return (
    <StateCard
      testId="guardian-state-lapsed"
      title={
        ended
          ? `${possessive(name)} subscription has ended`
          : `${name} doesn't have a subscription yet`
      }
      action={
        <Link
          href={guardianPaths.choosePlan(studentId)}
          className="inline-flex min-h-[48px] w-fit items-center rounded-md bg-primary px-5 text-base font-semibold text-primary-foreground no-underline"
          data-testid="guardian-state-lapsed-cta"
        >
          Choose a plan for {name}
        </Link>
      }
    >
      {ended
        ? `${possessive(name)} progress, calendar and results are kept, and appear here again once their subscription is active.`
        : `You'll see ${possessive(name)} progress, calendar and results here once they have a subscription.`}
    </StateCard>
  );
}

export function GuardianRevokedState({
  name,
}: {
  name: string | null;
}): JSX.Element {
  return (
    <StateCard
      testId="guardian-state-revoked"
      title={`${name ?? "This student"} is no longer linked to your account`}
      alert
      action={
        <Link
          href={guardianPaths.home}
          className="inline-flex min-h-[48px] w-fit items-center rounded-md border border-border px-5 text-base font-semibold no-underline"
        >
          Back to your students
        </Link>
      }
    >
      Their progress, calendar and results are no longer available to you. If
      this is a mistake, ask them for a new link code.
    </StateCard>
  );
}

export function GuardianNotSetUpState({ name }: { name: string }): JSX.Element {
  return (
    <StateCard
      testId="guardian-state-not-set-up"
      title={`${name} hasn't set up a study plan yet`}
    >
      {`${possessive(name)} calendar appears here once they set up their plan. There's nothing for you to do.`}
    </StateCard>
  );
}

export function GuardianNoExamsState({ name }: { name: string }): JSX.Element {
  return (
    <StateCard
      testId="guardian-state-no-exams"
      // G5-08: an attempt in progress now shows on the card ("In progress", the student's word),
      // so this is only ever the student's "Not started": no attempt at all.
      title={`${name} hasn't started a full-length test yet`}
    >
      Results appear here after they finish one.
    </StateCard>
  );
}

/** The one rendering of a failed per-student read. */
export function GuardianReadFailureState({
  failure,
  name,
  studentId,
  what,
  onRetry,
}: {
  failure: GuardianReadFailure;
  name: string;
  studentId: string;
  what: string;
  onRetry?: () => void;
}): JSX.Element {
  if (failure === "lapsed") {
    return <GuardianLapsedState name={name} studentId={studentId} ended />;
  }
  if (failure === "revoked") {
    return (
      <GuardianRevokedState name={name === "your student" ? null : name} />
    );
  }
  return (
    <GuardianErrorState
      what={what}
      {...(onRetry !== undefined ? { onRetry } : {})}
    />
  );
}
