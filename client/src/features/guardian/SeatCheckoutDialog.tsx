/**
 * "Get Lyceon Pro for your teen" — a guardian buys one seat before any student is linked.
 *
 * @spec [owner brief "Parent paid seat + teen invite + book-a-call — build" (Karl, 2026-11-19)
 *        §1, §3.1; DESIGN.md §5 (2–3 options → radios; one filled primary action)] |
 *       @implemented [2026-11-19]
 *
 * plain English: pick a plan (radios: the live plans from `GET /api/billing/plans`), agree to
 * the Parent / Guardian Terms, and continue to Stripe Checkout. Billing starts at payment; the
 * seat grants nothing until the teen claims it. The server checks the age rule, the terms and
 * that no seat is already waiting; a guardian with no date of birth on file is asked for it
 * here (the same three fields and the same save as Add student), then the checkout retries.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { isApiError } from "@/lib/api-error";
import { QUERY_FRESHNESS } from "@/lib/query-freshness";
import {
  getBillingPlans,
  startSubscriptionCheckout,
  type BillingPlan,
  type BillingPlanMetadata,
} from "@/lib/billing-client";
import {
  type BirthdayParts,
  EMPTY_BIRTHDAY,
  resolveBirthday,
} from "@lyceon/shared/birthday";
import { BirthdayFields } from "@/components/profile/BirthdayFields";
import { formatPrice } from "@/components/guardian/GuardianPurchaseCard";
import { saveDateOfBirth } from "./AddStudentDialog";

const DATE_OF_BIRTH_REQUIRED = "GUARDIAN_DATE_OF_BIRTH_REQUIRED";

function planPrice(price: BillingPlanMetadata): string | null {
  return price.amountCents !== null && price.currency !== null
    ? formatPrice(price.amountCents, price.currency)
    : null;
}

export function SeatCheckoutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const [plan, setPlan] = useState<BillingPlan | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [needsDateOfBirth, setNeedsDateOfBirth] = useState(false);
  const [birthday, setBirthday] = useState<BirthdayParts>(EMPTY_BIRTHDAY);
  const [dobSubmitAttempted, setDobSubmitAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plans = useQuery<BillingPlanMetadata[]>({
    queryKey: ["billing-plans"],
    queryFn: getBillingPlans,
    staleTime: QUERY_FRESHNESS.pricing.staleTime,
    enabled: open,
  });

  const checkout = useMutation({
    mutationFn: (chosen: BillingPlan) =>
      startSubscriptionCheckout(chosen, { seatWithParentTermsAccepted: true }),
    onError: (err: unknown) => {
      if (isApiError(err) && err.code === DATE_OF_BIRTH_REQUIRED) {
        setNeedsDateOfBirth(true);
      }
      setError(
        err instanceof Error ? err.message : "Could not start checkout.",
      );
    },
  });

  const dob = useMutation({
    mutationFn: saveDateOfBirth,
    onSuccess: () => {
      setNeedsDateOfBirth(false);
      setError(null);
      if (plan !== null) checkout.mutate(plan);
    },
    onError: (err: unknown) =>
      setError(
        err instanceof Error
          ? err.message
          : "Could not save your date of birth",
      ),
  });

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);
    if (plan === null) {
      setError("Choose a plan");
      return;
    }
    if (!acceptedTerms) {
      setError("Please agree to the Parent / Guardian Terms to continue");
      return;
    }
    if (needsDateOfBirth) {
      const resolved = resolveBirthday(birthday, new Date());
      if (!resolved.ok) {
        setDobSubmitAttempted(true);
        return;
      }
      dob.mutate(resolved.iso);
      return;
    }
    checkout.mutate(plan);
  };

  const pending = checkout.isPending || dob.isPending;
  const prices = plans.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="seat-checkout-dialog">
        <DialogHeader>
          <DialogTitle>Get Lyceon Pro for your teen</DialogTitle>
          <DialogDescription className="text-base">
            You pay now and invite your teen next. Their Pro access starts when
            they join; you&rsquo;ll then see their progress here.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-base font-medium">Plan</legend>
            {plans.isLoading ? (
              <p className="text-base" data-testid="seat-plans-loading">
                Loading plans…
              </p>
            ) : plans.isError || prices.length === 0 ? (
              <p
                role="alert"
                className="text-base text-destructive"
                data-testid="seat-plans-error"
              >
                Plans are unavailable right now. Please try again later.
              </p>
            ) : (
              prices.map((p) => {
                const amount = planPrice(p);
                return (
                  <label
                    key={p.plan}
                    className="flex min-h-[48px] items-center gap-3 rounded-md border border-input px-3 text-base"
                  >
                    <input
                      type="radio"
                      name="seat-plan"
                      value={p.plan}
                      checked={plan === p.plan}
                      onChange={() => setPlan(p.plan)}
                      data-testid={`seat-plan-${p.plan}`}
                    />
                    <span className="flex-1">{p.label}</span>
                    <span className="text-muted-foreground">
                      {amount ?? "—"} {p.intervalLabel}
                    </span>
                  </label>
                );
              })
            )}
          </fieldset>
          {needsDateOfBirth && (
            <div
              className="flex flex-col gap-2"
              data-testid="seat-checkout-dob"
            >
              <Label className="text-base">Your date of birth</Label>
              <p className="text-base text-muted-foreground">
                We need this once before you buy for a student.
              </p>
              <BirthdayFields
                value={birthday}
                onChange={setBirthday}
                showAllErrors={dobSubmitAttempted}
                variant="default"
                disabled={pending}
              />
            </div>
          )}
          <label className="flex items-start gap-2 text-base">
            <input
              type="checkbox"
              className="mt-1.5"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              data-testid="seat-checkout-terms"
            />
            <span>
              I agree to the{" "}
              <a
                href="/legal/parent-guardian-terms"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                LYCEON Parent / Guardian Terms
              </a>
              .
            </span>
          </label>
          {error !== null && (
            <p
              role="alert"
              className="text-base text-destructive"
              data-testid="seat-checkout-error"
            >
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={pending}
            className="min-h-[48px] text-base"
            data-testid="seat-checkout-submit"
          >
            {pending ? "Opening checkout…" : "Continue to payment"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
