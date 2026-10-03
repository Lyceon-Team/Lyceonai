/**
 * Which paid surfaces a student can open, and why not when they can't.
 *
 * @spec [student-UI register OQ-29, owner ruling (Karl) 2026-10-02: a feature-access map on
 *        GET /api/profile, produced by the same predicates each route enforces (LISA's own for
 *        LISA), with a reason per locked feature (plan | age); DESIGN.md §2 rail locks]
 *        | @implemented [2026-10-02]
 *
 * plain English: the client draws the rail locks and decides between the upgrade modal and the
 * age message from this map, without calling the gated endpoint. It is a display hint only: every
 * gated route still decides for itself on every request.
 */
import { z } from "zod";

/** The four features the student UI locks, keyed by their `canAccessFeature` key. */
export const LOCKABLE_FEATURE_KEYS = [
  "tutor_access",
  "exam_full_length",
  "calendar_access",
  "mastery_detail",
] as const;
export type LockableFeatureKey = (typeof LOCKABLE_FEATURE_KEYS)[number];
/**
 * @spec [student-UI register UI-44] | @implemented [2026-10-03] | plain English: the narrowing
 * the upgrade modal applies to a denial's `details.feature`, which may name any of the eight seed
 * keys; only these four have a modal.
 */
export const lockableFeatureKeySchema = z.enum(LOCKABLE_FEATURE_KEYS);

export const featureLockReasonSchema = z.enum(["plan", "age"]);
export type FeatureLockReason = z.infer<typeof featureLockReasonSchema>;

export const featureAccessEntrySchema = z.discriminatedUnion("access", [
  z.object({ access: z.literal("granted") }).strict(),
  z
    .object({ access: z.literal("locked"), reason: featureLockReasonSchema })
    .strict(),
]);
export type FeatureAccessEntry = z.infer<typeof featureAccessEntrySchema>;

export const featureAccessMapSchema = z
  .object({
    tutor_access: featureAccessEntrySchema,
    exam_full_length: featureAccessEntrySchema,
    calendar_access: featureAccessEntrySchema,
    mastery_detail: featureAccessEntrySchema,
  })
  .strict();
export type FeatureAccessMap = z.infer<typeof featureAccessMapSchema>;
