/**
 * Practice: a compact "Full-length test" row, on every screen size, for both plans.
 *
 * @spec [Karl, 2026-10-13 on #1230, item 1: "add a compact 'Full-length test' row on the
 *       Practice page (phone and desktop), linking to the full-length page with the same
 *       entitlement and locks as before"; owner ruling (Karl, 2026-10-05) items 3–4 (the locked
 *       entry opens the upgrade modal as the rail lock does); register §2 Free versus paid (no
 *       navigation and no gated request from a lock); OQ-29 (`exam_full_length`, reason
 *       plan | age); DESIGN.md §5 (one filled primary per screen)] | @implemented [2026-10-13]
 *
 * plain English: the phone's way into full-length tests now that Home's card is gone (Full-Length
 * is on neither phone surface by design). It is the size and shape of the "Find your blind spots"
 * row: a title, the Full-Length page's own approved subtitle, and a text action on the right.
 *   - Granted (or no access map yet): "Start" is a link to `/tests`, the Full-Length home, whose
 *     Start and Resume ask the shared phone pre-start check (OQ-63). The link starts nothing.
 *   - Locked: "Start" is a button with the lock glyph that opens the upgrade modal for
 *     `exam_full_length` with the map's reason (`age` gets the age message), in place: no href,
 *     so nothing navigates and no gated request is made.
 * The lock is read with the rail's own `featureLockReason` and named with its `LOCK_SUFFIX`, so the
 * rail and this row cannot disagree. The action is a text link, never filled: Practice's one
 * primary is "Start practice".
 */
import { Lock } from "lucide-react";
import { Link } from "wouter";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import { featureLockReason, LOCK_SUFFIX } from "@/components/layout/app-shell";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";

const TITLE = "Full-length test";

/** The Full-Length page's approved subtitle (prototype FullLength.dc.html; TestsHomePage). */
const LINE =
  "Timed like test day: two modules per section, a break between sections, and a scored report at the end.";

const FULL_LENGTH_HREF = "/tests";

const ACTION =
  "bg-transparent p-0 text-[17px] font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline";

export function FullLengthRow(): JSX.Element {
  const access = useFeatureAccess();
  const { open } = useUpgradeModal();
  const reason = featureLockReason("exam_full_length", access);

  return (
    <section aria-label={TITLE} data-testid="practice-full-length">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-y border-lyc-rule py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-lg font-semibold text-lyc-ink">{TITLE}</span>
          <span className="text-base text-lyc-muted">{LINE}</span>
        </div>
        {reason === null ? (
          <Link
            href={FULL_LENGTH_HREF}
            className={ACTION}
            aria-label={`Start a ${TITLE.toLowerCase()}`}
            data-testid="practice-full-length-start"
          >
            Start
          </Link>
        ) : (
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 ${ACTION}`}
            aria-label={`Start a ${TITLE.toLowerCase()}, ${LOCK_SUFFIX[reason]}`}
            onClick={() => open("exam_full_length", reason)}
            data-testid="practice-full-length-start"
          >
            Start
            <Lock
              aria-hidden="true"
              className="h-4 w-4"
              strokeWidth={2.25}
              data-testid="practice-full-length-lock"
            />
          </button>
        )}
      </div>
    </section>
  );
}
