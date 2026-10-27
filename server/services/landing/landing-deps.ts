/**
 * The production answers to `LandingDeps`: the real tables, functions and engines.
 *
 * @spec [owner brief "Smart landing" (Karl, 2026-10-26); Karl's rulings on Step 0 (A–E);
 *        lyceon-coding-standards §2 (DB access centralised: every read and write here goes through
 *        supabaseServer and the migration's functions)] | @implemented [2026-10-26]
 *
 * plain English: each dependency is one read or write. Sets are created through the practice
 * page's own `startOrReplaySession` (with the server-only `composition`), today's block through
 * the calendar's own `launchBlock` (with the server-only `landing_lead`), and the quota through
 * the shared dry run, so a landing can never do something the student's own tap could not.
 * edge cases: a free student's quota is read only for `qotd_then_more` (the sets read it inside
 * the start, which refuses with 402 when nothing is left).
 */
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { defaultEmitDeps } from "../../lib/analytics/emit-event";
import { dryRunPracticeQuota } from "../../lib/practice-quota";
import { EntitlementService } from "../entitlement-service";
import { getHomeQotdToday } from "../qotd/home-qotd-service";
import { readCalendar } from "../calendar/read-service";
import { launchBlock } from "../calendar/launch-service";
import { liveLaunchDeps } from "../calendar/launch-deps";
import { startOrReplaySession } from "../../routes/practice-canonical";
import {
  deviceClassSchema,
  landingFallbackReasonSchema,
  storedLandingArmSchema,
  LANDING_RUNNER_QUERY,
  LANDING_SET_SECTIONS,
  type LandingFallbackReason,
} from "../../../packages/shared/src/smart-landing-schema";
import { loadLandingConfig } from "./landing-config";
import type { LandingDeps, SetOutcome } from "./landing-service";

const ACTIVE = ["created", "active"] as const;

const claimRowSchema = z.object({
  show_id: z.string().uuid(),
  arm: storedLandingArmSchema,
  eligible_arms: z.array(storedLandingArmSchema),
  first_in_window: z.boolean(),
});

const windowRowSchema = z.object({
  arm: storedLandingArmSchema,
  eligible_arms: z.array(storedLandingArmSchema),
});

const todayShowRowSchema = z.object({
  id: z.string().uuid(),
  arm: storedLandingArmSchema,
});

const escapeRowSchema = z.object({
  window_index: z.number().int(),
  arm: storedLandingArmSchema,
  device_class: deviceClassSchema,
});

const summaryRowSchema = z.object({
  show_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  window_index: z.number().int(),
  arm: storedLandingArmSchema,
  device_class: deviceClassSchema,
  questions_answered: z.number().int().min(0),
});

function readFailed(what: string, message: string): never {
  throw new Error(`landing ${what} failed: ${message}`);
}

/** The engine's refusal status, as the reason the landing records. */
export function fallbackForStatus(status: number): LandingFallbackReason {
  if (status === 402) return "quota_exhausted";
  if (status === 403) return "session_limit";
  if (status === 422) return "no_questions";
  return "error";
}

async function hasCurrentPlan(profileId: string): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("calendar_current_plan")
    .select("block_id")
    .eq("student_id", profileId)
    .limit(1);
  if (error) readFailed("plan read", error.message);
  return (data ?? []).length > 0;
}

async function mostRecentOpen(
  table: "practice_sessions" | "review_sessions",
  ownerColumn: "user_id" | "student_id",
  profileId: string,
  since: Date,
): Promise<{ id: string; last_activity_at: string } | null> {
  let query = supabaseServer
    .from(table)
    .select("id, last_activity_at")
    .eq(ownerColumn, profileId)
    .in("status", [...ACTIVE])
    .gte("last_activity_at", since.toISOString())
    .order("last_activity_at", { ascending: false })
    .limit(1);
  // A QOTD answer is a one-item practice session; it is never "in progress".
  if (table === "practice_sessions") query = query.neq("mode", "qotd");
  const { data, error } = await query;
  if (error) readFailed(`${table} read`, error.message);
  const row = (data ?? [])[0] as
    | { id: string; last_activity_at: string }
    | undefined;
  return row ?? null;
}

export const liveLandingDeps: LandingDeps = {
  now: () => new Date(),
  emit: defaultEmitDeps,
  loadConfig: loadLandingConfig,

  async readWindowArm(profileId, windowIndex) {
    const { data, error } = await supabaseServer
      .from("landing_windows")
      .select("arm, eligible_arms")
      .eq("profile_id", profileId)
      .eq("window_index", windowIndex)
      .maybeSingle();
    if (error) readFailed("window read", error.message);
    return data === null ? null : windowRowSchema.parse(data);
  },

  async readFacts(profileId) {
    const isPro = await EntitlementService.canAccessFeature(
      profileId,
      "calendar_access",
    );
    return { isPro, hasPlan: isPro ? await hasCurrentPlan(profileId) : false };
  },

  async resumePath(profileId, since) {
    const [practice, review] = await Promise.all([
      mostRecentOpen("practice_sessions", "user_id", profileId, since),
      mostRecentOpen("review_sessions", "student_id", profileId, since),
    ]);
    if (practice === null && review === null) return null;
    if (
      review !== null &&
      (practice === null || review.last_activity_at > practice.last_activity_at)
    ) {
      return `/review/session/${review.id}`;
    }
    return practice === null ? null : `/practice/session/${practice.id}`;
  },

  async claimOpen(args) {
    const { data, error } = await supabaseServer.rpc("landing_claim_open", {
      p_profile_id: args.profileId,
      p_window_index: args.windowIndex,
      p_arm: args.arm,
      p_eligible_arms: args.eligibleArms,
      p_device_class: args.deviceClass,
      p_now: args.now.toISOString(),
    });
    if (error) readFailed("claim", error.message);
    const row = ((data ?? []) as unknown[])[0];
    return row === undefined ? null : claimRowSchema.parse(row);
  },

  async setFallback(showId, reason) {
    const { error } = await supabaseServer
      .from("landing_shows")
      .update({ fallback_reason: landingFallbackReasonSchema.parse(reason) })
      .eq("id", showId)
      .is("fallback_reason", null);
    if (error) readFailed("fallback write", error.message);
  },

  async qotdAvailable(caller, now) {
    const today = await getHomeQotdToday(
      { id: caller.id, actorId: caller.actorId },
      now,
    );
    return today.state !== "none";
  },

  async quotaAllows(caller) {
    const decision = await dryRunPracticeQuota({
      userId: caller.id,
      role: caller.role,
    });
    return decision.allowed;
  },

  async startSet(args): Promise<SetOutcome> {
    // One section, named on the session itself (`section`) and in its spec, so the session page,
    // which runs a practice session in one section, can open it (Karl, 2026-10-26).
    const sections: ("M" | "RW")[] = [...LANDING_SET_SECTIONS];
    const result = await startOrReplaySession({
      userId: args.caller.id,
      actorId: args.caller.actorId,
      role: args.caller.role,
      section: LANDING_SET_SECTIONS[0],
      mode: "balanced",
      clientInstanceId: args.clientInstanceId,
      idempotencyKey: args.idempotencyKey,
      targetQuestionCount: args.size,
      sessionSpec: {
        sections,
        domains: [],
        skills: [],
        difficulties: [],
        target_minutes: null,
        target_question_count: args.size,
        mode: "balanced",
      },
      composition: "easy_medium_lead",
    });
    return result.ok
      ? { ok: true, sessionId: result.session.id }
      : { ok: false, reason: fallbackForStatus(result.status) };
  },

  async launchToday(args) {
    // The calendar route gates a launch on calendar_access; this server-side launch must too, at
    // the moment of the launch (eligibility was frozen at window start; the entitlement may not be).
    if (
      !(await EntitlementService.canAccessFeature(
        args.caller.id,
        "calendar_access",
      ))
    ) {
      return { ok: false, reason: "not_entitled" };
    }
    const calendar = await readCalendar({
      student_id: args.caller.id,
      query: {},
      now: args.now,
    });
    if (!calendar.ok || calendar.value.status !== "ready") {
      return { ok: false, reason: "no_block_today" };
    }
    const today = calendar.value.days.find((day) => day.status === "today");
    const block = today?.blocks.find(
      (b) => b.status !== "completed" && b.block.block_type === "practice",
    )?.block;
    if (block === undefined) return { ok: false, reason: "no_block_today" };
    const launched = await launchBlock(
      {
        student_id: args.caller.id,
        actor_id: args.caller.actorId,
        role: args.caller.role,
        block_id: block.block_id,
        client_instance_id: args.clientInstanceId,
        platform: "web",
        landing_lead: true,
      },
      liveLaunchDeps,
    );
    if (!launched.ok) {
      const error = launched.error;
      if (error.kind === "already_complete")
        return { ok: false, reason: "no_block_today" };
      if (error.kind === "engine_error" && error.status !== undefined) {
        return { ok: false, reason: fallbackForStatus(error.status) };
      }
      return { ok: false, reason: "error" };
    }
    const sep = launched.value.next.includes("?") ? "&" : "?";
    return {
      ok: true,
      path: `${launched.value.next}${sep}${LANDING_RUNNER_QUERY}`,
    };
  },

  async readTodayShow(profileId, windowIndex, chicagoDay) {
    const { data, error } = await supabaseServer
      .from("landing_shows")
      .select("id, arm")
      .eq("profile_id", profileId)
      .eq("window_index", windowIndex)
      .eq("chicago_day", chicagoDay)
      .maybeSingle();
    if (error) readFailed("show read", error.message);
    if (data === null) return null;
    const row = todayShowRowSchema.parse(data);
    return { show_id: row.id, arm: row.arm };
  },

  async recordEscape(args) {
    const { data, error } = await supabaseServer.rpc("landing_record_escape", {
      p_show_id: args.showId,
      p_profile_id: args.profileId,
      p_now: args.now.toISOString(),
      p_max_seconds: args.maxSeconds,
    });
    if (error) readFailed("escape", error.message);
    const row = ((data ?? []) as unknown[])[0];
    return row === undefined ? null : escapeRowSchema.parse(row);
  },

  async claimSummaries(now, limit) {
    const { data, error } = await supabaseServer.rpc(
      "landing_claim_summaries",
      {
        p_now: now.toISOString(),
        p_limit: limit,
      },
    );
    if (error) readFailed("summary claim", error.message);
    return z.array(summaryRowSchema).parse(data ?? []);
  },

  async releaseSummary(showId) {
    const { error } = await supabaseServer
      .from("landing_shows")
      .update({ summarized_at: null })
      .eq("id", showId);
    if (error) readFailed("summary release", error.message);
  },
};
