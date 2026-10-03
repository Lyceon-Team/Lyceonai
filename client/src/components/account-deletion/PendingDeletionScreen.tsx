import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { BareCardHeader } from "@/components/layout/BareCardShell";
import { Notice } from "@/components/student-ui";
import { toast } from "@/hooks/use-toast";
import { apiRequestRaw } from "@/lib/queryClient";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import {
  DeletionActionError,
  cancelDeletionErrorCopy,
} from "@/lib/account-deletion-errors";

/**
 * @spec [Doc-01_V8 §40.3 soft-delete state | §40.4 recovery] | @implemented 2026-06-21
 * plain English: the restricted screen a grace-window (soft-locked) user sees when they sign in. The
 * §40.3 lock allows them GET /api/profile (so this renders) + POST /api/account/cancel-deletion (the
 * in-app cancel), and nothing else. In-app cancel hits the now-atomic cancel path; on success the
 * server clears the soft-delete state, so we reload and the normal app returns. This is the in-app
 * half of recovery — the emailed token link (/account/recover) is the other.
 *
 * @spec [student-UI register UI-3A, UI-59; DESIGN.md §1, §2 "Bare card"; §4 "Not prototyped"
 *       (the pending-deletion screen)] | @implemented [2026-10-03]
 * UI-59: drawn with the student tokens only, inside the Bare card App's DeletionGate renders.
 * Copy and behaviour unchanged. "Cancel deletion & restore my account" is the one filled action;
 * Sign out is a quiet button. The email reminder is a neutral info notice (polite status) where
 * it was a shadcn Alert (role="alert"): it is not an error and is on screen from the first paint.
 */
function formatDeletionDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "soon"
    : d.toLocaleString(undefined, {
        dateStyle: "long",
        timeStyle: "short",
      });
}

export function PendingDeletionScreen() {
  const { user, signOut } = useSupabaseAuth();
  const scheduledAt = user?.pendingDeletion?.scheduledHardDeleteAt ?? null;

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequestRaw("/api/account/cancel-deletion", {
        method: "POST",
      });
      // Never surface the raw server `error` string — map by status below.
      if (!res.ok) throw new DeletionActionError(res.status);
    },
    onSuccess: () => {
      toast({
        title: "Account restored",
        description: "Your account is no longer scheduled for deletion.",
      });
      // Reload so the lifted lock + cleared pending state take effect across the app.
      window.location.assign("/dashboard");
    },
    onError: (err: unknown) => {
      const status = err instanceof DeletionActionError ? err.status : 0;
      // 404 = no pending request (already resolved elsewhere) — re-sync; the gate lifts on reload.
      if (status === 404) {
        window.location.assign("/dashboard");
        return;
      }
      toast(cancelDeletionErrorCopy(status));
    },
  });

  return (
    <div className="flex flex-col gap-6" data-testid="pending-deletion">
      <div>
        <BareCardHeader title="Your account is scheduled for deletion" />
        <p className="m-0 text-lyc-body text-lyc-ink">
          {scheduledAt ? (
            <>
              Your account and all your progress will be permanently deleted on{" "}
              <span className="font-semibold text-lyc-ink-strong">
                {formatDeletionDate(scheduledAt)}
              </span>
              . If you have a paid subscription, your paid access ends and you
              will not be charged again once your account is deleted. Until then
              your account is locked, but you can cancel and restore full access
              right now.
            </>
          ) : (
            <>
              Your account is locked during the 7-day deletion grace period. If
              you have a paid subscription, your paid access ends and you will
              not be charged again at the deletion date. You can cancel and
              restore full access right now.
            </>
          )}
        </p>
      </div>

      <Notice
        tone="info"
        title="You can also restore your account from the link in the email we sent when deletion was requested."
      />

      <div className="flex flex-col gap-3">
        <Button
          variant="lyc-primary"
          className="w-full"
          onClick={() => cancelMutation.mutate()}
          disabled={cancelMutation.isPending}
          data-testid="cancel-deletion"
        >
          {cancelMutation.isPending
            ? "Restoring…"
            : "Cancel deletion & restore my account"}
        </Button>
        <Button
          variant="lyc-quiet"
          className="w-full"
          onClick={() => void signOut()}
          disabled={cancelMutation.isPending}
          data-testid="pending-deletion-signout"
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
