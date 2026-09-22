/**
 * Plan blocks and plan members — the stored planning grain, as TypeScript.
 *
 * @spec [Doc_05F §6 (domain model), §7.4 `calendar_blocks`, §7.5
 *        `calendar_plan_block_memberships`, §10.2 (output shape), §12.4 (day edit);
 *        lyceon-coding-standards §7.2]
 * | @implemented [2026-09-17]
 *
 * plain English: two shapes. A PLAN BLOCK is a block row joined to its membership on the
 * current plan — what `calendar_current_plan` hands the read model, and what the allocator
 * allocates to. A NEW BLOCK is the `member.block` object a caller sends when it wants a
 * block created, which `calendar_write_version` reads field by field before INSERTing.
 *
 * expected outcome: the two shapes are the same triple (`block_type`, `section`, `scope`)
 * from `scope.js`, extended with the columns each context actually carries — so a scope rule
 * is enforced once and both shapes get it.
 *
 * trade-offs: `NewBlock` deliberately has no `derived_from_block_id`. That column is
 * lineage, written only by `calendar_do_it_now` inside SQL; putting it on a client-facing
 * member shape would invite a caller to forge a block's ancestry.
 *
 * edge cases: `full_length` carries `target_count: 1` as a literal, because
 * `calendar_blocks_full_length_single` is a CHECK and not a convention. `explanation_key` is
 * nullable on the row (the column is), even though every generated block has one.
 */
import { z } from "zod";
import {
  addDomainSectionIssues,
  calendarSectionSchema,
  fullLengthScopeSchema,
  fullLengthScopeTripleSchema,
  guardianPracticeScopeSchema,
  guardianReviewScopeSchema,
  practiceScopeTripleSchema,
  reviewScopeTripleSchema,
  toGuardianPracticeScope,
  toGuardianReviewScope,
} from "./scope.js";
import { localDateSchema } from "./time.js";

/** `calendar_blocks.source` — what kind of version created the block (§12.1). */
export const BLOCK_SOURCES = ["auto", "student", "post_exam"] as const;
export const blockSourceSchema = z.enum(BLOCK_SOURCES);
export type BlockSource = z.infer<typeof blockSourceSchema>;

/** `calendar_plan_block_memberships.membership_type` (§7.5). */
export const MEMBERSHIP_TYPES = ["created", "carried"] as const;
export const membershipTypeSchema = z.enum(MEMBERSHIP_TYPES);
export type MembershipType = z.infer<typeof membershipTypeSchema>;

/** `target_count integer NOT NULL CHECK (target_count >= 1)`. */
const targetCountSchema = z.number().int().positive();

// ── A block on the current plan ─────────────────────────────────────────────

const storedBlockFields = {
  block_id: z.string().uuid(),
  scheduled_date: localDateSchema,
  source: blockSourceSchema,
  derived_from_block_id: z.string().uuid().nullable(),
  explanation_key: z.string().nullable(),
  /** `display_ordinal smallint NOT NULL CHECK (>= 1)` — the day's display order, and §13's only tiebreak. */
  display_ordinal: z.number().int().positive(),
  membership_type: membershipTypeSchema,
};

/**
 * One block as the current plan holds it. `student_id` is absent on purpose: every read of
 * this shape is already scoped to one student by the route, and carrying the id into a
 * client payload only creates something to leak.
 */
export const planBlockSchema = z
  .discriminatedUnion("block_type", [
    practiceScopeTripleSchema.extend({
      ...storedBlockFields,
      target_count: targetCountSchema,
    }),
    reviewScopeTripleSchema.extend({
      ...storedBlockFields,
      target_count: targetCountSchema,
    }),
    fullLengthScopeTripleSchema.extend({
      ...storedBlockFields,
      target_count: z.literal(1),
    }),
  ])
  .superRefine(addDomainSectionIssues);
export type PlanBlock = z.infer<typeof planBlockSchema>;

// ── A block a caller asks to have created ───────────────────────────────────

const newBlockFields = {
  explanation_key: z.string().nullable(),
};

export const newBlockSchema = z
  .discriminatedUnion("block_type", [
    practiceScopeTripleSchema.extend({
      ...newBlockFields,
      target_count: targetCountSchema,
    }),
    reviewScopeTripleSchema.extend({
      ...newBlockFields,
      target_count: targetCountSchema,
    }),
    fullLengthScopeTripleSchema.extend({
      ...newBlockFields,
      target_count: z.literal(1),
    }),
  ])
  .superRefine(addDomainSectionIssues);
export type NewBlock = z.infer<typeof newBlockSchema>;

// ── Members of a date ───────────────────────────────────────────────────────

/**
 * §10.2: a member is either a block to create here or an existing block carried forward by
 * id. Array order IS display order, which is why the wire shape is a list and not a map.
 * V-12 makes carrying a started block mandatory, and the server injects any the client
 * omitted (§12.4) — this schema describes what may be sent, not what must be.
 */
export const planMemberSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("created"), block: newBlockSchema }).strict(),
  z.object({ kind: z.literal("carried"), block_id: z.string().uuid() }).strict(),
]);
export type PlanMember = z.infer<typeof planMemberSchema>;

// ── The guardian projection ─────────────────────────────────────────────────

const guardianBlockFields = {
  block_id: z.string().uuid(),
  scheduled_date: localDateSchema,
  display_ordinal: z.number().int().positive(),
};

/**
 * A block as a GUARDIAN may see it. §16 and R-08-22: no explanation copy, no controls.
 * `explanation_key` is the handle to §17.6's "why this block" text, so serving the key is
 * serving the explanation — it is absent here at BOTH levels (the block's own key and the
 * per-domain keys inside a practice mix), along with `source`, `derived_from_block_id` and
 * `membership_type`, which describe how the plan was made rather than what the student did.
 *
 * Built as its own `.strict()` union rather than by sanitising `planBlockSchema` on the way
 * out: a shape that never had the key cannot leak it when someone later spreads a block into
 * a response.
 */
export const guardianPlanBlockSchema = z
  .discriminatedUnion("block_type", [
    z
      .object({
        ...guardianBlockFields,
        block_type: z.literal("practice"),
        section: calendarSectionSchema,
        scope: guardianPracticeScopeSchema,
        target_count: targetCountSchema,
      })
      .strict(),
    z
      .object({
        ...guardianBlockFields,
        block_type: z.literal("review"),
        section: z.null(),
        scope: guardianReviewScopeSchema,
        target_count: targetCountSchema,
      })
      .strict(),
    z
      .object({
        ...guardianBlockFields,
        block_type: z.literal("full_length"),
        section: z.null(),
        scope: fullLengthScopeSchema,
        target_count: z.literal(1),
      })
      .strict(),
  ])
  .superRefine(addDomainSectionIssues);
export type GuardianPlanBlock = z.infer<typeof guardianPlanBlockSchema>;

/** The projection itself. One function, so there is one place a new field must be considered. */
export function toGuardianPlanBlock(block: PlanBlock): GuardianPlanBlock {
  const common = {
    block_id: block.block_id,
    scheduled_date: block.scheduled_date,
    display_ordinal: block.display_ordinal,
  };
  if (block.block_type === "practice") {
    return {
      ...common,
      block_type: "practice",
      section: block.section,
      scope: toGuardianPracticeScope(block.scope),
      target_count: block.target_count,
    };
  }
  if (block.block_type === "review") {
    return {
      ...common,
      block_type: "review",
      section: null,
      scope: toGuardianReviewScope(block.scope),
      target_count: block.target_count,
    };
  }
  return {
    ...common,
    block_type: "full_length",
    section: null,
    scope: block.scope,
    target_count: block.target_count,
  };
}
