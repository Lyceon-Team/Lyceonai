/**
 * Shared HTTP error responses.
 *
 * @spec [lyceon-coding-standards §8.2 (response shape), §8.3 (status codes);
 *        Doc-05F_V1.0 §15.1 (402 is the shared CTA payload)]
 * | @implemented [2026-09-18]
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
 */
import type { Response } from "express";

export const PAYMENT_REQUIRED_CODE = "PAYMENT_REQUIRED" as const;

export function sendPaymentRequired(res: Response, requestId?: string) {
  return res.status(402).json({
    error: "Subscription required",
    code: PAYMENT_REQUIRED_CODE,
    message: "An active subscription is required to see this.",
    requestId,
  });
}
