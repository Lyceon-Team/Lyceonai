import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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

export function DeleteAccountCard() {
  const { user } = useSupabaseAuth();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const deleteMutation = useMutation({
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

  // Server is the authority on whether the deletion path is live. Flag off → controls stay withheld.
  if (!user?.accountDeletionLifecycleV2) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Data export/reset/delete controls are intentionally withheld until
          safe ownership flows are finalized.
        </AlertDescription>
      </Alert>
    );
  }

  const confirmed = confirmText.trim().toUpperCase() === CONFIRM_PHRASE;

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
              This schedules your account for permanent deletion after a 7-day
              grace period. During the grace period your account is locked, but
              you can cancel any time — here or from the link we email you.
              After 7 days your account and all your data are permanently
              deleted and cannot be recovered. If you return to Lyceon,
              you&apos;ll start fresh with a new account.
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
