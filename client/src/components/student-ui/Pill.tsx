import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * @spec [owner ruling (Karl) 2026-10-13 on #1225 ("render domain, skill and difficulty as small
 *       chips (pills), difficulty in a neutral colour; use existing design tokens and any existing
 *       chip/pill primitive, do not fork a second one"); DESIGN.md §1 (tokens only), §5 (nothing
 *       below 14px)] | @implemented [2026-10-13]
 *
 * plain English: the student UI's small neutral pill: a `--chip` fill, a hairline `--rule`
 * border, 14px semibold `--ink` text. It is the recipe LISA's question chip already drew inline
 * (ScopedTutorPanel, OQ-54 (a), 2026-10-05), lifted here so the runner's question header and
 * LISA's chip are one style, not two copies of it. No colour variants on purpose: a pill says
 * what something is, never how good or hard it is (Karl, 2026-10-13: no green/amber/red
 * difficulty coding). Callers add layout classes (`truncate`, a wider radius for a pill that
 * can wrap) through `className`; extra props (`tabIndex`, `data-testid`, aria) pass through.
 */
export const PILL_CLASSES =
  "inline-block rounded-full border border-lyc-rule bg-lyc-chip px-2.5 py-0.5 text-lyc-meta font-semibold text-lyc-ink";

export function Pill({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement>): JSX.Element {
  return (
    <span className={cn(PILL_CLASSES, className)} {...rest}>
      {children}
    </span>
  );
}
