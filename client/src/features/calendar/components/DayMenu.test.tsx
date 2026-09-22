// @vitest-environment jsdom
/**
 * §17.2's day ⋯ menu, and what a blocked-out day looks like.
 *
 * @spec [Doc_05F_Study_Calendar, §17.2 day controls, §12.1 day_regenerate / day_reset,
 *        §12.4 day edit (a block-out is an edit to an empty member list), §16 guardian read]
 * | @implemented [2026-09-22]
 *
 * THE DISTINCTION THIS FILE EXISTS TO PROTECT. A blocked-out day and a rest day are both
 * empty and mean opposite things: one is something the student did and can undo, the other
 * is the study-days mask and has nothing to undo. `isBlockedOut` is the single definition,
 * and the tests below check the MENU changes with it — a Sunday the student never touched
 * must not offer "Undo day off".
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DayMenu, DayOffCard, type DayActions } from "./DayMenu";
import { isBlockedOut, canControlDay } from "../lib/day-state";
import type { ViewDay } from "../lib/view-model";

const DATE = "2026-09-25";

function makeActions(): DayActions & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onBlockOut: vi.fn(),
    onUndoBlockOut: vi.fn(),
    onRegenerateDay: vi.fn(),
    onResetDay: vi.fn(),
  } as DayActions & Record<string, ReturnType<typeof vi.fn>>;
}

function open(
  props: Partial<React.ComponentProps<typeof DayMenu>> = {},
): DayActions & Record<string, ReturnType<typeof vi.fn>> {
  const actions = makeActions();
  render(
    <DayMenu
      date={DATE}
      blockedOut={false}
      isOverride={false}
      actions={actions}
      {...props}
    />,
  );
  fireEvent.click(screen.getByTestId(`day-menu-${DATE}`));
  return actions;
}

describe("day-state tells a day off from a rest day", () => {
  const base: ViewDay = {
    date: DATE,
    status: "planned",
    isStudyDay: true,
    isOverride: false,
    blocks: [],
    plannedCount: 0,
    actualCount: 0,
    extraCount: 0,
  };

  it("empty AND overridden is a day off", () => {
    expect(isBlockedOut({ ...base, isOverride: true })).toBe(true);
  });

  it("empty but NOT overridden is a rest day, with nothing to undo", () => {
    expect(isBlockedOut(base)).toBe(false);
  });

  it("overridden but not empty is an edited day, not a day off", () => {
    expect(
      isBlockedOut({
        ...base,
        isOverride: true,
        blocks: [{ blockId: "b1" } as ViewDay["blocks"][number]],
      }),
    ).toBe(false);
  });

  it("a past date carries no controls at all (§12.2)", () => {
    expect(canControlDay("2026-09-21", "2026-09-22")).toBe(false);
    expect(canControlDay("2026-09-22", "2026-09-22")).toBe(true);
  });
});

describe("the menu offers the right four things", () => {
  it("offers Block out on an ordinary day, and not Undo", () => {
    open();
    expect(screen.getByTestId(`day-block-${DATE}`)).toBeTruthy();
    expect(screen.queryByTestId(`day-undo-${DATE}`)).toBeNull();
  });

  it("offers Undo on a blocked-out day, and not Block out", () => {
    open({ blockedOut: true, isOverride: true });
    expect(screen.getByTestId(`day-undo-${DATE}`)).toBeTruthy();
    expect(screen.queryByTestId(`day-block-${DATE}`)).toBeNull();
  });

  it("shows Reset to auto only on a day the student owns", () => {
    open();
    expect(screen.queryByTestId(`day-reset-${DATE}`)).toBeNull();
  });

  it("calls block out with the date", () => {
    const actions = open();
    fireEvent.click(screen.getByTestId(`day-block-${DATE}`));
    expect(actions.onBlockOut).toHaveBeenCalledWith(DATE);
  });

  it("undo is the day RESET — that is what clearing an override means (§12.1)", () => {
    const actions = open({ blockedOut: true, isOverride: true });
    fireEvent.click(screen.getByTestId(`day-undo-${DATE}`));
    expect(actions.onUndoBlockOut).toHaveBeenCalledWith(DATE);
  });

  it("refuses Regenerate on a blocked-out day, naming the step that unblocks it", () => {
    const actions = open({ blockedOut: true, isOverride: true });
    fireEvent.click(screen.getByTestId(`day-regenerate-${DATE}`));
    // Regenerating would silently put the plan back and undo the student's day off.
    expect(actions.onRegenerateDay).not.toHaveBeenCalled();
    expect(screen.getByTestId(`day-menu-notice-${DATE}`).textContent).toBe(
      "Undo the day off first",
    );
  });

  it("regenerates normally on a day that is not blocked out", () => {
    const actions = open({ isOverride: true });
    fireEvent.click(screen.getByTestId(`day-regenerate-${DATE}`));
    expect(actions.onRegenerateDay).toHaveBeenCalledWith(DATE);
  });
});

describe("guardian: there is no menu at all (§16)", () => {
  it("renders nothing when no actions are passed", () => {
    const { container } = render(
      <DayMenu date={DATE} blockedOut={false} isOverride={false} />,
    );
    // Not a disabled button, not a hidden one — nothing. There is no handler to build a
    // control from, which is the property that makes the guardian surface safe by
    // construction rather than by remembering to check a flag.
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId(`day-menu-${DATE}`)).toBeNull();
  });

  it("a day-off card for a guardian carries no Undo", () => {
    render(<DayOffCard date={DATE} />);
    expect(screen.getByTestId(`day-off-${DATE}`)).toBeTruthy();
    expect(screen.queryByTestId(`day-off-undo-${DATE}`)).toBeNull();
  });
});

describe("the day-off card", () => {
  it("offers Undo inline, so an accidental day off does not need the menu", () => {
    const onUndo = vi.fn();
    render(<DayOffCard date={DATE} onUndo={onUndo} />);
    fireEvent.click(screen.getByTestId(`day-off-undo-${DATE}`));
    expect(onUndo).toHaveBeenCalledWith(DATE);
  });

  it("says the weekly refresh will leave it alone, which is the load-bearing promise", () => {
    render(<DayOffCard date={DATE} />);
    expect(screen.getByTestId(`day-off-${DATE}`).textContent).toContain(
      "the weekly refresh will leave it alone",
    );
  });
});
