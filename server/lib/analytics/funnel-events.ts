/**
 * Server-side funnel events: six once-per-student milestones, sent through emitEvent.
 *
 * @spec [owner brief "Server-side funnel events" (Karl, 2026-10-21); Karl's answers of 2026-10-21:
 *       onboarding_completed is sent ~10s after completion so the separately saved SAT date and
 *       score are seen, plan_created is the first plan generated, upgraded `alpha` is a 100%-off
 *       discount; Karl's ruling 2026-10-21: anonymous product-usage metadata, no Privacy Policy
 *       change; Doc 07A V1.0 §9 (every server event goes through emitEvent)] | @implemented
 *       [2026-10-21]
 *
 * plain English: PostHog sees only visitors who accepted analytics cookies, so the student
 * journey is mostly invisible there. These six events are sent by the server instead, under the
 * same salted analytics_user_id as `user_signed_up` (emitEvent derives it; no name, email or raw
 * id ever leaves), so the funnels join up.
 *
 * The rules, and where each is held:
 *   - ONCE PER STUDENT, EVER: before sending, the milestone is CLAIMED in
 *     analytics_funnel_milestones with an insert-once (`analytics_funnel_claim` is true only for
 *     the call that inserted). Retries, reloads, second sessions and concurrent requests find the
 *     row and send nothing. Milestones passed before this shipped were claimed by the migration.
 *   - A send that FAILS for a transient reason (PostHog down, the profile read failing) releases
 *     the claim, so the next qualifying moment tries again. A policy exclusion (under 13, age not
 *     yet known: emitEvent's rule for user_signed_up, matched not reinvented) keeps the claim, so
 *     an excluded account is not re-tried on every answer.
 *   - ONLY THE LISTED PROPERTIES: each payload is built here from coarse facts, and emitEvent
 *     validates it against the registry entry (`additionalProperties: false`), so an extra field
 *     is refused, not sent.
 *   - ANALYTICS OFF (no POSTHOG_API_KEY or ANALYTICS_SALT): nothing is claimed or read.
 *   - FIRE-AND-FORGET: the route calls `fire…`, which hands the work to Vercel's `waitUntil` and
 *     returns at once. Nothing here throws into the caller and nothing delays its response.
 *
 * Each emission names its event as a string literal at an `emitEventWith` call, so
 * ci/event-schema-registry-parity can prove every name is registered.
 */
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import {
  funnelAgeBandSchema,
  type FunnelAgeBand,
  type FunnelAnswerSource,
  type FunnelMilestone,
  type FunnelUpgradeVia,
} from "../../../packages/shared/src/funnel-events-schema";
import { ageInYears } from "../../../packages/shared/src/profile-role-choice-schema";
import { logger } from "../../logger";
import {
  analyticsConfigProblems,
  defaultEmitDeps,
  emitEventWith,
  type EmitDeps,
  type EmitResult,
} from "./emit-event";

const COMPONENT = "ANALYTICS_FUNNEL";

/** Karl, 2026-10-21: long enough for the onboarding form's second save (date and score). */
export const ONBOARDING_EVENT_DELAY_MS = 10_000;

export type FunnelOutcome = "sent" | "already_sent" | "skipped" | "failed";

const signupFactsSchema = z.object({
  created_at: z.string().min(1),
  role: z.string().nullable(),
  date_of_birth: z.string().nullable(),
});
type SignupFacts = z.infer<typeof signupFactsSchema>;

export type FunnelDeps = {
  emit: EmitDeps;
  claim: (profileId: string, milestone: FunnelMilestone) => Promise<boolean>;
  release: (profileId: string, milestone: FunnelMilestone) => Promise<void>;
  loadSignupFacts: (profileId: string) => Promise<SignupFacts | null>;
  loadGoalFacts: (
    profileId: string,
  ) => Promise<{ hasTestDate: boolean; hasTargetScore: boolean }>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
};

// ---------------------------------------------------------------------------------------------
// Pure property builders
// ---------------------------------------------------------------------------------------------

/** "13-17" or "18+"; null for under 13 or an unknown age (never sent: emitEvent excludes them). */
export function ageBand(
  dateOfBirth: string | null,
  now: Date,
): FunnelAgeBand | null {
  if (dateOfBirth === null) return null;
  const age = ageInYears(dateOfBirth, now);
  if (age === null || age < 13) return null;
  return funnelAgeBandSchema.parse(age >= 18 ? "18+" : "13-17");
}

/** Whole hours since sign-up, rounded; never negative. */
export function hoursSince(createdAt: string, now: Date): number {
  const ms = now.getTime() - new Date(createdAt).getTime();
  return Math.max(0, Math.round(ms / 3_600_000));
}

/** Whole days since sign-up (completed days); never negative. */
export function daysSince(createdAt: string, now: Date): number {
  const ms = now.getTime() - new Date(createdAt).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** first_answer's source from the session's stored mode. */
export function answerSourceForMode(mode: string): FunnelAnswerSource {
  if (mode === "qotd") return "qotd";
  if (mode === "diagnostic") return "diagnostic";
  return "practice";
}

/**
 * `upgraded.via` (Karl, 2026-10-21): a discount whose coupon is 100% off is the founding code
 * (`alpha`), whoever paid; otherwise a payer other than the student is a guardian
 * (`guardian_paid`); otherwise the student paid (`paid`). Reads the subscription's `discounts`
 * as Stripe returns them with `discounts.source.coupon` expanded. Returns null when the discounts
 * cannot be read (an unexpanded coupon, an unknown shape): unknown is never guessed.
 */
const expandedDiscountsSchema = z.array(
  z.object({
    source: z.object({
      coupon: z.object({ percent_off: z.number().nullable() }),
    }),
  }),
);

export function classifyUpgradeVia(input: {
  discounts: unknown;
  payerProfileId: string | null;
  studentProfileId: string;
}): FunnelUpgradeVia | null {
  const discounts = expandedDiscountsSchema.safeParse(input.discounts ?? []);
  if (!discounts.success) return null;
  if (discounts.data.some((d) => d.source.coupon.percent_off === 100))
    return "alpha";
  if (
    input.payerProfileId !== null &&
    input.payerProfileId !== input.studentProfileId
  ) {
    return "guardian_paid";
  }
  return "paid";
}

// ---------------------------------------------------------------------------------------------
// Claim, send, release
// ---------------------------------------------------------------------------------------------

/** emitEvent refusals that are the policy working: the claim is kept, nothing is re-tried. */
const KEEP_CLAIM_ON = new Set(["excluded_under_13_or_age_unknown"]);

async function claimThenSend(
  deps: FunnelDeps,
  profileId: string,
  milestone: FunnelMilestone,
  send: () => Promise<EmitResult | "skip">,
): Promise<FunnelOutcome> {
  // Analytics switched off (no key or salt): claim nothing, so the milestone is still unclaimed
  // when it is switched on. Nothing is read or written.
  if (analyticsConfigProblems(deps.emit.env).length > 0) return "skipped";
  let claimed: boolean;
  try {
    claimed = await deps.claim(profileId, milestone);
  } catch (error: unknown) {
    logger.warn(
      COMPONENT,
      "claim_failed",
      "Funnel milestone claim failed; not sent",
      {
        milestone,
        error: error instanceof Error ? error.name : "unknown",
      },
    );
    return "failed";
  }
  if (!claimed) return "already_sent";

  let result: EmitResult | "skip";
  try {
    result = await send();
  } catch (error: unknown) {
    logger.warn(
      COMPONENT,
      "build_failed",
      "Funnel event could not be built; claim released",
      {
        milestone,
        error: error instanceof Error ? error.name : "unknown",
      },
    );
    result = { ok: false, reason: "identity_unavailable" };
  }
  if (result === "skip") return "skipped";
  if (result.ok) return "sent";
  if (KEEP_CLAIM_ON.has(result.reason)) return "skipped";
  try {
    await deps.release(profileId, milestone);
  } catch (error: unknown) {
    logger.warn(
      COMPONENT,
      "release_failed",
      "Funnel milestone release failed",
      {
        milestone,
        error: error instanceof Error ? error.name : "unknown",
      },
    );
  }
  return "failed";
}

async function signupFacts(
  deps: FunnelDeps,
  profileId: string,
): Promise<SignupFacts> {
  const facts = await deps.loadSignupFacts(profileId);
  if (!facts) throw new Error("profile_not_found");
  return facts;
}

// ---------------------------------------------------------------------------------------------
// The six events (each `emitEventWith` names its event as a literal)
// ---------------------------------------------------------------------------------------------

export async function runOnboardingCompleted(
  deps: FunnelDeps,
  profileId: string,
): Promise<FunnelOutcome> {
  // Karl, 2026-10-21: wait for the form's second save, then read what is stored.
  await deps.sleep(ONBOARDING_EVENT_DELAY_MS);
  return claimThenSend(deps, profileId, "onboarding_completed", async () => {
    const facts = await signupFacts(deps, profileId);
    if (facts.role !== "student" && facts.role !== "guardian") return "skip";
    const band = ageBand(facts.date_of_birth, deps.now());
    if (band === null)
      return { ok: false, reason: "excluded_under_13_or_age_unknown" };
    const goal =
      facts.role === "student"
        ? await deps.loadGoalFacts(profileId)
        : { hasTestDate: false, hasTargetScore: false };
    return emitEventWith(deps.emit, profileId, "onboarding_completed", {
      role: facts.role,
      age_band: band,
      has_test_date: goal.hasTestDate,
      has_target_score: goal.hasTargetScore,
    });
  });
}

/** first_answer for any answer; first_practice too when the answer was not the QOTD. */
export async function runAnswerMilestones(
  deps: FunnelDeps,
  profileId: string,
  sessionMode: string,
): Promise<{
  firstAnswer: FunnelOutcome;
  firstPractice: FunnelOutcome | null;
}> {
  const source = answerSourceForMode(sessionMode);
  const firstAnswer = await claimThenSend(
    deps,
    profileId,
    "first_answer",
    async () => {
      const facts = await signupFacts(deps, profileId);
      return emitEventWith(deps.emit, profileId, "first_answer", {
        source,
        hours_since_signup: hoursSince(facts.created_at, deps.now()),
      });
    },
  );
  if (source === "qotd") return { firstAnswer, firstPractice: null };
  const firstPractice = await claimThenSend(
    deps,
    profileId,
    "first_practice",
    async () => {
      const facts = await signupFacts(deps, profileId);
      return emitEventWith(deps.emit, profileId, "first_practice", {
        source,
        hours_since_signup: hoursSince(facts.created_at, deps.now()),
      });
    },
  );
  return { firstAnswer, firstPractice };
}

export async function runDiagnosticCompleted(
  deps: FunnelDeps,
  profileId: string,
): Promise<FunnelOutcome> {
  return claimThenSend(deps, profileId, "diagnostic_completed", async () => {
    const facts = await signupFacts(deps, profileId);
    return emitEventWith(deps.emit, profileId, "diagnostic_completed", {
      days_since_signup: daysSince(facts.created_at, deps.now()),
    });
  });
}

export async function runPlanCreated(
  deps: FunnelDeps,
  profileId: string,
): Promise<FunnelOutcome> {
  return claimThenSend(deps, profileId, "plan_created", async () => {
    const facts = await signupFacts(deps, profileId);
    return emitEventWith(deps.emit, profileId, "plan_created", {
      days_since_signup: daysSince(facts.created_at, deps.now()),
    });
  });
}

/**
 * `resolveVia` is read only after the claim succeeds (one Stripe read per first activation). A
 * null `via` (the read failed) is a transient failure: the claim is released, nothing is guessed.
 */
export async function runUpgraded(
  deps: FunnelDeps,
  studentProfileId: string,
  resolveVia: () => Promise<FunnelUpgradeVia | null>,
): Promise<FunnelOutcome> {
  return claimThenSend(deps, studentProfileId, "upgraded", async () => {
    const via = await resolveVia();
    if (via === null) return { ok: false, reason: "identity_unavailable" };
    const facts = await signupFacts(deps, studentProfileId);
    return emitEventWith(deps.emit, studentProfileId, "upgraded", {
      via,
      days_since_signup: daysSince(facts.created_at, deps.now()),
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Production dependencies and the fire-and-forget entry points
// ---------------------------------------------------------------------------------------------

export function defaultFunnelDeps(): FunnelDeps {
  return {
    emit: defaultEmitDeps,
    async claim(profileId, milestone) {
      const { data, error } = await supabaseServer.rpc(
        "analytics_funnel_claim",
        {
          p_profile_id: profileId,
          p_milestone: milestone,
        },
      );
      if (error) throw new Error(`claim failed: ${error.code ?? "unknown"}`);
      return data === true;
    },
    async release(profileId, milestone) {
      const { error } = await supabaseServer.rpc("analytics_funnel_release", {
        p_profile_id: profileId,
        p_milestone: milestone,
      });
      if (error) throw new Error(`release failed: ${error.code ?? "unknown"}`);
    },
    async loadSignupFacts(profileId) {
      const { data, error } = await supabaseServer
        .from("profiles")
        .select("created_at, role, date_of_birth")
        .eq("id", profileId)
        .maybeSingle();
      if (error)
        throw new Error(`profile read failed: ${error.code ?? "unknown"}`);
      if (data === null) return null;
      return signupFactsSchema.parse(data);
    },
    async loadGoalFacts(profileId) {
      const { data, error } = await supabaseServer
        .from("student_study_profile")
        .select("target_exam_dates, target_score")
        .eq("student_id", profileId)
        .maybeSingle();
      if (error)
        throw new Error(
          `study profile read failed: ${error.code ?? "unknown"}`,
        );
      const row = z
        .object({
          target_exam_dates: z.array(z.string()).nullable(),
          target_score: z.number().nullable(),
        })
        .nullable()
        .parse(data);
      return {
        hasTestDate: (row?.target_exam_dates?.length ?? 0) > 0,
        hasTargetScore:
          row?.target_score !== null && row?.target_score !== undefined,
      };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
  };
}

/** Never throws, never delays the caller; the work is kept alive by `waitUntil`. */
function fire(label: string, task: () => Promise<unknown>): void {
  const settled = Promise.resolve()
    .then(task)
    .catch((error: unknown) => {
      logger.error(COMPONENT, "unexpected_failure", "Funnel event task threw", {
        label,
        error: error instanceof Error ? error.name : "unknown",
      });
    });
  waitUntil(settled);
}

export function fireOnboardingCompleted(profileId: string): void {
  fire("onboarding_completed", () =>
    runOnboardingCompleted(defaultFunnelDeps(), profileId),
  );
}

export function fireAnswerMilestones(
  profileId: string,
  sessionMode: string,
): void {
  fire("answer", () =>
    runAnswerMilestones(defaultFunnelDeps(), profileId, sessionMode),
  );
}

export function fireDiagnosticCompleted(profileId: string): void {
  fire("diagnostic_completed", () =>
    runDiagnosticCompleted(defaultFunnelDeps(), profileId),
  );
}

export function firePlanCreated(profileId: string): void {
  fire("plan_created", () => runPlanCreated(defaultFunnelDeps(), profileId));
}

export function fireUpgraded(
  studentProfileId: string,
  resolveVia: () => Promise<FunnelUpgradeVia | null>,
): void {
  fire("upgraded", () =>
    runUpgraded(defaultFunnelDeps(), studentProfileId, resolveVia),
  );
}
