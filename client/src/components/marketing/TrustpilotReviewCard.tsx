/**
 * The homepage's Trustpilot card: a static, text-only invitation to review.
 *
 * @spec [final brief "Trustpilot card on the homepage + 'Feedback' across the site" (Karl,
 *       2026-10-20) §1: between the FAQ and the final call to action; "a static, text-only card:
 *       no Trustpilot script or widget, no logo or stars, no rating shown, and no third-party
 *       requests"; the approved copy; hidden if VITE_TRUSTPILOT_REVIEW_URL was unset at build
 *       time; Trustpilot Legal Brand Guidelines (Feb 2023): "Link back to your Trustpilot profile
 *       page when using our brand on your website"; Trustpilot Guidelines for Businesses (Sept
 *       2026): invitations "fair, neutral, and unbiased with no incentives offered", reviewers
 *       "over 18"] | @implemented [2026-10-20]
 *
 * plain English: two plain links and three lines of text, in the homepage's own card and outline
 * button. Nothing loads from Trustpilot until someone clicks. The page is prerendered, so whether
 * the card exists is decided by the build: no review URL, no card. The same words for every
 * visitor; nothing asks how anyone felt first. Later, with about 10 reviews, Karl may switch to
 * Trustpilot's official widget (not now).
 */
import { trustpilotReviewUrl } from "@/lib/product-feedback-api";
import { TRUSTPILOT_PROFILE_URL } from "../../../../packages/shared/src/product-feedback-schema";

export function TrustpilotReviewCard({
  cardClass,
  buttonClass,
  reviewUrl = trustpilotReviewUrl(),
}: {
  /** The page's own card and outline-button classes, so the card matches its section. */
  cardClass: string;
  buttonClass: string;
  reviewUrl?: string | null;
}): JSX.Element | null {
  if (reviewUrl === null) return null;
  return (
    <div
      className={`${cardClass} flex flex-col gap-5 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8`}
      data-testid="trustpilot-card"
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-bold sm:text-2xl">
          Used Lyceon? Tell others how it went.
        </h2>
        <p className="text-muted-foreground">
          Parents and students 18+ can share their experience on Trustpilot.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <a
          href={reviewUrl}
          target="_blank"
          rel="noopener"
          className={buttonClass}
          data-testid="trustpilot-card-review"
        >
          Review us on Trustpilot ↗
        </a>
        <a
          href={TRUSTPILOT_PROFILE_URL}
          target="_blank"
          rel="noopener"
          className="min-h-11 content-center font-semibold underline underline-offset-4"
          data-testid="trustpilot-card-profile"
        >
          See reviews
        </a>
      </div>
    </div>
  );
}
