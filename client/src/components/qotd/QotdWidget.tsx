/**
 * Today's Question of the Day, answerable without an account.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R16 (homepage, no login, same rendering as
 *       practice), R17 (answer + pre-written explanation on submit, no LISA, "% of students got
 *       this right" only at >= 5 attempts), Q3; SCL-202 item 2 (Turnstile on submit); owner
 *       Step 0 decisions 2026-10-05] | @implemented [2026-10-05]
 *
 * plain English: fetches today's question in the browser (so no prerendered HTML ever holds a
 * day's question before it is answered), renders it with the practice QuestionRenderer, and on
 * submit sends the choice and a Turnstile token. The response carries correctness, the correct
 * choice and the explanation, and the success-rate stat only when the server shows it.
 *
 * Owner ruling 2026-10-05 (QOTD follow-up, items 1-3) | updated [2026-10-05]:
 *   * the options arrive shuffled, each identified by an opaque token; they are lettered A-D by
 *     on-screen position (QuestionRenderer), and the reveal names the correct option by token, so
 *     it is marked in this visitor's own order;
 *   * ONE ANSWER PER VISIT: once a submit succeeds the widget locks — the choice can no longer
 *     change and nothing can be submitted again on this page. Nothing is stored, so a reload can
 *     answer again; the server counts only the first attempt per hashed IP per day anyway;
 *   * Turnstile loads on interaction: its script is fetched only once the visitor first picks
 *     an answer (or types one), never on page load.
 *
 * Privacy: the question-and-answer area carries `ph-no-capture`, so no session recording or
 * autocapture records what a visitor picked (owner ruling). Nothing is written to browser
 * storage; a reload starts the question fresh. No randomness anywhere.
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import QuestionRenderer from "@/components/question-renderer";
import {
  QotdRequestError,
  qotdTodayQueryOptions,
  submitQotdAnswer,
} from "@/lib/qotd";
import { TurnstileWidget } from "./turnstile";
import { QotdLoading } from "./QotdLoading";
import type {
  QotdStat,
  QotdSubmitResponse,
} from "../../../../packages/shared/src/qotd-schema";

const SECTION_NAME: Record<"M" | "RW", string> = {
  M: "Math",
  RW: "Reading and Writing",
};

function submitErrorMessage(err: unknown): string {
  if (err instanceof QotdRequestError) {
    if (err.code === "turnstile_failed")
      return "The check did not go through. Please complete it again and resubmit.";
    if (err.status === 429)
      return "Too many answers from this network right now. Please try again later.";
    if (err.code === "qotd_day_changed")
      return "A new question is up. Reload the page to see it.";
  }
  return "Your answer could not be checked right now. Please try again.";
}

/**
 * The day's success rate, once the server shows it (5 or more counted attempts, R17).
 *
 * @spec [plan R17; owner approval 2026-10-05: "N% answered correctly" replaces "N% of students
 *       got this right" (claim inventory; Doc 10A follow-up)] | @implemented [2026-10-06] |
 * plain English: states what was measured (answers, counted once per network) rather than who
 * gave them; the server cannot know the people behind a count are students.
 */
export function QotdStatLine({ stat }: { stat: QotdStat }): JSX.Element | null {
  if (stat.status !== "shown") return null;
  return (
    <p className="text-sm text-muted-foreground" data-testid="qotd-stat">
      {stat.percent_correct}% answered correctly.
    </p>
  );
}

export function QotdWidget({
  showArchiveLink = true,
  afterReveal = null,
}: {
  showArchiveLink?: boolean;
  /** Shown under the reveal once the visitor has answered (the homepage's signup button, F13). */
  afterReveal?: ReactNode;
}): JSX.Element {
  const today = useQuery(qotdTodayQueryOptions());
  const [choice, setChoice] = useState<string | null>(null);
  const [gridValue, setGridValue] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [turnstileDown, setTurnstileDown] = useState(false);
  // A Turnstile token is single-use: a new key remounts the widget for a fresh one.
  const [widgetKey, setWidgetKey] = useState(0);
  const [result, setResult] = useState<QotdSubmitResponse | null>(null);
  // Set by the first pick or keystroke; mounts Turnstile (and so loads its script) from then on.
  const [interacted, setInteracted] = useState(false);

  const submit = useMutation({
    mutationFn: submitQotdAnswer,
    onSuccess: (data) => setResult(data),
    onError: () => {
      setToken(null);
      setWidgetKey((k) => k + 1);
    },
  });

  if (today.isPending) {
    return <QotdLoading />;
  }
  if (today.isError) {
    const notYet =
      today.error instanceof QotdRequestError && today.error.status === 404;
    // QOTD resilience brief (Karl, 2026-10-09) §1, the homepage's no-question state (an SEO-owned
    // surface: only this state changed): one collapsed line, no empty card, no error, no spinner.
    if (notYet) {
      return (
        <p className="m-0 text-lg" data-testid="qotd-none">
          Today&apos;s question is on its way. Check back soon.
        </p>
      );
    }
    return (
      <p className="text-muted-foreground" data-testid="qotd-unavailable">
        Today&apos;s question could not be loaded. Please try again later.
      </p>
    );
  }

  const { qotd_date: date, question } = today.data;
  const isGrid = question.item_type === "grid_in";
  const answer = isGrid ? gridValue.trim() : (choice ?? "");
  const locked = result !== null;
  const canSubmit =
    !locked && answer.length > 0 && token !== null && !submit.isPending;

  const pick = (key: string): void => {
    if (locked || submit.isPending) return;
    setChoice(key);
    setInteracted(true);
  };
  const type = (value: string): void => {
    if (locked || submit.isPending) return;
    setGridValue(value);
    setInteracted(true);
  };
  const send = (): void => {
    // The lock, enforced here as well as by the disabled button: one answer per visit.
    if (!canSubmit) return;
    submit.mutate({
      qotd_date: date,
      answer,
      turnstile_token: token ?? "",
    });
  };

  return (
    <div data-testid="qotd-widget" className="space-y-5">
      <p className="text-sm font-medium text-muted-foreground">
        {SECTION_NAME[question.section_code]} · {question.domain}
      </p>
      {/* ph-no-capture: no recording or autocapture of the question, the choice or the reveal.
          `lyc`, light-locked: QuestionRenderer is drawn on the student tokens (UI-53), which
          exist only under a .lyc root; without one its choices lose their borders and fills.
          The root's paper background is suppressed so the widget keeps the page's own surface
          (merge of PR 1069, owner choice 2026-10-05). */}
      <div
        className="lyc ph-no-capture"
        data-theme-lock="light"
        style={{ background: "transparent" }}
        data-testid="qotd-question-area"
      >
        <QuestionRenderer
          question={{
            itemType: question.item_type,
            stem: question.stem,
            passage: question.passage,
            options: question.options,
          }}
          selectedAnswer={choice}
          onSelectAnswer={pick}
          freeResponseAnswer={gridValue}
          onFreeResponseAnswerChange={type}
          showResult={result !== null}
          isCorrect={result?.is_correct ?? null}
          correctOptionId={result?.correct_option_id ?? null}
          correctAnswer={result?.correct_answer ?? null}
          explanation={result?.explanation ?? null}
          disabled={locked || submit.isPending}
        />
      </div>

      {result ? (
        <div data-testid="qotd-locked" className="space-y-4">
          <QotdStatLine stat={result.stats} />
          {afterReveal}
        </div>
      ) : (
        <div className="space-y-3">
          {interacted ? (
            <TurnstileWidget
              key={widgetKey}
              onToken={setToken}
              onUnavailable={() => setTurnstileDown(true)}
            />
          ) : null}
          {turnstileDown ? (
            <p className="text-sm text-muted-foreground">
              The security check could not load. Please reload the page to
              answer.
            </p>
          ) : null}
          <button
            type="button"
            data-testid="qotd-submit"
            disabled={!canSubmit}
            onClick={send}
            className="px-5 py-2.5 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submit.isPending ? "Checking…" : "Check my answer"}
          </button>
          {submit.isError ? (
            <p className="text-sm text-rose-700" role="alert">
              {submitErrorMessage(submit.error)}
            </p>
          ) : null}
        </div>
      )}

      {showArchiveLink ? (
        <p className="text-sm">
          <Link
            href="/sat-question-of-the-day"
            className="underline underline-offset-2 hover:opacity-80"
          >
            See past SAT questions of the day
          </Link>
        </p>
      ) : null}
    </div>
  );
}
