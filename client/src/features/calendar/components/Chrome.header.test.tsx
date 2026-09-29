// @vitest-environment jsdom
/**
 * §17.1 — the header's two right-hand rows, and what they say when there is nothing to say.
 *
 * @spec [Doc 05F §17.1; Doc 05C §7; SCL-130] | @implemented [2026-09-24]
 *
 * The range is asserted against the ADDENDS, not against a literal. `680 – 1060` written
 * out would still pass if someone changed the composition to a midpoint and updated the
 * expectation to match; `380 + 300` fails unless the rendered number really is the sum of
 * the section rows that went in.
 */
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SectionProjectionDto } from "@lyceon/shared";
import { TopBar } from "./Chrome";

afterEach(cleanup);

function row(
  section: "M" | "RW",
  low: number | null,
  high: number | null,
): SectionProjectionDto {
  return {
    section,
    projectedScoreLow: low,
    projectedScoreMid: low === null ? null : low + 90,
    projectedScoreHigh: high,
    relevantQuestionCount: 40,
    computedAt: "2026-09-24T00:00:00Z",
  };
}

/** The prototype's own fixture — `PROJECTION={M:{lo:380,hi:560},RW:{lo:300,hi:500}}`. */
const PROTOTYPE_ROWS = [row("M", 380, 560), row("RW", 300, 500)];

function renderTopBar(
  over: Partial<React.ComponentProps<typeof TopBar>> = {},
): void {
  const { hook } = memoryLocation({ path: "/calendar", record: true });
  render(
    <Router hook={hook}>
      <TopBar
        viewer="student"
        backHref="/dashboard"
        rangeLabelText="21 – 27 September"
        view="week"
        onView={vi.fn()}
        onStep={vi.fn()}
        onToday={vi.fn()}
        streak={{ current: 6, longest: 9, history_complete: true }}
        daysToTest={47}
        targetScore={1400}
        projection={PROTOTYPE_ROWS}
        {...over}
      />
    </Router>,
  );
}

describe("the header's projected range", () => {
  it("is the SUM of Doc 05C's section rows", () => {
    renderTopBar();
    const band = screen.getByTestId("calendar-projection");
    expect(band.textContent).toContain(`${380 + 300} – ${560 + 500}`);
    expect(band.textContent).toContain("Projected");
  });

  it("renders copy, not a blank or a zero, when there is no projection", () => {
    renderTopBar({ projection: undefined });
    expect(screen.queryByTestId("calendar-projection")).toBeNull();
    const absent = screen.getByTestId("calendar-projection-absent");
    expect(absent.textContent).toMatch(/projection/i);
    // The two ways this could go wrong silently.
    expect(absent.textContent).not.toMatch(/\b0\b/);
    expect(absent.textContent?.trim().length).toBeGreaterThan(0);
  });

  it("renders copy below Doc 05C's Q4 gate, where low and high are null together", () => {
    renderTopBar({ projection: [row("M", null, null), row("RW", null, null)] });
    expect(screen.getByTestId("calendar-projection-absent")).toBeTruthy();
  });

  it("renders copy rather than half a composite when only one section is projected", () => {
    renderTopBar({ projection: [row("M", 380, 560), row("RW", null, null)] });
    expect(screen.queryByTestId("calendar-projection")).toBeNull();
    expect(screen.getByTestId("calendar-projection-absent")).toBeTruthy();
  });
});

describe("the header's target and countdown", () => {
  it("shows the target, number first and label trailing", () => {
    renderTopBar();
    const target = screen.getByTestId("calendar-target");
    expect(target.textContent).toContain("1400");
    expect(target.textContent).toContain("Target");
    // Number before label — the prototype's reading order, and what makes the two
    // right-hand rows scan as a column of figures.
    expect(target.textContent?.indexOf("1400")).toBeLessThan(
      target.textContent?.indexOf("Target") ?? -1,
    );
  });

  it("invites a target instead of showing one when it is null — SCL-130", () => {
    renderTopBar({ targetScore: null });
    expect(screen.queryByTestId("calendar-target")).toBeNull();
    expect(screen.getByTestId("calendar-target-absent").textContent).toBe(
      "Set a target",
    );
  });

  it("invites a test date instead of a countdown when there is none", () => {
    renderTopBar({ daysToTest: null });
    expect(screen.queryByTestId("calendar-countdown")).toBeNull();
    expect(screen.getByTestId("calendar-countdown-absent").textContent).toBe(
      "Add your test date",
    );
  });

  it("the all-absent header still renders every zone — the ordinary first visit", () => {
    // 103 of 104 students in production today. Nothing here may throw, blank or zero.
    renderTopBar({
      targetScore: null,
      daysToTest: null,
      projection: undefined,
      streak: undefined,
    });
    expect(screen.getByTestId("calendar-back-link")).toBeTruthy();
    expect(screen.getByTestId("calendar-target-absent")).toBeTruthy();
    expect(screen.getByTestId("calendar-countdown-absent")).toBeTruthy();
    expect(screen.getByTestId("calendar-projection-absent")).toBeTruthy();
  });
});

describe("the three zones, two rows each", () => {
  it("puts each element in the slot §17.1 names for it", () => {
    const { container } = (() => {
      renderTopBar({ onEditSchedule: vi.fn(), onRefresh: vi.fn() });
      return { container: document.body };
    })();

    const slotOf = (item: string): string | null =>
      container
        .querySelector(`[data-item="${item}"]`)
        ?.closest(".slot")
        ?.getAttribute("data-slot") ?? null;

    expect(slotOf("dashboard")).toBe("L1");
    expect(slotOf("edit")).toBe("L2");
    expect(slotOf("refresh")).toBe("L2");
    expect(slotOf("nav")).toBe("C1");
    expect(slotOf("viewtoggle")).toBe("C1");
    expect(slotOf("streak")).toBe("C2");
    expect(slotOf("countdown")).toBe("C2");
    expect(slotOf("target")).toBe("R1");
    expect(slotOf("range")).toBe("R2");
  });

  it("gives a guardian no write control — §16, and the slot simply empties", () => {
    renderTopBar({ onEditSchedule: undefined, onRefresh: undefined });
    expect(screen.queryByTestId("topbar-edit-schedule")).toBeNull();
    expect(document.querySelector('[data-item="refresh"]')).toBeNull();
    // The zone itself survives, so the grid does not reflow into two columns.
    expect(document.querySelector('[data-slot="L2"]')).toBeTruthy();
  });
});
