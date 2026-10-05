import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, LYC_FOCUS } from "@/components/ui/button";
import { Modal, ModalClose, Notice } from "@/components/student-ui";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { apiRequestRaw } from "@/lib/queryClient";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import {
  DeletionActionError,
  deleteRequestErrorCopy,
} from "@/lib/account-deletion-errors";

/**
 * @spec [Doc-01_V8 §40.1 deletion request | §40 lifecycle] | @implemented 2026-06-21
 * plain English: the front of the right-to-erasure chain. A confirmable destructive action that
 * schedules account deletion (POST /api/account/delete → 7-day soft-delete grace). Visibility is
 * gated on the SERVER-provided flag (accountDeletionLifecycleV2 from /api/profile), never a client
 * env guess, so the control cannot be triggered before the backend path is real. Type-to-confirm
 * because the action is irreversible after the grace window.
 */
const CONFIRM_PHRASE = "DELETE";

/** The shipped dialog body, shared by both presentations below. */
const DELETE_DIALOG_BODY =
  "This schedules your account for permanent deletion after a 7-day grace period. During the grace period your account is locked, but you can cancel any time — here or from the link we email you. If you have a paid subscription, your paid access ends and you will not be charged again when your account is deleted. After 7 days your account is permanently deleted and cannot be recovered. If you return to Lyceon, you'll start fresh with a new account.";

/** The shipped copy shown while the server keeps the deletion path off. */
const DELETE_WITHHELD_COPY =
  "Data export/reset/delete controls are intentionally withheld until safe ownership flows are finalized.";

/**
 * The one deletion request (POST /api/account/delete) and its outcome handling, shared by the
 * guardian profile's card and the student Settings box (UI-58) so there is one write path.
 */
function useScheduleAccountDeletion() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequestRaw("/api/account/delete", {
        method: "POST",
      });
      // Never surface the raw server `error` string — map by status in onError.
      if (!res.ok) throw new DeletionActionError(res.status);
    },
    onSuccess: () => {
      toast({
        title: "Account scheduled for deletion",
        description:
          "You can cancel any time before the deletion date — here or from the email we just sent.",
      });
      // Reload so the server-authority pending-deletion state takes over the app.
      window.location.assign("/profile");
    },
    onError: (err: unknown) => {
      const status = err instanceof DeletionActionError ? err.status : 0;
      toast(deleteRequestErrorCopy(status));
    },
  });
}

function isConfirmed(confirmText: string): boolean {
  return confirmText.trim().toUpperCase() === CONFIRM_PHRASE;
}

/**
 * @spec [DESIGN.md §4 Settings "Account" (the Delete account box); prototype Settings.dc.html;
 *        student-UI register UI-58; Doc-01_V8 §40.1] | @implemented [2026-10-03]
 * plain English: the student Settings presentation of the same request: the prototype's danger
 * box ("Delete account", its one sentence, an outline danger button), and the type-to-confirm
 * step in the student Modal, which carries the `.lyc` root into its portal so it follows the
 * page's theme. Same server flag, same request, same confirmation phrase as the card below.
 */
export function DeleteAccountBox(): JSX.Element {
  const { user } = useSupabaseAuth();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const deleteMutation = useScheduleAccountDeletion();

  if (!user?.accountDeletionLifecycleV2) {
    return (
      <Notice
        tone="neutral"
        title="Delete account"
        message={DELETE_WITHHELD_COPY}
        data-testid="delete-account-withheld"
      />
    );
  }

  const confirmed = isConfirmed(confirmText);
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-lyc-danger bg-lyc-danger-bg px-5 py-6 sm:px-7"
      data-testid="delete-account-box"
    >
      <h3 className="m-0 font-lyc-serif text-[21px] font-semibold tracking-normal text-lyc-danger">
        Delete account
      </h3>
      <p className="m-0 text-lyc-body text-lyc-ink">
        We&apos;ll email you a link to cancel during the waiting period. After
        that, your account and your progress are permanently deleted.
      </p>
      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirmText("");
        }}
        trigger={
          <Button
            type="button"
            variant="lyc-outline"
            className="self-start border-lyc-danger text-lyc-danger"
            data-testid="delete-account-trigger"
          >
            Delete account
          </Button>
        }
        title="Delete your account?"
        description={DELETE_DIALOG_BODY}
        data-testid="delete-account-modal"
        footer={
          <>
            <Button
              type="button"
              variant="lyc-outline"
              className="border-lyc-danger text-lyc-danger"
              onClick={() => {
                if (confirmed) deleteMutation.mutate();
              }}
              disabled={!confirmed || deleteMutation.isPending}
              data-testid="delete-account-confirm"
            >
              {deleteMutation.isPending ? "Scheduling…" : "Delete my account"}
            </Button>
            <ModalClose asChild>
              <Button
                type="button"
                variant="lyc-quiet"
                disabled={deleteMutation.isPending}
              >
                Keep my account
              </Button>
            </ModalClose>
          </>
        }
      >
        <label className="flex flex-col gap-2 text-[17px] font-semibold text-lyc-ink">
          <span>
            Type <span className="font-semibold">{CONFIRM_PHRASE}</span> to
            confirm
          </span>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
            className={`${LYC_FOCUS} h-[46px] w-full rounded-md border border-lyc-input-bd bg-lyc-sheet px-3.5 text-[17px] font-normal text-lyc-ink`}
            data-testid="delete-account-confirm-input"
          />
        </label>
      </Modal>
    </div>
  );
}

export function DeleteAccountCard() {
  const { user } = useSupabaseAuth();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const deleteMutation = useScheduleAccountDeletion();

  // Server is the authority on whether the deletion path is live. Flag off → controls stay withheld.
  if (!user?.accountDeletionLifecycleV2) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{DELETE_WITHHELD_COPY}</AlertDescription>
      </Alert>
    );
  }

  const confirmed = isConfirmed(confirmText);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-neutral-800">Delete account</p>
        <p className="text-sm text-neutral-600">
          Your account enters a 7-day grace period, then is permanently deleted.
          Lyceon tracks your progress over time to help you improve — deleting
          your account permanently erases that history. You can cancel any time
          during the grace period.
        </p>
      </div>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirmText("");
        }}
      >
        <AlertDialogTrigger asChild>
          <Button variant="destructive" data-testid="delete-account-trigger">
            Delete my account
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              {DELETE_DIALOG_BODY}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-delete">
              Type <span className="font-semibold">{CONFIRM_PHRASE}</span> to
              confirm
            </Label>
            <Input
              id="confirm-delete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              data-testid="delete-account-confirm-input"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Keep my account
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmed) deleteMutation.mutate();
              }}
              disabled={!confirmed || deleteMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
              data-testid="delete-account-confirm"
            >
              {deleteMutation.isPending ? "Scheduling…" : "Delete my account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
