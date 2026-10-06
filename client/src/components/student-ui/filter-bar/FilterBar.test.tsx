// @vitest-environment jsdom
/**
 * UI-43: the shared filter bar, rendered.
 *
 * @spec [student-UI register §2 "Filters" and "Content and data rules" (no bank counts), §6
 *       UI-43; DESIGN.md §3 "Filter bar"] | @implemented [2026-10-03]
 *
 * plain English: renders the controlled FilterBar inside a tiny state holder, with the taxonomy
 * the REAL topics route produces from the canonical tree (topics.fixture.ts), and drives it the
 * way a student would: the Section switch, chips and their remove buttons, "Clear all", and the
 * Domain/Skill/Difficulty dropdowns by keyboard only. The no-count check proves the bar and an
 * open menu are populated first, then that no digit and no "question" text appears in either.
 */
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { PracticeTopicsResponse } from "@lyceon/shared/practice-reference-schema";
import { canonicalCatalogRows, topicsFromRoute } from "./topics.fixture";
import { FilterBar } from "./FilterBar";
import { EMPTY_FILTER, type FilterBarValue } from "./filter-cascade";

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

function Harness({
  initial,
  onChange,
}: {
  initial: FilterBarValue;
  onChange?: (v: FilterBarValue) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="lyc">
      <FilterBar
        taxonomy={T}
        value={value}
        onChange={(next) => {
          onChange?.(next);
          setValue(next);
        }}
      />
    </div>
  );
}

function chipTexts(): string[] {
  return within(screen.getByTestId("filter-chips"))
    .queryAllByTestId("filter-chip")
    .map((c) => c.textContent ?? "");
}

/** Opens a dropdown from the keyboard and returns its menu. */
function openMenu(name: "Domain" | "Skill" | "Difficulty"): HTMLElement {
  const trigger = screen.getByRole("button", { name });
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getByRole("menu", { name });
}

function pressOnFocused(key: string): void {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) throw new Error("nothing focused");
  fireEvent.keyDown(el, { key });
}

/** Arrow keys move focus on the next tick (Radix roving focus); wait for it to land. */
async function arrowTo(
  key: "ArrowDown" | "ArrowUp",
  target: HTMLElement | undefined,
): Promise<void> {
  if (!target) throw new Error("no target item");
  pressOnFocused(key);
  await waitFor(() => expect(document.activeElement).toBe(target));
}

const START: FilterBarValue = {
  sections: ["M"],
  domains: ["Algebra", "Geometry and Trigonometry"],
  skills: ["Linear Functions", "Circles"],
  difficulties: ["hard"],
};

describe("FilterBar chips", () => {
  it("renders a chip per chosen value with a labelled remove button", () => {
    render(<Harness initial={START} />);
    expect(chipTexts()).toEqual([
      "Domain: Algebra",
      "Domain: Geometry and Trigonometry",
      "Skill: Linear Functions",
      "Skill: Circles",
      "Difficulty: Hard",
    ]);
    expect(
      screen.getByRole("button", { name: "Remove Algebra" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Hard" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Section: Math")).toBeInTheDocument();
  });

  it("removing a domain chip removes the domain and its skills only", () => {
    const onChange = vi.fn();
    render(<Harness initial={START} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Algebra" }));
    expect(onChange).toHaveBeenLastCalledWith({
      sections: ["M"],
      domains: ["Geometry and Trigonometry"],
      skills: ["Circles"],
      difficulties: ["hard"],
    });
    expect(chipTexts()).toEqual([
      "Domain: Geometry and Trigonometry",
      "Skill: Circles",
      "Difficulty: Hard",
    ]);
  });

  it("Clear all removes every chip and keeps the section", () => {
    const onChange = vi.fn();
    render(<Harness initial={START} onChange={onChange} />);
    expect(chipTexts()).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onChange).toHaveBeenLastCalledWith(MATH);
    expect(chipTexts()).toEqual([]);
    expect(
      screen.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Section: Math")).toBeInTheDocument();
  });

  it("switching section drops the old section's chips and keeps difficulty", () => {
    render(<Harness initial={START} />);
    const rw = screen.getByRole("button", { name: "Reading & Writing" });
    expect(rw).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(rw);
    expect(rw).toHaveAttribute("aria-pressed", "true");
    expect(chipTexts()).toEqual(["Difficulty: Hard"]);
    expect(screen.getByText("Section: Reading & Writing")).toBeInTheDocument();
  });
});

describe("FilterBar dropdowns, keyboard only", () => {
  it("opens with Enter, moves with arrows and toggles with Enter and Space", async () => {
    const onChange = vi.fn();
    render(<Harness initial={MATH} onChange={onChange} />);
    const menu = openMenu("Domain");
    const items = within(menu).getAllByRole("menuitemcheckbox");
    expect(items.map((i) => i.textContent)).toEqual([
      "Algebra",
      "Advanced Math",
      "Problem Solving and Data Analysis",
      "Geometry and Trigonometry",
    ]);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    await arrowTo("ArrowDown", items[1]);
    pressOnFocused("Enter");
    expect(onChange).toHaveBeenLastCalledWith({
      ...MATH,
      domains: ["Advanced Math"],
    });
    // The menu stays open for a second choice.
    expect(screen.getByRole("menu", { name: "Domain" })).toBeInTheDocument();
    await arrowTo("ArrowUp", items[0]);
    pressOnFocused(" ");
    expect(onChange).toHaveBeenLastCalledWith({
      ...MATH,
      domains: ["Algebra", "Advanced Math"],
    });
    expect(
      within(screen.getByRole("menu", { name: "Domain" }))
        .getAllByRole("menuitemcheckbox")
        .map((i) => i.getAttribute("aria-checked")),
    ).toEqual(["true", "true", "false", "false"]);
    expect(chipTexts()).toEqual(["Domain: Algebra", "Domain: Advanced Math"]);
  });

  it("offers only the chosen domains' skills in the Skill menu", () => {
    render(
      <Harness initial={{ ...MATH, domains: ["Geometry and Trigonometry"] }} />,
    );
    const menu = openMenu("Skill");
    expect(
      within(menu)
        .getAllByRole("menuitemcheckbox")
        .map((i) => i.textContent),
    ).toEqual([
      "Area and Volume",
      "Circles",
      "Lines, Angles, and Triangles",
      "Right Triangles and Trigonometry",
    ]);
    expect(
      within(menu).getByText("Skills in the domains you chose."),
    ).toBeInTheDocument();
  });

  it("toggles a difficulty from the keyboard", async () => {
    const onChange = vi.fn();
    render(<Harness initial={MATH} onChange={onChange} />);
    const menu = openMenu("Difficulty");
    const items = within(menu).getAllByRole("menuitemcheckbox");
    expect(items.map((i) => i.textContent)).toEqual(["Easy", "Medium", "Hard"]);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    await arrowTo("ArrowDown", items[1]);
    await arrowTo("ArrowDown", items[2]);
    pressOnFocused("Enter");
    expect(onChange).toHaveBeenLastCalledWith({
      ...MATH,
      difficulties: ["hard"],
    });
    pressOnFocused("Escape");
    await waitFor(() =>
      expect(
        screen.queryByRole("menu", { name: "Difficulty" }),
      ).not.toBeInTheDocument(),
    );
    expect(chipTexts()).toEqual(["Difficulty: Hard"]);
  });
});

describe("FilterBar shows no counts", () => {
  it("renders options and chips, and no digit or 'question' text anywhere", () => {
    render(<Harness initial={START} />);
    const bar = screen.getByTestId("filter-bar");
    // Presence first: the bar is populated and an open menu lists every Math skill.
    expect(chipTexts()).toHaveLength(5);
    const menu = openMenu("Skill");
    expect(within(menu).getAllByRole("menuitemcheckbox")).toHaveLength(
      T.sections
        .filter((s) => s.section === "M")
        .flatMap((s) =>
          s.domains.filter(
            (d) =>
              d.domain === "Algebra" ||
              d.domain === "Geometry and Trigonometry",
          ),
        )
        .flatMap((d) => d.skills).length,
    );
    expect(menu.textContent ?? "").toContain("Linear Functions");
    // Then absence.
    for (const text of [bar.textContent ?? "", menu.textContent ?? ""]) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/question/i);
    }
    const labels = [...bar.querySelectorAll("[aria-label]"), menu].map(
      (el) => el.getAttribute("aria-label") ?? "",
    );
    expect(labels).toContain("Remove Algebra");
    for (const l of labels) expect(l).not.toMatch(/\d/);
  });
});
