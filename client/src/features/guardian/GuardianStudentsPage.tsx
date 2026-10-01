/**
 * `/guardian/students` — Linked students & billing.
 *
 * @spec [Guardian_Closure_Plan G4-10 (Q-L3); owner ruling 2026-09-30, option (c); Doc 01 V8
 *       §36.3 (either party may revoke), §36.4 (billing is per student); SCL-043 (the guardian
 *       is the payer: one Stripe Customer per payer)] | @implemented [2026-09-30]
 *
 * plain English: every linked student on one page, each with its own subscription status,
 * and ONE "Manage billing" button. There is one button, not one per student, because there is
 * one Stripe Customer per payer: `POST /api/billing/portal` takes no student and opens the
 * whole Customer, so a per-student button would open the same portal under a label that
 * promised something narrower. The copy says what it really covers — every student you pay
 * for. The portal session is the existing one, unchanged (no Stripe logic changes).
 *
 * Per student, the status is the roster's server-derived pair (`has_active_entitlement`,
 * `entitlement_lapsed`) — shown, never used to gate: "Active", "Subscription ended", or "No
 * subscription". A student who is not active gets "Choose a plan", which opens the existing
 * purchase card with that student selected; for an ENDED subscription that card offers
 * reactivation in the portal rather than a second subscription (owner ruling 2026-09-03).
 *
 * Remove asks first. It revokes the LINK (§36.3) and nothing else — it does not cancel a
 * subscription the guardian pays for that student, and the dialog says so, because the
 * obvious reading of "remove" is that the charge stops too. On success the student's cached
 * reads are dropped and the roster refetched (`useForgetGuardianStudent`, G3-04).
 *
 * edge cases: the billing button is shown only when the server says the guardian has a
 * billing account (`hasBillingAccount`); without one the portal answers 409, so the page says
 * there is nothing to manage yet instead of offering a button that fails. A billing-status
 * read that fails says so; it never falls back to either answer.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
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
import { GuardianShell } from "@/components/layout/GuardianShell";
import { GuardianPurchaseCard } from "@/components/guardian/GuardianPurchaseCard";
import { csrfFetch } from "@/lib/csrf";
import { parseApiErrorFromResponse } from "@/lib/api-error";
import { useBillingPortal } from "@/hooks/useBillingPortal";
import { useBillingStatus } from "@/hooks/useBillingStatus";
import {
  studentLabel,
  useForgetGuardianStudent,
  useGuardianStudents,
  type LinkedStudent,
} from "@/hooks/useGuardianStudents";
import { AddStudentButton } from "./AddStudentDialog";

type SubscriptionState = "active" | "ended" | "none";

const STATE_LABEL: Record<SubscriptionState, string> = {
  active: "Active",
  ended: "Subscription ended",
  none: "No subscription",
};

export function subscriptionState(
  student: Pick<LinkedStudent, "has_active_entitlement" | "entitlement_lapsed">,
): SubscriptionState {
  if (student.has_active_entitlement) return "active";
  return student.entitlement_lapsed ? "ended" : "none";
}

async function unlink(studentId: string): Promise<void> {
  const res = await csrfFetch(
    `/api/guardian/link/${encodeURIComponent(studentId)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok) {
    throw await parseApiErrorFromResponse(res, "Could not remove the student");
  }
}

function ManageBilling(): JSX.Element {
  const status = useBillingStatus();
  const portal = useBillingPortal();
  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5"
      data-testid="billing-manage"
    >
      <h2 className="m-0 text-xl font-semibold">Billing</h2>
      {status.isLoading ? (
        <p className="m-0 text-base text-muted-foreground">Loading…</p>
      ) : status.isError || status.data === undefined ? (
        <p
          className="m-0 text-base text-muted-foreground"
          data-testid="billing-manage-error"
        >
          We couldn&rsquo;t load your billing details. Refresh to try again.
        </p>
      ) : status.data.hasBillingAccount ? (
        <>
          <p className="m-0 text-base" data-testid="billing-manage-copy">
            Manage billing for every student you pay for — payment method,
            invoices and cancellations — in one place.
          </p>
          <Button
            className="min-h-[48px] w-fit text-base"
            onClick={() => portal.open()}
            disabled={portal.isPending}
          >
            {portal.isPending ? "Opening billing…" : "Manage billing"}
          </Button>
        </>
      ) : (
        <p
          className="m-0 text-base text-muted-foreground"
          data-testid="billing-manage-none"
        >
          You don&rsquo;t pay for a student yet. Choose a plan for a student
          below to start.
        </p>
      )}
    </section>
  );
}

export default function GuardianStudentsPage(): JSX.Element {
  const { data, isLoading, isError } = useGuardianStudents();
  const students = data?.students ?? [];
  const forget = useForgetGuardianStudent();
  // G4-06: the lapsed state's "Choose a plan for …" arrives with `?choose=<studentId>` and
  // opens that student's plan choice. Only a linked student's id selects anything — the
  // purchase card offers the roster's students and nothing else.
  const search = useSearch();
  const [purchaseFor, setPurchaseFor] = useState<string | null>(() => {
    const choose = new URLSearchParams(search).get("choose");
    return choose !== null && choose.length > 0 ? choose : null;
  });
  const [confirming, setConfirming] = useState<LinkedStudent | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: unlink,
    onSuccess: (_data, studentId) => {
      setConfirming(null);
      setPurchaseFor((current) => (current === studentId ? null : current));
      forget(studentId);
    },
    onError: (err: unknown) => {
      setConfirming(null);
      setRemoveError(
        err instanceof Error ? err.message : "Could not remove the student",
      );
    },
  });

  return (
    <GuardianShell actions={<AddStudentButton />}>
      <div
        className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6"
        data-testid="guardian-students-page"
      >
        {/* The way back (owner decision 2026-10-01, item 8). `/guardian` lands on the first
            student's Dashboard, or the no-students page when there are none. */}
        <Link
          href="/guardian"
          className="w-fit text-base text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          data-testid="students-back-to-dashboard"
        >
          &larr; Back to dashboard
        </Link>
        <h1 className="m-0 text-2xl font-semibold">
          Linked students &amp; billing
        </h1>

        <ManageBilling />

        <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
          <h2 className="m-0 text-xl font-semibold">Students</h2>
          {removeError !== null && (
            <p role="alert" className="m-0 text-base text-destructive">
              {removeError}
            </p>
          )}
          {isLoading ? (
            <p className="m-0 text-base text-muted-foreground">Loading…</p>
          ) : isError ? (
            <p className="m-0 text-base text-muted-foreground">
              We couldn&rsquo;t load your students. Refresh to try again.
            </p>
          ) : students.length === 0 ? (
            <p
              className="m-0 text-base text-muted-foreground"
              data-testid="guardian-students-none"
            >
              No students linked yet. Use &ldquo;Add student&rdquo; with the
              code your student gives you.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {students.map((s) => {
                const state = subscriptionState(s);
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-4"
                    data-testid={`linked-student-${s.id}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-base font-semibold">
                      {studentLabel(s)}
                    </span>
                    <span
                      className="rounded-full bg-secondary px-3 py-1 text-base"
                      data-testid="linked-student-status"
                    >
                      {STATE_LABEL[state]}
                    </span>
                    {state !== "active" && (
                      <Button
                        variant="outline"
                        className="min-h-[44px] text-base"
                        onClick={() => setPurchaseFor(s.id)}
                      >
                        Choose a plan
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="min-h-[44px] text-base"
                      onClick={() => {
                        setRemoveError(null);
                        setConfirming(s);
                      }}
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {purchaseFor !== null && (
          <GuardianPurchaseCard
            students={students}
            preselectStudentId={purchaseFor}
          />
        )}
      </div>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {confirming ? studentLabel(confirming) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              You&rsquo;ll stop seeing their progress straight away. This does
              not cancel a subscription you pay for them — use Manage billing
              for that. They can give you a new code to link again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="min-h-[44px] text-base"
              disabled={remove.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[44px] bg-destructive text-base text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                // Keep the dialog open until the server answers.
                e.preventDefault();
                if (confirming) remove.mutate(confirming.id);
              }}
            >
              {remove.isPending
                ? "Removing…"
                : `Remove ${confirming ? studentLabel(confirming) : ""}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GuardianShell>
  );
}
