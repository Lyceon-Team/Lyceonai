import { useId } from "react";
import { Lock } from "lucide-react";
import { MasteryMeterSegments } from "@/components/mastery/MasteryMeter";

/** Widths of the ghost name bars: shapes only, standing for no domain in particular. */
const GHOST_NAME_WIDTHS = ["w-36", "w-28", "w-32"] as const;

/**
 * @spec [student-UI register §2 ("The free user's mastery slot is a locked card: 'Track mastery
 *   by domain and skills'. It shows empty bar outlines only, never fake data"), UI-42;
 *   DESIGN.md §3 (Locked mastery card: right panel, free plan, empty segment outlines, "See
 *   what's included" opens the modal); coding standards §10 (no invented metrics)]
 *   | @implemented [2026-10-03]
 *
 * plain English: what a free student sees in the mastery slot. A lock, the headline, three
 * ghost rows — a blank name bar and five EMPTY segments each — one line of copy, and an outline
 * "See what's included" button. The ghost rows carry no level, no name and no number: they are
 * shapes, hidden from assistive technology, and every segment is the empty colour. Nothing about
 * the student's mastery is fetched or drawn, so nothing can leak or be invented.
 *
 * The button calls `onSeeWhatsIncluded`. The upgrade modal (UI-44) is built separately and the
 * caller wires it; this card opens nothing itself and makes no request.
 *
 * `headingLevel` follows the panel it sits in (Home's right panel: h2; Practice's, under its
 * own "Mastery" heading: h3 — the prototypes).
 */
export function LockedMasteryCard({
  onSeeWhatsIncluded,
  headingLevel = 2,
}: {
  onSeeWhatsIncluded: () => void;
  headingLevel?: 2 | 3;
}): JSX.Element {
  const headingId = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3.5 rounded-lg border border-lyc-rule bg-lyc-sheet p-[22px]"
      data-testid="locked-mastery-card"
    >
      <Lock
        aria-hidden="true"
        className="h-[22px] w-[22px] text-lyc-ink-strong"
        strokeWidth={1.75}
      />
      <Heading
        id={headingId}
        className="m-0 font-lyc-serif text-lyc-panel font-semibold text-lyc-ink-strong"
      >
        Track mastery by domain and skills
      </Heading>
      <div
        aria-hidden="true"
        className="flex flex-col gap-2.5"
        data-testid="locked-mastery-ghosts"
      >
        {GHOST_NAME_WIDTHS.map((width) => (
          <div key={width} className="flex items-center justify-between gap-3">
            <span className={`h-2.5 rounded-full bg-lyc-seg-empty ${width}`} />
            <MasteryMeterSegments
              filled={0}
              fillClass="bg-lyc-seg-empty"
              size="compact"
            />
          </div>
        ))}
      </div>
      <p className="m-0 text-base leading-normal text-lyc-muted">
        See your level in all eight SAT domains and every skill inside them.
      </p>
      <button
        type="button"
        onClick={onSeeWhatsIncluded}
        className="h-11 self-start rounded-md border border-lyc-ink-strong bg-transparent px-[18px] text-base font-semibold text-lyc-ink-strong hover:bg-lyc-hover"
        data-testid="locked-mastery-see-included"
      >
        See what&apos;s included
      </button>
    </section>
  );
}
