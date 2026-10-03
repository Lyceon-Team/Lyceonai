import { Link } from "wouter";
import { ChevronDown } from "lucide-react";
import type { MasteryLevelKey } from "@lyceon/shared/mastery-levels";
import { LevelPill } from "@/components/mastery/LevelPill";
import { MasteryMeter } from "@/components/mastery/MasteryMeter";

export type MasteryRowVariant = "wide" | "compact";

/** UI-57: the row as a show/hide button for the list with id `controls` (wide rows only). */
type MasteryRowDisclosure = {
  expanded: boolean;
  controls: string;
  onToggle: () => void;
};

/**
 * @spec [student-UI register §2 ("Mastery is shown as a five-segment bar filled to the level,
 *   plus the level label, on the production ladder (`mastery_levels`) … The same row component
 *   is used on Home, Practice, Review, Full-Length home and the Mastery page"), UI-42;
 *   DESIGN.md §3 (Mastery row: Home wide; Practice, Review, Full-Length compact; unmeasured shows
 *   empty segments and a dashed "Not enough answers yet" pill; values `mastery_level` only);
 *   owner ruling 2026-08-20 RULE 1, RULE 3] | @implemented [2026-10-03]
 *
 * plain English: one domain or skill as a row — its name, the five-segment `MasteryMeter`
 * filled to the level, and the `LevelPill` naming it. The two variants are the prototype's:
 * `wide` (Home, Main.dc.html) puts name, meter and pill on one line; `compact` (the right
 * panel, Practice.dc.html) puts the name above a line holding meter and pill. Below the `sm`
 * breakpoint `wide` stacks like `compact`, since its fixed tracks do not fit a phone.
 *
 * THE PILL TRACK IS 184px, NOT THE PROTOTYPE'S 132px (UI-57, 2026-10-03; owner question in the
 * UI-57 report, unratified). Main.dc.html's 132px fits the five level names but not the dashed
 * "Not enough answers yet" pill (about 183px at 15px), which then overlapped the meter: the
 * Mastery page showed it on every unmeasured skill, and Home would on any unmeasured domain. The
 * pill is right-aligned, so a measured pill sits where it did; the meter moves 52px left.
 *
 * WHAT IT SHOWS. The level and its server-sent name (`displayName`, from `mastery_levels`)
 * — nothing else. There is no prop for an accuracy, a score or a count, so none can be drawn.
 * The name of the level is never looked up here: the caller passes the server's words.
 *
 * ACCESSIBILITY. The meter is the row's one statement of the level ("Mastery: Developing,
 * level 3 of 5", or "Mastery: Not enough answers yet"). The pill repeats it visually, so it is
 * hidden from assistive technology rather than read twice.
 *
 * LINK. With `href` (normally `/mastery`) the whole row is the link, as in the prototype's
 * right panel; without it the row is static.
 *
 * DISCLOSURE (UI-57, the Mastery page). With `disclosure` the whole row is a button that shows
 * or hides the list it controls (`aria-expanded`, `aria-controls`): a domain row opening its
 * skills. A chevron (decoration, hidden from assistive technology) ends the row and points down
 * when the list is open. It adds no words: the button's name is the row's own label and meter.
 * `href` and `disclosure` are exclusive — a row is a link, a disclosure, or static.
 *
 * edge cases: a long name wraps (`min-w-0` on the wide grid's first track); unmeasured draws
 * five empty segments and the dashed pill, never a placeholder level.
 */
export function MasteryRow({
  label,
  levelKey,
  displayName,
  variant,
  href,
  disclosure,
}: {
  label: string;
  levelKey: MasteryLevelKey;
  displayName: string;
  variant: MasteryRowVariant;
  href?: string;
  disclosure?: MasteryRowDisclosure;
}): JSX.Element {
  const wideTracks =
    disclosure === undefined
      ? "sm:grid-cols-[minmax(0,1fr)_176px_184px]"
      : "relative pr-9 sm:pr-0 sm:grid-cols-[minmax(0,1fr)_176px_184px_20px]";
  const layout =
    variant === "wide"
      ? `flex flex-col gap-2 py-3.5 sm:grid ${wideTracks} sm:items-center sm:gap-6`
      : "flex flex-col gap-2 py-[11px]";
  const body =
    variant === "wide" ? (
      <>
        <span className="min-w-0 text-lg leading-snug text-lyc-ink">
          {label}
        </span>
        <MasteryMeter
          levelKey={levelKey}
          displayName={displayName}
          size="wide"
        />
        <span aria-hidden="true" className="sm:justify-self-end">
          <LevelPill
            levelKey={levelKey}
            displayName={displayName}
            size="wide"
          />
        </span>
        {disclosure === undefined ? null : (
          <ChevronDown
            aria-hidden="true"
            data-testid="mastery-row-chevron"
            className={`absolute right-1 top-4 h-5 w-5 text-lyc-ink-strong sm:static ${disclosure.expanded ? "rotate-180" : ""}`}
            strokeWidth={1.75}
          />
        )}
      </>
    ) : (
      <>
        <span className="text-base leading-snug text-lyc-ink">{label}</span>
        <span className="flex items-center justify-between gap-3">
          <MasteryMeter
            levelKey={levelKey}
            displayName={displayName}
            size="compact"
          />
          <span aria-hidden="true">
            <LevelPill
              levelKey={levelKey}
              displayName={displayName}
              size="compact"
            />
          </span>
        </span>
      </>
    );
  const className = `${layout} border-b border-lyc-rule-soft`;
  const data = {
    "data-testid": "mastery-row",
    "data-variant": variant,
    "data-level-key": levelKey,
  };
  if (disclosure !== undefined) {
    return (
      <button
        type="button"
        aria-expanded={disclosure.expanded}
        aria-controls={disclosure.controls}
        onClick={disclosure.onToggle}
        className={`${className} w-full bg-transparent text-left hover:bg-lyc-hover`}
        {...data}
      >
        {body}
      </button>
    );
  }
  return href === undefined ? (
    <div className={className} {...data}>
      {body}
    </div>
  ) : (
    <Link
      href={href}
      className={`${className} no-underline hover:bg-lyc-hover`}
      {...data}
    >
      {body}
    </Link>
  );
}
