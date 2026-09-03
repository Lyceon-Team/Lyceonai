/**
 * Where a billing CTA sends each role, and what it says. One resolver.
 *
 * @spec [Doc 01 V8 §20 "Who pays"; §31.1–§31.4 guardian derivation;
 *        Coding Standards §11.1 domain logic out of components, §11.3 the
 *        server always enforces] | @implemented [2026-09-03]
 *
 * plain English: every paid boundary in the app resolves to one of a small set
 * of states, and each state has exactly one destination and one sentence. This
 * module owns both, so no surface invents its own.
 *
 * WHY A MODULE AND NOT PER-SURFACE LOGIC. Four bespoke lock screens is how this
 * vertical accumulated six unreachable controls — including a "View Plans"
 * button, enabled for a linked guardian, pointing at a route their role is
 * bounced from. That bug is impossible to write once the destination is a pure
 * function of the role.
 *
 * NOTHING HERE IS A GATE. It decides what a surface OFFERS. Whether a purchase
 * or a portal session is permitted is re-decided server-side on every request:
 * `evaluateSubjectPurchaseEligibility` refuses a funded subject,
 * `resolveGuardianPurchaseSubject` re-resolves the student against active
 * `guardian_links`, and `POST /api/billing/portal` refuses a profile with no
 * Stripe Customer. Editing any of this in devtools changes what is REQUESTED,
 * never what is GRANTED.
 */

/**
 * A guardian is NEVER sent to `/upgrade`.
 *
 * `client/src/App.tsx` registers `/upgrade` as
 * `RequireRole allow={["student","admin"]}`, and `RequireRole` redirects a
 * guardian to `/guardian`. So a guardian-facing "View Plans" is not a slow path
 * or a degraded one — it is a button that cannot do what it says. Guardians buy
 * from the purchase card on their own dashboard.
 */
export type BillingCtaDestination = "/upgrade" | "/guardian";

export function resolveCtaDestination(input: {
  readonly isGuardian: boolean;
}): BillingCtaDestination {
  return input.isGuardian ? "/guardian" : "/upgrade";
}

/**
 * The states a paid boundary can be in, from the viewer's role and the SUBJECT
 * student's entitlement — nothing else.
 *
 * `guardian_student_lapsed` and `student_lapsed` are the fourth state, added by
 * owner ruling 2026-09-03. Their remedy is the PORTAL, not checkout: none of
 * `canceled`, `unpaid`, `incomplete_expired` is in the platform predicate, so
 * `evaluateSubjectPurchaseEligibility` would permit a fresh purchase and sell a
 * second subscription to someone who can reactivate the first for less.
 */
export type BillingCtaState =
  | { readonly kind: "student_unentitled" }
  | { readonly kind: "student_lapsed" }
  | { readonly kind: "guardian_no_link" }
  /**
   * A guardian who hit a boundary somewhere that has no per-student context.
   * Their remedies all live on their own dashboard — the link panel and the
   * purchase card both — so that is where they are sent. It is never
   * `/upgrade`, which their role is bounced from.
   */
  | { readonly kind: "guardian_dashboard" }
  | { readonly kind: "guardian_student_unfunded"; readonly studentName: string }
  | { readonly kind: "guardian_student_lapsed"; readonly studentName: string };

/** What the primary button does when pressed. */
export type BillingCtaAction =
  | { readonly kind: "navigate"; readonly to: BillingCtaDestination }
  | { readonly kind: "portal" };

export type BillingCtaCopy = {
  readonly title: string;
  readonly body: string;
  readonly actionLabel: string;
  readonly action: BillingCtaAction;
};

/**
 * NAME THE STUDENT. A guardian with two linked students, one funded and one
 * not, hits a boundary on ONE of them; copy that says "upgrade to premium"
 * leaves them guessing which child they are being asked to pay for. The name
 * comes from the roster the dashboard already fetched, so it costs no request.
 */
export function resolveCtaCopy(
  state: BillingCtaState,
  options: { readonly featureBenefit?: string } = {},
): BillingCtaCopy {
  /**
   * The feature's OWN benefit, not a generic pitch. A lock on the calendar and
   * a lock on mastery are different disappointments, and "upgrade to premium"
   * answers neither. Falls back to a plain sentence rather than to nothing,
   * because a surface that forgets to pass one should still read as English.
   */
  const benefit = options.featureBenefit ?? "this feature";

  switch (state.kind) {
    case "student_unentitled":
      return {
        title: "Subscription required",
        body: `Choose a plan to unlock ${benefit}.`,
        actionLabel: "View plans",
        action: { kind: "navigate", to: "/upgrade" },
      };
    case "student_lapsed":
      return {
        title: "Your subscription ended",
        body: `Reactivate your subscription to get ${benefit} back. Restarting the one you had costs less than a new plan.`,
        actionLabel: "Reactivate subscription",
        action: { kind: "portal" },
      };
    case "guardian_no_link":
      return {
        title: "Link a student first",
        body: "Ask your student for the code in their account settings. Once they are linked you can see their progress and subscribe for them.",
        actionLabel: "Link a student",
        action: { kind: "navigate", to: "/guardian" },
      };
    case "guardian_dashboard":
      return {
        title: "Manage this from your dashboard",
        body: `Your guardian view of ${benefit} follows from a linked student's subscription. Your dashboard is where you link a student and subscribe for them.`,
        actionLabel: "Go to your dashboard",
        action: { kind: "navigate", to: "/guardian" },
      };
    case "guardian_student_unfunded":
      return {
        title: `${state.studentName} needs a subscription`,
        body: `Subscribe for ${state.studentName} to unlock ${benefit} for them — and the guardian view that follows from it.`,
        actionLabel: `Subscribe for ${state.studentName}`,
        action: { kind: "navigate", to: "/guardian" },
      };
    case "guardian_student_lapsed":
      return {
        title: `${state.studentName}'s subscription ended`,
        body: `Reactivate it to restore ${benefit}. Restarting the subscription you had costs less than starting a new one.`,
        actionLabel: `Reactivate for ${state.studentName}`,
        action: { kind: "portal" },
      };
  }
}
