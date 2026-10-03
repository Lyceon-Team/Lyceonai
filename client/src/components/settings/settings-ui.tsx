/**
 * The Settings page's small shared pieces: the section heading, the sheet box and the field
 * classes, from `Settings.dc.html` (28px serif section title; a --sheet box with a hairline
 * --rule border, 8px radius, 24px 28px padding; 17px labels over 46px inputs with an
 * --input-bd border; 15px muted helper lines).
 *
 * @spec [DESIGN.md §1 (tokens only, 14px floor, one primary action), §4 Settings; prototype
 *        Settings.dc.html; UI-58] | @implemented [2026-10-03]
 *
 * plain English: presentation only. Every colour is a student token, so the sections follow the
 * device theme with the rest of the App shell.
 */
import type { ReactNode } from "react";
import { LYC_FOCUS } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const FIELD_LABEL =
  "flex flex-col gap-2 text-[17px] font-semibold text-lyc-ink";

export const FIELD_INPUT = `${LYC_FOCUS} h-[46px] w-full rounded-md border border-lyc-input-bd bg-lyc-sheet px-3.5 text-[17px] font-normal text-lyc-ink`;

export const FIELD_HELP = "m-0 text-lyc-meta-lg font-normal text-lyc-muted";

export function SectionHeading({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <h2
      id={id}
      className="m-0 font-lyc-serif text-lyc-section font-semibold tracking-normal text-lyc-ink-strong"
    >
      {children}
    </h2>
  );
}

export function SheetBox({
  children,
  tone = "sheet",
  className,
  "data-testid": testId,
}: {
  children: ReactNode;
  tone?: "sheet" | "danger";
  className?: string;
  "data-testid"?: string;
}): JSX.Element {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex flex-col gap-4 rounded-lg border px-5 py-6 sm:px-7",
        tone === "danger"
          ? "border-lyc-danger bg-lyc-danger-bg"
          : "border-lyc-rule bg-lyc-sheet",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function BoxHeading({
  children,
  tone = "ink",
}: {
  children: ReactNode;
  tone?: "ink" | "danger";
}): JSX.Element {
  return (
    <h3
      className={cn(
        "m-0 font-lyc-serif text-[21px] font-semibold tracking-normal",
        tone === "danger" ? "text-lyc-danger" : "text-lyc-ink-strong",
      )}
    >
      {children}
    </h3>
  );
}
