import type { MasteryLevelKey } from "@lyceon/shared/mastery-levels";
import { levelFill, levelTone } from "@/components/mastery/LevelPill";

/** Five segments: one per level from Foundations (`mastery_level` 0) to Strong (4). */
export const MASTERY_METER_SEGMENTS = 5;

/**
 * How many segments a level fills: L0–L4 (`mastery_level` 0–4) fill 1–5, the level index plus
 * one, and `unmeasured` ("Not enough answers yet", level null) fills none.
 *
 * The rule is the owner's (owner review 2026-10-01, final round item 3: "`mastery_level` 0–4
 * fills 1–5 segments and null fills 0"), restated by DESIGN.md §3 ("five segments filled to the
 * level"; unmeasured "shows empty segments") and drawn by the signed-off prototype (`lycRow`:
 * segment i is filled when `i <= lvl`). Unmeasured is NOT level 0 (owner ruling 2026-08-20
 * RULE 3): Foundations is a measured level and shows one segment.
 *
 * Keyed on `levelKey`, not on `level`: the shared schema's refine already makes the two agree
 * (`masteryLevelLabelInvariant`), and one input cannot disagree with itself. Exhaustive, with
 * no `default`, so a seventh level fails the build.
 *
 * Exported for the guardian Dashboard's mastery card (G5-03), which draws its own meter with the
 * same fill rule.
 */
export function masteryMeterFill(levelKey: MasteryLevelKey): number {
  switch (levelKey) {
    case "unmeasured":
      return 0;
    case "L0":
      return 1;
    case "L1":
      return 2;
    case "L2":
      return 3;
    case "L3":
      return 4;
    case "L4":
      return 5;
  }
}

/**
 * A level's INK: the pill's TEXT tone — the darker shade of the level's hue — as a class, for
 * painting a fill through `bg-current` (owner review 2026-10-01: the pale background shade read
 * too faint). Taken from `levelTone` itself, so a guardian meter, a legend swatch and the pill
 * cannot disagree on a level's colour. Used by the guardian Dashboard's mastery card (G5-03);
 * the student meter fills with `levelFill` (UI-42).
 */
export function levelInk(levelKey: MasteryLevelKey): string {
  return (
    levelTone(levelKey)
      .split(" ")
      .find((c) => c.startsWith("text-")) ?? "text-foreground"
  );
}

/**
 * The meter's accessible name. A measured level reads "Mastery: Developing, level 3 of 5" — the
 * ordinal of the level on the five-step ladder, never a score or a count of answers; the
 * unmeasured state reads "Mastery: Not enough answers yet", because it is not a level.
 */
function masteryMeterLabel(
  levelKey: MasteryLevelKey,
  displayName: string,
): string {
  const filled = masteryMeterFill(levelKey);
  return levelKey === "unmeasured"
    ? `Mastery: ${displayName}`
    : `Mastery: ${displayName}, level ${filled} of ${MASTERY_METER_SEGMENTS}`;
}

/**
 * Segment geometry. `fill` stretches across its container (the domain card); `wide` and
 * `compact` are the mastery row's fixed tracks (prototype Main.dc.html 30×10px, gap 6px;
 * Practice.dc.html 26×9px, gap 5px).
 */
type MasteryMeterSize = "fill" | "wide" | "compact";

function track(size: MasteryMeterSize): { row: string; seg: string } {
  switch (size) {
    case "fill":
      return { row: "flex w-full gap-1", seg: "h-2 flex-1" };
    case "wide":
      return { row: "flex gap-1.5", seg: "h-2.5 w-[30px]" };
    case "compact":
      return { row: "flex gap-[5px]", seg: "h-[9px] w-[26px]" };
  }
}

/**
 * The five segments as pure decoration, hidden from assistive technology. `filled` segments take
 * `fillClass`; the rest take `--seg-empty`. Exported for the locked card's empty outlines, which
 * are not a level and so must not be announced as one; everything that shows a level uses
 * `MasteryMeter`.
 */
export function MasteryMeterSegments({
  filled,
  fillClass,
  size,
}: {
  filled: number;
  fillClass: string;
  size: MasteryMeterSize;
}): JSX.Element {
  const { row, seg } = track(size);
  return (
    <span aria-hidden="true" className={row} data-testid="mastery-segments">
      {Array.from({ length: MASTERY_METER_SEGMENTS }, (_unused, index) => {
        const on = index < filled;
        return (
          <span
            key={index}
            data-segment={index + 1}
            data-filled={on ? "true" : "false"}
            className={`${seg} rounded-full ${on ? fillClass : "bg-lyc-seg-empty"}`}
          />
        );
      })}
    </span>
  );
}

/**
 * @spec [owner review 2026-10-01, final round item 3 (a five-segment meter under the pill,
 *   in `DomainGrid`); owner ruling 2026-08-20 RULE 1 (level names from `mastery_levels`),
 *   RULE 3 (unmeasured is its own state); Guardian_Closure_Plan R11 (one component for the
 *   student page and the guardian Dashboard), R12 (16px floor); student-UI register §2, UI-42;
 *   DESIGN.md §1 (mastery ramp), §3 (Mastery row)]
 *   | @implemented [2026-10-01; level-ramp tokens and row sizes 2026-10-03]
 *
 * plain English: the level as a row of five segments — the ONE segment renderer. `MasteryRow`
 * draws it beside the pill; `DomainGrid` draws it across a domain card. Filled segments take the
 * level's `--lvN-fill` token (`levelFill`, beside the pill's tones — no second colour table, no
 * hex); empty ones `--seg-empty`. It is ONE image to assistive technology, labelled by
 * `masteryMeterLabel` with the server's level name verbatim, and its segments are hidden, so a
 * screen reader hears the level once. It draws no text, so no type floor applies to it.
 *
 * Not a percentage and not a score: five ordered levels, drawn as five steps. Nothing here
 * invents a value the mastery model did not produce.
 */
export function MasteryMeter({
  levelKey,
  displayName,
  size = "fill",
}: {
  levelKey: MasteryLevelKey;
  displayName: string;
  size?: MasteryMeterSize;
}): JSX.Element {
  return (
    <span
      role="img"
      aria-label={masteryMeterLabel(levelKey, displayName)}
      className={size === "fill" ? "flex w-full" : "inline-flex"}
      data-testid="mastery-meter"
      data-level-key={levelKey}
    >
      <MasteryMeterSegments
        filled={masteryMeterFill(levelKey)}
        fillClass={levelFill(levelKey)}
        size={size}
      />
    </span>
  );
}
