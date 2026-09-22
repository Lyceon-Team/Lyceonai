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
            const allocation = allocateDay({
              local_date: day.local_date,
              today: input.today,
              blocks: day.blocks,
              units: input.units.filter((unit) => unit.local_date === day.local_date),
              launches: input.launches,
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
      occurred_at: `2026-09-14T${String(8 + (index % 12)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00Z`,
      local_date: "2026-09-14",
      section,
      domain,
      form_id: engine === "full_length" ? pick(["FORM-A", "FORM-B"]) : null,
    });
  }

  return {
    local_date: "2026-09-14",
    today: "2026-09-14",
    blocks,
    units,
    launches: [],
  };
}

describe("unit conservation (§13, INV-08-21)", () => {
  it("allocated + extra = units considered, and no unit is counted twice, over 500 generated days", () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const input = generateCase(seed);
      // The generator names units `u-1`…`u-n` per engine-agnostic index, so two units can
      // share a unit_id across engines — which is legal, identity is (engine, unit_id).
      const identities = new Set(
        input.units.map((unit) => `${unit.engine}|${unit.unit_id}`),
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
    }
  });

  it("is a deterministic function of its input — the same day twice is the same answer", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const input = generateCase(seed);
      expect(allocateDay(input)).toEqual(allocateDay(input));
    }
  });
});
