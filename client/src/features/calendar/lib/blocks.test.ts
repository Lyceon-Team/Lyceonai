/**
 * @spec [Doc_05F_Study_Calendar, §17.1 rows, §17.2 day editor, §12.2 protected state,
 *        §13 progress] [Doc_05F_formula_sheet.md §8 item 3 (scope jsonb)]
 *
 * plain English: every screen that shows a block must show the SAME words for it, and none
 * of these functions may decide anything the server decides. These tests pin the wording, the
 * singular/plural boundaries, and the three refusals `calendar_move_block` mirrors.
 *
 * The fixtures are parsed through `planBlockSchema` in the first block below, so a test that
 * passes here is a test built on a block shape the database would actually store.
 */
import { describe, expect, it } from "vitest";
import {
  CANONICAL_DOMAINS,
  DOMAIN_SECTION,
  planBlockSchema,
  type CanonicalDomain,
  type PlanBlock,
  type PlanningEstimates,
} from "@lyceon/shared";
import {
  TONE_LABEL,
  domainsForSection,
  isDraggable,
  isPastDate,
  isStarted,
  minutesFor,
  minutesLabel,
  mixOf,
  primaryActionLabel,
  sectionName,
  titleOf,
  toneOf,
} from "./blocks";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** The stored columns every block carries, whatever its type (`plan.ts` `storedBlockFields`). */
const storedFields = {
  block_id: "11111111-1111-4111-8111-111111111111",
  scheduled_date: "2026-09-21",
  source: "auto",
  derived_from_block_id: null,
  explanation_key: "weighted",
  display_ordinal: 1,
  membership_type: "created",
} as const;

function domainPracticeBlock(
  section: "M" | "RW",
  mix: readonly {
    domain: CanonicalDomain;
    count: number;
    explanation_key: string;
  }[],
): PlanBlock {
  return {
    ...storedFields,
    block_type: "practice",
    section,
    scope: { level: "domain", mix: [...mix] },
    target_count: mix.reduce((total, entry) => total + entry.count, 0),
  };
}

function sectionPracticeBlock(section: "M" | "RW", count: number): PlanBlock {
  return {
    ...storedFields,
    block_type: "practice",
    section,
    scope: { level: "section", count, explanation_key: "cold_start" },
    target_count: count,
  };
}

function reviewBlock(targetCount: number): PlanBlock {
  return {
    ...storedFields,
    block_type: "review",
    section: null,
    scope: { mode: "queue" },
    explanation_key: "review_due",
    target_count: targetCount,
  };
}

function fullLengthBlock(): PlanBlock {
  return {
    ...storedFields,
    block_type: "full_length",
    section: null,
    scope: { form_id: null },
    explanation_key: "exam_cadence",
    target_count: 1,
  };
}

const MATH_MIX = [
  { domain: "Algebra", count: 12, explanation_key: "weak" },
  {
    domain: "Geometry and Trigonometry",
    count: 8,
    explanation_key: "balanced",
  },
] as const satisfies readonly {
  domain: CanonicalDomain;
  count: number;
  explanation_key: string;
}[];

/** Server-owned seconds-per-unit, as they travel on the payload (§15 `planningEstimates`). */
const ESTIMATES: PlanningEstimates = {
  practice_seconds_per_unit: 90,
  review_seconds_per_unit: 45,
};

/** A SECOND, different budget — used to prove the estimates are read, not assumed. */
const FASTER_ESTIMATES: PlanningEstimates = {
  practice_seconds_per_unit: 60,
  review_seconds_per_unit: 30,
};

describe("the fixtures are blocks the database would store", () => {
  it("parses every fixture through planBlockSchema", () => {
    const fixtures = [
      domainPracticeBlock("M", MATH_MIX),
      domainPracticeBlock("RW", [
        {
          domain: "Craft and Structure",
          count: 10,
          explanation_key: "strength",
        },
      ]),
      sectionPracticeBlock("RW", 20),
      reviewBlock(7),
      fullLengthBlock(),
    ];
    for (const fixture of fixtures) {
      expect(planBlockSchema.safeParse(fixture).success).toBe(true);
    }
  });
});

// ── toneOf ──────────────────────────────────────────────────────────────────

describe("toneOf (§17.1 colour families)", () => {
  it('paints a Math practice block "math"', () => {
    expect(toneOf(domainPracticeBlock("M", MATH_MIX))).toBe("math");
  });

  it('paints a Reading & Writing practice block "rw"', () => {
    expect(toneOf(sectionPracticeBlock("RW", 20))).toBe("rw");
  });

  it('paints a review block "review", whatever its (null) section', () => {
    expect(toneOf(reviewBlock(7))).toBe("review");
  });

  it('paints a full-length block "exam"', () => {
    expect(toneOf(fullLengthBlock())).toBe("exam");
  });

  it("has a label for all four tones", () => {
    expect(TONE_LABEL).toEqual({
      math: "Math practice",
      rw: "Reading & Writing",
      review: "Review",
      exam: "Practice test",
    });
  });
});

// ── titleOf ─────────────────────────────────────────────────────────────────

describe("titleOf (§17.1 row title)", () => {
  it("names the section in full — the wire says M/RW, students do not", () => {
    expect(sectionName("M")).toBe("Math");
    expect(sectionName("RW")).toBe("Reading & Writing");
    expect(titleOf(domainPracticeBlock("M", MATH_MIX))).toBe(
      "Math · 20 questions",
    );
    expect(titleOf(sectionPracticeBlock("RW", 20))).toBe(
      "Reading & Writing · 20 questions",
    );
  });

  it('says "1 question" and not "1 questions" at the singular boundary', () => {
    expect(titleOf(sectionPracticeBlock("M", 1))).toBe("Math · 1 question");
    expect(titleOf(sectionPracticeBlock("M", 2))).toBe("Math · 2 questions");
  });

  it('says "1 item" and not "1 items" at the singular boundary', () => {
    expect(titleOf(reviewBlock(1))).toBe("Review · 1 item");
    expect(titleOf(reviewBlock(2))).toBe("Review · 2 items");
    expect(titleOf(reviewBlock(7))).toBe("Review · 7 items");
  });

  it("gives a full-length block a count-free title — its target_count is a literal 1", () => {
    const block = fullLengthBlock();
    expect(block.target_count).toBe(1);
    expect(titleOf(block)).toBe("Full-length practice test");
  });
});

// ── mixOf ───────────────────────────────────────────────────────────────────

describe("mixOf (§17.1 domain chips)", () => {
  it("returns the mix of a domain-level practice block, in order", () => {
    expect([...mixOf(domainPracticeBlock("M", MATH_MIX))]).toEqual([
      ...MATH_MIX,
    ]);
  });

  it("returns [] for a SECTION-level block — cold start has not chosen domains yet", () => {
    expect(mixOf(sectionPracticeBlock("RW", 20))).toEqual([]);
    expect(mixOf(sectionPracticeBlock("M", 1))).toEqual([]);
  });

  it("returns [] for review and full_length — neither has a mix", () => {
    expect(mixOf(reviewBlock(7))).toEqual([]);
    expect(mixOf(fullLengthBlock())).toEqual([]);
  });
});

// ── domainsForSection ───────────────────────────────────────────────────────

describe("domainsForSection (§17.2 Domain select)", () => {
  it("offers exactly the four Math domains for M", () => {
    expect(new Set(domainsForSection("M"))).toEqual(
      new Set(
        CANONICAL_DOMAINS.filter((domain) => DOMAIN_SECTION[domain] === "M"),
      ),
    );
    expect([...domainsForSection("M")]).toEqual([
      "Algebra",
      "Advanced Math",
      "Problem Solving and Data Analysis",
      "Geometry and Trigonometry",
    ]);
  });

  it("offers exactly the four Reading & Writing domains for RW", () => {
    expect(new Set(domainsForSection("RW"))).toEqual(
      new Set(
        CANONICAL_DOMAINS.filter((domain) => DOMAIN_SECTION[domain] === "RW"),
      ),
    );
    expect([...domainsForSection("RW")]).toEqual([
      "Information and Ideas",
      "Craft and Structure",
      "Expression of Ideas",
      "Standard English Conventions",
    ]);
  });

  it("never offers a Math domain on an RW block, or the reverse — the CHECK would refuse it", () => {
    const math = new Set<string>(domainsForSection("M"));
    const rw = new Set<string>(domainsForSection("RW"));
    for (const domain of rw) expect(math.has(domain)).toBe(false);
    for (const domain of math) expect(rw.has(domain)).toBe(false);
  });

  it("covers the canonical eight between them, with nothing invented", () => {
    expect(
      new Set([...domainsForSection("M"), ...domainsForSection("RW")]),
    ).toEqual(new Set(CANONICAL_DOMAINS));
    expect(domainsForSection("M").length + domainsForSection("RW").length).toBe(
      CANONICAL_DOMAINS.length,
    );
  });
});

// ── minutesFor / minutesLabel ───────────────────────────────────────────────

describe("minutesFor (§17.1 “~N min”)", () => {
  it("uses the PASSED estimates, never a literal of its own (§17)", () => {
    const block = sectionPracticeBlock("M", 20);
    // Same block, two server budgets, two different answers. A module-level constant here
    // would give one answer to both and drift from the budget the generator planned against.
    expect(minutesFor(block, ESTIMATES)).toBe(30); // 20 × 90s
    expect(minutesFor(block, FASTER_ESTIMATES)).toBe(20); // 20 × 60s
    expect(minutesFor(block, ESTIMATES)).not.toBe(
      minutesFor(block, FASTER_ESTIMATES),
    );
  });

  it("reads the REVIEW seconds for a review block and the practice seconds for practice", () => {
    expect(minutesFor(reviewBlock(8), ESTIMATES)).toBe(6); // 8 × 45s
    expect(minutesFor(reviewBlock(8), FASTER_ESTIMATES)).toBe(4); // 8 × 30s
    expect(minutesFor(sectionPracticeBlock("M", 8), ESTIMATES)).toBe(12); // 8 × 90s
  });

  it("rounds to the nearest minute", () => {
    expect(minutesFor(reviewBlock(7), ESTIMATES)).toBe(5); // 5.25 → 5
    expect(minutesFor(reviewBlock(5), ESTIMATES)).toBe(4); // 3.75 → 4
  });

  it("never returns 0 minutes for a block that has work in it", () => {
    expect(
      minutesFor(reviewBlock(1), { ...ESTIMATES, review_seconds_per_unit: 10 }),
    ).toBe(1);
  });

  it("returns null for a full_length block — its duration is the exam form's, not a per-question figure", () => {
    expect(minutesFor(fullLengthBlock(), ESTIMATES)).toBeNull();
    expect(minutesFor(fullLengthBlock(), FASTER_ESTIMATES)).toBeNull();
  });
});

describe("minutesLabel", () => {
  it('renders "~N min"', () => {
    expect(minutesLabel(sectionPracticeBlock("M", 20), ESTIMATES)).toBe(
      "~30 min",
    );
    expect(minutesLabel(reviewBlock(8), ESTIMATES)).toBe("~6 min");
  });

  it("returns null — never an empty string — when there is no honest figure", () => {
    expect(minutesLabel(fullLengthBlock(), ESTIMATES)).toBeNull();
  });
});

// ── Status-derived state (§12.2, §13) ───────────────────────────────────────

describe("isStarted (§12.2 protected state, derived from status not actual)", () => {
  it("is true for in_progress, partial and completed", () => {
    expect(isStarted({ status: "in_progress", actual: 0 })).toBe(true);
    expect(isStarted({ status: "partial", actual: 3 })).toBe(true);
    expect(isStarted({ status: "completed", actual: 20 })).toBe(true);
  });

  it("is false for scheduled and missed", () => {
    expect(isStarted({ status: "scheduled", actual: 0 })).toBe(false);
    expect(isStarted({ status: "missed", actual: 0 })).toBe(false);
  });

  it("calls a launched block with no answers yet started — `actual` would call it untouched", () => {
    expect(isStarted({ status: "in_progress", actual: 0 })).toBe(true);
  });
});

describe("isPastDate (§12.2 a past day is read-only)", () => {
  it("is true strictly before today, false on today and after", () => {
    expect(isPastDate("2026-09-20", "2026-09-21")).toBe(true);
    expect(isPastDate("2026-09-21", "2026-09-21")).toBe(false);
    expect(isPastDate("2026-09-22", "2026-09-21")).toBe(false);
  });
});

describe("isDraggable (mirrors calendar_move_block's refusals)", () => {
  const future = {
    status: "scheduled",
    actual: 0,
    date: "2026-09-22",
    today: "2026-09-21",
  };

  it("is false when the surface is readOnly, even for an untouched future block", () => {
    expect(isDraggable({ ...future, readOnly: true })).toBe(false);
  });

  it("is false for a block on a PAST date", () => {
    expect(
      isDraggable({ ...future, date: "2026-09-20", readOnly: false }),
    ).toBe(false);
  });

  it("is false once the block has been started", () => {
    for (const status of ["in_progress", "partial", "completed"]) {
      expect(isDraggable({ ...future, status, readOnly: false })).toBe(false);
    }
  });

  it("is true for an unstarted block on today or later, on a writable surface", () => {
    expect(isDraggable({ ...future, readOnly: false })).toBe(true);
    expect(
      isDraggable({ ...future, date: "2026-09-21", readOnly: false }),
    ).toBe(true);
    expect(
      isDraggable({
        ...future,
        status: "missed",
        date: "2026-09-21",
        readOnly: false,
      }),
    ).toBe(true);
  });
});

describe("primaryActionLabel (§17.1 one primary action per row)", () => {
  it('says "Start" for a block not yet launched', () => {
    expect(primaryActionLabel({ status: "scheduled", actual: 0 })).toBe(
      "Start",
    );
    expect(primaryActionLabel({ status: "missed", actual: 0 })).toBe("Start");
  });

  it('says "Resume" for a block in flight', () => {
    expect(primaryActionLabel({ status: "in_progress", actual: 0 })).toBe(
      "Resume",
    );
    expect(primaryActionLabel({ status: "partial", actual: 4 })).toBe("Resume");
  });

  it('says "Done" for a completed block', () => {
    expect(primaryActionLabel({ status: "completed", actual: 20 })).toBe(
      "Done",
    );
  });
});
