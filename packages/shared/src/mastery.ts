import { z } from "zod";

/**
 * @spec [Doc 05A §7.4 + Doc 05B §5.4 student-readable grants; Doc 05 Parent §4.5 level
 *   boundaries, §4.7 independent computation, §6.6 NULL-evidence, Acceptance Criteria #19/#20]
 * | @implemented [2026-06-23]
 * plain English: the single source of truth for client-facing mastery READ DTOs. Student and
 * guardian surfaces expose ONLY the canonical 0–4 `mastery_level` rendered as a tier — never
 * `mastery_score`, never `mastery_pct`, never a percentage (AC#20, INV-05A-12). Skill and domain
 * mastery are each independently event-computed (Parent §4.7); a domain tier is NOT an average of
 * its skills. The section level carries no tier and no projection — it is a pure grouping container
 * (owner ruling 2026-06-23); the Doc 05C SAT projection lives on its own surface, not this page.
 * Trade-offs: the tier is a coarser signal than the raw score by design (anti-leak / honest
 * progress); the raw score stays admin-only and does not unlock behind auth+entitlement.
 * Edge cases: `masteryLevel === null` means no/insufficient evidence (< MIN_EVENTS_FOR_MASTERY,
 * Parent §6.6) → `not_started`. NULL is not zero.
 */

/** UI tier vocabulary — a presentation grouping of the canonical 0–4 levels. */
export const masteryTierSchema = z.enum([
  "not_started",
  "weak",
  "improving",
  "proficient",
]);
export type MasteryTier = z.infer<typeof masteryTierSchema>;

/** Canonical `mastery_level`: integer 0–4, or null when evidence is absent/insufficient. */
export const masteryLevelSchema = z.number().int().min(0).max(4).nullable();
export type MasteryLevel = z.infer<typeof masteryLevelSchema>;

export const skillMasteryNodeSchema = z.object({
  skill: z.string(),
  label: z.string(),
  masteryLevel: masteryLevelSchema,
  tier: masteryTierSchema,
  computedAt: z.string().nullable(),
});
export type SkillMasteryNode = z.infer<typeof skillMasteryNodeSchema>;

export const domainMasteryNodeSchema = z.object({
  domain: z.string(),
  label: z.string(),
  masteryLevel: masteryLevelSchema,
  tier: masteryTierSchema,
  computedAt: z.string().nullable(),
  skills: z.array(skillMasteryNodeSchema),
});
export type DomainMasteryNode = z.infer<typeof domainMasteryNodeSchema>;

export const sectionMasteryNodeSchema = z.object({
  section: z.string(),
  label: z.string(),
  domains: z.array(domainMasteryNodeSchema),
});
export type SectionMasteryNode = z.infer<typeof sectionMasteryNodeSchema>;

export const masteryTreeResponseSchema = z.object({
  sections: z.array(sectionMasteryNodeSchema),
});
export type MasteryTreeResponse = z.infer<typeof masteryTreeResponseSchema>;

/**
 * Maps the canonical `mastery_level` (0–4) to a UI tier. The raw `mastery_score` is NEVER
 * consulted (AC#20) — this is the only sanctioned status path. A null level (no/insufficient
 * evidence, Parent §6.6) maps to `not_started`; the prior attempts-based guard is removed
 * (canonical NULL is the evidence signal, not a synthesized attempt count). Pure + deterministic.
 */
export function masteryTierFromLevel(masteryLevel: MasteryLevel): MasteryTier {
  if (masteryLevel === null) return "not_started";
  if (masteryLevel >= 3) return "proficient";
  if (masteryLevel === 2) return "improving";
  return "weak"; // level 0 or 1
}
