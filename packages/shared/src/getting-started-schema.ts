/**
 * The "Getting started" checklist on the student's Home: the API contract and the one rule that
 * turns stored facts into the steps a student sees.
 *
 * @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
 *       brief v2, Karl, 2026-10-13) §2 steps, §3 completion rules, §8 server; mocks v2 approved
 *       2026-10-13; Coding Standards §7.2 (schema first), §3.6 (pure domain)]
 *       | @implemented [2026-10-13]
 *
 * plain English: `getting_started_observe` (SQL) derives each step from the student's real data
 * and latches it the first time it is reached; it returns the facts parsed by
 * `gettingStartedObservationSchema`. `deriveGettingStarted` then decides, deterministically, which
 * steps this student sees and in what state:
 *   - free: test date and score, today's question, the daily email, blind spots, review;
 *   - Pro: those five, then the study calendar, LISA and a guardian link;
 *   - the email step is hidden for a student who cannot opt in (under 13), and LISA for a student
 *     who cannot use it (under 13) — a step that could never be done would hold the card open
 *     forever;
 *   - the email step can be "skipped" ("Not now"), which counts toward finishing; opting in later
 *     makes it "done".
 * The card is complete when every visible step is done or skipped. Every href is a real route
 * (tests/ci/getting-started.contract.test.ts pins each one against the route registry).
 */
import { z } from "zod";

export const GETTING_STARTED_STEP_IDS = [
  "test_date",
  "qotd",
  "email",
  "blind_spots",
  "review",
  "calendar",
  "lisa",
  "guardian",
] as const;
export const gettingStartedStepIdSchema = z.enum(GETTING_STARTED_STEP_IDS);
export type GettingStartedStepId = z.infer<typeof gettingStartedStepIdSchema>;

/** Steps 6–8 are Pro only; free accounts never see them. */
export const PRO_ONLY_STEPS: readonly GettingStartedStepId[] = [
  "calendar",
  "lisa",
  "guardian",
];

/** Where each step is completed. Settings sections are `/profile?tab=<id>`. */
export const GETTING_STARTED_HREF: Record<GettingStartedStepId, string> = {
  test_date: "/profile?tab=profile",
  qotd: "/dashboard#qotd",
  email: "/profile?tab=notifications",
  blind_spots: "/practice",
  review: "/review",
  calendar: "/calendar",
  lisa: "/chat",
  guardian: "/profile?tab=guardian",
};

/** What `getting_started_observe` returns: sticky facts, never content. */
export const gettingStartedObservationSchema = z
  .object({
    email_eligible: z.boolean(),
    test_date_done: z.boolean(),
    qotd_done: z.boolean(),
    email_done: z.boolean(),
    email_skipped: z.boolean(),
    blind_spots_done: z.boolean(),
    review_done: z.boolean(),
    calendar_done: z.boolean(),
    lisa_done: z.boolean(),
    guardian_done: z.boolean(),
    dismissed: z.boolean(),
  })
  .strict();
export type GettingStartedObservation = z.infer<
  typeof gettingStartedObservationSchema
>;

export const gettingStartedPlanSchema = z.enum(["free", "pro"]);
export type GettingStartedPlan = z.infer<typeof gettingStartedPlanSchema>;

export const gettingStartedStepStatusSchema = z.enum([
  "done",
  "open",
  "skipped",
]);
export type GettingStartedStepStatus = z.infer<
  typeof gettingStartedStepStatusSchema
>;

export const gettingStartedStepSchema = z
  .object({
    id: gettingStartedStepIdSchema,
    status: gettingStartedStepStatusSchema,
    href: z.string().min(1),
  })
  .strict();
export type GettingStartedStep = z.infer<typeof gettingStartedStepSchema>;

export const gettingStartedResponseSchema = z
  .object({
    plan: gettingStartedPlanSchema,
    steps: z.array(gettingStartedStepSchema).min(1),
    /** Every visible step done or skipped: the card shows "You're all set" with Dismiss. */
    complete: z.boolean(),
    /** Dismissed for good: Home returns to its usual order. */
    dismissed: z.boolean(),
  })
  .strict();
export type GettingStartedResponse = z.infer<
  typeof gettingStartedResponseSchema
>;

/** "Not sure yet" for the SAT date and/or the target score; at least one. */
export const gettingStartedNotSureRequestSchema = z
  .object({
    test_date: z.literal(true).optional(),
    target_score: z.literal(true).optional(),
  })
  .strict()
  .refine((v) => v.test_date === true || v.target_score === true, {
    message: "Name the test date, the target score, or both.",
  });
export type GettingStartedNotSureRequest = z.infer<
  typeof gettingStartedNotSureRequestSchema
>;

/** The facts the server decides about the student, beside the stored observation. */
export type GettingStartedAudience = {
  plan: GettingStartedPlan;
  /** False when LISA is locked for this student's age (it can never be used). */
  lisaAvailable: boolean;
};

function statusOf(
  id: GettingStartedStepId,
  obs: GettingStartedObservation,
): GettingStartedStepStatus {
  switch (id) {
    case "test_date":
      return obs.test_date_done ? "done" : "open";
    case "qotd":
      return obs.qotd_done ? "done" : "open";
    case "email":
      if (obs.email_done) return "done";
      return obs.email_skipped ? "skipped" : "open";
    case "blind_spots":
      return obs.blind_spots_done ? "done" : "open";
    case "review":
      return obs.review_done ? "done" : "open";
    case "calendar":
      return obs.calendar_done ? "done" : "open";
    case "lisa":
      return obs.lisa_done ? "done" : "open";
    case "guardian":
      return obs.guardian_done ? "done" : "open";
  }
}

function isVisible(
  id: GettingStartedStepId,
  obs: GettingStartedObservation,
  audience: GettingStartedAudience,
): boolean {
  if (audience.plan === "free" && PRO_ONLY_STEPS.includes(id)) return false;
  if (id === "email") return obs.email_eligible;
  if (id === "lisa") return audience.lisaAvailable;
  return true;
}

/** Pure and deterministic: the same facts always give the same card. */
export function deriveGettingStarted(
  obs: GettingStartedObservation,
  audience: GettingStartedAudience,
): GettingStartedResponse {
  const steps = GETTING_STARTED_STEP_IDS.filter((id) =>
    isVisible(id, obs, audience),
  ).map((id) => ({
    id,
    status: statusOf(id, obs),
    href: GETTING_STARTED_HREF[id],
  }));
  return {
    plan: audience.plan,
    steps,
    complete: steps.every((s) => s.status !== "open"),
    dismissed: obs.dismissed,
  };
}
