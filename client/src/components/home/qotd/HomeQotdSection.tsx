/**
 * Home's Question of the Day block: the card, the email prompt, and the SAT-date card.
 *
 * @spec [owner brief "Question of the Day on Home, daily streak, email, SAT dates in onboarding"
 *       (Karl, decisions 2026-10-08/09) "Home, top to bottom" 3 and 4, "Email prompt rule",
 *       acceptance 10; Coding Standards §5.2 (the card never has the answer before submit),
 *       §11.1 (components render; the hooks fetch), §11.4 (no effect for derived state)]
 *       | @implemented [2026-10-09]
 *
 * plain English:
 *  - No question today (state "none": no scheduled question, or its question was withdrawn): the
 *    card is drawn collapsed, the same shape as "done", saying "Today's question is on its way.
 *    Check back soon." The streak chip is unaffected (QOTD resilience brief, Karl 2026-10-09 §1).
 *  - Unanswered: "Today's question", the stem, the choices lettered A-D by position (the shared
 *    QuestionRenderer; each choice is an opaque token), and Submit. Submit mints ONE
 *    idempotency key per press.
 *  - Just answered (this visit): the result and the explanation, the chip celebrates (the page
 *    owns the chip, so it is told through `onStreakExtended`), then the email prompt if the
 *    server allows it.
 *  - Answered on an earlier visit today: collapsed to "✓ Today's question done · 🔥 N-day streak
 *    · New question tomorrow", with "See explanation" to open it.
 *  - Below the card, while the student has no SAT date saved and today's question is done (or
 *    there is none): "Pick your SAT date to see your countdown", saved through the calendar's
 *    one profile write.
 *  - `#qotd` (the daily email's "Answer now" link) scrolls the card into view on arrival.
 */
import { useEffect, useState } from "react";
import type { HomeQotdTodayResponse } from "@lyceon/shared/home-qotd-schema";
import QuestionRenderer from "@/components/question-renderer";
import {
  SatDatePicker,
  type SatDateChoice,
} from "@/components/sat-dates/SatDatePicker";
import { Notice } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import {
  newIntent,
  useStudyProfile,
  useStudyProfileMutation,
} from "@/features/calendar/api";
import {
  useAnswerHomeQotd,
  useHomeQotd,
  useQotdEmailDecision,
  type QotdEmailDecision,
} from "@/hooks/useHomeQotd";
import { HttpApiError } from "@/lib/api-error";
import { chicagoToday } from "@shared/sat-test-dates";
import { QotdEmailPrompt } from "./QotdEmailPrompt";

const CARD =
  "flex flex-col gap-5 rounded-lg border border-lyc-rule bg-lyc-sheet px-6 py-7 sm:px-10 sm:py-8";
const CARD_H2 =
  "m-0 font-lyc-serif text-[26px] font-semibold leading-tight text-lyc-ink-strong";
const SECTION_NAME = { M: "Math", RW: "Reading and Writing" } as const;

export function HomeQotdSection({
  onStreakExtended,
}: {
  onStreakExtended: () => void;
}): JSX.Element | null {
  const today = useHomeQotd();
  const data = today.data;

  if (today.isLoading) return null;
  if (today.isError) {
    return (
      <Notice
        title="We couldn’t load today’s question."
        message="Try again in a moment."
        actionLabel="Try again"
        onAction={() => void today.refetch()}
        data-testid="home-qotd-error"
      />
    );
  }
  if (data === undefined) return null;

  return (
    <>
      {data.state === "none" ? (
        <NoQuestionToday />
      ) : (
        <QotdCard
          key={data.qotd_date}
          data={data}
          onStreakExtended={onStreakExtended}
        />
      )}
      {data.state === "unanswered" ? null : <SatDateCard />}
    </>
  );
}

/** QOTD resilience brief §1: the collapsed card for a day with no question (no empty card). */
const QOTD_ON_ITS_WAY_COPY = "Today's question is on its way. Check back soon.";

function NoQuestionToday(): JSX.Element {
  return (
    <section
      id="qotd"
      aria-label="Today's question"
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-lyc-rule bg-lyc-sheet px-6 py-5 sm:px-8"
      data-testid="home-qotd"
      data-state="none"
    >
      <p className="m-0 text-[17px] text-lyc-ink" data-testid="home-qotd-none">
        {QOTD_ON_ITS_WAY_COPY}
      </p>
    </section>
  );
}

type DayData = Exclude<HomeQotdTodayResponse, { state: "none" }>;

function QotdCard({
  data,
  onStreakExtended,
}: {
  data: DayData;
  onStreakExtended: () => void;
}): JSX.Element {
  const answer = useAnswerHomeQotd();
  const decide = useQotdEmailDecision();
  const [choice, setChoice] = useState<string | null>(null);
  const [gridValue, setGridValue] = useState("");
  const [justAnswered, setJustAnswered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);

  // The daily email links to /dashboard#qotd: bring the card into view on arrival. A side
  // effect on mount (scrolling), not derived state.
  useEffect(() => {
    if (window.location.hash === "#qotd") {
      document
        .getElementById("qotd")
        ?.scrollIntoView({ block: "start", behavior: "auto" });
    }
  }, []);

  const question = data.question;
  const isGrid = question.item_type === "grid_in";
  const result = data.state === "answered" ? data.result : null;

  const submit = (): void => {
    if (answer.isPending) return;
    const body = isGrid
      ? {
          qotd_date: data.qotd_date,
          grid_answer: gridValue.trim(),
          idempotency_key: crypto.randomUUID(),
        }
      : {
          qotd_date: data.qotd_date,
          option_token: choice ?? "",
          idempotency_key: crypto.randomUUID(),
        };
    answer.mutate(body, {
      onSuccess: (response) => {
        setJustAnswered(true);
        if (response.streak_extended) onStreakExtended();
        if (response.show_email_prompt) setPromptOpen(true);
      },
    });
  };

  const onDecide = (decision: QotdEmailDecision): void => {
    decide.mutate(decision, { onSuccess: () => setPromptOpen(false) });
  };

  const answerError =
    answer.error instanceof HttpApiError && answer.error.status === 409
      ? "You've already answered today's question. Refresh to see it."
      : answer.error !== null
        ? "We couldn't check your answer. Please try again."
        : null;

  const renderer = (
    <div className="ph-no-capture" data-testid="home-qotd-question">
      <QuestionRenderer
        question={{
          itemType: question.item_type,
          stem: question.stem,
          passage: question.passage,
          options: question.options,
        }}
        selectedAnswer={result ? result.selected_option_id : choice}
        onSelectAnswer={(id) => {
          if (result === null && !answer.isPending) setChoice(id);
        }}
        freeResponseAnswer={gridValue}
        onFreeResponseAnswerChange={(v) => {
          if (result === null && !answer.isPending) setGridValue(v);
        }}
        showResult={result !== null}
        isCorrect={result?.is_correct ?? null}
        correctOptionId={result?.correct_option_id ?? null}
        correctAnswer={result?.correct_answer ?? null}
        explanation={result?.explanation ?? null}
        missNote
        disabled={result !== null || answer.isPending}
      />
    </div>
  );

  const prompt = (
    <QotdEmailPrompt
      open={promptOpen}
      showDontAskAgain={data.show_dont_ask_again}
      pending={decide.isPending}
      error={
        decide.error !== null
          ? "We couldn't save that. Please try again."
          : null
      }
      onDecide={onDecide}
    />
  );

  if (result !== null && !justAnswered && !expanded) {
    return (
      <section
        id="qotd"
        aria-label="Today's question"
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-lyc-rule bg-lyc-sheet px-6 py-5 sm:px-8"
        data-testid="home-qotd"
        data-state="collapsed"
      >
        <p
          className="m-0 text-[17px] text-lyc-ink"
          data-testid="home-qotd-collapsed"
        >
          ✓ Today&apos;s question done · 🔥 {data.streak.current}-day streak ·
          New question tomorrow
        </p>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="bg-transparent p-0 text-[17px] font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline"
          data-testid="home-qotd-see-explanation"
        >
          See explanation
        </button>
      </section>
    );
  }

  return (
    <section
      id="qotd"
      aria-labelledby="home-qotd-h"
      className={CARD}
      data-testid="home-qotd"
      data-state={result === null ? "unanswered" : "answered"}
    >
      <div className="flex flex-col gap-1.5">
        <h2 id="home-qotd-h" className={CARD_H2}>
          Today&apos;s question
        </h2>
        <p className="m-0 text-base text-lyc-muted">
          {SECTION_NAME[question.section_code]} · {question.domain}
        </p>
      </div>
      {renderer}
      {result === null ? (
        <div className="flex flex-col gap-3">
          {answerError !== null ? (
            <p role="alert" className="m-0 text-base text-lyc-danger">
              {answerError}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              variant="lyc-outline"
              size="lyc-lg"
              pending={answer.isPending}
              disabled={
                answer.isPending ||
                (isGrid ? gridValue.trim() === "" : choice === null)
              }
              onClick={submit}
              data-testid="home-qotd-submit"
            >
              Submit
            </Button>
          </div>
        </div>
      ) : (
        <p
          className="m-0 text-base text-lyc-muted"
          data-testid="home-qotd-next"
        >
          New question tomorrow.
        </p>
      )}
      {prompt}
    </section>
  );
}

/**
 * "Pick your SAT date to see your countdown" — only while no date is saved. Saves through the
 * calendar's one profile write (a dates-only save; it never completes calendar setup).
 */
function SatDateCard(): JSX.Element | null {
  const profile = useStudyProfile();
  const save = useStudyProfileMutation();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<SatDateChoice>({
    notSure: false,
    dates: [],
  });
  const todayChicago = chicagoToday();

  if (profile.isLoading || profile.isError) return null;
  const saved = (profile.data?.profile?.target_exam_dates ?? []).filter(
    (d) => d >= todayChicago,
  );
  if (saved.length > 0) return null;

  return (
    <section
      aria-labelledby="home-sat-date-h"
      className="flex flex-col gap-4 rounded-lg border border-lyc-rule bg-lyc-sheet px-6 py-5 sm:px-8"
      data-testid="home-sat-date-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h2
          id="home-sat-date-h"
          className="m-0 text-[17px] font-semibold text-lyc-ink-strong"
        >
          Pick your SAT date to see your countdown
        </h2>
        {open ? null : (
          <Button
            type="button"
            variant="lyc-outline"
            onClick={() => setOpen(true)}
            data-testid="home-sat-date-open"
          >
            Pick a date
          </Button>
        )}
      </div>
      {open ? (
        <>
          <SatDatePicker
            legend="When's your SAT?"
            value={choice}
            onChange={setChoice}
            today={todayChicago}
            data-testid="home-sat-dates"
          />
          {save.isError ? (
            <p role="alert" className="m-0 text-base text-lyc-danger">
              We couldn&apos;t save your date. Please try again.
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              variant="lyc-outline"
              pending={save.isPending}
              disabled={save.isPending || choice.dates.length === 0}
              onClick={() =>
                save.mutate(newIntent({ target_exam_dates: choice.dates }), {
                  onSuccess: () => setOpen(false),
                })
              }
              data-testid="home-sat-date-save"
            >
              Save
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
