/**
 * Guardian-paid purchase — PER STUDENT, selected by the guardian.
 *
 * @spec [Doc 01 V8 §20 "Who pays" ("guardian initiates Checkout on student's
 *        behalf"); §31.4 ("Guardian paying for linked student"); §36.4
 *        ("You are still paying for this student's subscription");
 *        SCL-043 payer identity; SCL-045 one SubscriptionItem per student;
 *        Charter §6] | @implemented [2026-08-27]
 * @revised [2026-08-28 — owner ruling: per-student, not cover-all-links]
 *
 * plain English: decides WHICH single student a guardian's purchase is for, and
 * refuses if that student is not one the guardian is actively linked to.
 * Expected outcome: one purchase, one student, chosen by the guardian.
 * Trade-off: the guardian must return to buy for a second child rather than
 * getting them all in one transaction — which is the correct trade, because the
 * alternative charges for children the guardian never chose to pay for. Edge
 * cases: no active links at all, a requested student the guardian is not linked
 * to, and a link row with no student profile — all refused, none guessed at.
 *
 * WHAT THIS REPLACED, AND WHY. The 2026-08-27 implementation built one line item
 * for EVERY active link, so a guardian with three linked students was charged
 * for three the moment they pressed Subscribe. That behaviour was never ruled —
 * it emerged from the shape of the builder — and the owner ruled against it on
 * 2026-08-28. Doc 01 V8 supports per-student throughout: §20 and §31.4 both say
 * "linked student", singular, and §36.4's unlink prompt ("You are still paying
 * for **this student's** subscription. Keep or cancel?") is only answerable if
 * the money was per-student to begin with.
 *
 * ONE SUBSCRIPTION PER STUDENT (@revised 2026-09-29 — owner ruling).
 *
 * This module previously documented the opposite: a guardian's second student
 * became a new SubscriptionItem on the SAME subscription, and only their first
 * purchase went through Checkout. That path was removed because it took no
 * money at the moment of purchase. `subscriptionItems.create` with the default
 * `create_prorations` puts the amount on the NEXT invoice, so a guardian buying
 * for a second student was entitled immediately and charged up to three months
 * later — with no Checkout page, no price shown, no receipt, and no Billing
 * Terms acceptance, because `consent_collection.terms_of_service` exists only on
 * a Checkout Session. A guardian who cancelled before the proration was
 * collected had months of free access and a dispute-shaped argument. Charge at
 * initiation or not at all (owner ruling, observed in production
 * 2026-09-29 05:28:25Z).
 *
 * So every guardian purchase — first or fifth — is a Checkout Session creating
 * its own subscription: one guardian Customer, one subscription per student,
 * each with its own billing period, invoice, charge and cancellation. Stripe
 * supports this directly; the pinned SDK's own list parameter is documented as
 * "The ID of the customer whose subscriptions you're retrieving"
 * (stripe@20.4.1, `types/SubscriptionsResource.d.ts:1998`), and Stripe's Billing
 * analytics documentation states "A customer with multiple active subscriptions
 * is counted as a single active subscriber."
 *
 * ACCEPTED TRADE-OFF: one invoice per student. Stripe has no native
 * consolidation across separate subscriptions — two children, two receipts — and
 * no consolidation layer is built here.
 *
 * SCL-045's item-level entitlement key still holds: each subscription now
 * carries exactly one item, so `stripe_subscription_item_id` still identifies
 * the entitlement. No schema change.
 */
import type { GuardianLink } from "../../../packages/shared/src/guardian-link-schema";

export type GuardianPurchaseSubject =
  | { readonly ok: true; readonly studentProfileId: string }
  | {
      readonly ok: false;
      readonly code: GuardianPurchaseRefusal;
      readonly reason: string;
    };

export type GuardianPurchaseRefusal =
  | "NO_ACTIVE_LINKED_STUDENTS"
  | "STUDENT_NOT_LINKED"
  | "STUDENT_NOT_SELECTED";

/**
 * Resolve the one student a guardian's purchase entitles.
 *
 * Pure and deterministic: same links and same request in, same verdict out. No
 * IO, so the `guardian_links` read has exactly one owner (the route).
 *
 * CHARTER §6. `requestedStudentProfileId` is caller-supplied and is treated as a
 * SELECTION, never as an authorisation. It is returned only if it appears in
 * `activeLinks`, which the caller read from the server. A guardian who names a
 * student they are not linked to gets `STUDENT_NOT_LINKED` and nothing is
 * purchased. There is deliberately no "if only one link, assume that one"
 * convenience: silently choosing a subject the guardian did not name is how a
 * cover-all default gets reintroduced.
 *
 * @param activeLinks  ACTIVE guardian links, read server-side
 * @param requestedStudentProfileId  the student the guardian selected
 */
export function resolveGuardianPurchaseSubject(
  activeLinks: readonly GuardianLink[],
  requestedStudentProfileId: string | undefined,
): GuardianPurchaseSubject {
  const linkedStudentIds = new Set(
    activeLinks
      .map((l) => l.student_profile_id)
      .filter((id): id is string => Boolean(id)),
  );

  if (linkedStudentIds.size === 0) {
    return {
      ok: false,
      code: "NO_ACTIVE_LINKED_STUDENTS",
      reason:
        "guardian has no active linked students, so there is nobody to entitle. " +
        "Not an error to paper over: charging a guardian for nobody would be " +
        "worse than refusing.",
    };
  }

  if (!requestedStudentProfileId) {
    return {
      ok: false,
      code: "STUDENT_NOT_SELECTED",
      reason:
        "no student selected. A guardian purchase is per student (Doc 01 V8 " +
        "§20, §31.4, §36.4), and defaulting to a link the guardian did not " +
        "choose would charge them for a child they did not select.",
    };
  }

  if (!linkedStudentIds.has(requestedStudentProfileId)) {
    return {
      ok: false,
      code: "STUDENT_NOT_LINKED",
      reason:
        "the selected student is not one of this guardian's ACTIVE links. The " +
        "request names a choice; the server's own read of `guardian_links` is " +
        "what authorises it (Charter §6).",
    };
  }

  return { ok: true, studentProfileId: requestedStudentProfileId };
}

/**
 * Does one of the guardian's existing subscriptions already fund this student?
 *
 * @revised [2026-09-29 — owner ruling: moved from items to subscriptions]
 *
 * plain English: given the guardian's non-cancelled subscriptions, is any of
 * them already paying for this student? Expected outcome: a second purchase for
 * an already-funded student is refused before any Stripe object is created.
 *
 * WHY THIS SURVIVED THE ADD-ITEM DELETION, WHEN THE FIRST PLAN WAS TO DELETE IT.
 * `evaluateSubjectPurchaseEligibility` looks like it answers this question and
 * does not: it asks whether the student holds an entitlement, which is a fact
 * about OUR database and true only after the webhook writes. This asks a fact
 * about STRIPE, true the instant the subscription exists. The gap between them
 * is the window this closes, and that window has already produced a live
 * defect — student `3f18cbe2` holds `sub_1U4bqZ…` and `sub_1U8pin…`, both
 * billing yearly, and because `upsertEntitlement` keys on `profile_id` only the
 * second is referenced by any row. With every guardian purchase now creating a
 * subscription, deleting this check would have generalised that defect to
 * guardians rather than removing it.
 *
 * The question is unchanged; only its source moved. It used to read
 * `student_profile_id` from the SubscriptionItems of the guardian's one
 * subscription. It now reads the same key from the subscription metadata that
 * `subscription_data.metadata` writes on every subscription Checkout creates.
 *
 * IT READS METADATA, SO IT CANNOT AUTHORISE. A false answer costs a duplicate
 * charge; it can never grant access. Entitlement is still resolved server-side
 * against active `guardian_links` (Charter §6).
 */
export function aSubscriptionAlreadyFundsStudent(
  subscriptions: readonly {
    readonly metadata?: { student_profile_id?: string } | null;
  }[],
  studentProfileId: string,
): boolean {
  return subscriptions.some(
    (s) => s.metadata?.student_profile_id === studentProfileId,
  );
}
