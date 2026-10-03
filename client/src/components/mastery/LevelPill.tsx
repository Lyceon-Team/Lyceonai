import type { MasteryLevelKey } from "@lyceon/shared/mastery-levels";

/**
 * @spec [owner ruling 2026-08-20 RULE 1 (the six level names come from `mastery_levels`);
 *   owner standing rule 2026-08-21 (one DTO, one shape — guardian surfaces render the
 *   student component, not a copy of it); student-UI register UI-00e (these colours become the
 *   level-ramp tokens), UI-42; DESIGN.md §1 (mastery ramp `--lv0`..`--lv4`, nothing below
 *   14px), §3 (Mastery row: unmeasured shows a dashed "Not enough answers yet" pill)]
 *   | @implemented [2026-08-21; level-ramp tokens 2026-10-03]
 *
 * plain English: renders one mastery level as its name, with a colour for the level. Used
 * by the student drill-down, the mastery row (UI-42) and the guardian dashboard — the same
 * component, so they cannot drift apart.
 *
 * The component maps a level to a COLOUR and never to a NAME. `displayName` arrives from
 * the server (`mastery_levels.display_name`) and is rendered verbatim; a client-side name
 * table would be a second source of truth for locked owner vocabulary.
 *
 * COLOURS ARE THE LEVEL-RAMP TOKENS (UI-00e, 2026-10-03). L0–L4 use `--lvN-bg/-ink/-bd`
 * (`bg-lyc-lvN-bg` …), which `student-tokens.css` declares on `:root` as well as `.lyc`, so a
 * guardian page outside the student root keeps the same colours it had (UI-00e's values) and a
 * student page in the dark theme gets the dark ramp. Unmeasured is transparent with a DASHED
 * `--rule-strong` border (DESIGN.md §3). Its text is `--muted` inside `.lyc`; outside it,
 * index.css's own `--muted` is a pale BACKGROUND colour, so there the app-wide
 * `text-muted-foreground` stands in, and the `[.lyc_&]` variant switches it to the student
 * token wherever a `.lyc` ancestor exists. No hex, no palette classes: the grep guard
 * `mastery-tokens.test.ts` enforces it.
 */
export function levelTone(levelKey: MasteryLevelKey): string {
  // Exhaustive with no `default` arm: a seventh level fails the build here rather than
  // silently rendering as unmeasured — which is the whole reason `unmeasured` is a row in
  // the database and not a fall-through in code.
  switch (levelKey) {
    case "unmeasured":
      return "bg-transparent border-dashed border-lyc-rule-strong text-muted-foreground [.lyc_&]:text-lyc-muted";
    case "L0":
      return "bg-lyc-lv0-bg text-lyc-lv0-ink border-lyc-lv0-bd";
    case "L1":
      return "bg-lyc-lv1-bg text-lyc-lv1-ink border-lyc-lv1-bd";
    case "L2":
      return "bg-lyc-lv2-bg text-lyc-lv2-ink border-lyc-lv2-bd";
    case "L3":
      return "bg-lyc-lv3-bg text-lyc-lv3-ink border-lyc-lv3-bd";
    case "L4":
      return "bg-lyc-lv4-bg text-lyc-lv4-ink border-lyc-lv4-bd";
  }
}

/**
 * The colour a FILLED meter segment takes for a level: `--lvN-fill` (DESIGN.md §1; the
 * prototype's `lycRow`). Unmeasured fills no segment, so its arm is the empty-segment colour.
 * Kept beside `levelTone` so the ramp has one home.
 */
export function levelFill(levelKey: MasteryLevelKey): string {
  switch (levelKey) {
    case "unmeasured":
      return "bg-lyc-seg-empty";
    case "L0":
      return "bg-lyc-lv0-fill";
    case "L1":
      return "bg-lyc-lv1-fill";
    case "L2":
      return "bg-lyc-lv2-fill";
    case "L3":
      return "bg-lyc-lv3-fill";
    case "L4":
      return "bg-lyc-lv4-fill";
  }
}

/**
 * Pill sizes. `sm` is the drill-down and domain-card pill (14px); `compact` and `wide` are the
 * mastery row's (DESIGN.md §3; prototype Practice.dc.html 14px, Main.dc.html 15px). Nothing is
 * below 14px (DESIGN.md §1); on a guardian page `guardian-surface.css` raises all three to 16px.
 */
export type LevelPillSize = "sm" | "compact" | "wide";

function pillSize(size: LevelPillSize): string {
  switch (size) {
    case "sm":
      return "px-2.5 py-0.5 text-sm font-medium";
    case "compact":
      return "px-3 py-0.5 text-sm font-semibold";
    case "wide":
      return "px-3.5 py-1 text-[15px] font-semibold";
  }
}

export function LevelPill({
  levelKey,
  displayName,
  size = "sm",
}: {
  levelKey: MasteryLevelKey;
  displayName: string;
  size?: LevelPillSize;
}): JSX.Element {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border ${pillSize(size)} ${levelTone(levelKey)}`}
      data-testid="level-pill"
      data-level-key={levelKey}
    >
      {displayName}
    </span>
  );
}
