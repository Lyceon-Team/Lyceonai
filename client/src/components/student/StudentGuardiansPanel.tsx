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
import { formatDate } from "@/lib/format-date";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal, ModalClose } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
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

const STUDENT_GUARDIAN_LINKS_QUERY_KEY = ["student-guardian-links"] as const;
/** G-NEW-11: one cache entry per student, as `studentLinkCodeQueryKey`. */
function studentGuardianLinksQueryKey(studentId: string) {
  return [...STUDENT_GUARDIAN_LINKS_QUERY_KEY, studentId] as const;
}

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

/**
 * UI-58 (2026-10-03): drawn with the student tokens, inside the `.lyc` root of whichever student
 * shell holds it (Settings → Guardian in the App shell; /guardian-required in the Bare card), and
 * the confirmation is the student Modal, whose portal carries the same root. Behaviour, requests
 * and test ids are unchanged. Settings passes `summary` (the OQ-38 sentence) and drops the empty
 * hint, whose "above" points at a code that sits below the status box there; with no link the
 * heading is the prototype's "No guardian linked".
 */
export function StudentGuardiansPanel({
  studentId,
  summary = "People who can see your progress summary. You can remove any of them at any time.",
  emptyHint = "No guardian is linked to your account. Share your link code above to add one.",
}: {
  studentId: string;
  summary?: string;
  emptyHint?: string | null;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<StudentGuardianLinkView | null>(null);
  const [removedName, setRemovedName] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: studentGuardianLinksQueryKey(studentId),
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
        queryKey: studentGuardianLinksQueryKey(studentId),
      });
    },
    onError: () => {
      // The row is re-read either way: a 409 means it was already gone.
      setPending(null);
      void queryClient.invalidateQueries({
        queryKey: studentGuardianLinksQueryKey(studentId),
      });
    },
  });

  const links = data ?? [];
  const noneLinked = !isLoading && !error && links.length === 0;

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border border-lyc-rule bg-lyc-sheet px-5 py-6 text-lyc-ink sm:px-7"
      data-testid="student-guardians-panel"
    >
      <h3 className="m-0 font-lyc-serif text-[21px] font-semibold tracking-normal text-lyc-ink-strong">
        {noneLinked ? "No guardian linked" : "Your guardians"}
      </h3>
      <p className="m-0 text-[17px] leading-relaxed text-lyc-ink">{summary}</p>

      {isLoading && (
        <p className="m-0 text-lyc-body text-lyc-muted">
          Loading your guardians...
        </p>
      )}

      {error && (
        <p
          className="m-0 text-lyc-body text-lyc-danger"
          role="alert"
          data-testid="student-guardians-error"
        >
          {toUserFacingMessage(error).message}
        </p>
      )}

      {revoke.error && (
        <p
          className="m-0 text-lyc-body text-lyc-danger"
          role="alert"
          data-testid="student-guardians-revoke-error"
        >
          {toUserFacingMessage(revoke.error).message}
        </p>
      )}

      {removedName && (
        <p
          className="m-0 text-lyc-body text-lyc-ink"
          role="status"
          data-testid="student-guardians-removed"
        >
          {removedName} can no longer see your progress. They have been
          notified.
        </p>
      )}

      {noneLinked && emptyHint !== null && (
        <p
          className="m-0 text-lyc-body text-lyc-muted"
          data-testid="student-guardians-empty"
        >
          {emptyHint}
        </p>
      )}

      {links.length > 0 && (
        <ul
          className="m-0 flex list-none flex-col divide-y divide-lyc-rule border-t border-lyc-rule p-0"
          data-testid="student-guardians-list"
        >
          {links.map((link) => (
            <li
              key={link.link_id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
              data-testid={`student-guardian-${link.link_id}`}
            >
              <div>
                <p className="m-0 text-[17px] font-semibold text-lyc-ink">
                  {guardianLabel(link)}
                </p>
                <p className="m-0 text-lyc-meta-lg text-lyc-muted">
                  {/* QA 2026-10-07 item 15: the one student date formatter. */}
                  Linked {formatDate(link.linked_at, "month-day-year") ?? ""}
                </p>
              </div>
              <Button
                type="button"
                variant="lyc-outline"
                data-testid={`student-guardian-remove-${link.link_id}`}
                disabled={revoke.isPending}
                onClick={() => {
                  setRemovedName(null);
                  setPending(link);
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* §36.3: "Remove guardian → confirmation". Never one click. */}
      <Modal
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={`Remove ${pending ? guardianLabel(pending) : "this guardian"}?`}
        description="They will immediately stop seeing your progress summary and will be notified that the link was removed. You can share a new link code later if you change your mind."
        data-testid="student-guardian-remove-dialog"
        footer={
          <>
            <Button
              type="button"
              variant="lyc-primary"
              data-testid="student-guardian-remove-confirm"
              disabled={revoke.isPending}
              onClick={() => {
                if (pending) revoke.mutate(pending);
              }}
            >
              {revoke.isPending ? "Removing..." : "Remove guardian"}
            </Button>
            <ModalClose asChild>
              <Button
                type="button"
                variant="lyc-quiet"
                data-testid="student-guardian-remove-cancel"
              >
                Keep guardian
              </Button>
            </ModalClose>
          </>
        }
      />
    </div>
  );
}
