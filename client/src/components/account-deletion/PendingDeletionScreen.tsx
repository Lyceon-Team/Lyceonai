import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { apiRequestRaw } from "@/lib/queryClient";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { SUPPORT_EMAIL } from "@/lib/support-contact";

/**
 * @spec [Doc-01_V8 §40.3 soft-delete state | §40.4 recovery] | @implemented 2026-06-21
 * plain English: the restricted screen a grace-window (soft-locked) user sees when they sign in. The
 * §40.3 lock allows them GET /api/profile (so this renders) + POST /api/account/cancel-deletion (the
 * in-app cancel), and nothing else. In-app cancel hits the now-atomic cancel path; on success the
 * server clears the soft-delete state, so we reload and the normal app returns. This is the in-app
 * half of recovery — the emailed token link (/account/recover) is the other.
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
      if (res.ok) return "ok" as const;
      if (res.status === 409) return "reclaimed" as const;
      if (res.status === 404) return "gone" as const;
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Failed to cancel deletion");
    },
    onSuccess: (result) => {
      if (result === "reclaimed") {
        toast({
          title: "We couldn't restore your account automatically",
          description: `Your email is no longer available. Contact ${SUPPORT_EMAIL} to recover your account.`,
        });
        return;
      }
      toast({
        title: "Account restored",
        description: "Your account is no longer scheduled for deletion.",
      });
      // Reload so the lifted lock + cleared pending state take effect across the app.
      window.location.assign("/dashboard");
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not cancel deletion",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#EAF0FF] to-white p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 space-y-5">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-neutral-800">
            Your account is scheduled for deletion
          </h1>
          <p className="text-sm text-neutral-600">
            {scheduledAt ? (
              <>
                It will be permanently deleted on{" "}
                <span className="font-medium text-neutral-800">
                  {formatDeletionDate(scheduledAt)}
                </span>
                . Until then your account is locked, but you can cancel and
                restore full access right now.
              </>
            ) : (
              <>
                Your account is locked during the deletion grace period. You can
                cancel and restore full access right now.
              </>
            )}
          </p>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You can also restore your account from the link in the email we sent
            when deletion was requested.
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          <Button
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
            variant="ghost"
            className="w-full"
            onClick={() => void signOut()}
            disabled={cancelMutation.isPending}
            data-testid="pending-deletion-signout"
          >
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
