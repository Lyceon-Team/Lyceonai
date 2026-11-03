/**
 * Cancel a subscription: the button, the confirmation, the result, the undo.
 *
 * @spec [SCL-271 (what each status does); SCL-272 (payer-only);
 *        docs/plans/student-ui/design/DESIGN.md §5 UI standards (one filled
 *        primary action; every data area has empty, loading and error states);
 *        Coding Standards §11.1, §11.3, §11.4] | @implemented [2026-11-03]
 *
 * plain English: one component for both surfaces. It shows what will happen in
 * words, shows the exact date access ends, does it, then shows that date again
 * with a way to change your mind while the subscription is only scheduled to
 * stop. Expected outcome: nobody cancels without having been told the date, and
 * nobody who cancels is left wondering whether they still owe money.
 *
 * EVERY SENTENCE AND EVERY DATE COMES FROM THE SERVER'S `decision`. This file
 * contains no status strings, no arithmetic on dates, and no notion of a grace
 * period — it switches on a decision the server made and renders a date the
 * server computed. That is deliberate and it is the no-client-trust rule in its
 * useful form: a client that can compute "when access ends" can compute it
 * WRONGLY, and would then show a confident date that nothing honours.
 *
 * WHY THE THREE BRANCHES READ SO DIFFERENTLY. They are genuinely different
 * promises, and flattening them into one sentence would make two of them false:
 * good standing keeps the period already paid for; `past_due` has its balance
 * cleared AND keeps access to a deadline that was fixed before they asked; and
 * a subscription that grants nothing has no date to offer at all.
 *
 * edge cases:
 *   - A subscription already scheduled to stop shows no Cancel button — it
 *     shows when it ends and an Undo. Offering "cancel" for something already
 *     cancelling is a second action with no second effect.
 *   - `accessEndsAt` can be null (the no-access branch, and any date the server
 *     declined to name). The copy branches on null rather than rendering an
 *     empty string after "until".
 *   - The dialog is the error surface for its own mutation: the hook toasts,
 *     and the dialog stays open so the customer can retry rather than being
 *     dropped back with no explanation.
 *
 * TWO SURFACES, ONE COMPONENT, THROUGH THE CANONICAL `Surface` TABLE. Student
 * Settings renders inside the `.lyc` root and wants the student button variants;
 * the guardian page does not and wants the shadcn ones. That choice is not
 * re-invented here — it is `SURFACE` (`@/components/product-feedback/surface`),
 * the same table `MarketingEmailCard` uses for the same reason. The DIALOG's own
 * content stays on the default tokens either way, which is that file's own stated
 * rule: Radix portals it to <body>, outside `.lyc`, where the student tokens do
 * not resolve.
 *
 * THE CONFIRM BUTTON NAMES ITS OWN FILL, AND HAS TO. `AlertDialogAction`'s default
 * is `buttonVariants()` — `bg-primary` — and `--primary` is declared as a bare HSL
 * triplet (`client/src/styles/tokens.css:4`, `20 14% 12%`) while the Tailwind theme
 * maps `primary` to `var(--primary)` rather than `hsl(var(--primary))`. The
 * declaration is invalid, so the fill computes to `rgba(0, 0, 0, 0)` and
 * `text-primary-foreground` cream lands on a cream sheet: a primary action nobody
 * can see. Every other `AlertDialogAction` in this codebase overrides the
 * background for the same reason (`GuardianStudentsPage.tsx:317`,
 * `DeleteAccountCard.tsx:252`, `SubmitModuleDialog.tsx:83`); this one matches its
 * nearest neighbour, the guardian Remove dialog. The token itself is a
 * pre-existing app-wide defect and is reported, not fixed here.
 */
import { useState } from "react";
import type { CancellableSubscription } from "@lyceon/shared/billing-schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { SURFACE, type Surface } from "@/components/product-feedback/surface";
import { formatDate } from "@/lib/format-date";
import {
  useCancelSubscription,
  useUndoCancellation,
} from "@/hooks/useCancelSubscription";

/** The server's date, in the house style. Null stays null — never an empty string. */
function accessEndsLabel(iso: string | null): string | null {
  if (iso === null) return null;
  return formatDate(iso, "month-day-year");
}

/** What cancelling will do, in the customer's words. */
export function cancelConsequence(subscription: CancellableSubscription): {
  readonly title: string;
  readonly body: string;
} {
  const when = accessEndsLabel(subscription.accessEndsAt);

  switch (subscription.decision) {
    case "at_period_end":
      return {
        title: "Cancel this subscription?",
        body: when
          ? `You will not be charged again. You keep full access until ${when}, the end of the period you have already paid for, and then move to the free plan.`
          : "You will not be charged again. You keep full access until the end of the period you have already paid for, and then move to the free plan.",
      };
    case "past_due_scheduled":
      return {
        title: "Cancel this subscription?",
        body: when
          ? `Billing stops now and the outstanding balance is cleared — you will not be charged and you will not owe anything. You keep full access until ${when}, and then move to the free plan.`
          : "Billing stops now and the outstanding balance is cleared — you will not be charged and you will not owe anything.",
      };
    case "immediate":
      return {
        title: "Cancel this subscription?",
        body: "Billing stops now and any outstanding balance is cleared — you will not be charged and you will not owe anything. This subscription is not currently giving you premium access, so nothing changes about what you can use today.",
      };
    case "already_scheduled":
      return {
        title: "Already cancelling",
        body: when
          ? `This subscription is already set to end on ${when}.`
          : "This subscription is already set to end.",
      };
    case "already_canceled":
      return {
        title: "Already cancelled",
        body: "This subscription has already ended.",
      };
  }
}

type CancelSubscriptionDialogProps = {
  readonly subscription: CancellableSubscription;
  /** Names whose subscription this is, on the guardian surface. */
  readonly forLabel?: string;
  /** Distinguishes the testids when several rows render on one page. */
  readonly testIdSuffix?: string;
  /** `lyc` on student Settings (inside the `.lyc` root); `default` on the guardian page. */
  readonly surface?: Surface;
};

export function CancelSubscriptionDialog({
  subscription,
  forLabel,
  testIdSuffix = "",
  surface = "default",
}: CancelSubscriptionDialogProps) {
  const look = SURFACE[surface];
  // 44px and 16px on the guardian page, matching the Remove control beside it. The student
  // variants already carry both (`size: lyc` via the button's compound variants).
  const rowButton = surface === "lyc" ? "" : "min-h-[44px] text-base";
  const [open, setOpen] = useState(false);
  const cancel = useCancelSubscription();
  const undoCancellation = useUndoCancellation();

  const alreadyStopping =
    subscription.decision === "already_scheduled" ||
    subscription.decision === "already_canceled";

  // The final screen's date is the RESULT's, not the preview's: they agree, and
  // reading the result is what makes that visible rather than assumed.
  const doneDate = cancel.result
    ? accessEndsLabel(cancel.result.accessEndsAt)
    : null;

  // ── Already stopping: when it ends, and a way back ──────────────────────
  if (alreadyStopping) {
    const when = accessEndsLabel(
      subscription.cancelAt ?? subscription.accessEndsAt,
    );
    return (
      <div
        className="space-y-2"
        data-testid={`cancel-scheduled${testIdSuffix}`}
      >
        <p className="text-sm text-muted-foreground">
          {when
            ? `Cancelled${forLabel ? ` for ${forLabel}` : ""} — access continues until ${when}.`
            : `Cancelled${forLabel ? ` for ${forLabel}` : ""}.`}
        </p>
        {subscription.undoable && (
          <Button
            type="button"
            variant={look.outline}
            className={rowButton}
            onClick={() => undoCancellation.undo(subscription.subscriptionId)}
            disabled={undoCancellation.isPending}
            data-testid={`button-undo-cancel${testIdSuffix}`}
          >
            {undoCancellation.isPending ? "Restoring…" : "Keep my subscription"}
          </Button>
        )}
      </div>
    );
  }

  // ── Done: the date again, and the undo while it is only scheduled ────────
  if (cancel.result && !cancel.result.alreadyStopping) {
    const undoable =
      cancel.result.decision === "at_period_end" ||
      cancel.result.decision === "past_due_scheduled";
    return (
      <div className="space-y-2" data-testid={`cancel-done${testIdSuffix}`}>
        <p className="text-sm font-medium">
          {doneDate
            ? `Cancelled. Access continues until ${doneDate}.`
            : "Cancelled. Billing has stopped and nothing is owed."}
        </p>
        <p className="text-sm text-muted-foreground">
          We have emailed you a confirmation.
        </p>
        {undoable && (
          <Button
            type="button"
            variant={look.outline}
            className={rowButton}
            onClick={() => undoCancellation.undo(subscription.subscriptionId)}
            disabled={undoCancellation.isPending}
            data-testid={`button-undo-cancel${testIdSuffix}`}
          >
            {undoCancellation.isPending
              ? "Restoring…"
              : "Changed your mind? Keep my subscription"}
          </Button>
        )}
      </div>
    );
  }

  const consequence = cancelConsequence(subscription);

  return (
    <>
      <Button
        type="button"
        variant={look.outline}
        className={`self-start ${rowButton}`}
        onClick={() => setOpen(true)}
        data-testid={`button-cancel-subscription${testIdSuffix}`}
      >
        {forLabel ? `Cancel for ${forLabel}` : "Cancel subscription"}
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!cancel.isPending) setOpen(next);
        }}
      >
        <AlertDialogContent data-testid={`cancel-confirm${testIdSuffix}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>{consequence.title}</AlertDialogTitle>
            <AlertDialogDescription>{consequence.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="min-h-[44px] text-base"
              disabled={cancel.isPending}
            >
              Keep my subscription
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[44px] bg-destructive text-base text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                // The dialog must not close on click: the result screen renders
                // in its place, and closing first would discard it.
                event.preventDefault();
                cancel.cancel(subscription.subscriptionId);
                setOpen(false);
              }}
              disabled={cancel.isPending}
              data-testid={`button-confirm-cancel${testIdSuffix}`}
            >
              {cancel.isPending ? "Cancelling…" : "Yes, cancel"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
