/**
 * THE billing CTA card. Every paid boundary on every surface renders this one.
 *
 * @spec [Doc 01 V8 §20 "Who pays"; §31.1–§31.4; Doc 02B "Entitlement Matrix";
 *        Coding Standards §11.1, §11.3] | @implemented [2026-09-03]
 *
 * plain English: tells someone what they hit, what it costs them, and gives
 * them the one control that fixes it. Expected outcome: one component, one
 * render condition, one destination resolver, across calendar, chat,
 * full-length exams, mastery, practice, the dashboards and profile.
 *
 * WHAT THIS ABSORBS. `EmptyStateCTA`'s two billing uses and the inline
 * quota block in `practice.tsx` were three more shapes for one message. This
 * card was already the most complete of them — it knew about roles, reasons and
 * the portal — so it is extended rather than replaced, per the repo's rule that
 * a second version of an existing primitive is a defect even when no two edits
 * touch the same line.
 *
 * TWO WAYS TO CALL IT. Pass `state` when the surface KNOWS the answer — the
 * guardian dashboard knows which student is unfunded and whether their
 * subscription lapsed, which is more than this component could work out. Pass
 * nothing and it asks `/api/billing/status` itself, which is right for the
 * student surfaces, where the viewer IS the subject.
 *
 * THE PORTAL BRANCH IS NOW REACHABLE, and was not before. It used to be gated
 * on `getPremiumDenialReason` returning `payment_past_due`,
 * `subscription_canceled` or `subscription_expired`, which it does only when an
 * error body carries a `reason` field with that literal — and NO server route
 * emits one. The whole `ctaKind: "billing"` path was dead code behind a
 * condition nothing wrote, the same shape as `linkRequiredForPremium`. Both
 * entry points now reach it from facts the server does write.
 */
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { csrfFetch } from "@/lib/csrf";
import { parseApiErrorFromResponse } from "@/lib/api-error";
import { X, Sparkles, CreditCard, ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBillingPortal } from "@/hooks/useBillingPortal";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import {
  resolveCtaCopy,
  resolveCtaDestination,
  type BillingCtaState,
} from "@/lib/billing-cta";

export type PremiumPromptReason =
  | "premium_required"
  | "payment_required"
  | "payment_past_due"
  | "subscription_canceled"
  | "subscription_expired";

export type PremiumUpgradePromptProps = {
  /**
   * The explicit state. Preferred: it can name the student, which is the whole
   * point of the guardian-facing copy.
   */
  readonly state?: BillingCtaState;
  /**
   * Accepted and IGNORED, deliberately.
   *
   * Three of its five values — `payment_past_due`, `subscription_canceled`,
   * `subscription_expired` — were unreachable: `getPremiumDenialReason` returns
   * them only when an error body carries a `reason` field with that literal,
   * and no server route emits one. The other two both meant "not entitled",
   * which this component now establishes from `/api/billing/status` with more
   * precision than a denial reason could carry. The prop stays so existing call
   * sites keep compiling; it is scheduled for deletion once they are updated.
   *
   * @deprecated pass `state`, or nothing at all.
   */
  readonly reason?: PremiumPromptReason;
  /**
   * What THIS surface gives you paid — "your study calendar", "the interactive
   * tutor", "your full mastery breakdown". Not a generic pitch: a lock on the
   * calendar and a lock on mastery are different disappointments.
   */
  readonly featureBenefit?: string;
  readonly mode?: "floating" | "inline";
  readonly onDismiss?: () => void;
};

/** Only what this component reads from `GET /api/billing/status`. */
type BillingStatusForCta = {
  readonly lapsed?: boolean;
  readonly hasBillingAccount?: boolean;
  readonly hasActiveLink?: boolean;
};

/**
 * Derive the state from the viewer's own billing facts.
 *
 * @spec [owner ruling 2026-09-03 — the fourth state]
 *
 * WHY THE COMPONENT ASKS RATHER THAN EACH SURFACE. Reaching the lapsed state
 * needs `lapsed` and `hasBillingAccount`, which only `/api/billing/status`
 * writes. Threading both through calendar, chat, exams, mastery and practice
 * would be five new props and five chances to forget one. The query shares
 * `["billing-status"]` with the guardian paywall, so on a surface that already
 * holds it this costs no request at all.
 *
 * A guardian without per-student context is sent to their dashboard, because
 * that is where every guardian remedy lives. Never `/upgrade`.
 */
function stateFromBilling(
  status: BillingStatusForCta | undefined,
  isGuardian: boolean,
): BillingCtaState {
  if (isGuardian) {
    return status?.hasActiveLink === false
      ? { kind: "guardian_no_link" }
      : { kind: "guardian_dashboard" };
  }
  // Reactivating beats buying again, but only when there is an account holding
  // the subscription to reactivate. Without one the portal has nothing to open.
  return status?.lapsed === true && status?.hasBillingAccount === true
    ? { kind: "student_lapsed" }
    : { kind: "student_unentitled" };
}

export function PremiumUpgradePrompt({
  state,
  featureBenefit,
  mode = "inline",
  onDismiss,
}: PremiumUpgradePromptProps) {
  const [, navigate] = useLocation();
  const { isGuardian } = useSupabaseAuth();
  const portal = useBillingPortal();

  /**
   * Skipped entirely when the caller already knows the state — the guardian
   * dashboard does, and it knows more than this could (which student).
   */
  const { data: billingStatus } = useQuery<BillingStatusForCta>({
    queryKey: ["billing-status"],
    queryFn: async () => {
      const res = await csrfFetch("/api/billing/status", {
        credentials: "include",
      });
      if (!res.ok) {
        throw await parseApiErrorFromResponse(
          res,
          "Failed to get billing status",
        );
      }
      return res.json() as Promise<BillingStatusForCta>;
    },
    enabled: state === undefined,
    retry: 1,
  });

  const resolved: BillingCtaState =
    state ?? stateFromBilling(billingStatus, isGuardian);
  const copy = resolveCtaCopy(resolved, { featureBenefit });

  /**
   * The destination is a pure function of the role, checked against the role's
   * own resolver rather than taken from the copy alone. A guardian-facing state
   * whose copy named `/upgrade` would be the exact defect this replaces, so the
   * two are reconciled here instead of trusted.
   */
  const roleDestination = resolveCtaDestination({ isGuardian });

  const handlePrimaryAction = () => {
    if (copy.action.kind === "portal") {
      portal.open();
      return;
    }
    navigate(isGuardian ? roleDestination : copy.action.to);
  };

  return (
    <Card
      data-testid="premium-upgrade-prompt"
      data-cta-state={resolved.kind}
      className={
        mode === "floating"
          ? "fixed right-4 bottom-4 z-50 w-[min(440px,calc(100vw-2rem))] border-primary/30 shadow-lg"
          : "border-primary/30 bg-card"
      }
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {copy.title}
            </CardTitle>
            <CardDescription className="mt-1">{copy.body}</CardDescription>
          </div>
          {mode === "floating" && onDismiss && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Dismiss upgrade prompt"
              onClick={onDismiss}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <Button
          onClick={handlePrimaryAction}
          disabled={portal.isPending}
          data-testid="premium-upgrade-cta"
        >
          {copy.action.kind === "portal" ? (
            <CreditCard className="h-4 w-4 mr-2" />
          ) : null}
          {portal.isPending ? "Opening billing..." : copy.actionLabel}
          {copy.action.kind === "navigate" ? (
            <ArrowRight className="h-4 w-4 ml-2" />
          ) : null}
        </Button>
      </CardContent>
    </Card>
  );
}
