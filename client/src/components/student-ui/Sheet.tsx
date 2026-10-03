import type { ReactNode } from "react";
import {
  Sheet as SheetRoot,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useActiveThemeLock } from "@/components/layout/theme-lock";
import { cn } from "@/lib/utils";
import { MODAL_CLOSE_CLASS, MODAL_OVERLAY_CLASS } from "./Modal";

/**
 * @spec [student-UI register UI-46; DESIGN.md §1, §2 "Mobile"; register §2 Keyboard "Esc closes
 *       the open modal or sheet"; audit §6.2 "Modal / sheet"] | @implemented [2026-10-03]
 *
 * plain English: the student sheet (a panel docked to an edge of the screen), a thin composition
 * over ui/sheet, which is Radix Dialog underneath. Radix supplies the focus trap, Esc to close,
 * click-outside to close, focus returned to the opener, the page behind hidden from assistive
 * tech, and the labelled title
 * (`title` is required). This file styles it to the textbook look: --paper panel, a hairline
 * --rule edge instead of a shadow, the --scrim behind, a serif 20px panel heading, the same 44px
 * quiet close button as the Modal, and no slide animation (DESIGN.md §1 limits motion to the
 * LISA dots). `side` is right (default), left or bottom; bottom is the phone form, capped at 85%
 * of the viewport height and scrolling inside. The portal carries the `.lyc` root.
 */
export type SheetProps = {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  side?: "right" | "left" | "bottom";
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  className?: string;
  "data-testid"?: string;
};

const SIDE_CLASS: Record<NonNullable<SheetProps["side"]>, string> = {
  right: "w-full max-w-[420px] border-l sm:max-w-[420px]",
  left: "w-full max-w-[420px] border-r sm:max-w-[420px]",
  bottom: "max-h-[85vh] overflow-y-auto rounded-t-lg border-t",
};

export function Sheet({
  title,
  description,
  children,
  footer,
  side = "right",
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  className,
  "data-testid": testId = "student-sheet",
}: SheetProps) {
  // F-65: the portal takes the lock of the shell on screen (layout/theme-lock.tsx).
  const themeLock = useActiveThemeLock();
  return (
    <SheetRoot
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
      {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}
      <SheetContent
        side={side}
        data-testid={testId}
        portalClassName="lyc contents"
        portalThemeLock={themeLock}
        overlayClassName={MODAL_OVERLAY_CLASS}
        closeClassName={MODAL_CLOSE_CLASS}
        /* With no description, say so explicitly: Radix otherwise points aria-describedby at
           a description id that does not exist. */
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "flex flex-col gap-4 border-lyc-rule bg-lyc-paper p-8 text-lyc-body text-lyc-ink shadow-none duration-0 data-[state=closed]:animate-none data-[state=open]:animate-none",
          SIDE_CLASS[side],
          className,
        )}
      >
        <SheetTitle className="m-0 pr-10 font-lyc-serif text-lyc-panel font-semibold text-lyc-ink-strong">
          {title}
        </SheetTitle>
        {description ? (
          <SheetDescription className="m-0 text-lyc-body text-lyc-muted">
            {description}
          </SheetDescription>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col gap-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center gap-4 border-t border-lyc-rule pt-4">
            {footer}
          </div>
        ) : null}
      </SheetContent>
    </SheetRoot>
  );
}

export { SheetClose };
