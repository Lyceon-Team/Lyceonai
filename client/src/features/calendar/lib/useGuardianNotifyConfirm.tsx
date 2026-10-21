/**
 * The confirmation before a calendar write the guardian will hear about.
 *
 * @spec [owner brief "student cleanups" (Karl, 2026-10-21) Part A ("When the student has an
 *        active guardian link and active entitlement, any action the accountability loop records
 *        shows a confirmation dialog BEFORE the write … One dialog per action. Cancel = no write,
 *        state unchanged. No 'don't show again'. Shared Modal primitive (focus trap, Esc =
 *        Cancel)."); SCL-238 (Doc 05F §17.2 / §17.7); DESIGN.md §5 (one filled primary)]
 *        | @implemented [2026-10-21]
 *
 * plain English: every recorded-capable calendar write hands its action and its write to
 * `confirm`. The shared predicate (`willNotifyGuardian`, packages/shared) decides from the
 * action and the server's `guardian_notified`: when it says no, the write runs at once; when it
 * says yes, the student Modal opens with the brief's exact words and the write is HELD. "Make
 * change" (the one filled primary) runs the held write once and closes; "Cancel", Esc, the
 * Modal's Close and a tap on the scrim drop it, so nothing is sent and nothing changes.
 *
 * trade-offs: the held write is a ref, not state — it is never rendered, only called, and a
 * function in state would be called as an updater (the pattern `useFullLengthPhonePrecheck`
 * uses). A second `confirm` while the dialog is open replaces the held write: one dialog per
 * action, and the newest action is the one on screen.
 *
 * edge cases: while `guardian_notified` is unknown (loading, error) it reads false, so the write
 * runs without asking — the dialog states a fact and is not shown until the server says so.
 * "Make change" clears the held write before running it (defensive: the Modal unmounts on the
 * same press, so a second press cannot reach it; a plant that skips the clearing stays green).
 */
import { useCallback, useRef, useState } from "react";
import {
  willNotifyGuardian,
  type CalendarAction,
  type DayBlockBefore,
} from "@lyceon/shared/calendar";
import { Modal, ModalClose } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import {
  GUARDIAN_CONFIRM_ACTION,
  GUARDIAN_CONFIRM_BODY,
  GUARDIAN_CONFIRM_CANCEL,
  GUARDIAN_CONFIRM_TITLE,
} from "../copy/guardian-notice";
import type { ViewDay } from "./view-model";

export type GuardianNotifyConfirm = {
  /** Run `write` now, or after "Make change" when the action will notify the guardian. */
  confirm: (action: CalendarAction, write: () => void) => void;
  /** The dialog. Render it once in the consumer's tree; closed, it renders nothing. */
  dialog: JSX.Element;
};

export function useGuardianNotifyConfirm(
  guardianNotified: boolean,
): GuardianNotifyConfirm {
  const [open, setOpen] = useState(false);
  const held = useRef<(() => void) | null>(null);

  const confirm = useCallback(
    (action: CalendarAction, write: () => void): void => {
      if (!willNotifyGuardian(action, guardianNotified)) {
        write();
        return;
      }
      held.current = write;
      setOpen(true);
    },
    [guardianNotified],
  );

  const makeChange = (): void => {
    const write = held.current;
    held.current = null;
    setOpen(false);
    write?.();
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
      title={GUARDIAN_CONFIRM_TITLE}
      description={GUARDIAN_CONFIRM_BODY}
      data-testid="guardian-notify-confirm"
      footer={
        <>
          <Button
            type="button"
            variant="lyc-primary"
            size="lyc"
            onClick={makeChange}
            data-testid="guardian-notify-make-change"
          >
            {GUARDIAN_CONFIRM_ACTION}
          </Button>
          <ModalClose asChild>
            <Button
              type="button"
              variant="lyc-outline"
              size="lyc"
              data-testid="guardian-notify-cancel"
            >
              {GUARDIAN_CONFIRM_CANCEL}
            </Button>
          </ModalClose>
        </>
      }
    />
  );

  return { confirm, dialog };
}

/**
 * A day's blocks as the predicate's `edit_day` "before" (student surface: `plan` is present).
 * A block with no `plan` (never on the student surface) cannot be edited and is left out.
 */
export function dayBlocksBefore(day: ViewDay): DayBlockBefore[] {
  const out: DayBlockBefore[] = [];
  for (const b of day.blocks) {
    if (b.plan === null) continue;
    out.push({
      block_id: b.blockId,
      block_type: b.plan.block_type,
      target_count: b.plan.target_count,
      started: b.started,
    });
  }
  return out;
}
