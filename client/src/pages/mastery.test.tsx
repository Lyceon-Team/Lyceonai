// @vitest-environment jsdom
// @spec [owner ruling 2026-08-20 RULE 1 (the six level names), RULE 5 (drill-down: domain
//   first, then skills), RULE 6 (NULL is a distinct state — a single CTA or blank, never a
//   CTA per card); ruling 2026-08-21 Q2 (skill names render verbatim)]
// @implemented [2026-08-21]
//
// plain English: proves the mastery surface renders the six level states by NAME on both
// screens, that unmeasured is its own state rather than a synonym for level 0, that the
// panel shows exactly one call to action however many skills are unmeasured, and that no
// percentage reaches the page.
//
// WHY THE DISPLAY NAMES COME FROM THE FIXTURE, NOT FROM THE COMPONENT.
//   The names live in `mastery_levels`. The component renders whatever the server sends.
//   So these cases feed the six names in and assert they come out — which is what proves
//   the component is a pass-through. A test that asserted a hardcoded "Foundations" against
//   a hardcoded "Foundations" would prove only that a constant equals itself, and would
//   stay green if the server's name changed.
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const queryMock = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock("@tanstack/react-query", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-query")>();
  return { ...actual, useQuery: queryMock.useQuery };
});
// The page reads the signed-in student's id to build its subject-scoped URLs. The provider
// is not mounted in a unit render, so the hook is stubbed — same pattern as
// guardian-dashboard.history.test.tsx.
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: { id: "11111111-1111-4111-8111-111111111111" },
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/mastery", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import MasteryPage from "./mastery";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The six states as the server sends them (migration 20260820000000). */
const LEVELS = [
  {
    levelKey: "unmeasured" as const,
    level: null,
    displayName: "Not enough answers yet",
  },
  { levelKey: "L0" as const, level: 0, displayName: "Foundations" },
  { levelKey: "L1" as const, level: 1, displayName: "Building" },
  { levelKey: "L2" as const, level: 2, displayName: "Developing" },
  { levelKey: "L3" as const, level: 3, displayName: "Proficient" },
  { levelKey: "L4" as const, level: 4, displayName: "Strong" },
];

type QueryResult = {
  data: unknown;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
};

function ok(data: unknown): QueryResult {
  return { data, isLoading: false, error: null, refetch: vi.fn() };
}

/**
 * The page issues two queries: the domain grid, then the skill panel once a domain is
 * opened. They are told apart by the query key so a case can drive each independently.
 */
function mockQueries(args: { domains?: QueryResult; skills?: QueryResult }) {
  queryMock.useQuery.mockImplementation((options: { queryKey: unknown[] }) => {
    // The keys are now full subject-scoped URLs (`/api/students/<id>/mastery/skills`), one
    // string per key, so membership no longer distinguishes them — the suffix does.
    const isSkills = options.queryKey.some(
      (k) => typeof k === "string" && k.endsWith("/mastery/skills"),
    );
    if (isSkills) {
      return args.skills ?? ok({ ok: true, catalogEmpty: false, skills: [] });
    }
    return args.domains ?? ok({ ok: true, domains: [] });
  });
}

function domainNode(level: (typeof LEVELS)[number], domain: string) {
  return { section: "M" as const, domain, ...level };
}

describe("MasteryPage — domain grid", () => {
  it.each(LEVELS)(
    "renders the $levelKey state on a domain card by its server-supplied name",
    (level) => {
      mockQueries({
        domains: ok({ ok: true, domains: [domainNode(level, "Algebra")] }),
      });
      render(<MasteryPage />);

      expect(screen.getByText("Algebra")).toBeTruthy();
      const pill = screen.getByTestId("level-pill");
      expect(pill.textContent).toBe(level.displayName);
      // The key travels with the pill, so a case cannot pass by accidentally matching
      // another level whose name happens to be similar.
      expect(pill.getAttribute("data-level-key")).toBe(level.levelKey);
    },
  );

  it("treats unmeasured as its own state, not as level 0", () => {
    mockQueries({
      domains: ok({
        ok: true,
        domains: [
          domainNode(LEVELS[0], "Algebra"),
          domainNode(LEVELS[1], "Advanced Math"),
        ],
      }),
    });
    render(<MasteryPage />);

    const pills = screen.getAllByTestId("level-pill");
    expect(pills.map((p) => p.textContent)).toEqual([
      "Not enough answers yet",
      "Foundations",
    ]);
    expect(pills.map((p) => p.getAttribute("data-level-key"))).toEqual([
      "unmeasured",
      "L0",
    ]);
  });

  it("shows ONE grid CTA when every domain is unmeasured, not one per card", () => {
    mockQueries({
      domains: ok({
        ok: true,
        domains: [
          domainNode(LEVELS[0], "Algebra"),
          domainNode(LEVELS[0], "Advanced Math"),
          domainNode(LEVELS[0], "Geometry and Trigonometry"),
        ],
      }),
    });
    render(<MasteryPage />);

    expect(screen.getAllByTestId("level-pill")).toHaveLength(3);
    expect(screen.getAllByTestId("grid-cta")).toHaveLength(1);
  });

  it("shows no grid CTA once any domain is measured", () => {
    mockQueries({
      domains: ok({
        ok: true,
        domains: [
          domainNode(LEVELS[0], "Algebra"),
          domainNode(LEVELS[3], "Advanced Math"),
        ],
      }),
    });
    render(<MasteryPage />);

    expect(screen.queryByTestId("grid-cta")).toBeNull();
  });

  it("renders no percentage anywhere — the level is not a percentage", () => {
    mockQueries({
      domains: ok({
        ok: true,
        domains: LEVELS.map((level, i) => domainNode(level, `Domain ${i}`)),
      }),
    });
    const { container } = render(<MasteryPage />);

    // tierToBarPercent mapped a tier to 25/60/100 and drew a bar from it — a precision
    // claim the mastery model never made. It does not come back, in any form.
    expect(container.textContent).not.toMatch(/\d+\s*%/);
    expect(container.querySelectorAll('[style*="width"]')).toHaveLength(0);
  });
});

describe("MasteryPage — skill panel (RULE 5: domain first, then skills)", () => {
  function openAlgebra() {
    fireEvent.click(screen.getAllByTestId("domain-open")[0]);
  }

  it.each(LEVELS)(
    "renders the $levelKey state on a skill row by its server-supplied name",
    (level) => {
      mockQueries({
        domains: ok({ ok: true, domains: [domainNode(LEVELS[2], "Algebra")] }),
        skills: ok({
          ok: true,
          catalogEmpty: false,
          skills: [{ section: "M" as const, domain: "Algebra", skill: "Linear Equations in One Variable", ...level }],
        }),
      });
      render(<MasteryPage />);
      openAlgebra();

      expect(screen.getByTestId("skill-panel")).toBeTruthy();
      // Rendered verbatim (owner ruling Q2) — not title-cased, not de-slugged.
      expect(screen.getByText("Linear Equations in One Variable")).toBeTruthy();
      const pill = screen.getByTestId("level-pill");
      expect(pill.textContent).toBe(level.displayName);
      expect(pill.getAttribute("data-level-key")).toBe(level.levelKey);
    },
  );

  it("keeps unmeasured skills in the list rather than omitting them", () => {
    mockQueries({
      domains: ok({ ok: true, domains: [domainNode(LEVELS[2], "Algebra")] }),
      skills: ok({
        ok: true,
        catalogEmpty: false,
        skills: [
          { section: "M" as const, domain: "Algebra", skill: "Linear Equations in One Variable", ...LEVELS[0] },
          { section: "M" as const, domain: "Algebra", skill: "Linear Functions", ...LEVELS[4] },
          { section: "M" as const, domain: "Algebra", skill: "Systems of Two Linear Equations", ...LEVELS[0] },
        ],
      }),
    });
    render(<MasteryPage />);
    openAlgebra();

    // An absent row and an unmeasured row say different things to a student choosing what
    // to practise. All three are present.
    expect(screen.getAllByTestId("skill-row")).toHaveLength(3);
  });

  it("shows exactly ONE panel CTA however many skills are unmeasured (RULE 6)", () => {
    mockQueries({
      domains: ok({ ok: true, domains: [domainNode(LEVELS[0], "Algebra")] }),
      skills: ok({
        ok: true,
        catalogEmpty: false,
        skills: [
          { section: "M" as const, domain: "Algebra", skill: "Linear Equations in One Variable", ...LEVELS[0] },
          { section: "M" as const, domain: "Algebra", skill: "Linear Functions", ...LEVELS[0] },
          { section: "M" as const, domain: "Algebra", skill: "Systems of Two Linear Equations", ...LEVELS[0] },
          { section: "M" as const, domain: "Algebra", skill: "Linear Inequalities", ...LEVELS[0] },
        ],
      }),
    });
    render(<MasteryPage />);
    openAlgebra();

    expect(screen.getAllByTestId("skill-row")).toHaveLength(4);
    expect(screen.getAllByTestId("panel-cta")).toHaveLength(1);
  });

  it("shows no panel CTA when every skill is measured", () => {
    mockQueries({
      domains: ok({ ok: true, domains: [domainNode(LEVELS[3], "Algebra")] }),
      skills: ok({
        ok: true,
        catalogEmpty: false,
        skills: [
          { section: "M" as const, domain: "Algebra", skill: "Linear Equations in One Variable", ...LEVELS[3] },
          { section: "M" as const, domain: "Algebra", skill: "Linear Functions", ...LEVELS[5] },
        ],
      }),
    });
    render(<MasteryPage />);
    openAlgebra();

    expect(screen.queryByTestId("panel-cta")).toBeNull();
  });

  it("distinguishes an empty catalog from a failed load (owner ruling Q6)", () => {
    mockQueries({
      domains: ok({ ok: true, domains: [domainNode(LEVELS[0], "Algebra")] }),
      skills: ok({
        ok: true,
        section: "M",
        domain: "Algebra",
        catalogEmpty: true,
        skills: [],
      }),
    });
    render(<MasteryPage />);
    openAlgebra();

    expect(screen.getByTestId("catalog-empty")).toBeTruthy();
    expect(screen.queryByTestId("skill-list")).toBeNull();

    cleanup();

    // The same student, the same domain, but the read FAILED. Different screen: a retry,
    // not a statement about the question bank. Empty and failed are different answers.
    mockQueries({
      domains: ok({ ok: true, domains: [domainNode(LEVELS[0], "Algebra")] }),
      skills: {
        data: undefined,
        isLoading: false,
        error: new Error("skill_catalog_query_failed"),
        refetch: vi.fn(),
      },
    });
    render(<MasteryPage />);
    openAlgebra();

    expect(screen.queryByTestId("catalog-empty")).toBeNull();
    expect(screen.queryByTestId("skill-list")).toBeNull();
    expect(
      screen.getByText(/couldn't load this domain's skills/i),
    ).toBeTruthy();
  });
});
