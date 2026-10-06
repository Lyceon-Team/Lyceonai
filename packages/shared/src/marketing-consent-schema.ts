/**
 * Marketing opt-in: the wire contract and the one eligibility rule.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R26 ("Opt-in: own checkbox at signup, Settings
 *       toggle, reset bug fixed; guardians + students 13+; never under-13"), row Q5; Doc 10 §9.21
 *       (separate from ToS acceptance, revocable, logged); owner Step 0 answers 1, 2, 5
 *       (2026-10-05)] | @implemented [2026-10-05]
 *
 * plain English: the Settings toggle sends `{ granted }` to `PUT /api/profile/marketing-consent`
 * and gets the stored value back. Eligibility is a known date of birth at least 13 years ago —
 * the same rule the database applies (public.marketing_opt_in_age_eligible), so the server can
 * refuse with a clear message before the trigger would refuse with an error. A guardian is an
 * adult by the role rules, but one created before dates of birth were collected has none, and an
 * unknown age is not eligible (fail closed); they can add it through the one-time fill.
 *
 * MARKETING_CONSENT_VERSION names the wording the person agreed to. Change the checkbox or toggle
 * wording → bump it, so the log can tell which text each grant was given against.
 */
import { z } from "zod";
import { ageInYears } from "./profile-role-choice-schema";

export const MARKETING_CONSENT_VERSION = "1.0.0";

/** The one sentence shown beside the onboarding checkbox and the Settings toggle. */
export const MARKETING_CONSENT_LABEL =
  "Send me optional product updates and study news.";

export const MARKETING_OPT_IN_MIN_AGE = 13;

export const marketingConsentRequestSchema = z
  .object({ granted: z.boolean() })
  .strict();
export type MarketingConsentRequest = z.infer<
  typeof marketingConsentRequestSchema
>;

export const marketingConsentResponseSchema = z
  .object({ marketingOptIn: z.boolean() })
  .strict();
export type MarketingConsentResponse = z.infer<
  typeof marketingConsentResponseSchema
>;

/** The coded refusal when an ineligible account asks to opt in. */
export const MARKETING_OPT_IN_INELIGIBLE = "MARKETING_OPT_IN_INELIGIBLE";

/** Known date of birth, and 13 or more whole years before `today`. Pure. */
export function marketingOptInEligible(
  dateOfBirth: string | null,
  today: Date,
): boolean {
  if (dateOfBirth === null) return false;
  const age = ageInYears(dateOfBirth, today);
  return age !== null && age >= MARKETING_OPT_IN_MIN_AGE;
}
