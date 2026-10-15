/**
 * Home: three equal entry points, Practice, Review and Full-Length, at the bottom of the main
 * column, free and paid, at every width.
 *
 * @spec [owner ruling (Karl, 2026-10-15, on #1233) "Home: three equal entry points": one compact
 *       section at the bottom of Home's main column, three equal-weight rows in the order
 *       Practice, Review, Full-Length, each a name, one short muted line and a text-link action,
 *       no filled button; Review's count is the server's; Full-Length locked for free students
 *       opens the upgrade modal as the rail lock does; supersedes final brief v2 §4's removal of
 *       Home's full-length card and its "Go to Practice" / "Go to Review" outline buttons;
 *       register §2 Free versus paid (no navigation and no gated request from a lock); OQ-29
 *       (`exam_full_length`, reason plan | age); OQ-63 (the phone pre-start check);
 *       DESIGN.md §5 (one filled primary per screen)] | @implemented [2026-10-15]
 *
 * plain English: the rows are the size and shape of a "Pick up where you left off" row (a name,
 * a muted line, a text action on the right), so none outranks another and Home keeps its one
 * filled action ("Start today's plan", or the checklist's step / the blind-spots card).
 *   - Practice: "Questions on any skill", "Start" opens /practice.
 *   - Review: "{N} waiting from past mistakes", or "Nothing waiting" at 0, "Review" opens /review.
 *     N is the review pool's `total` (GET /api/review/pool, the same read the Review page counts
 *     from), passed in by the Home that already holds it. When that read failed, N is unknown and
 *     the line says what the page holds without a number: never a 0 the server did not send.
 *   - Full-Length: "A timed test, like test day". Granted (or no access map yet): "Start" is a
 *     link to /tests, the Full-Length page, whose Start and Resume ask the shared phone
 *     pre-start check (OQ-63); this link starts nothing. Locked: "Start" is a button with the
 *     lock glyph that opens the upgrade modal for `exam_full_length` with the map's reason, in
 *     place: no href, so nothing navigates and no gated request is made. The lock is read with
 *     the rail's own `featureLockReason` and named with its `LOCK_SUFFIX` (the server's
 *     featureAccess map, never a client role), as the Practice page's Full-length row does.
 * Phones have no Full-Length tab, so this row is Home's way there on a phone: nothing here is
 * hidden at any width.
 */
import { Lock } from "lucide-react";
import { Link } from "wouter";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import { featureLockReason, LOCK_SUFFIX } from "@/components/layout/app-shell";
import { LYC_FOCUS } from "@/components/ui/button";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";

/** The ruling's words, one place. */
const HOME_ENTRY_COPY = {
  practice: {
    name: "Practice",
    line: "Questions on any skill",
    action: "Start",
  },
  review: { name: "Review", action: "Review" },
  fullLength: {
    name: "Full-Length",
    line: "A timed test, like test day",
    action: "Start",
  },
} as const;

/** "5 waiting from past mistakes"; "Nothing waiting" at 0; no number when the read failed. */
function reviewWaitingLine(waiting: number | null): string {
  if (waiting === null) return "Questions from past mistakes";
  return waiting === 0
    ? "Nothing waiting"
    : `${waiting} waiting from past mistakes`;
}

const ROW =
  "flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-lyc-rule py-4";
const ACTION = `${LYC_FOCUS} bg-transparent p-0 text-[17px] font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline`;

function RowText({ name, line }: { name: string; line: string }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-lg font-semibold text-lyc-ink">{name}</span>
      <span className="text-base text-lyc-muted">{line}</span>
    </div>
  );
}

export function HomeEntryPoints({
  reviewWaiting,
}: {
  /** The review pool's `total`; null when the read failed. */
  reviewWaiting: number | null;
}): JSX.Element {
  const access = useFeatureAccess();
  const { open } = useUpgradeModal();
  const lock = featureLockReason("exam_full_length", access);
  const { practice, review, fullLength } = HOME_ENTRY_COPY;

  return (
    <section
      aria-label="Practice, Review and Full-Length"
      data-testid="home-entry-points"
    >
      <ul className="m-0 list-none border-t border-lyc-rule p-0">
        <li className={ROW} data-testid="home-entry-practice">
          <RowText name={practice.name} line={practice.line} />
          <Link
            href="/practice"
            className={ACTION}
            aria-label="Start practice"
            data-testid="home-entry-practice-action"
          >
            {practice.action}
          </Link>
        </li>
        <li className={ROW} data-testid="home-entry-review">
          <RowText name={review.name} line={reviewWaitingLine(reviewWaiting)} />
          <Link
            href="/review"
            className={ACTION}
            data-testid="home-entry-review-action"
          >
            {review.action}
          </Link>
        </li>
        <li className={ROW} data-testid="home-entry-full-length">
          <RowText name={fullLength.name} line={fullLength.line} />
          {lock === null ? (
            <Link
              href="/tests"
              className={ACTION}
              aria-label="Start a full-length test"
              data-testid="home-entry-full-length-action"
            >
              {fullLength.action}
            </Link>
          ) : (
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 ${ACTION}`}
              aria-label={`Start a full-length test, ${LOCK_SUFFIX[lock]}`}
              onClick={() => open("exam_full_length", lock)}
              data-testid="home-entry-full-length-action"
            >
              {fullLength.action}
              <Lock
                aria-hidden="true"
                className="h-4 w-4"
                strokeWidth={2.25}
                data-testid="home-entry-full-length-lock"
              />
            </button>
          )}
        </li>
      </ul>
    </section>
  );
}
