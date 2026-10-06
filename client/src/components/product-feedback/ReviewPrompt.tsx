/**
 * The review prompt: one neutral card, three options side by side, always dismissible.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R28 ("One neutral review prompt for everyone —
 *       no review gating. Options side by side: in-app anonymous review ..., Trustpilot (guardians
 *       + 18+ ...), private feedback"), R29 (anonymous), R30 (cadence), row Q6; Doctrine §0.8
 *       (no review gating); owner answers 2026-10-05 (Trustpilot click = reviewed; choosing
 *       private feedback = shown)] | @implemented [2026-10-05]
 *
 * plain English: mount it on a success-moment page with the moment it stands for. It asks the
 * server once; the server checks the moment really happened, applies the cadence, and records
 * the showing. If the answer is yes, the card appears with:
 *   - "Leave a review": a 1–5 rating, optional text, and an UNTICKED "Lyceon may quote this
 *     anonymously";
 *   - "Review on Trustpilot": only when the server says the person is 18+ (guardians and adult
 *     students) AND `VITE_TRUSTPILOT_REVIEW_URL` is set;
 *   - "Send private feedback".
 *
 * NO GATING, BY CONSTRUCTION: nothing asks how the person feels before the options appear, and
 * every option is offered whatever rating is chosen — the rating never changes what is shown.
 *
 * "Not now" and the close button are a dismissal (counted once per showing on the server). A
 * review or the Trustpilot button ends the prompt for good; sending private feedback just closes
 * it (it was shown; it is not a dismissal).
 *
 * Privacy: the review area carries `ph-no-capture`.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  dismissReviewPrompt,
  recordTrustpilotClick,
  submitReview,
  trustpilotReviewUrl,
  useReviewPrompt,
} from "@/lib/product-feedback-api";
import { FeedbackDialog } from "./FeedbackDialog";
import { SURFACE, type Surface } from "./surface";
import {
  FEEDBACK_MAX_LENGTH,
  type ReviewPromptQuery,
} from "../../../../packages/shared/src/product-feedback-schema";

type Phase = "options" | "review" | "thanks" | "closed";

const RATINGS = [1, 2, 3, 4, 5] as const;

function RatingInput({
  value,
  onChange,
  variant,
}: {
  value: number | null;
  onChange: (rating: number) => void;
  variant: Surface;
}): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Rating, 1 to 5 stars"
      className="flex gap-1"
      data-testid="review-rating"
    >
      {RATINGS.map((n) => {
        const selected = value === n;
        const filled = value !== null && n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            data-testid={`review-rating-${n}`}
            onClick={() => onChange(n)}
            className="rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star
              className={`h-7 w-7 ${filled ? `fill-current ${SURFACE[variant].star}` : SURFACE[variant].starOff}`}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}

export function ReviewPrompt({
  query,
  enabled = true,
  variant = "default",
}: {
  query: ReviewPromptQuery;
  /** False until the page knows its moment is real (e.g. the report finished scoring). */
  enabled?: boolean;
  /** `lyc` on student pages (inside the `.lyc` root); `default` on guardian pages. */
  variant?: Surface;
}): JSX.Element | null {
  const look = SURFACE[variant];
  const prompt = useReviewPrompt(query, enabled);
  const [phase, setPhase] = useState<Phase>("options");
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [quote, setQuote] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const dismiss = useMutation({ mutationFn: dismissReviewPrompt });
  const trustpilot = useMutation({ mutationFn: recordTrustpilotClick });
  const review = useMutation({
    mutationFn: () =>
      submitReview({
        rating: rating ?? 0,
        body: text.trim() === "" ? null : text.trim(),
        quote_permission: quote,
      }),
    onSuccess: () => setPhase("thanks"),
  });

  if (prompt.data?.show !== true || phase === "closed") {
    // The feedback dialog outlives the card it was opened from.
    return feedbackOpen ? (
      <FeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        source="prompt"
      />
    ) : null;
  }

  const trustpilotUrl = prompt.data.trustpilot_eligible
    ? trustpilotReviewUrl()
    : null;

  const close = (): void => {
    if (phase === "options" || phase === "review") dismiss.mutate();
    setPhase("closed");
  };

  return (
    <section
      aria-labelledby="review-prompt-title"
      className={`relative ${look.box}`}
      data-testid="review-prompt"
    >
      <button
        type="button"
        onClick={close}
        aria-label="Close"
        data-testid="review-prompt-close"
        className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>

      {phase === "thanks" ? (
        <div className="space-y-3 pr-8">
          <h2 id="review-prompt-title" className={look.title}>
            Thanks for your review
          </h2>
          <p className={look.muted}>
            It helps the Lyceon team decide what to build next.
          </p>
          <Button
            variant={look.outline}
            onClick={() => setPhase("closed")}
            data-testid="review-prompt-done"
          >
            Done
          </Button>
        </div>
      ) : (
        <div className="space-y-4 pr-8">
          <div className="space-y-1">
            <h2 id="review-prompt-title" className={look.title}>
              Share your thoughts on Lyceon
            </h2>
            <p className={look.muted}>
              Leave a review, or send the team a private note. It takes a
              minute, and it&apos;s up to you.
            </p>
          </div>

          {phase === "options" ? (
            <div
              className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
              data-testid="review-prompt-options"
            >
              <Button
                variant={look.primary}
                onClick={() => setPhase("review")}
                data-testid="review-prompt-leave-review"
              >
                Leave a review
              </Button>
              {trustpilotUrl !== null ? (
                <Button variant={look.outline} asChild>
                  <a
                    href={trustpilotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="review-prompt-trustpilot"
                    onClick={() => {
                      trustpilot.mutate();
                      setPhase("closed");
                    }}
                  >
                    Review on Trustpilot
                  </a>
                </Button>
              ) : null}
              <Button
                variant={look.outline}
                onClick={() => {
                  setFeedbackOpen(true);
                  setPhase("closed");
                }}
                data-testid="review-prompt-feedback"
              >
                Send private feedback
              </Button>
              <Button
                variant={look.quiet}
                onClick={close}
                data-testid="review-prompt-not-now"
              >
                Not now
              </Button>
            </div>
          ) : (
            <form
              className="ph-no-capture space-y-4"
              data-testid="review-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (rating !== null && !review.isPending) review.mutate();
              }}
            >
              <div className="space-y-2">
                <p className="text-sm font-medium" id="review-rating-label">
                  Your rating
                </p>
                <RatingInput
                  value={rating}
                  onChange={setRating}
                  variant={variant}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="review-text">
                  Your review{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Textarea
                  id="review-text"
                  data-testid="review-text"
                  value={text}
                  maxLength={FEEDBACK_MAX_LENGTH}
                  onChange={(event) => setText(event.target.value)}
                  rows={4}
                />
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="review-quote-permission"
                  variant={look.checkbox}
                  data-testid="review-quote-permission"
                  checked={quote}
                  onCheckedChange={(checked) => setQuote(checked === true)}
                />
                <Label
                  htmlFor="review-quote-permission"
                  className="text-sm font-normal leading-5"
                >
                  Lyceon may quote this anonymously
                </Label>
              </div>
              <p className={look.note}>
                Reviews are anonymous. Please don&apos;t include your name or
                other personal details.
              </p>
              {review.isError ? (
                <p className={look.error} role="alert">
                  Your review couldn&apos;t be sent. Please try again.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  variant={look.primary}
                  disabled={rating === null || review.isPending}
                  data-testid="review-submit"
                >
                  {review.isPending ? "Sending…" : "Send review"}
                </Button>
                <Button
                  type="button"
                  variant={look.quiet}
                  onClick={() => setPhase("options")}
                >
                  Back
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
