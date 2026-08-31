import type { MasteryLevelKey } from "@/lib/masteryApi";

/**
 * @spec [owner ruling 2026-08-20 RULE 1 (the six level names come from `mastery_levels`);
 *   owner standing rule 2026-08-21 (one DTO, one shape — guardian surfaces render the
 *   student component, not a copy of it)] | @implemented [2026-08-21]
 *
 * plain English: renders one mastery level as its name, with a colour for the level. Used
 * by the student drill-down and by the guardian dashboard — the same component, so the two
 * cannot drift apart.
 *
 * The component maps a level to a COLOUR and never to a NAME. `displayName` arrives from
 * the server (`mastery_levels.display_name`) and is rendered verbatim; a client-side name
 * table would be a second source of truth for locked owner vocabulary.
 */
export function levelTone(levelKey: MasteryLevelKey): string {
  // Exhaustive with no `default` arm: a seventh level fails the build here rather than
  // silently rendering as unmeasured — which is the whole reason `unmeasured` is a row in
  // the database and not a fall-through in code.
  switch (levelKey) {
    case "unmeasured":
      return "bg-muted text-muted-foreground border-border";
    case "L0":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "L1":
      return "bg-orange-100 text-orange-900 border-orange-200";
    case "L2":
      return "bg-sky-100 text-sky-900 border-sky-200";
    case "L3":
      return "bg-blue-100 text-blue-900 border-blue-200";
    case "L4":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
  }
}

export function LevelPill({
  levelKey,
  displayName,
}: {
  levelKey: MasteryLevelKey;
  displayName: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${levelTone(levelKey)}`}
      data-testid="level-pill"
      data-level-key={levelKey}
    >
      {displayName}
    </span>
  );
}
