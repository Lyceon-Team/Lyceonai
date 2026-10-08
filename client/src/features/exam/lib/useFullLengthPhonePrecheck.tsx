/**
 * The one pre-start check for a full-length sitting on a phone: the laptop-or-tablet notice with
 * "Continue anyway", asked before the start goes ahead.
 *
 * @spec [owner ruling (Karl, 2026-10-05, OQ-63): "Phone notice: show it for every full-length
 *        start on a phone, including calendar-launched starts. One shared pre-start check, same
 *        \"Continue anyway\". Test it from a calendar block at 390px."; the earlier same-day
 *        ruling's words for the notice and its action (phone-notice.ts); DESIGN.md §1 (one
 *        filled primary per surface), §2 Mobile, §3 Modal (UI-46)] | @implemented [2026-10-05]
 *
 * plain English: every control that starts or resumes a full-length sitting (the Full-Length
 * home's Start and Resume, a calendar block's Start or Resume, Home's Today's plan when the block
 * is a full-length one, Home's "Pick up where you left off" row for a sitting in progress) hands
 * its start to `run`. On a phone width (the App shell's `max-lg`, `PHONE_LAYOUT_QUERY`), and
 * unless the student already chose "Continue anyway" in this tab, `run` opens the student Modal
 * whose title is the ruling's sentence and whose one action is the outline "Continue anyway";
 * pressing it records the choice for the tab (`rememberPhoneNoticeContinued`) and THEN performs
 * the start. Anywhere else (laptop, tablet in landscape, no `matchMedia`) `run` performs the start
 * at once. The check runs BEFORE the start's request, so a start that is cancelled at the notice
 * sends nothing and creates no session.
 *
 * NEVER BLOCKS. The notice is one tap. Closing it (the Modal's Close button, the quiet "Not now"
 * beside Continue anyway — owner QA list, Karl, 2026-10-07, item 15 — Esc, a tap on the scrim)
 * only cancels this start: the student stays where they were, and the same control asks
 * again. The exam's own pages (session hub, module, report) never use this check: a sitting that
 * has started is never interrupted by it.
 *
 * trade-offs: "Continue anyway" is an OUTLINE button, as it was on the Full-Length home's notice:
 * it acknowledges a note, it is not the surface's primary action. A link that resumes a sitting
 * (`onLinkClick`) is intercepted only when the notice is going to show, so on a laptop it stays an
 * ordinary link; a modified click (new tab) is left to the browser and opens the session directly.
 *
 * edge cases: storage that cannot be read answers "not continued" (the notice shows and one tap
 * passes it); storage that cannot be written only means the next start asks again. Each consumer
 * renders its own `dialog`; a closed Modal renders nothing, so several on one page cost nothing.
 */
import { useCallback, useRef, useState, type MouseEvent } from "react";
import { useLocation } from "wouter";
import { Modal, ModalClose } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import { PHONE_LAYOUT_QUERY, useMediaQuery } from "@/hooks/use-mobile";
import {
  PHONE_NOTICE_CONTINUE,
  PHONE_NOTICE_NOT_NOW,
  PHONE_NOTICE_TEXT,
  readPhoneNoticeContinued,
  rememberPhoneNoticeContinued,
} from "./phone-notice";

export type FullLengthPhonePrecheck = {
  /** Perform a full-length start, after the notice when the notice applies. */
  run: (proceed: () => void) => void;
  /** A link that starts or resumes a sitting: intercepted only when the notice will show. */
  onLinkClick: (href: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
  /** The notice itself. Render it once, anywhere in the consumer's tree. */
  dialog: JSX.Element;
};

export function useFullLengthPhonePrecheck(): FullLengthPhonePrecheck {
  // Desktop when matchMedia is unavailable: "no match" means desktop (use-mobile.tsx).
  const phone = useMediaQuery(PHONE_LAYOUT_QUERY, false);
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  // The held start. A ref, not state: it is never read during render, only when the student
  // presses Continue anyway, and storing a function in state would call it as an updater.
  const held = useRef<(() => void) | null>(null);

  const asks = useCallback(
    (): boolean => phone && !readPhoneNoticeContinued(),
    [phone],
  );

  const run = useCallback(
    (proceed: () => void): void => {
      if (!asks()) {
        proceed();
        return;
      }
      held.current = proceed;
      setOpen(true);
    },
    [asks],
  );

  const onLinkClick = useCallback(
    (href: string) =>
      (event: MouseEvent<HTMLAnchorElement>): void => {
        if (!asks()) return;
        event.preventDefault();
        held.current = () => navigate(href);
        setOpen(true);
      },
    [asks, navigate],
  );

  const continueAnyway = (): void => {
    rememberPhoneNoticeContinued();
    const proceed = held.current;
    held.current = null;
    setOpen(false);
    proceed?.();
  };

  const cancel = (next: boolean): void => {
    if (next) return;
    held.current = null;
    setOpen(false);
  };

  const dialog = (
    <Modal
      open={open}
      onOpenChange={cancel}
      title={PHONE_NOTICE_TEXT}
      data-testid="full-length-phone-notice"
      footer={
        <>
          <Button
            type="button"
            variant="lyc-outline"
            size="lyc"
            onClick={continueAnyway}
            data-testid="full-length-phone-continue"
          >
            {PHONE_NOTICE_CONTINUE}
          </Button>
          {/* QA item 15 (2026-10-07): "Not now" closes the notice as Close does. */}
          <ModalClose asChild>
            <Button
              type="button"
              variant="lyc-quiet"
              size="lyc"
              data-testid="full-length-phone-not-now"
            >
              {PHONE_NOTICE_NOT_NOW}
            </Button>
          </ModalClose>
        </>
      }
    />
  );

  return { run, onLinkClick, dialog };
}
