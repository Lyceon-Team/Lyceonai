/**
 * UI-43: the filter bar's cascade rules, on the pure module.
 *
 * @spec [student-UI register §2 "Filters", §6 UI-43 ("unit tests for the cascade rules");
 *       DESIGN.md §3 "Filter bar"] | @implemented [2026-10-03]
 *
 * plain English: every rule in filter-cascade.ts against the taxonomy the REAL topics route
 * produces from the canonical tree (topics.fixture.ts). Presence before absence: the fixture is
 * shown to hold both sections, all eight domains and 29 skills before any rule is asserted, so a
 * rule cannot pass over an empty taxonomy.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PracticeTopicsResponse } from "@lyceon/shared/practice-reference-schema";
import { canonicalCatalogRows, topicsFromRoute } from "./topics.fixture";
import {
  EMPTY_FILTER,
  clearAll,
  difficultyOptions,
  domainOptions,
  filterChips,
  normalizeFilter,
  removeChip,
  removeDomain,
  removeSkill,
  selectSection,
  skillOptions,
  toggleDifficulty,
  toggleDomain,
  toggleSkill,
  type FilterBarValue,
} from "./filter-cascade";

vi.mock("../../../../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("../../../../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== "canonical_skill_catalog")
        throw new Error(`unexpected table ${table}`);
      return {
        select: () =>
          Promise.resolve({ data: canonicalCatalogRows(), error: null }),
      };
    },
  }),
}));

import { getPracticeTopics } from "../../../../../server/routes/practice-topics-routes";

let T: PracticeTopicsResponse;

beforeAll(async () => {
  T = await topicsFromRoute(getPracticeTopics);
});

const MATH: FilterBarValue = { ...EMPTY_FILTER, sections: ["M"] };

function skillsOf(domain: string): string[] {
  const found = T.sections
    .flatMap((s) => s.domains)
    .find((d) => d.domain === domain);
  if (!found) throw new Error(`no domain ${domain}`);
  return found.skills;
}

describe("fixture is the real route's output and is non-trivial", () => {
  it("holds both sections, eight domains and 29 skills, all labelled by name", () => {
    expect(T.sections.map((s) => [s.section, s.label])).toEqual([
      ["M", "Math"],
      ["RW", "Reading & Writing"],
    ]);
    const domains = T.sections.flatMap((s) => s.domains);
    expect(domains).toHaveLength(8);
    expect(domains.flatMap((d) => d.skills)).toHaveLength(29);
    expect(skillsOf("Algebra")).toContain("Linear Functions");
  });
});

describe("rule 1: domain options depend on Section", () => {
  it("offers only the chosen section's domains, in taxonomy order", () => {
    expect(domainOptions(T, ["M"]).map((o) => o.value)).toEqual([
      "Algebra",
      "Advanced Math",
      "Problem Solving and Data Analysis",
      "Geometry and Trigonometry",
    ]);
    expect(domainOptions(T, ["RW"]).map((o) => o.value)).toEqual([
      "Craft and Structure",
      "Information and Ideas",
      "Standard English Conventions",
      "Expression of Ideas",
    ]);
  });

  it("offers every domain when no section is chosen (empty = no constraint)", () => {
    expect(domainOptions(T, [])).toHaveLength(8);
  });

  it("labels options with display names", () => {
    for (const o of domainOptions(T, ["M"])) expect(o.label).toBe(o.value);
  });
});

describe("rule 2: skill options depend on the chosen domains", () => {
  it("offers only the chosen domains' skills", () => {
    const v = toggleDomain(T, MATH, "Geometry and Trigonometry");
    expect(skillOptions(T, v).map((o) => o.value)).toEqual(
      skillsOf("Geometry and Trigonometry"),
    );
    expect(skillOptions(T, v).map((o) => o.value)).not.toContain(
      "Linear Functions",
    );
  });

  it("offers every skill of the section when no domain is chosen", () => {
    const all = T.sections
      .filter((s) => s.section === "M")
      .flatMap((s) => s.domains.flatMap((d) => d.skills));
    expect(all.length).toBeGreaterThan(0);
    expect(skillOptions(T, MATH).map((o) => o.value)).toEqual(all);
    expect(skillOptions(T, MATH).map((o) => o.value)).not.toContain(
      "Words in Context",
    );
  });

  it("drops a chosen skill once the chosen domains no longer contain it", () => {
    const withSkill = toggleSkill(T, MATH, "Linear Functions");
    expect(withSkill.skills).toEqual(["Linear Functions"]);
    const narrowed = toggleDomain(T, withSkill, "Geometry and Trigonometry");
    expect(narrowed.skills).toEqual([]);
  });

  it("refuses a skill that is not offered", () => {
    const v = toggleDomain(T, MATH, "Algebra");
    expect(toggleSkill(T, v, "Circles").skills).toEqual([]);
  });
});

describe("rule 3: changing Section clears choices that no longer apply", () => {
  it("drops the old section's domains and skills, keeps difficulty", () => {
    let v = toggleDomain(T, MATH, "Algebra");
    v = toggleSkill(T, v, "Linear Functions");
    v = toggleDifficulty(T, v, "hard");
    expect(v.domains).toEqual(["Algebra"]);
    expect(v.skills).toEqual(["Linear Functions"]);
    const switched = selectSection(T, v, "RW");
    expect(switched).toEqual({
      sections: ["RW"],
      domains: [],
      skills: [],
      difficulties: ["hard"],
    });
  });

  it("keeps choices that still apply when the section is re-selected", () => {
    let v = toggleDomain(T, MATH, "Algebra");
    v = toggleSkill(T, v, "Linear Functions");
    expect(selectSection(T, v, "M")).toEqual(v);
  });
});

describe("rule 4: removing a domain removes its skills", () => {
  it("drops the removed domain's skills and keeps the others'", () => {
    let v = toggleDomain(T, MATH, "Algebra");
    v = toggleDomain(T, v, "Geometry and Trigonometry");
    v = toggleSkill(T, v, "Linear Functions");
    v = toggleSkill(T, v, "Circles");
    expect(v.skills).toEqual(["Linear Functions", "Circles"]);
    const removed = removeDomain(T, v, "Algebra");
    expect(removed.domains).toEqual(["Geometry and Trigonometry"]);
    expect(removed.skills).toEqual(["Circles"]);
  });

  it("drops its skills even when it was the last domain", () => {
    let v = toggleDomain(T, MATH, "Algebra");
    v = toggleSkill(T, v, "Linear Functions");
    expect(removeDomain(T, v, "Algebra")).toEqual(MATH);
  });

  it("toggling a chosen domain off is the same as removing it", () => {
    let v = toggleDomain(T, MATH, "Algebra");
    v = toggleSkill(T, v, "Linear Functions");
    expect(toggleDomain(T, v, "Algebra")).toEqual(
      removeDomain(T, v, "Algebra"),
    );
  });
});

describe("rule 5: Clear all", () => {
  it("empties domains, skills and difficulties and keeps the section", () => {
    let v = toggleDomain(T, MATH, "Algebra");
    v = toggleSkill(T, v, "Linear Functions");
    v = toggleDifficulty(T, v, "easy");
    expect(filterChips(T, v)).toHaveLength(3);
    expect(clearAll(T, v)).toEqual(MATH);
    expect(filterChips(T, clearAll(T, v))).toEqual([]);
  });
});

describe("rule 6: difficulty is independent", () => {
  it("is unaffected by section, domain and skill changes", () => {
    let v = toggleDifficulty(T, MATH, "medium");
    v = toggleDomain(T, v, "Algebra");
    v = selectSection(T, v, "RW");
    v = toggleDomain(T, v, "Craft and Structure");
    expect(v.difficulties).toEqual(["medium"]);
  });

  it("offers easy, medium, hard with display labels", () => {
    expect(difficultyOptions()).toEqual([
      { value: "easy", label: "Easy" },
      { value: "medium", label: "Medium" },
      { value: "hard", label: "Hard" },
    ]);
  });
});

describe("chips", () => {
  it("lists every chosen value, domains then skills then difficulties, by name", () => {
    let v = toggleDifficulty(T, MATH, "hard");
    v = toggleSkill(T, v, "Circles");
    v = toggleDomain(T, v, "Geometry and Trigonometry");
    expect(filterChips(T, v)).toEqual([
      {
        kind: "domain",
        value: "Geometry and Trigonometry",
        label: "Geometry and Trigonometry",
      },
      { kind: "skill", value: "Circles", label: "Circles" },
      { kind: "difficulty", value: "hard", label: "Hard" },
    ]);
  });

  it("removing a chip removes exactly that choice", () => {
    let v = toggleDomain(T, MATH, "Algebra");
    v = toggleDifficulty(T, v, "easy");
    v = toggleDifficulty(T, v, "hard");
    const [, , hard] = filterChips(T, v);
    if (!hard) throw new Error("expected three chips");
    expect(removeChip(T, v, hard).difficulties).toEqual(["easy"]);
  });
});

describe("idempotence and determinism", () => {
  const busy = (): FilterBarValue => {
    let v = toggleDomain(T, MATH, "Algebra");
    v = toggleSkill(T, v, "Linear Functions");
    return toggleDifficulty(T, v, "easy");
  };

  it("select, remove, clear and normalise are idempotent", () => {
    const v = busy();
    const once = selectSection(T, v, "RW");
    expect(selectSection(T, once, "RW")).toEqual(once);
    const r1 = removeDomain(T, v, "Algebra");
    expect(removeDomain(T, r1, "Algebra")).toEqual(r1);
    const s1 = removeSkill(T, v, "Linear Functions");
    expect(removeSkill(T, s1, "Linear Functions")).toEqual(s1);
    const c1 = clearAll(T, v);
    expect(clearAll(T, c1)).toEqual(c1);
    const n1 = normalizeFilter(T, v);
    expect(normalizeFilter(T, n1)).toEqual(n1);
  });

  it("toggling twice returns the starting value", () => {
    const v = busy();
    // Each first toggle must change the value, in both directions (off then on, on then off),
    // so a toggle that does nothing cannot pass by returning its input twice.
    for (const d of ["hard", "easy"] as const) {
      const once = toggleDifficulty(T, v, d);
      expect(once).not.toEqual(v);
      expect(toggleDifficulty(T, once, d)).toEqual(v);
    }
    for (const s of ["Linear Functions", "Linear Equations in One Variable"]) {
      const once = toggleSkill(T, v, s);
      expect(once).not.toEqual(v);
      expect(toggleSkill(T, once, s)).toEqual(v);
    }
  });

  it("orders values canonically whatever the click order", () => {
    let a = toggleDomain(T, MATH, "Geometry and Trigonometry");
    a = toggleDomain(T, a, "Algebra");
    a = toggleDifficulty(T, a, "hard");
    a = toggleDifficulty(T, a, "easy");
    let b = toggleDomain(T, MATH, "Algebra");
    b = toggleDomain(T, b, "Geometry and Trigonometry");
    b = toggleDifficulty(T, b, "easy");
    b = toggleDifficulty(T, b, "hard");
    expect(a).toEqual(b);
    expect(a.domains).toEqual(["Algebra", "Geometry and Trigonometry"]);
    expect(a.difficulties).toEqual(["easy", "hard"]);
  });

  it("returns the same options on every call", () => {
    expect(skillOptions(T, MATH)).toEqual(skillOptions(T, MATH));
    expect(domainOptions(T, ["RW"])).toEqual(domainOptions(T, ["RW"]));
  });

  it("drops values the taxonomy does not know", () => {
    const stale: FilterBarValue = {
      sections: ["M"],
      domains: ["Algebra", "Not A Domain"],
      skills: ["Linear Functions", "Not A Skill"],
      difficulties: ["easy"],
    };
    expect(normalizeFilter(T, stale)).toEqual({
      sections: ["M"],
      domains: ["Algebra"],
      skills: ["Linear Functions"],
      difficulties: ["easy"],
    });
  });

  it("does not mutate its input", () => {
    const v = busy();
    const copy = structuredClone(v);
    selectSection(T, v, "RW");
    removeDomain(T, v, "Algebra");
    clearAll(T, v);
    expect(v).toEqual(copy);
  });
});
