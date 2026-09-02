/**
 * The guardian purchase surface — a card on the guardian dashboard.
 *
 * @spec [Doc-01_V8 §20 "Who pays"; §31.4 guardian paying for a linked student;
 *        §36.4; SCL-045 one SubscriptionItem per student]
 * @implemented [2026-09-02]
 *
 * plain English: a guardian picks ONE linked student who is not yet covered,
 * picks a plan, and pays. Expected outcome: entitlement lands on the STUDENT,
 * and the guardian's own access derives from it. Trade-off: two children means
 * two transactions, which is the point — the alternative charges for children
 * the guardian never chose. Edge cases are enumerated below.
 *
 * WHY THIS IS NOT IN `SubscriptionPaywall`, WHICH IS WHERE IT USED TO LIVE.
 * The paywall renders only while the guardian has NO access, and returns its
 * children the moment §31.3's fold finds any one linked student premium. A
 * purchase surface gated that way is gated on the exact opposite of when it is
 * needed: guardian `c6d3fc60` held two active links, one student premium, so
 * the fold reported access, the paywall stepped aside, and the picker went with
 * it — leaving no path in the deployed app to buy for the second student. The
 * condition that belongs here is not "can this guardian see anything" but "is
 * there a linked student nobody has paid for".
 *
 * THIS IS NOT A GATE. The filter below decides what the card OFFERS. Whether a
 * purchase is permitted is decided server-side on every request:
 * `resolveGuardianPurchaseSubject` re-resolves the chosen id against active
 * `guardian_links`, and a student already covered by the guardian's own
 * subscription is refused with `STUDENT_ALREADY_FUNDED`. Editing the select in
 * devtools changes what is REQUESTED, never what is GRANTED.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CreditCard, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { isApiError } from "@/lib/api-error";
import { AppNotice } from "@/components/feedback/AppNotice";
import {
  getBillingPlans,
  startSubscriptionCheckout,
  type BillingPlan,
  type BillingPlanMetadata,
} from "@/lib/billing-client";
import { studentLabel, type LinkedStudent } from "@/hooks/useGuardianStudents";

function formatPrice(amountCents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amountCents / 100);
}

type GuardianPurchaseCardProps = {
  /**
   * The guardian's linked students, from the dashboard's existing
   * `useGuardianStudents` query. Passed in rather than re-fetched: one endpoint,
   * one round trip, and the dashboard and this card cannot disagree about who is
   * linked.
   */
  readonly students: readonly LinkedStudent[];
};

export function GuardianPurchaseCard({ students }: GuardianPurchaseCardProps) {
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(
    null,
  );
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [itemAdded, setItemAdded] = useState(false);

  /**
   * Edge cases 1 and 3, both by the same expression. Every linked student
   * already entitled leaves this empty and the card does not render; zero links
   * leaves it empty too, and the link panel above already speaks to that state.
   * Edge case 2 falls out as well: a mixed roster offers only the unpaid.
   */
  const unfundedStudents = students.filter((s) => !s.has_active_entitlement);

  const { data: pricesData, isLoading: pricesLoading } = useQuery<
    BillingPlanMetadata[]
  >({
    queryKey: ["billing-plans"],
    queryFn: getBillingPlans,
  });
  const prices = Array.isArray(pricesData) ? pricesData : [];

  const checkoutMutation = useMutation({
    mutationFn: async (plan: BillingPlan) => {
      // The subject travels with the purchase (§20, §31.4, §36.4).
      // `startSubscriptionCheckout` redirects to Stripe on `checkout_session`
      // and returns without redirecting on `item_added`, which is why the
      // outcome is inspected rather than discarded.
      return startSubscriptionCheckout(plan, {
        studentProfileId: selectedStudentId ?? undefined,
      });
    },
    onSuccess: (outcome) => {
      // Adding a student to an existing guardian subscription completes
      // server-side with no redirect. Saying so is the difference between a
      // finished purchase and a button that appeared to do nothing.
      if (outcome.kind === "item_added") {
        setItemAdded(true);
        setSelectedStudentId(null);
      }
    },
    onError: (err: unknown) => {
      /**
       * Edge case 4, surfaced rather than swallowed. If the student became
       * entitled between this card rendering and the click, the server answers
       * 409 `STUDENT_ALREADY_FUNDED`; its message is shown verbatim because it
       * describes the situation better than any generic retry copy.
       */
      setCheckoutError(
        err instanceof Error
          ? err.message
          : isApiError(err)
            ? err.message
            : "Could not start checkout. Please try again.",
      );
    },
  });

  if (unfundedStudents.length === 0) {
    return null;
  }

  return (
    <Card
      className="bg-card border-border/60"
      data-testid="guardian-purchase-card"
    >
      <CardHeader>
        <CardTitle className="text-[#0F2E48] flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Start a student subscription
        </CardTitle>
        <CardDescription>
          A subscription covers one student. Choose who it is for, then pick a
          plan — the subscription lands on their account and your reporting
          follows from it.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {itemAdded && (
          <Alert className="border-green-600/40 bg-green-50">
            <AlertDescription className="text-green-800">
              Student added to your existing subscription. Their access starts
              now and the charge appears on your next invoice.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2" data-testid="student-picker">
          <label
            htmlFor="checkout-student"
            className="text-sm font-medium text-[#0F2E48]"
          >
            Who is this subscription for?
          </label>
          <select
            id="checkout-student"
            data-testid="student-select"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={selectedStudentId ?? ""}
            onChange={(e) => {
              setCheckoutError(null);
              setItemAdded(false);
              setSelectedStudentId(e.target.value || null);
            }}
          >
            <option value="">Select a student...</option>
            {unfundedStudents.map((student) => (
              <option key={student.id} value={student.id}>
                {studentLabel(student)}
              </option>
            ))}
          </select>
        </div>

        {pricesLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-[#0F2E48]" />
          </div>
        ) : prices.length === 0 ? (
          <Alert>
            <AlertDescription>
              Subscription plans are currently unavailable. Please try again
              later.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {prices.map((price) => {
              const savingsBadge =
                typeof price.savingsPercent === "number" &&
                price.savingsPercent > 0
                  ? `Save ${price.savingsPercent.toFixed(1)}%`
                  : null;
              return (
                <button
                  key={price.plan}
                  onClick={() => {
                    setCheckoutError(null);
                    setSelectedPlan(price.plan);
                  }}
                  className={cn(
                    "relative p-4 rounded-lg border-2 text-left transition-all",
                    selectedPlan === price.plan
                      ? "border-[#0F2E48] bg-[#0F2E48]/5"
                      : "border-[#0F2E48]/20 hover:border-[#0F2E48]/40",
                  )}
                >
                  {savingsBadge && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-green-600 text-white text-xs font-medium rounded-full whitespace-nowrap">
                      {savingsBadge}
                    </span>
                  )}
                  <div className="text-lg font-semibold text-[#0F2E48]">
                    {price.label}
                  </div>
                  <div className="text-2xl font-bold text-[#0F2E48] mt-1">
                    {formatPrice(price.amountCents, price.currency)}
                  </div>
                  <div className="text-sm text-[#0F2E48]/60">
                    {price.intervalLabel}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {checkoutError && (
          <AppNotice
            variant="warning"
            title="Could not start checkout."
            message={checkoutError}
            mode="inline"
          />
        )}
      </CardContent>

      <CardFooter>
        <Button
          className="w-full bg-[#0F2E48] hover:bg-[#0F2E48]/90 text-white"
          size="lg"
          data-testid="guardian-purchase-submit"
          onClick={() => {
            setCheckoutError(null);
            setItemAdded(false);
            if (!selectedStudentId) {
              // No selection means NO REQUEST: the server would answer 400
              // STUDENT_NOT_SELECTED, and a round trip to learn what the form
              // already knows is not a useful error.
              setCheckoutError(
                "Please choose which student this subscription is for.",
              );
              return;
            }
            if (!selectedPlan) {
              setCheckoutError("Please select a subscription plan.");
              return;
            }
            checkoutMutation.mutate(selectedPlan);
          }}
          disabled={
            checkoutMutation.isPending ||
            pricesLoading ||
            !selectedPlan ||
            !selectedStudentId
          }
        >
          {checkoutMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Redirecting to checkout...
            </>
          ) : (
            <>
              <CreditCard className="mr-2 h-4 w-4" />
              Start Student Subscription
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
