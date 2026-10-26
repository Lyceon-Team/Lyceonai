/**
 * Smart landing: the pure rules the server applies. No IO.
 *
 * @spec [owner brief "Smart landing" (Karl, 2026-10-26) "Assignment" ("deterministic pick from
 *        that student's eligible arms at window start, seeded by hash(student, window index,
 *        experiment salt)") and "Landings" ("in every already-on-Q1 set, the first 2 items are
 *        easy or medium, then normal selection"); Karl's ruling D on Step 0, 2026-10-26 (math
 *        first = 5 Math then 5 Reading and Writing)] | @implemented [2026-10-26]
 *
 * plain English:
 *  - `landingHashUnit` turns (salt, student, window) into a number in [0, 1): the first 52 bits of
 *    sha256, so the same inputs always give the same number and a new window gives a new one.
 *  - `landingArmFor` is the whole assignment: eligibility, then the pick.
 *  - `planLandingDraws` turns a set's size and kind into the ordered draws the practice start
 *    makes: an easy/medium lead of 2 first, then the rest (math first: the Math lead and Math
 *    rest, then Reading and Writing). Each draw is the SAME pool function the practice page uses,
 *    so selection inside a draw is unchanged ("then normal selection").
 * trade-offs: the lead is a separate draw rather than a reorder of one draw, so a set whose random
 *   draw happened to hold no easy or medium item still opens with two.
 * edge cases: a set clamped by the free quota to fewer items shrinks the later draws first; the
 *   lead never exceeds the size.
 */
import { createHash } from "node:crypto";
import {
  LANDING_LEAD_EASY_MEDIUM,
  LANDING_MATH_FIRST_COUNT,
  eligibleLandingArms,
  pickLandingArm,
  type LandingArm,
  type LandingConfig,
  type LandingEligibilityFacts,
} from "../../../packages/shared/src/smart-landing-schema";

/** A number in [0, 1) from hash(salt, student, window). */
export function landingHashUnit(
  salt: string,
  profileId: string,
  windowIndex: number,
): number {
  const digest = createHash("sha256")
    .update(`${salt}:${profileId.toLowerCase()}:${windowIndex}`)
    .digest();
  // 52 bits: exactly representable as a double, so the division is exact.
  const high = digest.readUInt32BE(0) * 2 ** 20;
  const low = digest.readUInt32BE(4) >>> 12;
  return (high + low) / 2 ** 52;
}

export type LandingAssignment = {
  arm: LandingArm;
  eligibleArms: LandingArm[];
};

export function landingArmFor(
  profileId: string,
  windowIndex: number,
  facts: LandingEligibilityFacts,
  config: Pick<LandingConfig, "dashboardShare" | "weights" | "salt">,
): LandingAssignment {
  const eligibleArms = eligibleLandingArms(facts, config.weights);
  const unit = landingHashUnit(config.salt, profileId, windowIndex);
  return { arm: pickLandingArm(unit, eligibleArms, config), eligibleArms };
}

/**
 * The kinds of landing set the practice start can compose. `scoped` keeps the session's own
 * sections (a calendar block's, for `session_today`) and only adds the easy/medium lead.
 */
export type LandingSetKind = "mixed" | "math_first" | "scoped";

/** One pool draw: the sections it draws from, whether it is easy/medium only, how many. */
export type LandingDraw = {
  sections: ("M" | "RW")[];
  easyMediumOnly: boolean;
  limit: number;
};

/**
 * The difficulties an easy/medium lead draw may use: the session's own difficulties narrowed to
 * easy (1) and medium (2); no filter means both. A session filtered to hard only has no easy or
 * medium to give, so the lead keeps the session's own filter rather than widening to every
 * difficulty (an empty list reaches the RPC as null, which would be "all").
 */
export function easyMediumLead(sessionDifficulties: number[]): number[] {
  if (sessionDifficulties.length === 0) return [1, 2];
  const narrowed = sessionDifficulties.filter((d) => d <= 2);
  return narrowed.length > 0 ? narrowed : sessionDifficulties;
}

/**
 * The ordered draws for a landing set of `size` (already clamped by the quota). Items are stored
 * in draw order, so the first `LANDING_LEAD_EASY_MEDIUM` ordinals are the lead. `scopedSections`
 * is used by `scoped` only (the session spec's sections).
 */
export function planLandingDraws(
  kind: LandingSetKind,
  size: number,
  scopedSections: ("M" | "RW")[] = [],
): LandingDraw[] {
  if (size <= 0) return [];
  const lead = Math.min(LANDING_LEAD_EASY_MEDIUM, size);
  if (kind !== "math_first") {
    const sections: ("M" | "RW")[] =
      kind === "mixed" ? ["M", "RW"] : [...scopedSections];
    const draws: LandingDraw[] = [
      { sections, easyMediumOnly: true, limit: lead },
    ];
    if (size > lead) {
      draws.push({ sections, easyMediumOnly: false, limit: size - lead });
    }
    return draws;
  }
  const math = Math.min(LANDING_MATH_FIRST_COUNT, size);
  const draws: LandingDraw[] = [
    { sections: ["M"], easyMediumOnly: true, limit: Math.min(lead, math) },
  ];
  if (math > lead) {
    draws.push({ sections: ["M"], easyMediumOnly: false, limit: math - lead });
  }
  if (size > math) {
    draws.push({ sections: ["RW"], easyMediumOnly: false, limit: size - math });
  }
  return draws;
}
