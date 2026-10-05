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
 * Privacy: the question-and-answer area carries `ph-no-capture`, so no session recording or
 * autocapture records what a visitor picked (owner ruling). Nothing is written to browser
 * storage; a reload starts the question fresh. No randomness anywhere.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import QuestionRenderer from "@/components/question-renderer";
import {
  QotdRequestError,
  qotdTodayQueryOptions,
  submitQotdAnswer,
} from "@/lib/qotd";
import { TurnstileWidget } from "./turnstile";
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

export function QotdStatLine({ stat }: { stat: QotdStat }): JSX.Element | null {
  if (stat.status !== "shown") return null;
  return (
    <p className="text-sm text-muted-foreground" data-testid="qotd-stat">
      {stat.percent_correct}% of students got this right.
    </p>
  );
}

export function QotdWidget({
  showArchiveLink = true,
}: {
  showArchiveLink?: boolean;
}): JSX.Element {
  const today = useQuery(qotdTodayQueryOptions());
  const [choice, setChoice] = useState<string | null>(null);
  const [gridValue, setGridValue] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [turnstileDown, setTurnstileDown] = useState(false);
  // A Turnstile token is single-use: a new key remounts the widget for a fresh one.
  const [widgetKey, setWidgetKey] = useState(0);
  const [result, setResult] = useState<QotdSubmitResponse | null>(null);

  const submit = useMutation({
    mutationFn: submitQotdAnswer,
    onSuccess: (data) => setResult(data),
    onError: () => {
      setToken(null);
      setWidgetKey((k) => k + 1);
    },
  });

  if (today.isPending) {
    return (
      <p className="text-muted-foreground" data-testid="qotd-loading">
        Loading today&apos;s question…
      </p>
    );
  }
  if (today.isError) {
    const notYet =
      today.error instanceof QotdRequestError && today.error.status === 404;
    return (
      <p className="text-muted-foreground" data-testid="qotd-unavailable">
        {notYet
          ? "Today's question is not up yet. Check back soon."
          : "Today's question could not be loaded. Please try again later."}
      </p>
    );
  }

  const { qotd_date: date, question } = today.data;
  const isGrid = question.item_type === "grid_in";
  const answer = isGrid ? gridValue.trim() : (choice ?? "");
  const canSubmit =
    !result && answer.length > 0 && token !== null && !submit.isPending;

  return (
    <div data-testid="qotd-widget" className="space-y-5">
      <p className="text-sm font-medium text-muted-foreground">
        {SECTION_NAME[question.section_code]} · {question.domain}
      </p>
      {/* ph-no-capture: no recording or autocapture of the question, the choice or the reveal. */}
      <div className="ph-no-capture" data-testid="qotd-question-area">
        <QuestionRenderer
          question={{
            itemType: question.item_type,
            stem: question.stem,
            passage: question.passage,
            options: question.options,
          }}
          selectedAnswer={choice}
          onSelectAnswer={setChoice}
          freeResponseAnswer={gridValue}
          onFreeResponseAnswerChange={setGridValue}
          showResult={result !== null}
          isCorrect={result?.is_correct ?? null}
          correctOptionId={result?.correct_option_id ?? null}
          correctAnswer={result?.correct_answer ?? null}
          explanation={result?.explanation ?? null}
          disabled={result !== null || submit.isPending}
        />
      </div>

      {result ? (
        <QotdStatLine stat={result.stats} />
      ) : (
        <div className="space-y-3">
          <TurnstileWidget
            key={widgetKey}
            onToken={setToken}
            onUnavailable={() => setTurnstileDown(true)}
          />
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
            onClick={() =>
              submit.mutate({
                qotd_date: date,
                answer,
                turnstile_token: token ?? "",
              })
            }
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
