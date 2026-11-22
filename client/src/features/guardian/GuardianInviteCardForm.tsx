/**
 * "Save a card now": the optional card on file for one open invite.
 *
 * @spec [owner rulings 2026-11-21 (counsel-approved) 3 (a guardian with no active link may save
 *        a card for a chosen plan; before saving they see "You'll be charged {price}/{interval}
 *        when your teen joins. Renews until you cancel."), 9 (Billing Terms v4 §2.1,
 *        Auto-Renewal Notice v3 §3.5: affirmative consent before saving); SCL-286; DESIGN.md §5
 *        (2-3 options are radios; one filled primary action per screen; loading and error
 *        states; nothing below 14px)] | @implemented [2026-11-22]
 *
 * plain English: the guardian picks one of the three plans, reads the ruled sentence for that
 * plan's real price (from `GET /api/billing/plans`, read from Stripe), ticks the Billing Terms
 * box, and presses **Save card**, which opens Stripe's card page. Nothing is charged there; the
 * card is charged when the teen joins. **Save card** is outline: **Send invite** stays the
 * screen's one filled action. A plan whose price is not known is not offered.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getBillingPlans } from "@/lib/billing-client";
import { QUERY_FRESHNESS } from "@/lib/query-freshness";
import { saveGuardianInviteCard } from "@/hooks/useGuardianInvites";
import type { BillingPlanMetadata } from "@lyceon/shared/billing-schema";
import { guardianInviteChargeDisclosure } from "@lyceon/shared/guardian-invite-card-schema";

type OfferedPlan = { plan: BillingPlanMetadata; disclosure: string };

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message.length > 0
    ? err.message
    : "Something went wrong. Please try again.";
}

export function GuardianInviteCardForm({
  inviteId,
  onClose,
}: {
  inviteId: string;
  onClose: () => void;
}): JSX.Element {
  const plans = useQuery({
    queryKey: ["/api/billing/plans"],
    queryFn: getBillingPlans,
    retry: 1,
    staleTime: QUERY_FRESHNESS.pricing.staleTime,
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);

  if (plans.isLoading) {
    return (
      <div
        role="status"
        aria-label="Loading plans"
        className="flex flex-col gap-2"
        data-testid="invite-card-plans-loading"
      >
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }
  const offered: OfferedPlan[] = (plans.data ?? []).flatMap((plan) => {
    const disclosure = guardianInviteChargeDisclosure(plan);
    return disclosure === null ? [] : [{ plan, disclosure }];
  });
  if (plans.isError || offered.length === 0) {
    return (
      <div
        className="flex flex-col gap-2"
        data-testid="invite-card-plans-error"
      >
        <p role="alert" className="m-0 text-base text-destructive">
          We couldn&rsquo;t load the plans just now.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] text-base"
            onClick={() => void plans.refetch()}
          >
            Try again
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-[44px] text-base"
            onClick={onClose}
          >
            Not now
          </Button>
        </div>
      </div>
    );
  }

  const selected = offered.find((o) => o.plan.plan === chosen) ?? null;

  return (
    <form
      className="flex flex-col gap-3"
      data-testid="invite-card-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (selected === null) {
          setMissing("Choose a plan.");
          return;
        }
        if (!accepted) {
          setMissing("Agree to the Billing Terms to save a card.");
          return;
        }
        setMissing(null);
        setFailed(null);
        setSaving(true);
        saveGuardianInviteCard(inviteId, selected.plan.plan)
          .then((url) => window.location.assign(url))
          .catch((err: unknown) => {
            setFailed(err);
            setSaving(false);
          });
      }}
    >
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-base font-medium">Choose a plan</legend>
        {offered.map(({ plan }) => (
          <label
            key={plan.plan}
            className="flex min-h-[44px] items-center gap-2 text-base"
          >
            <input
              type="radio"
              name={`invite-card-plan-${inviteId}`}
              value={plan.plan}
              checked={chosen === plan.plan}
              onChange={() => setChosen(plan.plan)}
              data-testid={`invite-card-plan-${plan.plan}`}
            />
            <span>{plan.label}</span>
          </label>
        ))}
      </fieldset>
      {selected !== null && (
        <p className="m-0 text-base" data-testid="invite-card-disclosure">
          {selected.disclosure}
        </p>
      )}
      <label className="flex items-start gap-2 text-base">
        <input
          type="checkbox"
          className="mt-1.5"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          data-testid="invite-card-terms"
        />
        <span>
          I am 18 or older and authorised to use this card. I agree to the{" "}
          <a
            href="/legal/billing-terms"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            LYCEON Billing Terms
          </a>
          , and I understand the subscription renews automatically until I
          cancel.
        </span>
      </label>
      {missing !== null && (
        <p role="alert" className="m-0 text-base text-destructive">
          {missing}
        </p>
      )}
      {failed !== null && (
        <p
          role="alert"
          className="m-0 text-base text-destructive"
          data-testid="invite-card-error"
        >
          {errorMessage(failed)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="outline"
          disabled={saving}
          className="min-h-[44px] text-base"
          data-testid="invite-card-save"
        >
          {saving ? "Opening…" : "Save card"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-[44px] text-base"
          onClick={onClose}
        >
          Not now
        </Button>
      </div>
      <p className="m-0 text-base text-muted-foreground">
        Nothing is charged now. Stripe keeps your card; we never see its number.
      </p>
    </form>
  );
}
