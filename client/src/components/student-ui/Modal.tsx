import type { ReactNode } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useActiveThemeLock } from "@/components/layout/theme-lock";
import { cn } from "@/lib/utils";

/**
 * @spec [student-UI register UI-46; DESIGN.md §1, §3 "Upgrade modal"; register §2 Keyboard
 *       "Esc closes the open modal or sheet"; audit §6.2 "Modal / sheet"] |
 *       @implemented [2026-10-03]
 *
 * plain English: the student modal, a thin composition over ui/dialog (Radix Dialog). Radix
 * supplies the behaviour: the focus trap, Esc to close, click-outside to close, focus returned to
 * the element that opened it, the rest of the page hidden from assistive tech, and the title wired to the dialog through
 * `aria-labelledby` (so `title` is required: a modal always has a labelled title). This file only
 * styles it to the textbook look, from the prototype's upgrade modal: --paper sheet, a hairline
 * --rule border and no shadow, the --scrim behind, a serif 28px title, an 18px body, a 44px quiet
 * close button top right (named "Close"), and no open/close animation (DESIGN.md §1 limits motion to the LISA
 * dots). The portal carries the `.lyc` root, since it renders on <body>, outside the shell.
 * Controlled (`open` + `onOpenChange`) or uncontrolled with a `trigger` element.
 * `footer` holds the actions: at most one `lyc-primary` button, the rest outline or quiet;
 * `ModalClose` (asChild) turns any button into a closer, e.g. "Not now".
 */
export type ModalProps = {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  className?: string;
  "data-testid"?: string;
};

const MODAL_OVERLAY_CLASS =
  "bg-lyc-scrim data-[state=open]:animate-none data-[state=closed]:animate-none";

const MODAL_CLOSE_CLASS =
  "right-3.5 top-3.5 flex h-11 w-11 items-center justify-center rounded-md text-lyc-ink-strong opacity-100 hover:bg-lyc-hover focus:ring-0 focus:ring-offset-0 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-lyc-focus data-[state=open]:bg-transparent data-[state=open]:text-lyc-ink-strong [&_svg]:h-5 [&_svg]:w-5";

export function Modal({
  title,
  description,
  children,
  footer,
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  className,
  "data-testid": testId = "student-modal",
}: ModalProps) {
  // F-65: the portal takes the lock of the shell on screen (layout/theme-lock.tsx).
  const themeLock = useActiveThemeLock();
  return (
    <Dialog open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        data-testid={testId}
        portalClassName="lyc contents"
        portalThemeLock={themeLock}
        overlayClassName={MODAL_OVERLAY_CLASS}
        closeClassName={MODAL_CLOSE_CLASS}
        /* With no description, say so explicitly: Radix otherwise points aria-describedby at
           a description id that does not exist. */
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "w-[calc(100%-2rem)] max-w-[540px] gap-4 rounded-lg border-lyc-rule bg-lyc-paper p-9 text-lyc-body text-lyc-ink shadow-none duration-0 sm:rounded-lg data-[state=open]:animate-none data-[state=closed]:animate-none",
          className,
        )}
      >
        <DialogTitle className="m-0 pr-10 font-lyc-serif text-lyc-section font-semibold tracking-normal text-lyc-ink-strong">
          {title}
        </DialogTitle>
        {description ? (
          <DialogDescription className="m-0 text-[18px] leading-relaxed text-lyc-ink">
            {description}
          </DialogDescription>
        ) : null}
        {children}
        {footer ? (
          <div className="flex flex-wrap items-center gap-4 pt-2">{footer}</div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export const ModalClose = DialogClose;
