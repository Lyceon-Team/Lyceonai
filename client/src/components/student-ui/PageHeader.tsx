import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * @spec [student-UI register UI-46; DESIGN.md §1 "Typography", §2 "App shell"; audit §6.2
 *       "Page header"] | @implemented [2026-10-03]
 *
 * plain English: the one page header for student pages: an optional eyebrow (a short muted
 * label above the title), the page's single H1 in Source Serif 4 600 at the 42px title size
 * (28px on a phone), an optional description in the 19px muted body size, and an optional
 * actions slot that sits to the right of the text on wide screens and below it on a phone.
 * It draws no rule, card or background: on the textbook page the header is just type.
 * Renders inside the `.lyc` root the student shells provide (the colours are student tokens).
 * Edge cases: `titleId` lets a page point `aria-labelledby` at the H1; the actions slot holds at
 * most the page's one primary action plus outline buttons, which is the caller's to respect.
 */
type PageHeaderProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
  className?: string;
  "data-testid"?: string;
};

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  titleId,
  className,
  "data-testid": testId = "page-header",
}: PageHeaderProps) {
  return (
    <header
      data-testid={testId}
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-2.5">
        {eyebrow ? (
          <p
            className="m-0 text-lyc-meta-lg font-semibold uppercase tracking-[0.06em] text-lyc-muted"
            data-testid="page-header-eyebrow"
          >
            {eyebrow}
          </p>
        ) : null}
        <h1
          id={titleId}
          className="m-0 font-lyc-serif text-lyc-section font-semibold text-lyc-ink-strong sm:text-lyc-title"
        >
          {title}
        </h1>
        {description ? (
          <p
            className="m-0 text-lyc-body-lg text-lyc-muted"
            data-testid="page-header-description"
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          className="flex shrink-0 flex-wrap items-center gap-3"
          data-testid="page-header-actions"
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}
