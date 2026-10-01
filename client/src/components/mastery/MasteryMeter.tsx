import type {
  MasteryLevel,
  MasteryLevelKey,
} from "@lyceon/shared/mastery-levels";
import { levelTone } from "@/components/mastery/LevelPill";

/** Five segments: one per level from Foundations (`mastery_level` 0) to Strong (4). */
export const MASTERY_METER_SEGMENTS = 5;

/**
 * How many segments a level fills: `mastery_level` 0–4 fills 1–5, and null — "Not enough
 * answers yet", the unmeasured state — fills none. Null is NOT level 0 (owner ruling
 * 2026-08-20 RULE 3): Foundations is a measured level and shows one segment; an unmeasured
 * domain shows an empty meter.
 */
export function masteryMeterFill(level: MasteryLevel): number {
  return level === null ? 0 : level + 1;
}

/**
 * @spec [owner review 2026-10-01, final round item 3 (a five-segment meter under the pill,
 *   in `DomainGrid`); owner ruling 2026-08-20 RULE 1 (level names from `mastery_levels`),
 *   RULE 3 (unmeasured is its own state); Guardian_Closure_Plan R11 (one component for the
 *   student page and the guardian Dashboard), R12 (16px floor)] | @implemented [2026-10-01]
 *
 * plain English: the level as a row of five segments beneath its `LevelPill`, spanning the
 * card's content width. Filled segments are painted in that level's pill TEXT tone
 * (`levelTone`, the same classes — no second colour table, no hex); empty ones a neutral
 * token. It is ONE image to assistive technology — "Mastery:
 * Proficient, 4 of 5", the server's level name verbatim — and its segments are hidden, so a
 * screen reader hears the level once rather than five unlabelled shapes. It draws no text,
 * so the 16px floor has nothing to apply to.
 *
 * Not a percentage and not a score: five ordered levels, drawn as five steps. Nothing here
 * invents a value the mastery model did not produce.
 */
export function MasteryMeter({
  levelKey,
  level,
  displayName,
}: {
  levelKey: MasteryLevelKey;
  level: MasteryLevel;
  displayName: string;
}): JSX.Element {
  const filled = masteryMeterFill(level);
  // The pill's TEXT tone — the darker shade of the level's hue — painted as the fill through
  // `bg-current` (owner review 2026-10-01: the pale background shade read too faint). Taken
  // from `levelTone` itself, so the meter and the pill cannot disagree on a level's colour.
  const ink =
    levelTone(levelKey)
      .split(" ")
      .find((c) => c.startsWith("text-")) ?? "text-foreground";
  return (
    <span
      role="img"
      aria-label={`Mastery: ${displayName}, ${filled} of ${MASTERY_METER_SEGMENTS}`}
      className="flex w-full gap-1"
      data-testid="mastery-meter"
    >
      {Array.from({ length: MASTERY_METER_SEGMENTS }, (_unused, index) => {
        const on = index < filled;
        return (
          <span
            key={index}
            aria-hidden="true"
            data-segment={index + 1}
            data-filled={on ? "true" : "false"}
            className={`h-2 flex-1 rounded-full border ${on ? `${ink} bg-current border-current` : "bg-muted border-border"}`}
          />
        );
      })}
    </span>
  );
}
