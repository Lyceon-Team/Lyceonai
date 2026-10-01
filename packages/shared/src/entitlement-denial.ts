/**
 * The paid-feature denial contract — one code, one `details.feature`, two body shapes.
 *
 * @spec [Doc-01_V8 §26.1 (FeatureKey), §27.2 (launch seed); Doc-03B_V2 §5.9 + CR-03B-21
 *        (tutor 403 `entitlement_required`); Doc-04A_V2.2 §16.1/§16.2 (exam 403);
 *        Doc-05F_V1.0 §15/§15.1 (calendar 402, flat CTA payload); SCL-185 (UI-01, owner
 *        ruling 2026-09-29)] | @implemented [2026-09-29]
 *
 * plain English: every paid-feature denial carries `code: "entitlement_required"` and
 * `details.feature`, where `feature` is the `canAccessFeature` key the server checked. The
 * STATUS is not part of the contract and does not change per surface: tutor and exam answer
 * 403 in the nested §8.2 envelope `{error:{message, code, details}}`; the calendar and the
 * student-resource gate answer 402 in the flat CTA shape `{error:"Subscription required",
 * code, message, details, requestId}` (owner ruling 2026-09-17, `server/lib/http-errors.ts`).
 *
 * `readEntitlementDenial` is the ONE reader. It keys on `code`, never on status, because the
 * status legitimately differs by surface and a 403 is also what a session-ownership refusal
 * (`forbidden`) looks like. Trade-off: a denial body missing `details.feature`, or naming a key
 * outside the seed, reads as NOT a denial — failing toward "show the error" rather than toward
 * a paywall on an unknown feature.
 *
 * The nested schema is derived from the canonical `apiErrorSchema` (Coding Standards §8.2),
 * not a second declaration of the envelope.
 */
import { z } from "zod";
import { apiErrorSchema } from "./calendar/api.js";

/** Doc 01 §26.1 `FeatureKey`, in the order the §27.2 launch seed inserts them. */
export const ENTITLEMENT_FEATURE_KEYS = [
  "practice_daily_free",
  "practice_unlimited",
  "tutor_access",
  "review_full",
  "exam_full_length",
  "calendar_access",
  "mastery_detail",
  "historical_trends",
] as const;
export const entitlementFeatureKeySchema = z.enum(ENTITLEMENT_FEATURE_KEYS);
export type EntitlementFeatureKey = z.infer<typeof entitlementFeatureKeySchema>;

export const ENTITLEMENT_REQUIRED_CODE = "entitlement_required" as const;

export const entitlementDenialDetailsSchema = z
  .object({ feature: entitlementFeatureKeySchema })
  .strict();
export type EntitlementDenialDetails = z.infer<
  typeof entitlementDenialDetailsSchema
>;

/** Tutor and exam: the §8.2 envelope. Exam adds a top-level `requestId`; the tutor does not. */
export const entitlementDenialNestedBodySchema = z.object({
  error: apiErrorSchema.shape.error.extend({
    code: z.literal(ENTITLEMENT_REQUIRED_CODE),
    details: entitlementDenialDetailsSchema,
  }),
  requestId: z.string().optional(),
});

/** Calendar and the student-resource gate: the flat Doc 05F §15.1 CTA payload. */
export const entitlementDenialFlatBodySchema = z.object({
  error: z.string(),
  code: z.literal(ENTITLEMENT_REQUIRED_CODE),
  message: z.string(),
  details: entitlementDenialDetailsSchema,
  requestId: z.string().optional(),
});

export type EntitlementDenialNestedBody = z.infer<
  typeof entitlementDenialNestedBodySchema
>;
export type EntitlementDenialFlatBody = z.infer<
  typeof entitlementDenialFlatBodySchema
>;

export const entitlementDenialBodySchema = z.union([
  entitlementDenialNestedBodySchema,
  entitlementDenialFlatBodySchema,
]);
export type EntitlementDenialBody = z.infer<typeof entitlementDenialBodySchema>;

export type EntitlementDenial = {
  feature: EntitlementFeatureKey;
  message: string;
};

/**
 * Reads a paid-feature denial out of a response body of either shape, or returns null.
 * Keyed on the body's `code` — the caller's status is deliberately not an input.
 */
export function readEntitlementDenial(body: unknown): EntitlementDenial | null {
  const nested = entitlementDenialNestedBodySchema.safeParse(body);
  if (nested.success) {
    return {
      feature: nested.data.error.details.feature,
      message: nested.data.error.message,
    };
  }
  const flat = entitlementDenialFlatBodySchema.safeParse(body);
  if (flat.success) {
    return { feature: flat.data.details.feature, message: flat.data.message };
  }
  return null;
}
