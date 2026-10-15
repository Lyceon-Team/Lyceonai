/**
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P0 item 3; Coding Standards
 *        §10 (mastery from observed events only); Doc 05 Parent RULE 3 (NULL is unmeasured)]
 *        | @implemented [2026-10-13]
 *
 * plain English: the summary's two pure steps. `countResolvedItems`: a skip is never an answer.
 * `summarizeMasteryChanges`: per skill, the level before the FIRST recorded event and after the
 * LAST (by the skill's own counter, whatever order the rows arrive in); a skill whose level ends
 * where it began is no change; unmeasured → a level is a change; a fall is shown as a fall.
 */
import { describe, expect, it } from "vitest";
import {
  countResolvedItems,
  summarizeMasteryChanges,
  type MasteryAuditRow,
} from "../../server/services/session-summary";

const NAMES: Record<string, string> = {
  null: "Not enough answers yet",
  "0": "Foundations",
  "1": "Building",
  "2": "Developing",
  "3": "Proficient",
  "4": "Strong",
};
const labels = {
  forLevel(level: number | null) {
    return level === null
      ? {
          levelKey: "unmeasured" as const,
          level: null,
          displayName: NAMES.null!,
        }
      : {
          levelKey: `L${level}` as "L0" | "L1" | "L2" | "L3" | "L4",
          level,
          displayName: NAMES[String(level)]!,
        };
  },
};

function row(
  skill: string,
  n: number,
  before: number | null,
  after: number | null,
): MasteryAuditRow {
  return {
    section: "M",
    domain: "Algebra",
    skill,
    mastery_level_before: before,
    mastery_level_after: after,
    event_count_after: n,
  };
}

describe("countResolvedItems", () => {
  it("counts answers, correct answers and skips; a skip is never an answer", () => {
    const counts = countResolvedItems([
      { id: "a", status: "answered", is_correct: true, outcome: "correct" },
      { id: "b", status: "answered", is_correct: false, outcome: "incorrect" },
      { id: "c", status: "skipped", is_correct: null, outcome: "skipped" },
    ]);
    expect(counts).toEqual({
      answered: 2,
      correct: 1,
      skipped: 1,
      answeredItemIds: ["a", "b"],
    });
  });
});

describe("summarizeMasteryChanges", () => {
  it("first before, last after, per skill, in any row order", () => {
    const changes = summarizeMasteryChanges(
      [
        row("Linear", 7, 1, 2),
        row("Linear", 5, null, 1),
        row("Linear", 6, 1, 1),
      ],
      labels,
    );
    expect(changes).toEqual([
      {
        section: "M",
        domain: "Algebra",
        skill: "Linear",
        before: labels.forLevel(null),
        after: labels.forLevel(2),
      },
    ]);
  });

  it("a level that ends where it began is no change; a fall is a change", () => {
    const changes = summarizeMasteryChanges(
      [row("Same", 3, 2, 3), row("Same", 4, 3, 2), row("Falls", 9, 3, 2)],
      labels,
    );
    expect(
      changes.map((c) => [c.skill, c.before.level, c.after.level]),
    ).toEqual([["Falls", 3, 2]]);
  });

  it("no rows, no changes", () => {
    expect(summarizeMasteryChanges([], labels)).toEqual([]);
  });
});
