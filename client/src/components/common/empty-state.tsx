import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * @spec [student-UI register UI-46; DESIGN.md §1, audit §6.2 "Empty state"] |
 *       @implemented [2026-10-03]
 * plain English: the one EmptyState. `variant="lyc"` is the student look: a hairline-ruled
 * sheet (no card shadow), a serif heading in --ink-strong, the explanation in --muted at body
 * size, and the action as an OUTLINE button, never the filled one, because the filled primary
 * action belongs to the page. `icon` is an optional decorative glyph above the heading.
 * `headingLevel` makes the title a real heading where it starts a section (default: a plain
 * paragraph, which is what the default variant has always rendered). The default variant is
 * unchanged for the pages that use it today (UserProfile). The test ids are shared by both
 * variants.
 */
export type EmptyStateProps = {
  title?: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  variant?: "default" | "lyc";
  icon?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  className?: string;
  "data-testid"?: string;
};

export function EmptyState({
  title = "Nothing here yet",
  description = "Try changing filters or add new content.",
  action,
  variant = "default",
  icon,
  headingLevel,
  className,
  "data-testid": testId = "empty-state",
}: EmptyStateProps) {
  if (variant === "lyc") {
    const Heading =
      headingLevel === undefined ? "p" : (`h${headingLevel}` as const);
    return (
      <section
        data-testid={testId}
        data-variant="lyc"
        className={cn(
          "flex flex-col items-center gap-3 rounded-lg border border-lyc-rule bg-lyc-sheet px-8 py-10 text-center",
          className,
        )}
      >
        {icon ? (
          <div className="text-lyc-ink-strong" aria-hidden="true">
            {icon}
          </div>
        ) : null}
        <Heading
          className="m-0 font-lyc-serif text-lyc-panel font-semibold text-lyc-ink-strong"
          data-testid="empty-state-title"
        >
          {title}
        </Heading>
        <p
          className="m-0 max-w-prose text-lyc-body text-lyc-muted"
          data-testid="empty-state-description"
        >
          {description}
        </p>
        {action ? (
          <Button
            type="button"
            variant="lyc-outline"
            onClick={action.onClick}
            data-testid="empty-state-action"
            className="mt-2"
          >
            {action.label}
          </Button>
        ) : null}
      </section>
    );
  }

  return (
    <Card data-testid={testId} className={className}>
      <CardContent className="p-8 text-center space-y-3">
        <div className="text-lg font-medium" data-testid="empty-state-title">
          {title}
        </div>
        <p
          className="text-muted-foreground"
          data-testid="empty-state-description"
        >
          {description}
        </p>
        {action ? (
          <Button onClick={action.onClick} data-testid="empty-state-action">
            {action.label}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
