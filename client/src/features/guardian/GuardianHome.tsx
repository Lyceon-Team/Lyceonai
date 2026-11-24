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
import {
  cameFromReviewEmail,
  REVIEW_EMAIL_RETURN_SEARCH,
} from "@/lib/product-feedback-api";
import { guardianPaths } from "./paths";
import { AddStudentButton, AddStudentDialog } from "./AddStudentDialog";
import { GuardianTemplatePreview } from "./GuardianTemplatePreview";
import { CheckoutReturnPoller } from "@/components/guardian/CheckoutReturnPoller";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PARENT_CALL_LABEL,
  PARENT_CALL_URL,
} from "@lyceon/shared/external-links";
import { GuardianInviteCard } from "./GuardianInviteCard";

/**
 * @spec [Guardian_Closure_Plan G4-01; owner rulings 2026-11-21 (counsel-approved) 1, 2, 8;
 *        SCL-282; DESIGN.md §5 (one filled primary action)] | @implemented [2026-09-30;
 *        invite card and call link 2026-11-22]
 *
 * plain English: a guardian with no linked student. The invite card is the way in, card first
 * (owner ruling 2026-11-22, 2): step 1 saves a card for a plan, step 2 (locked until then)
 * emails the teen a link or copies one. One filled action at a time: **Save card**, then
 * **Send invite**.
 * Entering a student's link code stays, as an outline button. A plain link (new tab, no embed)
 * offers a 15-minute call first.
 */
export function GuardianNoStudents({
  onAdd,
}: {
  onAdd: () => void;
}): JSX.Element {
  return (
    <section
      className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-16 text-center"
      data-testid="guardian-no-students"
    >
      <h1 className="text-2xl font-semibold">Add your first student</h1>
      <p className="mx-auto max-w-xl text-base text-muted-foreground">
        Invite your teen to join, or enter the 6-character link code from their
        Settings, under Guardian. Once linked, you&rsquo;ll see their progress,
        study calendar and test results here.
      </p>
      <GuardianInviteCard />
      <Button
        variant="outline"
        className="mx-auto min-h-[48px] px-6 text-base"
        onClick={onAdd}
        data-testid="guardian-no-students-add"
      >
        Enter a link code
      </Button>
      <p className="m-0 text-base">
        Want to talk it through first?{" "}
        <a
          href={PARENT_CALL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
          data-testid="guardian-book-call"
        >
          {PARENT_CALL_LABEL} (15 minutes)
        </a>
      </p>
      {/* The 2026-09-03 preview of what linking unlocks — structural, no figures (owner
          decision 2026-10-01: it lives in the no-students state). */}
      <div className="mt-8">
        <GuardianTemplatePreview />
      </div>
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
    // The review email's link (`/guardian?review=email`) opens the ask on the Dashboard it lands on.
    const review =
      typeof window !== "undefined" &&
      cameFromReviewEmail(window.location.search)
        ? REVIEW_EMAIL_RETURN_SEARCH
        : "";
    return <Redirect to={guardianPaths.dashboard(first.id) + review} replace />;
  }
  return (
    <GuardianShell actions={<AddStudentButton />}>
      <AddStudentDialog
        open={adding}
        onOpenChange={setAdding}
        initialCode={prefill}
      />
      {isLoading ? (
        // DESIGN.md §5: a loading state is a skeleton, never bare text.
        <div
          role="status"
          aria-label="Loading your students"
          className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-16"
          data-testid="guardian-loading"
        >
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-full max-w-xl" />
          <Skeleton className="h-40 w-full max-w-xl" />
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
