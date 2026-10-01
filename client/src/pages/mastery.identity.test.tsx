// @vitest-environment jsdom
/**
 * The student mastery page renders IDENTICALLY across the G4-03 `DomainGrid` extraction.
 *
 * @spec [Guardian_Closure_Plan G4-03; owner approval 2026-09-30] | @implemented [2026-09-30]
 *
 * plain English: the snapshots were written against `MasteryPage` BEFORE its domain grid
 * moved into the shared `DomainGrid`, and are unchanged by the move: every level state across
 * both sections, and the all-unmeasured grid with its single CTA.
 *
 * UPDATED DELIBERATELY, 2026-10-01 (owner decision on #1003: the grid always shows the eight
 * domains, four per section; R11 — the student page changes with the guardian's). Both
 * fixtures serve fewer than eight rows, so each snapshot now draws all eight cards in the
 * canonical order (`CANONICAL_DOMAINS_BY_SECTION`, Math first — the order the server already
 * sends), the missing ones as "Not enough answers yet", and each card carries `data-domain`.
 * Checked when updating: with text, `data-domain`, `data-level-key` and `aria-label` set
 * aside, every card's markup and the page around the grid are byte-identical to before.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const queryMock = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock("@tanstack/react-query", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-query")>();
  return { ...actual, useQuery: queryMock.useQuery };
});
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: { id: "11111111-1111-4111-8111-111111111111" },
  }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/mastery", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import MasteryPage from "./mastery";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LEVEL_NAMES = {
  unmeasured: "Not enough answers yet",
  L0: "Foundations",
  L1: "Building",
  L2: "Developing",
  L3: "Proficient",
  L4: "Strong",
} as const;
type Key = keyof typeof LEVEL_NAMES;
const node = (section: "M" | "RW", domain: string, levelKey: Key) => ({
  section,
  domain,
  levelKey,
  level: levelKey === "unmeasured" ? null : Number(levelKey.slice(1)),
  displayName: LEVEL_NAMES[levelKey],
});

function renderWith(domains: ReturnType<typeof node>[]): string {
  queryMock.useQuery.mockImplementation(() => ({
    data: { ok: true, domains, catalogEmpty: false, skills: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }));
  return render(<MasteryPage />).container.innerHTML;
}

describe("the mastery page renders identically across the extraction", () => {
  it("every level state, both sections", () => {
    expect(
      renderWith([
        node("RW", "Information and Ideas", "L4"),
        node("RW", "Craft and Structure", "L3"),
        node("RW", "Expression of Ideas", "L2"),
        node("RW", "Standard English Conventions", "L1"),
        node("M", "Algebra", "L0"),
        node("M", "Advanced Math", "unmeasured"),
      ]),
    ).toMatchSnapshot();
  });

  it("nothing measured yet: one CTA for the grid", () => {
    expect(
      renderWith([
        node("RW", "Craft and Structure", "unmeasured"),
        node("M", "Algebra", "unmeasured"),
      ]),
    ).toMatchSnapshot();
  });
});
