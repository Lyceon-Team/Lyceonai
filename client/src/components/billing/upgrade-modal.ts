/**
 * The upgrade modal's words, its one destination, and the rule that decides when a refused
 * request opens it.
 *
 * @spec [student-UI register UI-44, UI-3B; §2 Free versus paid; SCL-185 (UI-01); OQ-29;
 *        OQ-39(e); DESIGN.md §3 "Upgrade modal"] | @implemented [2026-10-03]
 *
 * plain English: one data table holds every line the modal can show, keyed by the four lockable
 * `canAccessFeature` keys and by the lock reason (`plan` or `age`, OQ-29), so the copy Karl signs
 * off under UI-3B is swapped here and nowhere else. The sources, line by line:
 *   - Full-Length, LISA body, mastery: the prototype's `LYC_COPY` (identical in every
 *     docs/plans/student-ui/design/prototype/*.dc.html that defines it).
 *   - LISA headline: the shipped `LISA_UPGRADE_PITCH.title` ("A Tutor That Knows The SAT And Knows
 *     You", DESIGN.md §3), imported, not retyped.
 *   - Calendar: the prototype has no calendar modal (ruling 3: the calendar page is its own
 *     upsell), so it is the shipped student copy the calendar page already shows, produced by the
 *     canonical `resolveCtaCopy` with the calendar page's own benefit phrase.
 *   - Age (OQ-29): the server's own under-13 tutor refusal ("This feature requires an older
 *     account.", `requireStudentOnly`); the titles are chosen here and listed in the UI-44 report.
 * "See plans" goes to Settings → Billing (OQ-39(e)); Settings is not a route yet, so the
 * destination is the profile page's billing tab, held in ONE constant.
 *
 * `upgradeFeatureForDenial` keys on the denial CODE through the canonical reader, never on the
 * status (SCL-185): tutor and exam deny with 403, calendar and mastery with 402, and the practice
 * quota's 402 `PRACTICE_FREE_DAILY_QUOTA_EXCEEDED` is not a denial at all (F-07). Edge cases: a
 * denial naming a seed key outside the four (e.g. `practice_unlimited`) has no modal and returns
 * null; a query or mutation marked with `ENTITLEMENT_DENIAL_INLINE_META` renders its own upsell
 * (ruling 3, the calendar) and returns null.
 */
import {
  lockableFeatureKeySchema,
  type FeatureLockReason,
  type LockableFeatureKey,
} from "@lyceon/shared/feature-access";
import { getEntitlementDenial } from "@/lib/api-error";
import { resolveCtaCopy } from "@/lib/billing-cta";
import { LISA_UPGRADE_PITCH } from "@/components/tutor/LisaUpgradeCard";

/**
 * OQ-39(e) "See plans" → Settings → Billing. `/profile` is today's Settings, and
 * `UserProfile.tsx` selects its billing tab from `?tab=billing`. When the Settings route lands,
 * this is the one line to change.
 */
export const UPGRADE_PLANS_DESTINATION = "/profile?tab=billing";

type UpgradeModalCopy = {
  readonly title: string;
  readonly body: string;
};

/** Lines shared by every feature's plan copy (prototype modal). */
export const UPGRADE_MODAL_SHARED_COPY = {
  includedLine: "Included with every paid plan.",
  primaryLabel: "See plans",
  secondaryLabel: "Not now",
} as const;

/** The server's own words for the under-13 tutor refusal (`requireStudentOnly`, AGE_RESTRICTION). */
const AGE_BODY = "This feature requires an older account.";

/** Doc 05F §15: the calendar page's student copy, from the canonical resolver. */
const CALENDAR_COPY = resolveCtaCopy(
  { kind: "student_unentitled" },
  { featureBenefit: "your study calendar" },
);

export const UPGRADE_MODAL_COPY: Readonly<
  Record<
    LockableFeatureKey,
    Readonly<Record<FeatureLockReason, UpgradeModalCopy>>
  >
> = {
  exam_full_length: {
    plan: {
      title: "Full-length practice tests",
      body: "Timed tests with two modules per section that adapt to how you do, like the real SAT. You get a scored report after each one.",
    },
    age: { title: "Not available on your account", body: AGE_BODY },
  },
  tutor_access: {
    plan: {
      title: LISA_UPGRADE_PITCH.title,
      body: "Stuck on a question? LISA works through it with you, asking the next question instead of handing you the answer.",
    },
    age: { title: "LISA is for students 13 and older", body: AGE_BODY },
  },
  calendar_access: {
    plan: { title: CALENDAR_COPY.title, body: CALENDAR_COPY.body },
    age: { title: "Not available on your account", body: AGE_BODY },
  },
  mastery_detail: {
    plan: {
      title: "Mastery by domain and skill",
      body: "See your level in all eight SAT domains and every skill inside them, and how each one moves as you practice.",
    },
    age: { title: "Not available on your account", body: AGE_BODY },
  },
};

/**
 * Per-query / per-mutation opt-out (ruling 3): `meta: ENTITLEMENT_DENIAL_INLINE_META` tells the
 * app-wide listener that this surface renders its own upsell for a denial.
 */
export const ENTITLEMENT_DENIAL_INLINE_META = {
  entitlementDenial: "inline",
} as const;

/** The feature whose modal a refused request should open, or null. Pure. */
export function upgradeFeatureForDenial(
  error: unknown,
  meta: Readonly<Record<string, unknown>> | undefined,
): LockableFeatureKey | null {
  if (
    meta?.entitlementDenial === ENTITLEMENT_DENIAL_INLINE_META.entitlementDenial
  ) {
    return null;
  }
  const denial = getEntitlementDenial(error);
  if (denial === null) return null;
  const feature = lockableFeatureKeySchema.safeParse(denial.feature);
  return feature.success ? feature.data : null;
}
