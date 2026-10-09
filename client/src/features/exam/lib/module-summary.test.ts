/**
 * @spec [E7b plant "the review page's counts match the navigator's"] | @implemented [2026-09-25]
 */
import { describe, expect, it } from "vitest";
import { summarizeModule } from "./module-summary";

const ws = (ordinal: number, marked: boolean) =>
  [ordinal, { ordinal, marked_for_review: marked, eliminated_option_ids: [], highlights: [] }] as const;

describe("summarizeModule", () => {
  it("counts answered, unanswered (explicit omit included) and marked", () => {
    const items = [{ ordinal: 2 }, { ordinal: 0 }, { ordinal: 1 }, { ordinal: 3 }];
    const answers = new Map<number, string | null>([
      [0, "tok_a"],
      [1, null],
      [2, "  "],
      [3, "3/4"],
    ]);
    const s = summarizeModule(items, answers, new Map([ws(1, true), ws(3, true), ws(0, false)]));
    expect(s).toMatchObject({ total: 4, answered: 2, unanswered: 2, marked: 2, firstUnanswered: 1 });
    expect(s.cells.map((c) => c.number)).toEqual([1, 2, 3, 4]);
    expect(s.cells.map((c) => c.ordinal)).toEqual([0, 1, 2, 3]);
  });
});
