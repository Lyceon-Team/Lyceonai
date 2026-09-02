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
 * THE MECHANIC IS NOT A SECOND SUBSCRIPTION. A guardian's second student becomes
 * a new SubscriptionItem on the SAME subscription — one Customer, one
 * subscription, one invoice, one payment method, one portal. That is what
 * SCL-045's item-level entitlement key exists to support, and it is why this
 * module answers "which student" rather than "which line items": the caller
 * decides whether that student becomes a Checkout line item (first purchase) or
 * an added subscription item (every purchase after).
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
 * Is this student already funded by an item on the guardian's subscription?
 *
 * Buying twice for one student would create a second item entitling the same
 * profile — double billing, and after migration 20260827010000 the second
 * entitlement write would collide on `entitlements_profile_id_unique` AFTER the
 * money moved. Checked before the purchase, not after.
 */
export function subscriptionAlreadyFundsStudent(
  items: readonly {
    readonly metadata?: { student_profile_id?: string } | null;
  }[],
  studentProfileId: string,
): boolean {
  return items.some((i) => i.metadata?.student_profile_id === studentProfileId);
}
