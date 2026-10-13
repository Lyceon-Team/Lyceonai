/**
 * THE billing CTA card. Written for every paid boundary; drawn today only by Practice at 0
 * questions left (see "ON THE STUDENT TOKENS" below).
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
 * ON THE STUDENT TOKENS (register UI-65; OQ-52 (c), owner ruling Karl 2026-10-05: "Restyling
 * `PremiumUpgradePrompt` onto student tokens is Wave 6 row UI-65") | @implemented [2026-10-08].
 * Its one live caller is Practice at 0 questions left (`pages/practice.tsx`), inside the student
 * shell's `.lyc` root, so the card is drawn with the student card (`border-lyc-rule bg-lyc-sheet`,
 * as FullLengthCard and FilterBar), a serif panel heading and the 17px body, light and dark from
 * the tokens; no shadow (DESIGN.md §1). The action is `lyc-outline`, not a filled primary,
 * because Practice's one filled primary is "Start N questions" (disabled at 0, still the
 * surface's primary). No other surface renders this card today: chat and the review runner moved
 * to `LisaUpgradeCard` (UI-56, OQ-54), and no guardian or admin page imports it. Were a
 * non-student surface to render it again, it would need the student `.lyc` root or its own
 * variant; the guardian-state copy it still resolves is exercised only by GuardianCta.test.tsx.
 *
 * THE PORTAL BRANCH IS NOW REACHABLE, and was not before. It used to be gated
 * on `getPremiumDenialReason` returning `payment_past_due`,
 * `subscription_canceled` or `subscription_expired`, which it does only when an
 * error body carries a `reason` field with that literal — and NO server route
 * emits one. The whole `ctaKind: "billing"` path was dead code behind a
 * condition nothing wrote, the same shape as `linkRequiredForPremium`. Both
 * entry points now reach it from facts the server does write.
 */
import { useId } from "react";
import { useLocation } from "wouter";
import {
  useBillingStatusQuery,
  type BillingStatus,
} from "@/hooks/useBillingStatusQuery";
import { X, CreditCard, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBillingPortal } from "@/hooks/useBillingPortal";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import {
  resolveCtaCopy,
  resolveCtaDestination,
  type BillingCtaState,
} from "@/lib/billing-cta";
import { cn } from "@/lib/utils";

/**
 * Kept only because `chat.tsx` types its own local denial state with it
 * (`full-test.tsx` was deleted by the E1 exam deletion ruling, 2026-09-23).
 * This component no longer accepts it as a prop.
 *
 * THE PROP IS DELETED, not deprecated (owner ruling 2026-09-03). Three of these
 * five values — `payment_past_due`, `subscription_canceled`,
 * `subscription_expired` — are unreachable: `getPremiumDenialReason` returns
 * them only when an error body carries a `reason` field with that literal, and
 * no server route emits one. The other two both meant "not entitled", which
 * this component establishes from `/api/billing/status` with more precision
 * than a denial reason can carry. An accepted-and-ignored prop marked
 * `@deprecated` is still a prop someone will pass believing it works, which is
 * the same defect as a branch keyed on a field nothing writes.
 */
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
   * What THIS surface gives you paid — "your study calendar", "the interactive
   * tutor", "your full mastery breakdown". Not a generic pitch: a lock on the
   * calendar and a lock on mastery are different disappointments.
   */
  readonly featureBenefit?: string;
  readonly mode?: "floating" | "inline";
  readonly onDismiss?: () => void;
};

/** Only what this component reads from `GET /api/billing/status` (G4-09: the shared shape). */
type BillingStatusForCta = Pick<
  BillingStatus,
  "lapsed" | "hasBillingAccount" | "hasActiveLink"
>;

/**
 * Derive the state from the viewer's own billing facts.
 *
 * @spec [owner ruling 2026-09-03 — the fourth state]
 *
 * WHY THE COMPONENT ASKS RATHER THAN EACH SURFACE. Reaching the lapsed state
 * needs `lapsed` and `hasBillingAccount`, which only `/api/billing/status`
 * writes. Threading both through calendar, chat, exams, mastery and practice
 * would be five new props and five chances to forget one. The query is the
 * shared `useBillingStatusQuery` (UI-14), so on a surface that already holds it
 * this costs no request at all.
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
  const titleId = useId();

  /**
   * Skipped entirely when the caller already knows the state — the guardian
   * dashboard does, and it knows more than this could (which student).
   */
  const { data: billingStatus } = useBillingStatusQuery({
    enabled: state === undefined,
  });

  const resolved: BillingCtaState =
    state ?? stateFromBilling(billingStatus, isGuardian);
  const copy = resolveCtaCopy(resolved, {
    ...(featureBenefit !== undefined ? { featureBenefit } : {}),
  });

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
    <section
      aria-labelledby={titleId}
      data-testid="premium-upgrade-prompt"
      data-cta-state={resolved.kind}
      className={cn(
        "flex flex-col gap-4 rounded-lg border border-lyc-rule bg-lyc-sheet px-5 py-6 sm:px-7",
        mode === "floating" &&
          "fixed bottom-4 right-4 z-50 w-[min(440px,calc(100vw-2rem))]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3
            id={titleId}
            className="m-0 font-lyc-serif text-lyc-panel font-semibold text-lyc-ink-strong"
          >
            {copy.title}
          </h3>
          <p className="m-0 text-lyc-body text-lyc-ink">{copy.body}</p>
        </div>
        {mode === "floating" && onDismiss && (
          <Button
            type="button"
            variant="lyc-quiet"
            size="lyc-icon"
            className="text-lyc-body"
            aria-label="Dismiss upgrade prompt"
            onClick={onDismiss}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        )}
      </div>
      <Button
        type="button"
        variant="lyc-outline"
        size="lyc"
        className="self-start"
        onClick={handlePrimaryAction}
        disabled={portal.isPending}
        data-testid="premium-upgrade-cta"
      >
        {copy.action.kind === "portal" ? (
          <CreditCard className="mr-2 h-4 w-4" aria-hidden="true" />
        ) : null}
        {portal.isPending ? "Opening billing..." : copy.actionLabel}
        {copy.action.kind === "navigate" ? (
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        ) : null}
      </Button>
    </section>
  );
}
