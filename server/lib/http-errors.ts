/**
 * Shared HTTP error responses.
 *
 * @spec [lyceon-coding-standards §8.2 (response shape), §8.3 (status codes);
 *        Doc-05F_V1.0 §15.1 (402 is the shared CTA payload); Doc-01_V8 §26.1 (FeatureKey);
 *        SCL-185 (UI-01, owner ruling 2026-09-29)]
 * | @implemented [2026-09-18] (feature-bearing denial code: 2026-09-29)
 *
 * plain English: the 402 body the client's premium CTA gates on. It lived as a
 * module-local helper in `student-resources.ts` with one call site; the calendar
 * routes need the same body, and two copies of a payload the client pattern-matches
 * on is how the CTA quietly stops firing on one surface.
 *
 * WHY THIS ONE IS FLAT. §8.2's envelope is `{error:{message, code?, details?}}` and
 * every other calendar error uses it. 402 does not: Doc 05F §15.1 calls it "the
 * shared CTA payload", and the client gates on `status` plus a top-level `code`, so
 * nesting it would break the upgrade prompt rather than tidy it. The shape is the
 * contract here, not the standard (owner ruling, 2026-09-17).
 *
 * WHAT UI-01 CHANGED (SCL-185). The status and the flat shape stay. The code is now the
 * platform's paid-feature denial, `entitlement_required` (the same code the tutor and exam
 * 403s carry), and `details.feature` names the `canAccessFeature` key that was refused —
 * the caller supplies it, typed against the shared feature enum, so a gate cannot name a key
 * that does not exist. The body is typed against the shared flat schema the client reads.
 *
 * NOT covered here: the guardian-view 402 in `server/middleware/subject-resolver.ts`, which
 * still answers `PAYMENT_REQUIRED` inline (guardian vertical; out of UI-01's scope).
 */
import type { Response } from "express";
import {
  ENTITLEMENT_REQUIRED_CODE,
  type EntitlementDenialFlatBody,
  type EntitlementFeatureKey,
} from "../../packages/shared/src/entitlement-denial";

export function sendPaymentRequired(
  res: Response,
  feature: EntitlementFeatureKey,
  requestId?: string,
): Response {
  const body: EntitlementDenialFlatBody = {
    error: "Subscription required",
    code: ENTITLEMENT_REQUIRED_CODE,
    message: "An active subscription is required to see this.",
    details: { feature },
    ...(requestId !== undefined ? { requestId } : {}),
  };
  return res.status(402).json(body);
}
