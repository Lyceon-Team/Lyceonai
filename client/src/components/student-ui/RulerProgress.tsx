import { cn } from "@/lib/utils";

/**
 * @spec [DESIGN.md §3 "Ruler progress" (diagnostic card, free daily quota: 40 ticks, a taller
 *        tick every fifth); §1 (tokens only, no motion); prototype Main.dc.html (the diagnostic
 *        ruler and the "Today" quota ruler)] | @implemented [2026-10-03]
 *
 * plain English: a row of 40 thin ticks, every fifth one taller, the first `filled` drawn in
 * --ink-strong and the rest in --tick. Two sizes from the prototype: `card` (the diagnostic
 * card: 24px / 12px ticks, 9px apart) and `panel` (the right panel's quota: 20px / 10px, 4px
 * apart). The ticks spread to the available width up to the prototype's own width, so the card
 * size fits a phone. Decorative: hidden from assistive technology, because the sentence beside
 * it ("12 of 40 answered") is the statement; the ruler says nothing the text does not.
 *
 * Use `rulerFill` to turn a count of the student's own (answered, remaining) into ticks.
 */
export const RULER_TICKS = 40;

const SIZE = {
  card: {
    row: "h-6 max-w-[431px]",
    tall: "h-6",
    short: "h-3",
  },
  panel: {
    row: "h-5 max-w-[236px]",
    tall: "h-5",
    short: "h-2.5",
  },
} as const;

/** `part` of `whole` as a whole number of ticks, 0..40. A `whole` of 0 or less fills none. */
export function rulerFill(part: number, whole: number): number {
  if (!(whole > 0) || !(part > 0)) return 0;
  return Math.min(RULER_TICKS, Math.round((part / whole) * RULER_TICKS));
}

export function RulerProgress({
  filled,
  size,
  className,
  "data-testid": testId = "ruler-progress",
}: {
  filled: number;
  size: keyof typeof SIZE;
  className?: string;
  "data-testid"?: string;
}): JSX.Element {
  const on = Math.max(0, Math.min(RULER_TICKS, Math.round(filled)));
  const s = SIZE[size];
  return (
    <div
      aria-hidden="true"
      data-testid={testId}
      data-filled={on}
      className={cn("flex w-full items-end justify-between", s.row, className)}
    >
      {Array.from({ length: RULER_TICKS }, (_unused, i) => (
        <span
          key={i}
          data-tick={i < on ? "on" : "off"}
          className={cn(
            "w-0.5 shrink-0",
            i % 5 === 4 ? s.tall : s.short,
            i < on ? "bg-lyc-ink-strong" : "bg-lyc-tick",
          )}
        />
      ))}
    </div>
  );
}
