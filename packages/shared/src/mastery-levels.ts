import { z } from "zod";

/**
 * @spec [Doc 05 Parent §4.5 level boundaries, §6.6 NULL-evidence, Acceptance Criteria
 *   #19/#20; owner ruling 2026-08-20 RULE 1 (the six names), RULE 3 (`unmeasured` is a
 *   row, not a code branch), RULE 4 (the nine never-exposed columns)]
 * | @implemented [2026-08-20]
 *
 * plain English: the client-facing vocabulary for mastery. A student or guardian sees a
 * LEVEL and the NAME of that level — never the arithmetic underneath. These schemas are
 * the only sanctioned shape for that; anything carrying a score, a percentage, an
 * accuracy or an event count is an admin/internal DTO and does not belong here.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `mastery.ts`.
 *   `mastery.ts` owns the OLD four-tier vocabulary (`not_started`/`weak`/`improving`/
 *   `proficient`), which is being retired. Both vocabularies are alive for exactly one
 *   PR while the surfaces move across; keeping them in separate modules makes the
 *   retirement a file deletion rather than an archaeology exercise, and stops a new
 *   import accidentally reaching for the dying enum.
 *
 * WHY THE NAMES ARE NOT DEFINED HERE.
 *   The six display names live in the `mastery_levels` TABLE (migration
 *   20260820000000). This module declares the SHAPE; the database supplies the text.
 *   A second copy of "Foundations" in TypeScript is a second source of truth, and the
 *   whole point of RULE 3 is that a level whose label is missing must fail loudly
 *   rather than fall through a forgotten switch arm.
 *
 * expected outcome: every mastery read surface serialises `{ levelKey, level,
 * displayName }` and nothing else about how the level was reached.
 * trade-offs: the client cannot rank two entities more finely than the five levels
 * allow. That is deliberate — the finer signal is the score, and the score is not the
 * student's to see.
 * edge cases: `level === null` is the unmeasured state and is NOT level 0. The refine
 * below makes the two unrepresentable as each other, in both directions.
 */

/** The six states, in display order. `unmeasured` first: it is where every entity starts. */
export const MASTERY_LEVEL_KEYS = [
  "unmeasured",
  "L0",
  "L1",
  "L2",
  "L3",
  "L4",
] as const;

export const masteryLevelKeySchema = z.enum(MASTERY_LEVEL_KEYS);
export type MasteryLevelKey = z.infer<typeof masteryLevelKeySchema>;

/**
 * One labelled level. The `refine` is RULE 3 restated at the application boundary: it
 * mirrors the `mastery_levels_unmeasured_is_null` CHECK so a row that somehow escaped
 * the database constraint still cannot be serialised to a client.
 */
export const masteryLevelLabelSchema = z
  .object({
    levelKey: masteryLevelKeySchema,
    level: z.number().int().min(0).max(4).nullable(),
    displayName: z.string().min(1),
  })
  .refine(
    (value) => (value.levelKey === "unmeasured") === (value.level === null),
    {
      message:
        "levelKey 'unmeasured' must carry level null, and a null level must carry levelKey 'unmeasured'",
    },
  );
export type MasteryLevelLabel = z.infer<typeof masteryLevelLabelSchema>;

/** Canonical section codes as the database stores them (`questions.section` CHECK). */
export const masterySectionSchema = z.enum(["M", "RW"]);
export type MasterySection = z.infer<typeof masterySectionSchema>;

/**
 * A domain card on the drill-down's first screen (owner ruling RULE 5: domain first,
 * then skills). `domain` is the canonical College Board display string exactly as the
 * database holds it — there is no slug and no second display catalogue.
 */
export const masteryDomainNodeSchema = z.object({
  section: masterySectionSchema,
  domain: z.string().min(1),
  levelKey: masteryLevelKeySchema,
  level: z.number().int().min(0).max(4).nullable(),
  displayName: z.string().min(1),
});
export type MasteryDomainNode = z.infer<typeof masteryDomainNodeSchema>;

/**
 * A skill row inside one domain's panel. `skill` is rendered verbatim — owner ruling
 * 2026-08-20 answer to build question 2. The database strings ("Linear Equations in
 * One Variable") are already the student-facing names; inventing a parallel display
 * catalogue would be a second source of truth for text nobody asked to change.
 */
export const masterySkillNodeSchema = z.object({
  skill: z.string().min(1),
  levelKey: masteryLevelKeySchema,
  level: z.number().int().min(0).max(4).nullable(),
  displayName: z.string().min(1),
});
export type MasterySkillNode = z.infer<typeof masterySkillNodeSchema>;

export const masteryDomainsResponseSchema = z.object({
  ok: z.literal(true),
  domains: z.array(masteryDomainNodeSchema),
});
export type MasteryDomainsResponse = z.infer<
  typeof masteryDomainsResponseSchema
>;

/**
 * `catalogEmpty` is the owner's answer to build question 6: an empty skill panel and a
 * failed load must not look the same. A query failure throws and the route answers 500;
 * a domain the question bank genuinely has no published skills for answers 200 with
 * `catalogEmpty: true` and an empty array. Empty and failed are different answers.
 *
 * The complementary half of that ruling is a hard gate — `scripts/ci/mastery-levels-gate.sh`
 * fails if the catalog does not cover all eight canonical domains — so `catalogEmpty`
 * is a state the UI must handle, not a state production is expected to reach.
 */
export const masterySkillsResponseSchema = z.object({
  ok: z.literal(true),
  section: masterySectionSchema,
  domain: z.string().min(1),
  catalogEmpty: z.boolean(),
  skills: z.array(masterySkillNodeSchema),
});
export type MasterySkillsResponse = z.infer<typeof masterySkillsResponseSchema>;
