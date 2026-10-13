/**
 * The "Getting started" checklist at the top of the student's Home.
 *
 * @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
 *       brief v2, Karl, 2026-10-13) §2 steps, §3 completion, §4 layout, §5 look; mocks v2
 *       approved 2026-10-13; ruling 4 (2026-10-13) for step 2's line] | @implemented [2026-10-13]
 *
 * plain English: the server says which steps this student sees and whether each is done, open or
 * skipped; this component only draws that.
 *   - Progress: a row of dots, one per step, filled when done or skipped, and "N of M".
 *   - The first open step is the only expanded one; its button is the page's one filled button.
 *     The email step also offers "Not now".
 *   - Done steps collapse to one ticked line; a skipped email step says so, with a link to turn it
 *     on in Settings; other open steps show a plain text link.
 *   - Complete: the card shrinks to "You're all set" with Dismiss.
 * Every step links to where it is completed (the server's href); today's question scrolls to the
 * card on this page instead of navigating.
 */
import { Link } from "wouter";
import type {
  GettingStartedResponse,
  GettingStartedStep,
  GettingStartedStepId,
} from "@lyceon/shared/getting-started-schema";
import { Button } from "@/components/ui/button";
import {
  useDismissGettingStarted,
  useSkipEmailStep,
} from "@/hooks/useGettingStarted";
import {
  BLIND_SPOTS_NAME,
  blindSpotsSubtitle,
  QOTD_BLIND_SPOTS_LINE,
} from "@/lib/blind-spots-copy";
import { cn } from "@/lib/utils";

const TEXT_LINK =
  "text-[17px] font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline";

type StepCopy = { title: string; body: string; cta: string; link: string };

export function stepCopy(
  id: GettingStartedStepId,
  diagnosticTotal: number | null,
): StepCopy {
  switch (id) {
    case "test_date":
      return {
        title: "Set your test date and target score",
        body: "Pick your SAT date, or choose “Not sure yet”, and the score you’re aiming for.",
        cta: "Set your date and score",
        link: "Set in Settings",
      };
    case "qotd":
      return {
        title: "Answer today’s Question of the Day",
        body: QOTD_BLIND_SPOTS_LINE,
        cta: "Answer today’s question",
        link: "Go to today’s question",
      };
    case "email":
      return {
        title: "Get the daily question by email",
        body: "A new question in your inbox each morning. You can turn it off any time.",
        cta: "Turn on in Settings",
        link: "Turn on in Settings",
      };
    case "blind_spots":
      return {
        title: BLIND_SPOTS_NAME,
        body: `${blindSpotsSubtitle(diagnosticTotal)}. See where to focus first.`,
        cta: BLIND_SPOTS_NAME,
        link: "Go to Practice",
      };
    case "review":
      return {
        title: "Review your mistakes",
        body: "Go back over the questions you missed while they’re fresh.",
        cta: "Start reviewing",
        link: "Go to Review",
      };
    case "calendar":
      return {
        title: "Create your study calendar",
        body: "A day-by-day plan up to your test date.",
        cta: "Create your calendar",
        link: "Open Study Calendar",
      };
    case "lisa":
      return {
        title: "Ask LISA",
        body: "Ask your tutor about any question you’re stuck on.",
        cta: "Ask LISA",
        link: "Open LISA",
      };
    case "guardian":
      return {
        title: "Link a guardian",
        body: "Let a parent or guardian follow your progress. They can view your work, never change it.",
        cta: "Link a guardian",
        link: "Go to Settings",
      };
  }
}

/** Today's question is on this page: scroll to it rather than navigate. */
function scrollToQotd(): void {
  document.getElementById("qotd")?.scrollIntoView({ behavior: "smooth" });
}

function StepLink({
  step,
  className,
  children,
  testId,
  ...rest
}: {
  step: GettingStartedStep;
  className?: string;
  children: string;
  testId: string;
} & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "children"
>): JSX.Element {
  if (step.id === "qotd") {
    return (
      <a
        {...rest}
        href="#qotd"
        className={className}
        onClick={(event) => {
          event.preventDefault();
          scrollToQotd();
        }}
        data-testid={testId}
        data-href={step.href}
      >
        {children}
      </a>
    );
  }
  return (
    <Link
      {...rest}
      href={step.href}
      className={className}
      data-testid={testId}
      data-href={step.href}
    >
      {children}
    </Link>
  );
}

function Mark({
  kind,
  n,
}: {
  kind: "done" | "skipped" | "open" | "current";
  n: number;
}): JSX.Element {
  const base =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[15px] font-bold";
  if (kind === "done")
    return (
      <span
        aria-hidden="true"
        className={cn(base, "bg-lyc-lv4-bg text-lyc-ok")}
      >
        ✓
      </span>
    );
  if (kind === "skipped")
    return (
      <span
        aria-hidden="true"
        className={cn(
          base,
          "border-[1.5px] border-dashed border-lyc-step text-lyc-muted",
        )}
      >
        –
      </span>
    );
  if (kind === "current")
    return (
      <span
        aria-hidden="true"
        className={cn(base, "bg-lyc-primary-bg text-lyc-primary-ink")}
      >
        {n}
      </span>
    );
  return (
    <span
      aria-hidden="true"
      className={cn(base, "border-[1.5px] border-lyc-step text-lyc-step")}
    >
      {n}
    </span>
  );
}

export function GettingStartedCard({
  data,
  diagnosticTotal,
}: {
  data: GettingStartedResponse;
  diagnosticTotal: number | null;
}): JSX.Element {
  const skip = useSkipEmailStep();
  const dismiss = useDismissGettingStarted();
  const total = data.steps.length;
  const finished = data.steps.filter((s) => s.status !== "open").length;
  const emailSkipped = data.steps.some(
    (s) => s.id === "email" && s.status === "skipped",
  );

  if (data.complete) {
    return (
      <section
        aria-label="Getting started"
        className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-lyc-rule bg-lyc-sheet px-6 py-5 sm:px-8"
        data-testid="getting-started"
        data-state="complete"
      >
        <div className="flex min-w-0 items-center gap-3.5">
          <Mark kind="done" n={0} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[20px] font-semibold text-lyc-ink-strong">
              You’re all set
            </span>
            {emailSkipped ? (
              <span className="text-base text-lyc-muted">
                Daily email skipped. You can turn it on any time in{" "}
                <Link
                  href="/profile?tab=notifications"
                  className="font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline"
                >
                  Settings
                </Link>
                .
              </span>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          variant="lyc-outline"
          pending={dismiss.isPending}
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate()}
          data-testid="getting-started-dismiss"
        >
          Dismiss
        </Button>
        {dismiss.isError ? (
          <p role="alert" className="m-0 w-full text-base text-lyc-danger">
            We couldn’t dismiss this. Please try again.
          </p>
        ) : null}
      </section>
    );
  }

  const current = data.steps.findIndex((s) => s.status === "open");

  return (
    <section
      aria-labelledby="getting-started-h"
      className="flex flex-col gap-5 rounded-lg border border-lyc-rule bg-lyc-sheet px-5 py-6 sm:px-10 sm:py-8"
      data-testid="getting-started"
      data-state="active"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="getting-started-h"
          className="m-0 font-lyc-serif text-[24px] font-semibold text-lyc-ink-strong sm:text-[28px]"
        >
          Getting started
        </h2>
        <span
          className="text-[17px] text-lyc-muted"
          data-testid="getting-started-count"
        >
          {finished} of {total}
        </span>
      </div>
      <div
        className="flex gap-2"
        aria-hidden="true"
        data-testid="getting-started-dots"
      >
        {data.steps.map((s) => (
          <span
            key={s.id}
            data-dot={s.status === "open" ? "open" : "filled"}
            className={cn(
              "h-3 w-3 rounded-full border-[1.5px]",
              s.status === "open"
                ? "border-lyc-step"
                : "border-lyc-ink-strong bg-lyc-ink-strong",
            )}
          />
        ))}
      </div>
      <ol className="m-0 list-none border-t border-lyc-rule p-0">
        {data.steps.map((step, i) => {
          const copy = stepCopy(step.id, diagnosticTotal);
          const testId = `getting-started-step-${step.id}`;
          if (i === current) {
            return (
              <li
                key={step.id}
                className="grid grid-cols-[28px_minmax(0,1fr)] gap-3.5 border-b border-lyc-rule pb-6 pt-5"
                data-testid={testId}
                data-status="current"
              >
                <Mark kind="current" n={i + 1} />
                <div className="flex min-w-0 flex-col gap-1.5">
                  <h3 className="m-0 font-lyc-serif text-[21px] font-semibold text-lyc-ink-strong sm:text-[22px]">
                    {copy.title}
                  </h3>
                  <p className="m-0 text-[17px] leading-normal text-lyc-muted">
                    {copy.body}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 pt-2.5">
                    <Button asChild variant="lyc-primary" size="lyc-lg">
                      <StepLink
                        step={step}
                        testId="getting-started-current-cta"
                      >
                        {copy.cta}
                      </StepLink>
                    </Button>
                    {step.id === "email" ? (
                      <Button
                        type="button"
                        variant="lyc-quiet"
                        size="lyc-lg"
                        pending={skip.isPending}
                        disabled={skip.isPending}
                        onClick={() => skip.mutate()}
                        data-testid="getting-started-not-now"
                      >
                        Not now
                      </Button>
                    ) : null}
                  </div>
                  {skip.isError && step.id === "email" ? (
                    <p role="alert" className="m-0 text-base text-lyc-danger">
                      We couldn’t save that. Please try again.
                    </p>
                  ) : null}
                </div>
              </li>
            );
          }
          if (step.status === "done") {
            return (
              <li
                key={step.id}
                className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-lyc-rule py-3.5"
                data-testid={testId}
                data-status="done"
              >
                <Mark kind="done" n={i + 1} />
                <span className="min-w-0 text-[17px] text-lyc-muted sm:text-lg">
                  {copy.title}
                </span>
                <span className="hidden text-base text-lyc-muted sm:inline">
                  Done
                </span>
              </li>
            );
          }
          if (step.status === "skipped") {
            return (
              <li
                key={step.id}
                className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-1 border-b border-lyc-rule py-3.5 sm:grid-cols-[28px_minmax(0,1fr)_auto]"
                data-testid={testId}
                data-status="skipped"
              >
                <Mark kind="skipped" n={i + 1} />
                <span className="min-w-0 text-[17px] text-lyc-muted sm:text-lg">
                  {copy.title}
                </span>
                <span className="col-start-2 text-base text-lyc-muted sm:col-start-auto">
                  Skipped ·{" "}
                  <StepLink
                    step={step}
                    className="font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline"
                    testId={`${testId}-link`}
                  >
                    Turn on in Settings
                  </StepLink>
                </span>
              </li>
            );
          }
          return (
            <li
              key={step.id}
              className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-1 border-b border-lyc-rule py-3.5 sm:grid-cols-[28px_minmax(0,1fr)_auto]"
              data-testid={testId}
              data-status="open"
            >
              <Mark kind="open" n={i + 1} />
              <span className="min-w-0 text-[17px] text-lyc-ink sm:text-lg">
                {copy.title}
              </span>
              <StepLink
                step={step}
                className={cn(TEXT_LINK, "col-start-2 sm:col-start-auto")}
                testId={`${testId}-link`}
              >
                {copy.link}
              </StepLink>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
