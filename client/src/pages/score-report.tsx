/**
 * The post-exam score report and retake answer.
 *
 * @spec [Doc-01_V8 §36.4, §928, §955; SCL-191;
 *        lyceon-coding-standards §11.1 (no business logic in components), §11.2 (TanStack Query
 *        for all server state), §11.3 (the server always enforces), §11.4 (derive inline, never
 *        in an effect)]
 * | @implemented [2026-09-30]
 *
 * plain English: one page that asks two questions — what did you score, and are you taking it
 * again — and says plainly what each answer does to the subscription. Expected outcome: a student
 * can answer both in under a minute, and nobody is surprised by a cancellation.
 *
 * THE SERVER DECIDES EVERYTHING HERE. The occasion comes from the prompt we sent
 * (`GET /api/score-report`), so this page cannot invent one; `viewer_role` says whether this
 * student's answer can end the subscription, and the page renders different copy rather than
 * deciding different behaviour. A student on a guardian-funded subscription is told, honestly,
 * that their guardian is the one being charged — because the alternative is a button that claims
 * to cancel and does not (§11.3: the server always enforces, and the UI must not promise
 * otherwise).
 *
 * NOTHING IS DERIVED IN AN EFFECT (§11.4). The three form fields are local state because they are
 * local state; everything else is read from the query or computed inline in the render body.
 *
 * WHY THE TOTAL IS TYPED AND NOT COMPUTED. It is the third number on the College Board report and
 * typing it is the cheap check that the other two were read off the right lines — the server
 * refuses a total that is not their sum, and that refusal is the point. Computing it here would
 * throw away the only redundancy the form has.
 */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// A DEEP IMPORT, NOT THE BARREL, and the build gate is why. `@lyceon/shared`'s index re-exports
// `env.ts`, whose Zod schema names CSRF_SECRET and three Stripe keys; pulling the barrel into a
// client chunk puts those NAMES in a browser bundle and
// `scripts/ci/...`'s secret-token scan fails the build on it. No value leaks either way — the
// schema holds key names, not values — but the scanner cannot tell a name from a value, and it is
// right not to try. Every other client file importing shared VALUES does the same (for example
// `upgrade.tsx` and `GuardianPurchaseCard.tsx`).
import {
  SECTION_SCORE_MAX,
  SECTION_SCORE_MIN,
  SCORE_STEP,
  TOTAL_SCORE_MAX,
  TOTAL_SCORE_MIN,
  type RenewalDecision,
  type RenewalPromptView,
} from "../../../packages/shared/src/exam-score-renewal-schema";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SURFACE_KEY = ["/api/score-report"] as const;

type SurfaceResponse = { data: RenewalPromptView };

function formatDate(localDate: string): string {
  // A plain calendar date, rendered without a Date parse: `new Date("2026-09-12")` is midnight
  // UTC, which is the day before in every western-hemisphere zone — and this string is already
  // the student's own local date.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (match === null) return localDate;
  return `${Number(match[3])}/${Number(match[2])}/${match[1]}`;
}

export default function ScoreReportPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [rw, setRw] = useState("");
  const [math, setMath] = useState("");
  const [total, setTotal] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const surface = useQuery<SurfaceResponse>({ queryKey: SURFACE_KEY });

  const scoreMutation = useMutation({
    mutationFn: async (body: {
      occasion_key: string;
      rw_score: number;
      math_score: number;
      total_score: number;
    }) => {
      const res = await apiRequest("/api/score-report", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return (await res.json()) as unknown;
    },
    onSuccess: () => {
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: SURFACE_KEY });
    },
    onError: () =>
      setFormError(
        "We could not save those scores. Check them against your College Board report and try again.",
      ),
  });

  const decisionMutation = useMutation({
    mutationFn: async (body: {
      occasion_key: string;
      decision: RenewalDecision;
      confirm?: boolean;
    }) => {
      const res = await apiRequest("/api/score-report/renewal", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return (await res.json()) as unknown;
    },
    onSuccess: () => {
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: SURFACE_KEY });
    },
    onError: () =>
      setFormError("We could not save that answer. Please try again."),
  });

  if (surface.isLoading) {
    return <main className="p-6">Loading…</main>;
  }

  const prompt = surface.data?.data;
  if (prompt === undefined) {
    // 404 is the ordinary case here, not an error state: most of the time there is nothing to
    // answer. Saying so plainly beats an empty form.
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-xl font-semibold">Nothing to answer right now</h1>
        <p className="mt-2 text-muted-foreground">
          When your exam date has passed and your scores are out, we'll ask you
          here.
        </p>
      </main>
    );
  }

  const canEndSubscription = prompt.viewer_role === "payer";
  const submitScores = (event: FormEvent): void => {
    event.preventDefault();
    const parsed = {
      rw_score: Number(rw),
      math_score: Number(math),
      total_score: Number(total),
    };
    if (
      !Number.isInteger(parsed.rw_score) ||
      !Number.isInteger(parsed.math_score) ||
      !Number.isInteger(parsed.total_score)
    ) {
      setFormError("Enter all three numbers from your score report.");
      return;
    }
    scoreMutation.mutate({ occasion_key: prompt.occasion_key, ...parsed });
  };

  return (
    <main className="mx-auto max-w-xl space-y-8 p-6">
      <header>
        <h1 className="text-xl font-semibold">
          {prompt.anchor === "exam_date"
            ? `Your SAT on ${formatDate(prompt.occasion_key)}`
            : `Your subscription renews on ${formatDate(prompt.occasion_key)}`}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {prompt.anchor === "exam_date"
            ? "Two questions. The first one helps us check our projection against what actually happened."
            : "One question, so we only keep charging you while you're still preparing."}
        </p>
      </header>

      {prompt.anchor === "exam_date" && (
        <section aria-labelledby="scores-heading" className="space-y-4">
          <h2 id="scores-heading" className="font-medium">
            What did you score?
          </h2>
          {prompt.report === null ? (
            <form className="space-y-3" onSubmit={submitScores}>
              <label className="block text-sm">
                Reading and Writing
                <Input
                  type="number"
                  inputMode="numeric"
                  min={SECTION_SCORE_MIN}
                  max={SECTION_SCORE_MAX}
                  step={SCORE_STEP}
                  value={rw}
                  onChange={(e) => setRw(e.target.value)}
                  data-testid="input-rw-score"
                />
              </label>
              <label className="block text-sm">
                Math
                <Input
                  type="number"
                  inputMode="numeric"
                  min={SECTION_SCORE_MIN}
                  max={SECTION_SCORE_MAX}
                  step={SCORE_STEP}
                  value={math}
                  onChange={(e) => setMath(e.target.value)}
                  data-testid="input-math-score"
                />
              </label>
              <label className="block text-sm">
                Total
                <Input
                  type="number"
                  inputMode="numeric"
                  min={TOTAL_SCORE_MIN}
                  max={TOTAL_SCORE_MAX}
                  step={SCORE_STEP}
                  value={total}
                  onChange={(e) => setTotal(e.target.value)}
                  data-testid="input-total-score"
                />
              </label>
              <Button
                type="submit"
                disabled={scoreMutation.isPending}
                data-testid="button-submit-scores"
              >
                Save my scores
              </Button>
            </form>
          ) : (
            <p data-testid="text-reported-score">
              You reported {prompt.report.total_score} ({prompt.report.rw_score}{" "}
              Reading and Writing, {prompt.report.math_score} Math).
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="retake-heading" className="space-y-4">
        <h2 id="retake-heading" className="font-medium">
          {prompt.anchor === "exam_date"
            ? "Are you taking the SAT again?"
            : "Are you still preparing?"}
        </h2>

        {prompt.decision === null ? (
          <>
            <p className="text-sm text-muted-foreground">
              {canEndSubscription
                ? "If you're done, we'll stop your subscription at the end of the period you've already paid for — nothing is cut off early. If we don't hear from you within two weeks, we'll do the same."
                : "Your guardian is the one being charged, so they decide whether the subscription continues. Telling us you're still preparing keeps it going."}
            </p>
            <div className="flex gap-3">
              <Button
                onClick={() =>
                  decisionMutation.mutate({
                    occasion_key: prompt.occasion_key,
                    decision: "retaking",
                  })
                }
                disabled={decisionMutation.isPending}
                data-testid="button-decision-retaking"
              >
                {prompt.anchor === "exam_date"
                  ? "Yes, I'm taking it again"
                  : "Yes, keep it going"}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  decisionMutation.mutate({
                    occasion_key: prompt.occasion_key,
                    decision: "not_retaking",
                    // The server refuses an unconfirmed `not_retaking`; this button IS the
                    // confirmation, and the copy above says what it does before it is pressed.
                    confirm: true,
                  })
                }
                disabled={decisionMutation.isPending}
                data-testid="button-decision-not-retaking"
              >
                {canEndSubscription
                  ? "No — end it at the end of the period"
                  : "No, I'm done"}
              </Button>
            </div>
          </>
        ) : (
          <p data-testid="text-recorded-decision">
            {prompt.decision === "retaking"
              ? "You told us you're still preparing, so the subscription continues."
              : canEndSubscription
                ? "Your subscription will end at the end of the period you've already paid for. You can undo that here or in the billing portal."
                : "We've recorded that you're done. Your guardian is the one being charged, so the subscription is theirs to end."}
          </p>
        )}
      </section>

      {formError !== null && (
        <p
          role="alert"
          className="text-destructive"
          data-testid="text-form-error"
        >
          {formError}
        </p>
      )}
    </main>
  );
}
