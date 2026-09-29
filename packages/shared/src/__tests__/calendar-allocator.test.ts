/**
 * @spec [Doc_05F §13, §14, §22.3, §22.4; INV-08-21] | @implemented [2026-09-17]
 * plain English: the suite is driven ENTIRELY by
 * `scripts/ci/fixtures/calendar_allocator_fixtures.json`. Every case in that file runs; a
 * case whose `kind` this runner does not know fails loudly rather than being skipped, and
 * the file's declared `case_count` must match what it holds. The one thing not in the file
 * is the conservation property, which is a statement about ALL inputs and so is generated.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createRng } from "../rng";
import {
  allocateDay,
  dayAllocationInputSchema,
  type ActivityUnit,
  type DayAllocationInput,
} from "../calendar/allocate";
import {
  buildCalendarRange,
  calendarRangeInputSchema,
  type CalendarRange,
} from "../calendar/read-model";
import { CANONICAL_DOMAINS, DOMAIN_SECTION } from "../calendar/scope";
import type { LinkedSession } from "../calendar/allocate";
import type { PlanBlock } from "../calendar/plan";

const FIXTURE_PATH = new URL(
  "../../../../scripts/ci/fixtures/calendar_allocator_fixtures.json",
  import.meta.url,
);

const expectedBlockSchema = z
  .object({
    block_id: z.string(),
    target: z.number().int(),
    actual: z.number().int(),
    status: z.string(),
  })
  .strict();

const expectedExtraSchema = z
  .object({
    engine: z.string(),
    section: z.string().nullable(),
    domain: z.string().nullable(),
    count: z.number().int(),
  })
  .strict();

const expectedAllocationSchema = z
  .object({
    units_considered: z.number().int(),
    blocks: z.array(expectedBlockSchema),
    extra_work: z.array(expectedExtraSchema),
    unit_ids: z.record(z.array(z.string())).optional(),
  })
  .strict();

const expectedDaySchema = z
  .object({
    local_date: z.string(),
    timezone: z.string(),
    status: z.string(),
    planned_count: z.number().int(),
    actual_count: z.number().int(),
    extra_count: z.number().int(),
    blocks: z.array(expectedBlockSchema),
    extra_work: z.array(expectedExtraSchema),
  })
  .strict();

const expectedRangeSchema = z
  .object({
    days: z.array(expectedDaySchema),
    facts: z.record(z.number().int()),
    unit_ids: z.record(z.array(z.string())).optional(),
  })
  .strict();

const fixtureCaseSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  spec: z.string().min(1),
  why: z.string().min(1),
  input: z.unknown(),
  expected: z.unknown(),
});

const fixtureFileSchema = z
  .object({
    version: z.literal(1),
    case_count: z.number().int().positive(),
    cases: z.array(fixtureCaseSchema).min(1),
  })
  .passthrough();

const fixtures = fixtureFileSchema.parse(
  JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as unknown,
);

/** The comparison projection: what the spec states, not every field the code returns. */
function projectAllocation(allocation: ReturnType<typeof allocateDay>) {
  return {
    units_considered: allocation.units_considered,
    blocks: allocation.blocks.map((block) => ({
      block_id: block.block_id,
      target: block.target,
      actual: block.actual,
      status: block.status,
    })),
    extra_work: allocation.extra_work.map((group) => ({
      engine: group.engine,
      section: group.section,
      domain: group.domain,
      count: group.count,
    })),
  };
}

function projectRange(range: CalendarRange) {
  return {
    days: range.days.map((day) => ({
      local_date: day.local_date,
      timezone: day.timezone,
      status: day.status,
      planned_count: day.planned_count,
      actual_count: day.actual_count,
      extra_count: day.extra_count,
      blocks: day.blocks.map((entry) => ({
        block_id: entry.block.block_id,
        target: entry.block.target_count,
        actual: entry.actual,
        status: entry.status,
      })),
      extra_work: day.extra_work.map((group) => ({
        engine: group.engine,
        section: group.section,
        domain: group.domain,
        count: group.count,
      })),
    })),
    facts: { ...range.facts },
  };
}

describe("allocator fixtures", () => {
  it("holds the number of cases it says it holds", () => {
    expect(fixtures.cases).toHaveLength(fixtures.case_count);
  });

  it("gives every case a unique id", () => {
    expect(new Set(fixtures.cases.map((c) => c.id)).size).toBe(fixtures.cases.length);
  });

  for (const fixture of fixtures.cases) {
    it(`${fixture.kind}: ${fixture.id} — ${fixture.spec}`, () => {
      if (fixture.kind === "allocate") {
        const input = dayAllocationInputSchema.parse(fixture.input);
        const expected = expectedAllocationSchema.parse(fixture.expected);
        const allocation = allocateDay(input);
        expect(projectAllocation(allocation)).toEqual({
          units_considered: expected.units_considered,
          blocks: expected.blocks,
          extra_work: expected.extra_work,
        });
        if (expected.unit_ids !== undefined) {
          for (const [blockId, unitIds] of Object.entries(expected.unit_ids)) {
            const block = allocation.blocks.find((b) => b.block_id === blockId);
            expect(block?.unit_ids).toEqual(unitIds);
          }
        }
        return;
      }

      if (fixture.kind === "range") {
        const input = calendarRangeInputSchema.parse(fixture.input);
        const expected = expectedRangeSchema.parse(fixture.expected);
        const range = buildCalendarRange(input);
        expect(projectRange(range)).toEqual({ days: expected.days, facts: expected.facts });
        if (expected.unit_ids !== undefined) {
          for (const [blockId, unitIds] of Object.entries(expected.unit_ids)) {
            const day = input.days.find((candidate) =>
              candidate.blocks.some((block) => block.block_id === blockId),
            );
            expect(day).toBeDefined();
            if (day === undefined) return;
            // This re-derives ONE day out of the range to read its `unit_ids`, which the
            // range output does not carry. It filters units by their own `local_date`, which
            // is what `buildCalendarRange` does for a fixture with no linked sessions — and
            // only then. With links the range injects a unit into its BLOCK's day, so this
            // shortcut would disagree with the thing it is checking. Asserted rather than
            // assumed, so a linked range fixture fails here instead of quietly diverging.
            expect(input.linked_sessions).toEqual([]);
            const allocation = allocateDay({
              local_date: day.local_date,
              today: input.today,
              blocks: day.blocks,
              units: input.units.filter((unit) => unit.local_date === day.local_date),
              launches: input.launches,
              linked_sessions: input.linked_sessions,
            });
            const block = allocation.blocks.find((b) => b.block_id === blockId);
            expect(block?.unit_ids).toEqual(unitIds);
          }
        }
        return;
      }

      // A new kind in the file and not in the runner is a failure, never a silent skip.
      throw new Error(
        `unknown fixture kind "${fixture.kind}" in case "${fixture.id}" — teach the runner about it`,
      );
    });
  }
});

// ── The conservation property (§13, INV-08-21) ──────────────────────────────

const ENGINES = ["practice", "review", "full_length"] as const;

function generateCase(seed: number): DayAllocationInput {
  const random = createRng(`calendar-allocator-${seed}`);
  const pick = <T>(items: readonly T[]): T => {
    const index = Math.min(Math.floor(random() * items.length), items.length - 1);
    const value = items[index];
    if (value === undefined) throw new Error("cannot pick from an empty list");
    return value;
  };
  const between = (min: number, max: number): number =>
    min + Math.floor(random() * (max - min + 1));

  const blocks: PlanBlock[] = [];
  const blockCount = between(0, 4);
  for (let index = 0; index < blockCount; index += 1) {
    const blockId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const engine = pick(ENGINES);
    const common = {
      block_id: blockId,
      scheduled_date: "2026-09-14",
      source: "auto",
      derived_from_block_id: null,
      explanation_key: "weighted",
      display_ordinal: index + 1,
      membership_type: "created",
    } as const;

    if (engine === "practice") {
      const section = pick(["M", "RW"] as const);
      const sectionDomains = CANONICAL_DOMAINS.filter((d) => DOMAIN_SECTION[d] === section);
      if (random() < 0.3) {
        blocks.push({
          ...common,
          block_type: "practice",
          section,
          scope: { level: "section", count: between(5, 20), explanation_key: "cold_start" },
          target_count: between(1, 20),
        });
      } else {
        const chosen = sectionDomains.filter(() => random() < 0.5);
        const domains = chosen.length > 0 ? chosen : [pick(sectionDomains)];
        blocks.push({
          ...common,
          block_type: "practice",
          section,
          scope: {
            level: "domain",
            mix: domains.map((domain) => ({
              domain,
              count: 5,
              explanation_key: "weak",
            })),
          },
          target_count: between(1, 20),
        });
      }
      continue;
    }

    if (engine === "review") {
      blocks.push({
        ...common,
        block_type: "review",
        section: null,
        scope: random() < 0.5 ? { mode: "queue" } : {
          mode: "session",
          source_engine: "practice",
          source_session_id: "s-1",
        },
        target_count: between(1, 20),
      });
      continue;
    }

    blocks.push({
      ...common,
      block_type: "full_length",
      section: null,
      scope: random() < 0.5 ? { form_id: null } : { form_id: "FORM-A" },
      target_count: 1,
    });
  }

  // A small pool of sessions, so several units share one — which is what a real session
  // looks like and what makes the linked pass claim more than a single unit at a time.
  const SESSIONS = ["s-1", "s-2", "s-3", "s-4"] as const;

  const units: ActivityUnit[] = [];
  const unitCount = between(0, 40);
  for (let index = 0; index < unitCount; index += 1) {
    const engine = pick(ENGINES);
    const section = engine === "full_length" ? null : pick(["M", "RW"] as const);
    const domain =
      section === null
        ? null
        : pick(CANONICAL_DOMAINS.filter((d) => DOMAIN_SECTION[d] === section));
    units.push({
      engine,
      unit_id: `u-${index + 1}`,
      // A quarter of units come from no session at all, so the unlinked path stays exercised
      // rather than being crowded out by the new one.
      session_id: random() < 0.25 ? null : pick(SESSIONS),
      occurred_at: `2026-09-14T${String(8 + (index % 12)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00Z`,
      local_date: "2026-09-14",
      section,
      domain,
      form_id: engine === "full_length" ? pick(["FORM-A", "FORM-B"]) : null,
    });
  }

  /**
   * R-08-34's links. Three shapes on purpose, because conservation has to survive all three:
   *   - a session linked to a block ON this day, which pass 1 claims;
   *   - a session linked to a block that is NOT on this day (the work-ahead / work-late
   *     shape), whose units this day must drop entirely rather than call extra work;
   *   - no link at all, which leaves the date-and-scope pass to do what it always did.
   */
  const linked: LinkedSession[] = [];
  for (const engine of ENGINES) {
    for (const session of SESSIONS) {
      const roll = random();
      if (roll < 0.35 && blocks.length > 0) {
        linked.push({
          block_id: pick(blocks).block_id,
          engine,
          engine_session_id: session,
        });
        continue;
      }
      if (roll < 0.55) {
        linked.push({
          // A block id no day in this case owns — a block somewhere else in the range.
          block_id: "ffffffff-0000-4000-8000-000000000001",
          engine,
          engine_session_id: session,
        });
      }
    }
  }

  return {
    local_date: "2026-09-14",
    today: "2026-09-14",
    blocks,
    units,
    launches: [],
    linked_sessions: linked,
  };
}

describe("unit conservation (§13, INV-08-21)", () => {
  it("allocated + extra = units considered, and no unit is counted twice, over 500 generated days", () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const input = generateCase(seed);
      // The generator names units `u-1`…`u-n` per engine-agnostic index, so two units can
      // share a unit_id across engines — which is legal, identity is (engine, unit_id).
      // The units this day is responsible for. A unit whose session is linked to a block that
      // is NOT on this day belongs to that block's day and is counted there, so it is not part
      // of this day's conservation sum — see the allocator's own note. Deriving the expected
      // figure here rather than reading it back from the output is the point: an implementation
      // that simply dropped units would satisfy `allocated + extra = units_considered` while
      // losing work.
      const blockIdsHere = new Set(input.blocks.map((block) => block.block_id));
      const linkedBlockOf = (unit: ActivityUnit): string | null => {
        if (unit.session_id === null) return null;
        const link = input.linked_sessions.find(
          (candidate) =>
            candidate.engine === unit.engine &&
            candidate.engine_session_id === unit.session_id,
        );
        return link?.block_id ?? null;
      };
      const identities = new Set(
        input.units
          .filter((unit) => {
            const block = linkedBlockOf(unit);
            return block === null || blockIdsHere.has(block);
          })
          .map((unit) => `${unit.engine}|${unit.unit_id}`),
      );
      const allocation = allocateDay(input);

      const allocated = allocation.blocks.reduce((sum, block) => sum + block.actual, 0);
      const extra = allocation.extra_work.reduce((sum, group) => sum + group.count, 0);

      expect(allocation.units_considered).toBe(identities.size);
      expect(allocated + extra).toBe(allocation.units_considered);

      const seen = new Set<string>();
      for (const block of allocation.blocks) {
        expect(block.unit_ids).toHaveLength(block.actual);
        expect(block.actual).toBeLessThanOrEqual(block.target);
        for (const unitId of block.unit_ids) {
          const identity = `${block.engine}|${unitId}`;
          expect(seen.has(identity)).toBe(false);
          seen.add(identity);
        }
      }
      for (const group of allocation.extra_work) {
        expect(group.unit_ids).toHaveLength(group.count);
        for (const unitId of group.unit_ids) {
          const identity = `${group.engine}|${unitId}`;
          expect(seen.has(identity)).toBe(false);
          seen.add(identity);
        }
      }
      expect(seen.size).toBe(allocation.units_considered);

      // THE LINKED RULE ITSELF (R-08-34), and not merely that nothing was lost. Pass 1's whole
      // contract: a block takes its own linked units first, up to its target. Without this the
      // property would still pass with the linked pass deleted — every unit would land
      // somewhere, just on the wrong block.
      for (const block of allocation.blocks) {
        const linkedHere = [...identities].filter((identity) => {
          const unit = input.units.find(
            (candidate) => `${candidate.engine}|${candidate.unit_id}` === identity,
          );
          // `block.engine` as well as the block id: a link whose engine differs from the
          // block's is NOT claimable (the allocator keeps §13's engine-first clause), and a
          // day edit can produce one.
          return (
            unit !== undefined &&
            linkedBlockOf(unit) === block.block_id &&
            unit.engine === block.engine
          );
        });
        const claimable = Math.min(linkedHere.length, block.target);
        const claimed = block.unit_ids.filter((unitId) =>
          linkedHere.includes(`${block.engine}|${unitId}`),
        );
        expect(claimed.length).toBe(claimable);
      }
    }
  });

  it("is a deterministic function of its input — the same day twice is the same answer", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const input = generateCase(seed);
      expect(allocateDay(input)).toEqual(allocateDay(input));
    }
  });
});
