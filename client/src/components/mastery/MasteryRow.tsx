import { Link } from "wouter";
import type { MasteryLevelKey } from "@lyceon/shared/mastery-levels";
import { LevelPill } from "@/components/mastery/LevelPill";
import { MasteryMeter } from "@/components/mastery/MasteryMeter";

export type MasteryRowVariant = "wide" | "compact";

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
 * edge cases: a long name wraps (`min-w-0` on the wide grid's first track); unmeasured draws
 * five empty segments and the dashed pill, never a placeholder level.
 */
export function MasteryRow({
  label,
  levelKey,
  displayName,
  variant,
  href,
}: {
  label: string;
  levelKey: MasteryLevelKey;
  displayName: string;
  variant: MasteryRowVariant;
  href?: string;
}): JSX.Element {
  const layout =
    variant === "wide"
      ? "flex flex-col gap-2 py-3.5 sm:grid sm:grid-cols-[minmax(0,1fr)_176px_132px] sm:items-center sm:gap-6"
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
