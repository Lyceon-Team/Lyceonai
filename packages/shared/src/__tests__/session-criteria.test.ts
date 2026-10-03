/**
 * @spec [student-UI register §9 OQ-22, owner ruling (Karl) 2026-10-02] | @implemented [2026-10-03]
 *
 * plain English: pins the empty-array rule and the projection of `toSessionCriteria`:
 * whatever the stored spec holds, only the four arrays come out. The route-level proof
 * (real handlers, real stored rows) is tests/ci/session-criteria.pg.ci.test.ts.
 */
import { describe, it, expect } from "vitest";
import { sessionCriteriaSchema, toSessionCriteria } from "../session-criteria";

const EMPTY = { sections: [], domains: [], skills: [], difficulties: [] };

describe("toSessionCriteria", () => {
  it("a missing, null, array or primitive spec is four empty arrays", () => {
    for (const stored of [undefined, null, [], "M", 3]) {
      expect(toSessionCriteria(stored)).toEqual(EMPTY);
    }
  });

  it("a null or non-array criterion is an empty array", () => {
    expect(
      toSessionCriteria({
        sections: null,
        domains: "Algebra",
        skills: 7,
        difficulties: null,
      }),
    ).toEqual(EMPTY);
  });

  it("only the four keys come out, whatever else the stored object carries", () => {
    const out = toSessionCriteria({
      sections: ["M"],
      domains: ["Algebra"],
      skills: ["ALG.D01"],
      difficulties: ["easy"],
      source_pool_count: 812,
      requested_count: 20,
      target_question_count: 20,
      session_start_idempotency_key: "k",
    });
    expect(Object.keys(out).sort()).toEqual([
      "difficulties",
      "domains",
      "sections",
      "skills",
    ]);
    expect(sessionCriteriaSchema.safeParse(out).success).toBe(true);
  });

  it("drops non-strings, empty strings and duplicates, keeping first-occurrence order", () => {
    expect(
      toSessionCriteria({ domains: ["Geometry", "", 4, "Algebra", "Geometry"] })
        .domains,
    ).toEqual(["Geometry", "Algebra"]);
  });

  it("practice's default difficulty rule keeps only the three labels", () => {
    expect(
      toSessionCriteria({ difficulties: ["hard", "1", "easy", "hard"] })
        .difficulties,
    ).toEqual(["hard", "easy"]);
  });

  it("an engine's own difficulty rule is applied and its labels deduplicated", () => {
    const pool = (t: string) =>
      t === "easy" ? "easy" : t === "hard" ? "hard" : "medium";
    expect(
      toSessionCriteria({ difficulties: ["1", "medium", "hard"] }, pool)
        .difficulties,
    ).toEqual(["medium", "hard"]);
  });

  it("the schema refuses a fifth key", () => {
    expect(
      sessionCriteriaSchema.safeParse({ ...EMPTY, count: 3 }).success,
    ).toBe(false);
  });
});
