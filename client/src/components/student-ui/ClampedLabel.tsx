import { cn } from "@/lib/utils";

/**
 * @spec [owner brief "SAT date picker and UI control standards" (Karl, 2026-10-11) §2; DESIGN.md
 *       "UI standards" ("Long labels: truncate to 2 lines with an ellipsis (full text on
 *       hover/focus), never let a label push the layout")] | @implemented [2026-10-11]
 *
 * plain English: a label that never takes more than two lines. Longer text ends in an ellipsis;
 * the full text is the element's `title` (hover) and comes back in full while anything in the
 * enclosing `group` (the row the label names) has keyboard focus. Callers put `group` on that
 * row. The label never grows the row past two lines, so a long name cannot push the layout.
 */
export function ClampedLabel({
  text,
  className,
  "data-testid": testId,
}: {
  text: string;
  className?: string;
  "data-testid"?: string;
}): JSX.Element {
  return (
    <span
      title={text}
      className={cn(
        "line-clamp-2 break-words group-focus-within:line-clamp-none",
        className,
      )}
      data-testid={testId}
    >
      {text}
    </span>
  );
}
