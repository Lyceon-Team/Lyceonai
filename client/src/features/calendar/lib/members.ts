/**
 * @spec [Doc_05F_Study_Calendar, §12.4 day edit, §12.2 protected state (V-12), §10.2 members]
 * @implemented [2026-09-23]
 *
 * plain English: builds the member list `PUT /days/:date` takes. Expected outcome: editing
 * one block on a day leaves every other block on that day exactly where it was.
 *
 * §12.4 TAKES THE FULL DESIRED MEMBER LIST, NOT A PATCH. Anything omitted is gone — an empty
 * list is a cleared day, not a no-op. So every one of these functions starts from the day's
 * CURRENT blocks and names all of them, which is why they take the day and not just the edit.
 *
 * WHY AN EDIT IS A `created` MEMBER AND NOT AN UPDATE. `calendar_blocks` rows are
 * append-only (§7.4). Changing a block's mix or its target means creating a replacement and
 * dropping the reference to the old one — there is no update, and a member shape that
 * offered one would invite a caller to forge a block's ancestry.
 *
 * V-12 AND STARTED BLOCKS. A started block MUST be carried. These functions carry every
 * untouched block by id, so a started one is carried by construction; the server also
 * injects any the client omitted (§12.4), which is belt and braces rather than a licence to
 * omit it. The editor never offers to edit or remove a started block, so the `created`
 * branch can never be reached for one.
 *
 * edge cases: `derived_from_block_id` is deliberately NOT set on an edited block. The new
 * block is a REVISION of the old one, not a copy of it the way "do it now" makes a copy, and
 * `newBlockSchema` does not accept the field anyway — lineage there is the writer's to set.
 */
import type {
  CanonicalDomain,
  PlanBlock,
  PlanMember,
} from "@lyceon/shared/calendar";
import type { ViewDay } from "./view-model";

/** One block's contribution to the list, either carried by id or created anew. */
function carried(blockId: string): PlanMember {
  return { kind: "carried", block_id: blockId };
}

/**
 * The `created` member for a block whose scope or target changed. Every field that
 * `newBlockSchema` requires is named; nothing is spread from the stored block, because a
 * stored block carries `block_id`, `source` and `membership_type` that a new-block shape
 * must not have.
 */
function createdFrom(
  block: PlanBlock,
  overrides: { scope?: PlanBlock["scope"]; targetCount?: number },
): PlanMember {
  const targetCount = overrides.targetCount ?? block.target_count;
  if (block.block_type === "practice") {
    return {
      kind: "created",
      block: {
        block_type: "practice",
        section: block.section,
        scope: (overrides.scope ?? block.scope) as Extract<
          PlanBlock,
          { block_type: "practice" }
        >["scope"],
        target_count: targetCount,
        explanation_key: block.explanation_key,
      },
    };
  }
  if (block.block_type === "review") {
    return {
      kind: "created",
      block: {
        block_type: "review",
        section: null,
        scope: (overrides.scope ?? block.scope) as Extract<
          PlanBlock,
          { block_type: "review" }
        >["scope"],
        target_count: targetCount,
        explanation_key: block.explanation_key,
      },
    };
  }
  return {
    kind: "created",
    block: {
      block_type: "full_length",
      section: null,
      scope: block.scope as Extract<
        PlanBlock,
        { block_type: "full_length" }
      >["scope"],
      // §7.4: `calendar_blocks_full_length_single` makes this a CHECK, not a convention.
      target_count: 1,
      explanation_key: block.explanation_key,
    },
  };
}

/** Array order IS display order (§10.2), so the day's existing order is preserved. */
export function membersWithEdit(
  day: ViewDay,
  blockId: string,
  edit: { scope?: PlanBlock["scope"]; targetCount?: number },
): readonly PlanMember[] {
  return day.blocks.map((entry) => {
    if (entry.blockId !== blockId || entry.plan === null)
      return carried(entry.blockId);
    return createdFrom(entry.plan, edit);
  });
}

/**
 * §12.4: a BLOCKED-OUT day is the same call with nothing named at all.
 *
 * A named function rather than a bare `[]` at the call site, because an empty array there
 * reads like a placeholder someone forgot to fill in. It is the whole operation: the wire
 * shape for "this day holds nothing". The server still carries any STARTED block (V-12), so
 * this asks for a cleared day and does not promise one.
 */
export function membersCleared(): readonly PlanMember[] {
  return [];
}

/** §12.4: removing a block is the same call with that block simply not named. */
export function membersWithout(
  day: ViewDay,
  blockId: string,
): readonly PlanMember[] {
  return day.blocks
    .filter((entry) => entry.blockId !== blockId)
    .map((entry) => carried(entry.blockId));
}

/**
 * A brand-new practice block on a day, for the grid's "+ Add block".
 *
 * `explanation_key` is null on purpose. §17.6's copy explains why the SYSTEM put a block
 * somewhere; a block the student added themselves needs no such explanation, and inventing a
 * key would put words in the generator's mouth. `blockExplanation(null)` returns null and
 * the "why this is here" panel does not render — which is correct.
 */
export function membersWithNewPracticeBlock(
  day: ViewDay,
  section: "M" | "RW",
  mix: readonly { domain: CanonicalDomain; count: number }[],
): readonly PlanMember[] {
  const target = mix.reduce((sum, entry) => sum + entry.count, 0);
  const created: PlanMember = {
    kind: "created",
    block: {
      block_type: "practice",
      section,
      scope: {
        level: "domain",
        mix: mix.map((entry) => ({
          domain: entry.domain,
          count: entry.count,
          // The per-domain key vocabulary is the GENERATOR's (V-09 constrains generated
          // plans only). A student-built mix has no generator reasoning behind it, so the
          // key says exactly that rather than borrowing one that implies mastery analysis.
          explanation_key: "student_choice",
        })),
      },
      target_count: target,
      explanation_key: null,
    },
  };
  return [...day.blocks.map((entry) => carried(entry.blockId)), created];
}

// ── The §17.2 editing rules, in one place ───────────────────────────────────

/** §21: mix counts move in multiples of this. Sourced from the payload, never assumed. */
export const MIX_GRANULARITY = 5;
/** §21 `max_domains_per_block`. */
export const MAX_DOMAINS_PER_BLOCK = 4;

/** The count choices a mix row offers: multiples of the granularity, up to a sensible cap. */
export function mixCountChoices(): readonly number[] {
  return [5, 10, 15, 20];
}

/** The item choices a review block offers. */
export function reviewCountChoices(): readonly number[] {
  return [5, 10, 15, 20, 25, 30];
}

/** A mix is valid when it is non-empty, within the domain cap, and every count is a multiple. */
export function isValidMix(mix: readonly { count: number }[]): boolean {
  if (mix.length === 0 || mix.length > MAX_DOMAINS_PER_BLOCK) return false;
  return mix.every(
    (entry) => entry.count > 0 && entry.count % MIX_GRANULARITY === 0,
  );
}
