/**
 * The upgrade modal's words, its one destination, and the rule that decides when a refused
 * request opens it.
 *
 * @spec [student-UI register UI-44, UI-3B; §2 Free versus paid; SCL-185 (UI-01); OQ-29;
 *        OQ-39(e); OQ-44 (ruled 2026-10-03); DESIGN.md §3 "Upgrade modal"]
 *        | @implemented [2026-10-03]
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
 *   - Age (OQ-29, OQ-44): no new wording. The title is the feature's own approved plan title
 *     (above) and the body is the server's own under-13 tutor refusal ("This feature requires an
 *     older account.", `requireStudentOnly`, AGE_RESTRICTION). OQ-44 (Karl, 2026-10-03): "use the
 *     approved prototype copy (Full-Length, mastery, and LISA's shipped headline). No new
 *     wording." The two invented age titles ("LISA is for students 13 and older", "Not available
 *     on your account") were removed under that ruling.
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
import { LISA_UPGRADE_PITCH } from "@/components/tutor/lisa-upgrade-pitch";
import { sectionHref } from "@/components/settings/settings-sections";

/**
 * OQ-39(e) "See plans" → Settings → Billing (`/profile?tab=billing`), spelled by the Settings
 * page's own `sectionHref`. UI-58 (2026-10-03): Settings derives its section from the URL on every
 * render, so this navigation lands on Billing even when the student is already on /profile (the
 * UI-44 known limitation, closed).
 */
export const UPGRADE_PLANS_DESTINATION = sectionHref("billing");

type UpgradeModalCopy = {
  readonly title: string;
  readonly body: string;
};

/** Lines shared by every feature's plan copy. Source: the prototype modal (`*.dc.html`). */
export const UPGRADE_MODAL_SHARED_COPY = {
  // Source: prototype modal paragraph, e.g. Calendar.dc.html "Included with every paid plan."
  includedLine: "Included with every paid plan.",
  // Source: prototype modal primary link "See plans".
  primaryLabel: "See plans",
  // Source: prototype modal close button "Not now".
  secondaryLabel: "Not now",
} as const;

/**
 * Source: the server's own words for the under-13 tutor refusal (`requireStudentOnly`,
 * AGE_RESTRICTION, server/middleware/supabase-auth.ts). Not retyped copy: the test asserts it
 * equals the message the real middleware sends.
 */
export const UPGRADE_MODAL_AGE_BODY = "This feature requires an older account.";

/** Source: Doc 05F §15, the calendar page's shipped student copy, from the canonical resolver. */
const CALENDAR_COPY = resolveCtaCopy(
  { kind: "student_unentitled" },
  { featureBenefit: "your study calendar" },
);

/**
 * Source: prototype `LYC_COPY.full` (identical in every *.dc.html that defines it), as changed
 * by owner ruling OQ-62 (b) (Karl, 2026-10-05: "'full-length test' wording"): title "Full-length
 * practice tests" became "Full-length tests" and the body's "Timed tests" became "Timed
 * full-length tests". The test reads `LYC_COPY` out of the prototype file, applies exactly those
 * two changes, and asserts equality.
 */
const FULL_LENGTH_PLAN_COPY: UpgradeModalCopy = {
  title: "Full-length tests",
  body: "Timed full-length tests with two modules per section that adapt to how you do, like the real SAT. You get a scored report after each one.",
};

/**
 * Title source: shipped `LISA_UPGRADE_PITCH.title` (imported). Body source: prototype
 * `LYC_COPY.lisa.body` (asserted against the prototype file by the test).
 */
const LISA_PLAN_COPY: UpgradeModalCopy = {
  title: LISA_UPGRADE_PITCH.title,
  body: "Stuck on a question? LISA works through it with you, asking the next question instead of handing you the answer.",
};

/** Source: prototype `LYC_COPY.mastery` (asserted against the prototype file by the test). */
const MASTERY_PLAN_COPY: UpgradeModalCopy = {
  title: "Mastery by domain and skill",
  body: "See your level in all eight SAT domains and every skill inside them, and how each one moves as you practice.",
};

/** Source: `CALENDAR_COPY` above (shipped `resolveCtaCopy` output). */
const CALENDAR_PLAN_COPY: UpgradeModalCopy = {
  title: CALENDAR_COPY.title,
  body: CALENDAR_COPY.body,
};

/**
 * OQ-44: the age variant composes no sentence of its own. Title = the feature's approved plan
 * title; body = the server's age message.
 */
function ageCopy(plan: UpgradeModalCopy): UpgradeModalCopy {
  return { title: plan.title, body: UPGRADE_MODAL_AGE_BODY };
}

export const UPGRADE_MODAL_COPY: Readonly<
  Record<
    LockableFeatureKey,
    Readonly<Record<FeatureLockReason, UpgradeModalCopy>>
  >
> = {
  exam_full_length: {
    plan: FULL_LENGTH_PLAN_COPY,
    age: ageCopy(FULL_LENGTH_PLAN_COPY),
  },
  tutor_access: { plan: LISA_PLAN_COPY, age: ageCopy(LISA_PLAN_COPY) },
  calendar_access: {
    plan: CALENDAR_PLAN_COPY,
    age: ageCopy(CALENDAR_PLAN_COPY),
  },
  mastery_detail: {
    plan: MASTERY_PLAN_COPY,
    age: ageCopy(MASTERY_PLAN_COPY),
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
