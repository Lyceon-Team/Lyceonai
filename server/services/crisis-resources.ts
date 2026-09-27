/**
 * @spec [Doc-03_V3 §4.6, §12.3, §21.2; Layer1 PR 2 brief §2–§3; closure plan W3-3]
 * @implemented 2026-09-25 (tables moved out of tutor-crisis.ts unchanged; the
 *   unknown-country response replaced the US default the same day)
 *
 * plain English: the crisis and safeguarding resources for each supported
 * billing country, the named no-number response for an unknown one, and the
 * resolver that decides which a student gets. Pure data and pure functions, so
 * the route, the crisis service and the tests all read the one table.
 *
 * Resource numbers are owner-verified content (Karl). Nothing in this file
 * decides a number; changing one is an owner action.
 */
import type { CrisisCategory } from "../../packages/shared/src/crisis-flag-schema";

/**
 * What a student gets when we do not know their country, or have no resources
 * configured for it. Deliberately NAMES NO NUMBER: a hotline number is only
 * right in one country, and a US student's 988 does nothing for a student in
 * France. An honest pointer to local emergency services and a trusted adult
 * works everywhere. Owner ruling 2026-09-25 (closure plan W3-3), replacing the
 * US-number default the build first shipped with. Every use of these is logged
 * at WARN by the caller.
 *
 * Each keeps its lane's shape: the crisis copy never opens with the
 * safeguarding line, and the safeguarding copy never uses the crisis sign-off.
 */
export const UNKNOWN_COUNTRY_CRISIS_RESPONSE =
  "If you're in crisis, please reach out to someone right now. Call your local emergency number, or talk to a trusted adult — a parent, teacher, school counselor, or doctor. You don't have to go through this alone.";
export const UNKNOWN_COUNTRY_SAFEGUARDING_RESPONSE =
  "What you've shared matters. Please tell a trusted adult — a parent, teacher, school counselor, or doctor. If you're in danger right now, call your local emergency number.";

/**
 * Crisis-lane resources by billing country code. Youth-preferred lines
 * per V1 spec; adult general lines only where no youth-specific service
 * exists for the country.
 * @spec [Doc-03_V3 §4.6, §21.2, Layer1 PR 2 brief §3]
 */
const CRISIS_RESOURCES: Readonly<Record<string, string>> = {
  US: "If you're in crisis, the 988 Suicide & Crisis Lifeline is there for you. Call or text 988. Real people, anytime.",
  CA: "If you're in crisis, the 988 Suicide & Crisis Lifeline is there for you. Call or text 988. Real people, anytime.",
  UK: "If you're in crisis, Childline is there for you. Call 0800 1111. You can also call the Samaritans at 116 123. Real people, anytime.",
  GB: "If you're in crisis, Childline is there for you. Call 0800 1111. You can also call the Samaritans at 116 123. Real people, anytime.",
  IE: "If you're in crisis, Childline Ireland is there for you. Call 1800 66 66 66. You can also call Pieta at 1800 247 247. Real people, anytime.",
  AU: "If you're in crisis, Kids Helpline is there for you. Call 1800 55 1800. Real people, anytime.",
  NZ: "If you're in crisis, Youthline is there for you. Call 0800 376 633 or text 234. You can also call 1737 for free. Real people, anytime.",
  SG: "If you're in crisis, the Samaritans of Singapore (SOS) are there for you. Call 1767. Real people, anytime.",
};

/**
 * Safeguarding-lane resources by billing country code. Abuse/neglect
 * helplines — youth-preferred, distinct from the crisis (suicide/self-harm)
 * set. Template: "What you've shared matters. [Resource] is there for you —
 * call [number]. They listen, and you decide what happens next."
 * @spec [Layer1 PR 2 brief §2, §3]
 */
const SAFEGUARDING_RESOURCES: Readonly<Record<string, string>> = {
  US: "What you've shared matters. Childhelp is there for you — call 1-800-422-4453. You can also call RAINN at 1-800-656-4673. They listen, and you decide what happens next.",
  CA: "What you've shared matters. Kids Help Phone is there for you — call 1-800-668-6868 or text CONNECT to 686868. They listen, and you decide what happens next.",
  UK: "What you've shared matters. Childline is there for you — call 0800 1111. They listen, and you decide what happens next.",
  GB: "What you've shared matters. Childline is there for you — call 0800 1111. They listen, and you decide what happens next.",
  IE: "What you've shared matters. Childline Ireland is there for you — call 1800 66 66 66. They listen, and you decide what happens next.",
  AU: "What you've shared matters. Kids Helpline is there for you — call 1800 55 1800. They listen, and you decide what happens next.",
  NZ: "What you've shared matters. Youthline is there for you — call 0800 376 633 or text 234. They listen, and you decide what happens next.",
  SG: "What you've shared matters. The National Anti-Violence Helpline is there for you — call 1800-777-0000. They listen, and you decide what happens next.",
};

/**
 * @spec [Doc-03_V3 §4.6 ("selects the appropriate regional resource based on
 *        billing address country"), §12.3; closure plan W3-3]
 * @implemented 2026-09-25
 *
 * plain English: which country's crisis resources a student gets, and whether
 * that was a fallback. Pure — the caller decides what to log.
 *
 * expected outcome: a country with configured resources resolves to itself;
 * no country, or one with no configured resources, resolves to `null` with
 * `defaulted: true` and the reason — and `getCrisisResponse(null, …)` gives
 * the no-number response.
 *
 * edge cases: `GB` and `UK` both resolve (Stripe returns ISO `GB`; Doc 03
 * writes `UK`). Case and surrounding whitespace are ignored.
 */
export type CrisisCountryResolution =
  | { country: string; defaulted: false }
  | {
      country: null;
      defaulted: true;
      reason: "no_country" | "unsupported_country";
    };

export function resolveCrisisCountry(
  countryCode: string | null | undefined,
): CrisisCountryResolution {
  const normalised = countryCode?.trim().toUpperCase() ?? "";
  if (!normalised) {
    return {
      country: null,
      defaulted: true,
      reason: "no_country",
    };
  }
  if (CRISIS_RESOURCES[normalised] && SAFEGUARDING_RESOURCES[normalised]) {
    return { country: normalised, defaulted: false };
  }
  return {
    country: null,
    defaulted: true,
    reason: "unsupported_country",
  };
}

/**
 * The response for a country and lane. A null, unknown or unconfigured country
 * gets the no-number response for that lane — never another country's numbers.
 */
export function getCrisisResponse(
  country: string | null,
  category: CrisisCategory = "crisis",
): string {
  const upperCountry = country?.toUpperCase().trim() ?? "";
  if (category === "safeguarding") {
    return (
      SAFEGUARDING_RESOURCES[upperCountry] ??
      UNKNOWN_COUNTRY_SAFEGUARDING_RESPONSE
    );
  }
  return CRISIS_RESOURCES[upperCountry] ?? UNKNOWN_COUNTRY_CRISIS_RESPONSE;
}
