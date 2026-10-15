/**
 * Home: three equal entry points, Practice, Review and Full-Length, at the bottom of the main
 * column, free and paid, at every width.
 *
 * @spec [owner ruling (Karl, 2026-10-15, on #1233) "Home: three equal entry points": one compact
 *       section at the bottom of Home's main column, three equal-weight rows in the order
 *       Practice, Review, Full-Length, each a title, one short muted line and a text-link action,
 *       no filled button, same height for all three; Review's count is the server's;
 *       Full-Length locked for free students opens the upgrade modal as the rail lock does;
 *       owner wording ruling (Karl, 2026-10-15, after #1233 merged): the rows' titles, lines and
 *       links below, which SUPERSEDE the first copy ("Practice" / "Questions on any skill",
 *       "Review" / "{N} waiting from past mistakes" / "Nothing waiting" / link "Review",
 *       "Full-Length" / "A timed test, like test day") and its failed-read fallback ("Questions
 *       from past mistakes"); register §2 Free versus paid (no navigation and no gated request
 *       from a lock); OQ-29 (`exam_full_length`, reason plan | age); OQ-63 (the phone pre-start
 *       check); DESIGN.md §5 (one filled primary per screen)] | @implemented [2026-10-15;
 *       wording 2026-10-15]
 *
 * plain English: the rows are the size and shape of a "Pick up where you left off" row (a title,
 * a muted line, a text action on the right), so none outranks another and Home keeps its one
 * filled action ("Start today's plan", or the checklist's step / the blind-spots card). The
 * titles say what the student does; they do not repeat the rail's section names.
 *   - "Work on new questions" / "Any skill, any difficulty" / Start opens /practice.
 *   - "Fix past mistakes" / "{N} waiting", or "All caught up" at 0 / Start opens /review. N is the
 *     review pool's `total` (GET /api/review/pool, the read the Review page counts from), passed
 *     in by the Home that holds it. When that read failed, N is unknown and the row has NO muted
 *     line (never a 0 the server did not send); an invisible, aria-hidden line keeps the row the
 *     same height as the other two.
 *   - "Take a full-length test" / "Timed, like test day". Granted (or no access map yet): Start is
 *     a link to /tests, the Full-Length page, whose Start and Resume ask the shared phone
 *     pre-start check (OQ-63); this link starts nothing. Locked: Start is a button with the lock
 *     glyph that opens the upgrade modal for `exam_full_length` with the map's reason, in place:
 *     no href, so nothing navigates and no gated request is made. The lock is read with the
 *     rail's own `featureLockReason` and named with its `LOCK_SUFFIX` (the server's featureAccess
 *     map, never a client role).
 *   - Every link says "Start", so each is named by its own words plus its row's title through
 *     `aria-labelledby` ("Start Work on new questions"; locked: "Start Take a full-length test
 *     (included with a paid plan)", the rail's lock words in a hidden span read only through
 *     the name): the visible word stays first in the name, and no two names are alike.
 * Phones have no Full-Length tab, so this row is Home's way there on a phone: nothing here is
 * hidden at any width.
 */
import { useId } from "react";
import { Lock } from "lucide-react";
import { Link } from "wouter";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import { featureLockReason, LOCK_SUFFIX } from "@/components/layout/app-shell";
import { LYC_FOCUS } from "@/components/ui/button";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";

/** Karl's wording (2026-10-15), one place. */
const HOME_ENTRY_COPY = {
  practice: {
    title: "Work on new questions",
    line: "Any skill, any difficulty",
  },
  review: { title: "Fix past mistakes" },
  fullLength: {
    title: "Take a full-length test",
    line: "Timed, like test day",
  },
  action: "Start",
} as const;

/** "5 waiting"; "All caught up" at 0; null (no line at all) when the read failed. */
function reviewWaitingLine(waiting: number | null): string | null {
  if (waiting === null) return null;
  return waiting === 0 ? "All caught up" : `${waiting} waiting`;
}

const ROW =
  "flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-lyc-rule py-4";
const ACTION = `${LYC_FOCUS} bg-transparent p-0 text-[17px] font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline`;

function RowText({
  titleId,
  title,
  line,
}: {
  titleId: string;
  title: string;
  line: string | null;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span id={titleId} className="text-lg font-semibold text-lyc-ink">
        {title}
      </span>
      {line !== null ? (
        <span
          className="text-base text-lyc-muted"
          data-testid="home-entry-line"
        >
          {line}
        </span>
      ) : (
        // No line, but the row keeps the others' height (one row height for all three).
        <span aria-hidden="true" className="invisible text-base">
          {"\u00a0"}
        </span>
      )}
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
  const { practice, review, fullLength, action } = HOME_ENTRY_COPY;
  const id = useId();
  const ids = {
    practice: `${id}-practice`,
    review: `${id}-review`,
    fullLength: `${id}-full-length`,
    lock: `${id}-lock`,
  };
  const actionId = (row: string): string => `${row}-action`;

  return (
    <section
      aria-label="Practice, Review and Full-Length"
      data-testid="home-entry-points"
    >
      <ul className="m-0 list-none border-t border-lyc-rule p-0">
        <li className={ROW} data-testid="home-entry-practice">
          <RowText
            titleId={ids.practice}
            title={practice.title}
            line={practice.line}
          />
          <Link
            href="/practice"
            id={actionId(ids.practice)}
            className={ACTION}
            aria-labelledby={`${actionId(ids.practice)} ${ids.practice}`}
            data-testid="home-entry-practice-action"
          >
            {action}
          </Link>
        </li>
        <li className={ROW} data-testid="home-entry-review">
          <RowText
            titleId={ids.review}
            title={review.title}
            line={reviewWaitingLine(reviewWaiting)}
          />
          <Link
            href="/review"
            id={actionId(ids.review)}
            className={ACTION}
            aria-labelledby={`${actionId(ids.review)} ${ids.review}`}
            data-testid="home-entry-review-action"
          >
            {action}
          </Link>
        </li>
        <li className={ROW} data-testid="home-entry-full-length">
          <RowText
            titleId={ids.fullLength}
            title={fullLength.title}
            line={fullLength.line}
          />
          {lock === null ? (
            <Link
              href="/tests"
              id={actionId(ids.fullLength)}
              className={ACTION}
              aria-labelledby={`${actionId(ids.fullLength)} ${ids.fullLength}`}
              data-testid="home-entry-full-length-action"
            >
              {action}
            </Link>
          ) : (
            <>
              <button
                type="button"
                id={actionId(ids.fullLength)}
                className={`inline-flex items-center gap-1.5 ${ACTION}`}
                aria-labelledby={`${actionId(ids.fullLength)} ${ids.fullLength} ${ids.lock}`}
                onClick={() => open("exam_full_length", lock)}
                data-testid="home-entry-full-length-action"
              >
                {action}
                <Lock
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={2.25}
                  data-testid="home-entry-full-length-lock"
                />
              </button>
              {/* Named only through the button's aria-labelledby (hidden, so read once). */}
              <span id={ids.lock} hidden>
                {`(${LOCK_SUFFIX[lock]})`}
              </span>
            </>
          )}
        </li>
      </ul>
    </section>
  );
}
