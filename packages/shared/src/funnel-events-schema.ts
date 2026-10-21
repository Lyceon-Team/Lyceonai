/**
 * Server-side funnel events: the shared names and the property values they may carry.
 *
 * @spec [owner brief "Server-side funnel events" (Karl, 2026-10-21) "Events" table; Karl's answers
 *       of 2026-10-21 (onboarding_completed ~10s after completion; plan_created = first plan
 *       generated; upgraded via `alpha` = a 100%-off discount)] | @implemented [2026-10-21]
 *
 * plain English: the six milestones, each sent at most once per student, and the closed value sets
 * of their non-numeric properties. The full payload shapes, with `additionalProperties: false`, are
 * the registry entries in infra/event-schema-registry.yaml, which emitEvent validates every send
 * against; these enums are the same values, used by the server code that builds the payloads and by
 * the milestones table's CHECK (supabase/migrations/20261109000000_analytics_funnel_milestones.sql).
 */
import { z } from "zod";

export const FUNNEL_MILESTONES = [
  "onboarding_completed",
  "first_answer",
  "first_practice",
  "diagnostic_completed",
  "plan_created",
  "upgraded",
] as const;
export const funnelMilestoneSchema = z.enum(FUNNEL_MILESTONES);
export type FunnelMilestone = z.infer<typeof funnelMilestoneSchema>;

/** `first_answer.source`. `first_practice.source` is the same minus `qotd`. */
export const funnelAnswerSourceSchema = z.enum([
  "qotd",
  "practice",
  "diagnostic",
]);
export type FunnelAnswerSource = z.infer<typeof funnelAnswerSourceSchema>;

/** `onboarding_completed.age_band`. Under-13 accounts are never sent (emitEvent excludes them). */
export const funnelAgeBandSchema = z.enum(["13-17", "18+"]);
export type FunnelAgeBand = z.infer<typeof funnelAgeBandSchema>;

/** `upgraded.via`: a 100%-off founding code, a guardian's payment, or the student's own. */
export const funnelUpgradeViaSchema = z.enum([
  "alpha",
  "paid",
  "guardian_paid",
]);
export type FunnelUpgradeVia = z.infer<typeof funnelUpgradeViaSchema>;
