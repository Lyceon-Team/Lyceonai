/**
 * UI-51: the Practice page's pure rules (practice-landing-model.ts).
 *
 * @spec [DESIGN.md §4 Practice ("Questions per session" 5–30 in steps of 5; "the two
 *        lowest-level domains in the section"); prototype Practice.dc.html] | @implemented
 *        [2026-10-03]
 *
 * plain English: the edges the rendered page test does not reach. The domain nodes come from
 * `canonicalDomainNodes` over a body parsed by the shared mastery schema, the same path the
 * page takes, so an unmeasured domain is the node the server's absence produces.
 */
import { describe, expect, it } from "vitest";
import { masteryDomainsResponseSchema } from "@lyceon/shared/mastery-levels";
import { canonicalDomainNodes } from "@/components/mastery/domain-nodes";
import {
  parseQuestionsPerSession,
  QUESTIONS_PER_SESSION_OPTIONS,
  suggestedDomains,
} from "./practice-landing-model";

function mathNodes(
  rows: ReadonlyArray<{ domain: string; level: 0 | 1 | 2 | 3 | 4 }>,
) {
  const names = [
    "Foundations",
    "Building",
    "Developing",
    "Proficient",
    "Strong",
  ];
  const body = masteryDomainsResponseSchema.parse({
    ok: true,
    domains: rows.map((r) => ({
      section: "M",
      domain: r.domain,
      levelKey: `L${r.level}`,
      level: r.level,
      displayName: names[r.level],
    })),
  });
  return canonicalDomainNodes(body.domains, ["M"]);
}

describe("questions per session", () => {
  it("is 5 to 30 in steps of 5, and nothing else parses", () => {
    expect([...QUESTIONS_PER_SESSION_OPTIONS]).toEqual([5, 10, 15, 20, 25, 30]);
    expect(parseQuestionsPerSession("25")).toBe(25);
    for (const bad of ["0", "12", "35", "", "ten", "10.0"]) {
      expect(parseQuestionsPerSession(bad), bad).toBeNull();
    }
  });
});

describe("suggestedDomains", () => {
  it("a student with no mastery yet gets the first two canonical domains", () => {
    expect(suggestedDomains(mathNodes([])).map((n) => n.domain)).toEqual([
      "Algebra",
      "Advanced Math",
    ]);
  });

  it("measured domains come before unmeasured ones, lowest level first", () => {
    const picked = suggestedDomains(
      mathNodes([{ domain: "Geometry and Trigonometry", level: 4 }]),
    );
    // One measured domain (even at the top level) first, then the first unmeasured one.
    expect(picked.map((n) => [n.domain, n.levelKey])).toEqual([
      ["Geometry and Trigonometry", "L4"],
      ["Algebra", "unmeasured"],
    ]);
  });

  it("ties keep the canonical order, whatever order the server listed them in", () => {
    const picked = suggestedDomains(
      mathNodes([
        { domain: "Geometry and Trigonometry", level: 1 },
        { domain: "Problem Solving and Data Analysis", level: 1 },
        { domain: "Advanced Math", level: 3 },
        { domain: "Algebra", level: 2 },
      ]),
    );
    expect(picked.map((n) => n.domain)).toEqual([
      "Problem Solving and Data Analysis",
      "Geometry and Trigonometry",
    ]);
  });
});
