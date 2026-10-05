/**
 * Settings → Billing: three states from `managedBy` and the plan.
 *
 * @spec [DESIGN.md §4 Settings "Billing" (self: Manage billing, which opens Stripe; guardian:
 *        "Managed by your guardian", no button; free: See plans); prototype Settings.dc.html;
 *        student-UI register UI-S7 / F-40 (`managedBy` on GET /api/billing/status), UI-44 and
 *        OQ-39 (e) (the upgrade modal's "See plans" lands here); evidence/wiring-table.md §11;
 *        Doc 01 V8 §31.4 (Stripe supplies the cancellation surface)] | @implemented [2026-10-03]
 *
 * plain English: one read of the billing status through the shared parsed hook. Which state
 * shows is a pure function of the server's own answer (`billingView`):
 *   - guardian: `managedBy === "guardian"` (a plan with a subscription, and the student is not a
 *     Stripe customer): "Managed by your guardian", and no button, because the portal would
 *     answer 409 NO_STRIPE_CUSTOMER (F-40).
 *   - self: the server says the plan is in good standing or needs a payment update: the status
 *     label and Manage billing, which opens the student's own Stripe portal through the one
 *     portal hook (`POST /api/billing/portal`).
 *   - free: anything else (never paid, or ended): the free plan's lines and See plans, which
 *     goes to the plans page through the one role-aware resolver.
 * The server decides access everywhere; this only chooses words and a button.
 *
 * edge cases: a guardian-managed plan reads "guardian" whatever its standing (the guardian
 * renews it); the known edge annotated at `deriveBillingManagedBy` (an old self-paid customer
 * now covered by a guardian reads `self`) opens that student's own portal, a reachable page.
 */
import { useId } from "react";
import { useLocation } from "wouter";
import type { BillingStatus } from "@lyceon/shared/billing-schema";
import { Notice } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBillingPortal } from "@/hooks/useBillingPortal";
import {
  billingStatusLabel,
  useBillingStatusQuery,
} from "@/hooks/useBillingStatusQuery";
import { toUserFacingMessage } from "@/lib/api-error";
import { resolveCtaDestination } from "@/lib/billing-cta";
import {
  BoxHeading,
  FIELD_HELP,
  SectionHeading,
  SheetBox,
} from "./settings-ui";

export type BillingView = "self" | "guardian" | "free";

/** Pure: which of the three Billing states the server's answer means. */
export function billingView(
  status: Pick<
    BillingStatus,
    "managedBy" | "effectiveAccess" | "needsPaymentUpdate"
  >,
): BillingView {
  if (status.managedBy === "guardian") return "guardian";
  if (status.effectiveAccess || status.needsPaymentUpdate) return "self";
  return "free";
}

export function BillingSection(): JSX.Element {
  const headingId = useId();
  const status = useBillingStatusQuery();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-6"
      data-testid="settings-billing"
    >
      <SectionHeading id={headingId}>Billing</SectionHeading>
      {status.isLoading ? (
        <Skeleton variant="lyc" className="h-40 w-full" />
      ) : status.isError || !status.data ? (
        <Notice
          tone="warning"
          title={toUserFacingMessage(status.error).title}
          message={toUserFacingMessage(status.error).message}
          actionLabel="Try again"
          onAction={() => void status.refetch()}
          data-testid="settings-billing-error"
        />
      ) : (
        <BillingState status={status.data} />
      )}
    </section>
  );
}

function BillingState({ status }: { status: BillingStatus }): JSX.Element {
  const portal = useBillingPortal();
  const [, navigate] = useLocation();
  const view = billingView(status);

  if (view === "guardian") {
    return (
      <SheetBox data-testid="settings-billing-guardian">
        <BoxHeading>Lyceon plan</BoxHeading>
        <p className="m-0 text-[17px] leading-relaxed text-lyc-ink">
          Managed by your guardian. They handle payment and renewal from their
          own account.
        </p>
      </SheetBox>
    );
  }

  if (view === "self") {
    return (
      <SheetBox data-testid="settings-billing-self">
        <BoxHeading>Lyceon plan</BoxHeading>
        <p
          className="m-0 text-[17px] text-lyc-ink"
          data-testid="settings-billing-status"
        >
          {billingStatusLabel(status)}
        </p>
        <Button
          type="button"
          variant="lyc-outline"
          className="self-start"
          onClick={() => portal.open()}
          disabled={portal.isPending}
          data-testid="button-manage-billing"
        >
          Manage billing
        </Button>
        <p className={FIELD_HELP}>
          Opens Stripe, where you can update your card, see invoices or cancel.
        </p>
      </SheetBox>
    );
  }

  return (
    <SheetBox data-testid="settings-billing-free">
      <BoxHeading>Free plan</BoxHeading>
      <p className="m-0 text-[17px] leading-relaxed text-lyc-ink">
        The diagnostic, your projected score, 40 practice questions a day and
        unlimited review.
      </p>
      <p className="m-0 text-[17px] leading-relaxed text-lyc-muted">
        Paid plans add a study calendar, mastery for every domain and skill,
        full-length tests and LISA.
      </p>
      <Button
        type="button"
        variant="lyc-primary"
        size="lyc-lg"
        className="self-start"
        onClick={() => navigate(resolveCtaDestination({ isGuardian: false }))}
        data-testid="button-see-plans"
      >
        See plans
      </Button>
    </SheetBox>
  );
}
