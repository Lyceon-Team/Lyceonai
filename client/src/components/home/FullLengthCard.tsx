/**
 * Home's "Start a full-length test" card (both plans, every screen size).
 *
 * @spec [owner ruling (Karl, 2026-10-05; supersedes OQ-4, OQ-48 and the Full-Length part of
 *        OQ-62) items 3 and 4: on a phone, Full-Length is reached only from a scheduled calendar
 *        block or this card; the card is on Home at every size and, locked for a free student,
 *        opens the upgrade modal as the rail lock does; DESIGN.md §1 (one filled primary per
 *        surface, tokens only, 14px floor), §2 (rail locks), §4 Home; register §2 Free versus
 *        paid (no navigation and no gated request from a lock); OQ-29 (`exam_full_length` in the
 *        feature-access map, reason plan | age)] | @implemented [2026-10-05]
 *
 * plain English: a bordered card titled with the section's name, "Full-Length", the Full-Length
 * page's own approved subtitle (prototype FullLength.dc.html) as its one line, and the ruling's
 * action, "Start a full-length test". Granted (or no map yet): the action is a link to `/tests`,
 * the Full-Length home, which still shows its phone notice there. Locked: the action is a button
 * with the lock glyph that opens the upgrade modal for `exam_full_length` with the map's reason
 * (`age` gets the age message), in place: no href, so nothing navigates and no gated request is
 * made. The lock is read with the rail's own `featureLockReason`, so the two cannot disagree.
 *
 * trade-offs: the action is OUTLINE, not filled: Home already has its one primary ("Start today's
 * plan", "Set up your study calendar", "Start diagnostic" or "Go to practice"). No new sentence is
 * written: the title is the existing section label and the line is the page's approved subtitle.
 */
import { Lock } from "lucide-react";
import { Link } from "wouter";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import { featureLockReason, LOCK_SUFFIX } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";

/** The Full-Length page's subtitle (prototype FullLength.dc.html; TestsHomePage). */
export const FULL_LENGTH_CARD_LINE =
  "Timed like test day: two modules per section, a break between sections, and a scored report at the end.";

export const FULL_LENGTH_CARD_ACTION = "Start a full-length test";

const FULL_LENGTH_HREF = "/tests";

export function FullLengthCard(): JSX.Element {
  const access = useFeatureAccess();
  const { open } = useUpgradeModal();
  const reason = featureLockReason("exam_full_length", access);

  return (
    <section
      aria-labelledby="home-full-length-h"
      className="flex flex-col gap-4 rounded-lg border border-lyc-rule bg-lyc-sheet px-6 py-7 sm:px-10 sm:py-8"
      data-testid="home-full-length"
    >
      <h2
        id="home-full-length-h"
        className="m-0 font-lyc-serif text-lyc-section font-semibold text-lyc-ink-strong"
      >
        Full-Length
      </h2>
      <p className="m-0 max-w-[600px] text-[18px] leading-relaxed text-lyc-ink">
        {FULL_LENGTH_CARD_LINE}
      </p>
      <div>
        {reason === null ? (
          <Button asChild variant="lyc-outline" size="lyc">
            <Link href={FULL_LENGTH_HREF} data-testid="home-full-length-start">
              {FULL_LENGTH_CARD_ACTION}
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            variant="lyc-outline"
            size="lyc"
            aria-label={`${FULL_LENGTH_CARD_ACTION}, ${LOCK_SUFFIX[reason]}`}
            data-testid="home-full-length-start"
            onClick={() => open("exam_full_length", reason)}
          >
            {FULL_LENGTH_CARD_ACTION}
            <Lock
              aria-hidden="true"
              data-testid="home-full-length-lock"
              className="h-4 w-4"
              strokeWidth={2.25}
            />
          </Button>
        )}
      </div>
    </section>
  );
}
