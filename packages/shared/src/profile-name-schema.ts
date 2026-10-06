/**
 * The Settings name save: `PATCH /api/profile/name`.
 *
 * @spec [student-UI register OQ-28 (owner ruling, Karl, 2026-10-02: "a narrow name-only save
 *        that leaves `marketingOptIn` alone (F-54). Exact shape goes with the Settings
 *        migration"); F-54; UI-58; Coding Standards §7.1, §7.2] | @implemented [2026-10-03]
 *
 * plain English: the one rule for a display name (trimmed, 1 to 120 characters), shared by
 * onboarding's `PATCH /api/profile` and the Settings save, and the two bodies of the narrow
 * route. The request is `.strict()`: it carries `displayName` and nothing else, so a client
 * cannot ride `marketingOptIn`, `role` or a date of birth along with a name change. The route
 * writes `display_name` only; it never touches `marketing_opt_in` or `profile_completed_at`,
 * which is the F-54 defect this route exists to avoid.
 *
 * edge cases: whitespace around the name is trimmed before the length check, so "   " is
 * refused rather than stored as an empty name.
 */
import { z } from "zod";

/** The display-name rule: one definition for onboarding and Settings. */
export const displayNameSchema = z.string().trim().min(1).max(120);

export const profileNameUpdateRequestSchema = z
  .object({ displayName: displayNameSchema })
  .strict();
export type ProfileNameUpdateRequest = z.infer<
  typeof profileNameUpdateRequestSchema
>;

export const profileNameUpdateResponseSchema = z
  .object({ displayName: z.string().min(1) })
  .strict();
export type ProfileNameUpdateResponse = z.infer<
  typeof profileNameUpdateResponseSchema
>;
