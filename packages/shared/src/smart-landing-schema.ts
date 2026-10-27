/**
 * Smart landing: the within-student rotating landing test. Shared names, closed value sets and the
 * pure rules both sides need.
 *
 * @spec [owner brief "Smart landing: within-student rotating landing test" (Karl, 2026-10-26),
 *        "Landings", "Assignment", "Data"; Karl's rulings on Step 0 the same day: A (app open, the
 *        first open of the America/Chicago day within the window, at the default entry), B (an
 *        option that cannot be served shows Home and records `fallback_reason`), C (round 1 arms:
 *        `dashboard` at 1/3, `qotd_then_more`, `set_mixed`, `set_math_first` [the two sets
 *        superseded by `set_math_5` the same day, below]; Pro with a plan adds
 *        `session_today`, Pro without a plan `plan_builder`; `calendar_today` held for round 2),
 *        D (math first = 5 Math then 5 Reading and Writing [superseded, below]; device_class from the client
 *        breakpoints, validated against this fixed list; under-13 and unknown age never assigned);
 *        SCL recorded with this change amending DESIGN.md §2] | @implemented [2026-10-26]
 * @spec [owner change "Smart landing: replacing the multi-section sets" (Karl, 2026-10-26, later the
 *        same day): `set_math_5` (5 Math, first 2 easy or medium, already on Q1) replaces
 *        `set_mixed` and `set_math_first`; "5 more?" is 5 Math too] | @implemented [2026-10-26]
 *
 * plain English: every 48 hours (UTC, counted from `LANDING_WINDOW_EPOCH_MS`) a student is given
 * one landing from the arms they are eligible for at that window's first open. This file holds
 * the arm names, the eligibility rule, the deterministic pick from a hash value, the window index,
 * the device classes and the request/response shapes of the three landing routes.
 * expected outcome: the same (student, window) always picks the same arm; a free student never
 * gets a Pro arm; `dashboard` takes 1/3 of picks whatever the other arms are.
 * trade-offs: the hash itself is computed on the server (node:crypto); `pickLandingArm` takes the
 * resulting unit value so it stays pure and browser-safe.
 * edge cases: an arm with weight 0 is not eligible at all (that is how `calendar_today` is held);
 * a student whose only eligible arm is `dashboard` always gets it.
 */
import { z } from "zod";

/** Every landing that can be assigned. `calendar_today` exists but is weighted 0 in round 1. */
export const LANDING_ARMS = [
  "dashboard",
  "qotd_then_more",
  "set_math_5",
  "calendar_today",
  "session_today",
  "plan_builder",
] as const;
export const landingArmSchema = z.enum(LANDING_ARMS);
export type LandingArm = z.infer<typeof landingArmSchema>;

/**
 * Arms retired 2026-10-26 (Karl: `set_math_5` replaces both). They were 10-question sets across
 * Math and Reading and Writing, and the session page cannot run a two-section practice session.
 * Never assigned, weighted or served again; they exist only so the windows and shows already
 * stored with them still read. A window still holding one shows Home (`arm_retired`) until its
 * 48 hours end; the next window draws from `LANDING_ARMS`.
 */
export const LANDING_ARMS_RETIRED = ["set_mixed", "set_math_first"] as const;
/** An arm as stored on a window or show row: assignable or retired. */
export const storedLandingArmSchema = z.enum([
  ...LANDING_ARMS,
  ...LANDING_ARMS_RETIRED,
]);
export type StoredLandingArm = z.infer<typeof storedLandingArmSchema>;

export function isRetiredLandingArm(
  arm: StoredLandingArm,
): arm is (typeof LANDING_ARMS_RETIRED)[number] {
  return (LANDING_ARMS_RETIRED as readonly string[]).includes(arm);
}

/** The arms every student may get, in the fixed order the pick walks. */
export const LANDING_ARMS_EVERYONE = [
  "dashboard",
  "qotd_then_more",
  "set_math_5",
] as const satisfies readonly LandingArm[];
/** Pro (calendar access) with a current plan. */
export const LANDING_ARMS_PRO_WITH_PLAN = [
  "calendar_today",
  "session_today",
] as const satisfies readonly LandingArm[];
/** Pro without a plan. */
export const LANDING_ARMS_PRO_WITHOUT_PLAN = [
  "plan_builder",
] as const satisfies readonly LandingArm[];

/**
 * Why an assigned arm was not served, so Home was shown instead (ruling B). Recorded on the show
 * row and sent on `landing_shown`.
 */
export const LANDING_FALLBACK_REASONS = [
  "quota_exhausted",
  "session_limit",
  "no_questions",
  "qotd_unavailable",
  "no_block_today",
  "not_entitled",
  /** The window was assigned an arm since retired (`LANDING_ARMS_RETIRED`). */
  "arm_retired",
  "error",
] as const;
export const landingFallbackReasonSchema = z.enum(LANDING_FALLBACK_REASONS);
export type LandingFallbackReason = z.infer<typeof landingFallbackReasonSchema>;

/** Coarse device classes only (ruling D). Nothing finer is ever accepted or stored. */
export const DEVICE_CLASSES = ["phone", "tablet", "desktop"] as const;
export const deviceClassSchema = z.enum(DEVICE_CLASSES);
export type DeviceClass = z.infer<typeof deviceClassSchema>;

/**
 * The client's breakpoints (client/src/hooks/use-mobile.tsx): below 768px is the phone width
 * (`MOBILE_BREAKPOINT`, Tailwind `md`), below 1024px the phone layout (Tailwind `lg`), so 768 up
 * to 1023 is a tablet.
 */
export const DEVICE_CLASS_BREAKPOINTS = {
  tabletMin: 768,
  desktopMin: 1024,
} as const;

export function deviceClassForWidth(width: number): DeviceClass {
  if (width < DEVICE_CLASS_BREAKPOINTS.tabletMin) return "phone";
  if (width < DEVICE_CLASS_BREAKPOINTS.desktopMin) return "tablet";
  return "desktop";
}

/** The fixed epoch the 48-hour windows count from: 2026-10-26 00:00 UTC. */
export const LANDING_WINDOW_EPOCH_MS = Date.UTC(2026, 9, 26, 0, 0, 0);
export const LANDING_WINDOW_MS = 48 * 60 * 60 * 1000;

/** The window `now` falls in. Before the epoch is window 0's predecessor, never a landing. */
export function landingWindowIndex(now: Date): number {
  return Math.floor(
    (now.getTime() - LANDING_WINDOW_EPOCH_MS) / LANDING_WINDOW_MS,
  );
}

/** The runtime configuration (practice_runtime_config `landing_*` keys). */
export const landingConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** The share of picks that go to `dashboard`, in [0, 1). Ruling C: 1/3. */
    dashboardShare: z.number().min(0).lt(1),
    /** Relative weights of the other arms; 0 = never eligible. */
    weights: z.record(landingArmSchema, z.number().min(0)),
    salt: z.string().min(1),
  })
  .strict();
export type LandingConfig = z.infer<typeof landingConfigSchema>;

export type LandingEligibilityFacts = {
  /** calendar_access granted (an active entitlement). */
  isPro: boolean;
  /** A row in calendar_current_plan. Only read for a Pro student. */
  hasPlan: boolean;
};

/**
 * The arms a student may get, frozen at the window's first open (ruling C; "eligibility is
 * evaluated at window start"). `dashboard` is always eligible; any other arm needs a weight > 0.
 */
export function eligibleLandingArms(
  facts: LandingEligibilityFacts,
  weights: LandingConfig["weights"],
): LandingArm[] {
  const candidates: LandingArm[] = [...LANDING_ARMS_EVERYONE];
  if (facts.isPro) {
    candidates.push(
      ...(facts.hasPlan
        ? LANDING_ARMS_PRO_WITH_PLAN
        : LANDING_ARMS_PRO_WITHOUT_PLAN),
    );
  }
  return candidates.filter(
    (arm) => arm === "dashboard" || (weights[arm] ?? 0) > 0,
  );
}

/**
 * The deterministic pick. `unit` is a value in [0, 1) derived from hash(student, window, salt).
 * Below `dashboardShare` it is `dashboard`; the rest of the interval is split across the other
 * eligible arms by weight, walked in `LANDING_ARMS` order so the result never depends on the
 * order the eligible list arrived in.
 */
export function pickLandingArm(
  unit: number,
  eligible: readonly LandingArm[],
  config: Pick<LandingConfig, "dashboardShare" | "weights">,
): LandingArm {
  const others = LANDING_ARMS.filter(
    (arm) =>
      arm !== "dashboard" &&
      eligible.includes(arm) &&
      (config.weights[arm] ?? 0) > 0,
  );
  if (others.length === 0 || unit < config.dashboardShare) return "dashboard";
  const total = others.reduce(
    (sum, arm) => sum + (config.weights[arm] ?? 0),
    0,
  );
  let point =
    ((unit - config.dashboardShare) / (1 - config.dashboardShare)) * total;
  for (const arm of others) {
    point -= config.weights[arm] ?? 0;
    if (point < 0) return arm;
  }
  // Floating-point remainder at the very top of the interval: the last arm.
  return others[others.length - 1] ?? "dashboard";
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** POST /api/landing/open */
export const landingOpenRequestSchema = z
  .object({
    device_class: deviceClassSchema,
    /** The browser's own instance id, so a set created for it binds to the runner that opens it. */
    client_instance_id: z.string().min(1).max(200),
  })
  .strict();
export type LandingOpenRequest = z.infer<typeof landingOpenRequestSchema>;

/**
 * Where the client goes. `path: null` = stay on Home. `show_id` is set when this open was a
 * landing (the escape report names it); `arm` is the assigned arm, also when it fell back.
 */
export const landingOpenResponseSchema = z
  .object({
    path: z.string().startsWith("/").nullable(),
    show_id: z.string().uuid().nullable(),
    arm: storedLandingArmSchema.nullable(),
  })
  .strict();
export type LandingOpenResponse = z.infer<typeof landingOpenResponseSchema>;

/** POST /api/landing/escape: the student reached Home after a landing. */
export const landingEscapeRequestSchema = z
  .object({ show_id: z.string().uuid() })
  .strict();
export type LandingEscapeRequest = z.infer<typeof landingEscapeRequestSchema>;

/**
 * POST /api/landing/more: "5 more?" after today's question. The server finds today's
 * `qotd_then_more` show itself, so the client keeps no landing state across page loads.
 */
export const landingMoreRequestSchema = z
  .object({ client_instance_id: z.string().min(1).max(200) })
  .strict();
export type LandingMoreRequest = z.infer<typeof landingMoreRequestSchema>;
export const landingMoreResponseSchema = z
  .object({ path: z.string().startsWith("/").nullable() })
  .strict();
export type LandingMoreResponse = z.infer<typeof landingMoreResponseSchema>;

/** The query a landing-opened runner carries so its back link reads "Home" and goes there. */
export const LANDING_RUNNER_QUERY = "from=landing" as const;

/**
 * Set sizes and sections (Karl, 2026-10-26): `set_math_5` and "5 more?" are both 5 questions of
 * Math only. One section, because the session page runs a practice session in one section.
 */
export const LANDING_SET_SIZE = 5;
export const LANDING_MORE_SIZE = 5;
export const LANDING_SET_SECTIONS = ["M"] as const;
/** The first N items of every landing set are easy or medium (difficulty 1 or 2). */
export const LANDING_LEAD_EASY_MEDIUM = 2;
/** `landing_escaped`: going Home within this many seconds of the landing being shown. */
export const LANDING_ESCAPE_SECONDS = 30;
