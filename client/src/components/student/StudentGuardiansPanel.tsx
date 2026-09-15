/**
 * The student's linked guardians — and the "Remove guardian" control §36.3 promises.
 *
 * @spec [Doc-01_V8 §36.3 Revocation ("Student profile → Remove guardian → confirmation →
 *        status = 'revoked'"), §35 (a student may hold links to more than one guardian);
 *        Coding Standards §11.2 (server state via the query layer)] | @implemented [2026-09-15]
 *
 * plain English: lists every guardian who can currently see this student's progress summary
 * and lets the student end any of those links. Expected outcome: the guardian loses
 * visibility on their next request and is told (the `guardian_unlinked` notification); the
 * student sees the row disappear. Trade-off: removal is behind an explicit confirmation
 * dialog — it severs an adult's access to a minor's learning data and is not a one-click
 * action. Edge case: no revocation-reason input is offered, so no free text written by a
 * minor can travel anywhere from this control.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/alert-dialog";
import { Users, UserMinus } from "lucide-react";
import { csrfFetch } from "@/lib/csrf";
import {
  parseApiErrorFromResponse,
  toUserFacingMessage,
} from "@/lib/api-error";
// Module-specific imports, NOT the `@lyceon/shared` barrel (it re-exports the server env
// schema, whose `*_SECRET` names would land in the client bundle — see StudentLinkCodePanel).
import {
  studentLinkRevokeUrl,
  studentLinksUrl,
  studentGuardianLinksViewSchema,
  type StudentGuardianLinkView,
} from "../../../../packages/shared/src/student-resources";

export const STUDENT_GUARDIAN_LINKS_QUERY_KEY = [
  "student-guardian-links",
] as const;

async function readLinks(
  studentId: string,
): Promise<StudentGuardianLinkView[]> {
  const res = await csrfFetch(studentLinksUrl(studentId), {
    credentials: "include",
  });
  if (!res.ok)
    throw await parseApiErrorFromResponse(res, "Could not load your guardians");
  const payload = (await res.json()) as { data?: unknown };
  return studentGuardianLinksViewSchema.parse(payload?.data).links;
}

function guardianLabel(link: StudentGuardianLinkView): string {
  const trimmed = link.guardian_display_name.trim();
  return trimmed.length > 0 ? trimmed : "A guardian";
}

export function StudentGuardiansPanel({ studentId }: { studentId: string }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<StudentGuardianLinkView | null>(null);
  const [removedName, setRemovedName] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: STUDENT_GUARDIAN_LINKS_QUERY_KEY,
    queryFn: () => readLinks(studentId),
  });

  const revoke = useMutation({
    mutationFn: async (link: StudentGuardianLinkView) => {
      const res = await csrfFetch(
        studentLinkRevokeUrl(studentId, link.link_id),
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      if (!res.ok)
        throw await parseApiErrorFromResponse(
          res,
          "Could not remove this guardian",
        );
      return link;
    },
    onSuccess: (link) => {
      setRemovedName(guardianLabel(link));
      setPending(null);
      void queryClient.invalidateQueries({
        queryKey: STUDENT_GUARDIAN_LINKS_QUERY_KEY,
      });
    },
    onError: () => {
      // The row is re-read either way: a 409 means it was already gone.
      setPending(null);
      void queryClient.invalidateQueries({
        queryKey: STUDENT_GUARDIAN_LINKS_QUERY_KEY,
      });
    },
  });

  const links = data ?? [];

  return (
    <Card data-testid="student-guardians-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Your guardians
        </CardTitle>
        <CardDescription>
          People who can see your progress summary. You can remove any of them
          at any time.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading && (
          <p className="text-sm text-muted-foreground">
            Loading your guardians...
          </p>
        )}

        {error && (
          <Alert>
            <AlertDescription data-testid="student-guardians-error">
              {toUserFacingMessage(error).message}
            </AlertDescription>
          </Alert>
        )}

        {revoke.error && (
          <Alert>
            <AlertDescription data-testid="student-guardians-revoke-error">
              {toUserFacingMessage(revoke.error).message}
            </AlertDescription>
          </Alert>
        )}

        {removedName && (
          <Alert>
            <AlertDescription data-testid="student-guardians-removed">
              {removedName} can no longer see your progress. They have been
              notified.
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && !error && links.length === 0 && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="student-guardians-empty"
          >
            No guardian is linked to your account. Share your link code above to
            add one.
          </p>
        )}

        {links.length > 0 && (
          <ul className="divide-y" data-testid="student-guardians-list">
            {links.map((link) => (
              <li
                key={link.link_id}
                className="flex items-center justify-between py-3"
                data-testid={`student-guardian-${link.link_id}`}
              >
                <div>
                  <p className="font-medium">{guardianLabel(link)}</p>
                  <p className="text-xs text-muted-foreground">
                    Linked {new Date(link.linked_at).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid={`student-guardian-remove-${link.link_id}`}
                  disabled={revoke.isPending}
                  onClick={() => {
                    setRemovedName(null);
                    setPending(link);
                  }}
                >
                  <UserMinus className="h-4 w-4" />
                  <span className="ml-2">Remove</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {/* §36.3: "Remove guardian → confirmation". Never one click. */}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <AlertDialogContent data-testid="student-guardian-remove-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {pending ? guardianLabel(pending) : "this guardian"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will immediately stop seeing your progress summary and will
              be notified that the link was removed. You can share a new link
              code later if you change your mind.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="student-guardian-remove-cancel">
              Keep guardian
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="student-guardian-remove-confirm"
              disabled={revoke.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pending) revoke.mutate(pending);
              }}
            >
              {revoke.isPending ? "Removing..." : "Remove guardian"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
