/**
 * `/guardian` — where a guardian lands.
 *
 * @spec [Guardian_Closure_Plan Wave 4 routing table: "`/guardian` redirects to the first
 *       linked student, or shows the no-student state"; G4-01] | @implemented [2026-09-30]
 *
 * plain English: with a linked student, go straight to the first one's Dashboard (the roster
 * order is the server's). With none, the page says so and offers the one thing to do — add a
 * student. The list is read from `GET /api/guardian/students`; nothing here decides access.
 *
 * G4-09: Stripe Checkout returns a guardian to `/guardian?checkout=success`. On that return the
 * page sits behind `CheckoutReturnPoller`, whose processing state (bounded by its timeout)
 * holds the redirect until the webhook has landed — without it, the redirect below fired first
 * and the guardian landed on a Dashboard still reading the pre-payment state. Any other visit
 * skips the poller, so an ordinary landing costs no billing read.
 */
import { useState } from "react";
import { Redirect } from "wouter";
import { GuardianShell } from "@/components/layout/GuardianShell";
import { Button } from "@/components/ui/button";
import { useGuardianStudents } from "@/hooks/useGuardianStudents";
import { linkCodeFromSearch } from "@/lib/link-code-prefill";
import { guardianPaths } from "./paths";
import { AddStudentButton, AddStudentDialog } from "./AddStudentDialog";
import { CheckoutReturnPoller } from "@/components/guardian/CheckoutReturnPoller";

export function GuardianNoStudents({
  onAdd,
}: {
  onAdd: () => void;
}): JSX.Element {
  return (
    <section
      className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-16 text-center"
      data-testid="guardian-no-students"
    >
      <h1 className="text-2xl font-semibold">Add your first student</h1>
      <p className="text-base text-muted-foreground">
        Ask your student for the 6-character link code on their Profile page,
        under Settings. Once linked, you&rsquo;ll see their progress, study
        calendar and test results here.
      </p>
      <Button
        className="mx-auto min-h-[48px] px-6 text-base"
        onClick={onAdd}
        data-testid="guardian-no-students-add"
      >
        Enter a link code
      </Button>
    </section>
  );
}

function GuardianHomeBody(): JSX.Element {
  const { data, isLoading } = useGuardianStudents();
  // The emailed deep link (`/guardian?code=…`) opens the Add-student modal prefilled.
  const [prefill] = useState(() =>
    typeof window === "undefined"
      ? ""
      : linkCodeFromSearch(window.location.search),
  );
  const [adding, setAdding] = useState(prefill.length > 0);
  const first = data?.students[0];
  if (first !== undefined && !adding) {
    return <Redirect to={guardianPaths.dashboard(first.id)} replace />;
  }
  return (
    <GuardianShell actions={<AddStudentButton />}>
      <AddStudentDialog
        open={adding}
        onOpenChange={setAdding}
        initialCode={prefill}
      />
      {isLoading ? (
        <div
          className="py-16 text-center text-base"
          data-testid="guardian-loading"
        >
          Loading your students…
        </div>
      ) : (
        <GuardianNoStudents onAdd={() => setAdding(true)} />
      )}
    </GuardianShell>
  );
}

export default function GuardianHome(): JSX.Element {
  const [returningFromCheckout] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("checkout") === "success",
  );
  return returningFromCheckout ? (
    <CheckoutReturnPoller>
      <GuardianHomeBody />
    </CheckoutReturnPoller>
  ) : (
    <GuardianHomeBody />
  );
}
