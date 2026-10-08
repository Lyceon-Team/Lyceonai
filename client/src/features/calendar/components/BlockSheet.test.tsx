// @vitest-environment jsdom
/**
 * The block sheet's launch control, at every date position — Brief 15 Step 3.
 *
 * @spec [Doc 05F §15.1 as amended by R-08-34 (owner ruling 2026-09-29), §12.2 protected
 *        state, §12.6 "Do it now", §16 guardian] | @implemented [2026-09-29]
 *
 * The one thing this file exists to prove: the calendar is a plan, never a gate. Start and
 * Resume render on a past block and on a future one, not only on today's — the control used to
 * be disabled on a past date and replaced outright by "Do it now".
 *
 * What it also has to prove, because a change that removes a guard is exactly where the next
 * one gets removed by accident:
 *   - `disabled` still holds for the two reasons that are NOT about dates: a finished block and
 *     a launch already in flight;
 *   - §12.2's editing lock is UNCHANGED — a past block is workable and still not editable, and
 *     those two were one condition until this change;
 *   - "Do it now" still exists on an unfinished past block, beside Start rather than instead
 *     of it (§12.6);
 *   - a guardian still gets no control at any date.
 */
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockSheet, type BlockSheetActions } from "./BlockSheet";
import type { ViewBlock, ViewDay } from "../lib/view-model";
import type { PlanBlock } from "@lyceon/shared/calendar";

afterEach(cleanup);

const TODAY = "2026-09-21";
const BLOCK_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function viewBlock(over: Partial<ViewBlock> = {}): ViewBlock {
  return {
    blockId: BLOCK_ID,
    tone: "math",
    title: "Math · 20 questions",
    minutes: "~30 min",
    mix: [],
    target: 20,
    actual: 0,
    progress: 0,
    status: "scheduled",
    started: false,
    explanations: [],
    launchable: true,
    plan: null,
    ...over,
  };
}

function viewDay(date: string, block: ViewBlock): ViewDay {
  return {
    date,
    status: "upcoming",
    isStudyDay: true,
    isOverride: false,
    blocks: [block],
    plannedCount: block.target,
    actualCount: block.actual,
    extraCount: 0,
  };
}

function actions(over: Partial<BlockSheetActions> = {}): BlockSheetActions {
  return {
    onEditMix: vi.fn(),
    onEditReviewCount: vi.fn(),
    onEditFullLength: vi.fn(),
    onRemove: vi.fn(),
    onLaunch: vi.fn(),
    onDoItNow: vi.fn(),
    onMove: vi.fn(),
    launchPending: false,
    ...over,
  };
}

function open(
  date: string,
  blockOver: Partial<ViewBlock> = {},
  actionsOver: Partial<BlockSheetActions> | null = {},
): void {
  const block = viewBlock(blockOver);
  render(
    <BlockSheet
      block={block}
      day={viewDay(date, block)}
      today={TODAY}
      open
      onClose={vi.fn()}
      {...(actionsOver === null ? {} : { actions: actions(actionsOver) })}
    />,
  );
}

const PAST = "2026-09-18";
const FUTURE = "2026-09-24";

describe("R-08-34 — the launch control renders on ANY date", () => {
  it.each([
    ["a PAST block — a missed day the student wants to pick up", PAST],
    ["TODAY's block", TODAY],
    ["a FUTURE block — a student working ahead", FUTURE],
  ])("Start is present and enabled on %s", (_label, date) => {
    open(date);

    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toBeEnabled();
  });

  it.each([
    ["past", PAST],
    ["today", TODAY],
    ["future", FUTURE],
  ])("a STARTED block says Resume on a %s date, not Start", (_label, date) => {
    open(date, { started: true, actual: 8, status: "partial", progress: 0.4 });

    expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });
});

describe("the refusals that are NOT about dates still hold", () => {
  it.each([PAST, TODAY, FUTURE])(
    "a COMPLETE block says Done and is disabled, on %s",
    (date) => {
      open(date, { actual: 20, status: "completed", progress: 1 });

      const done = screen.getByRole("button", { name: "Done" });
      expect(done).toBeDisabled();
      // And no launch control of either name is offered beside it.
      expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    },
  );

  it.each([PAST, TODAY, FUTURE])(
    "a launch already in flight disables Start, on %s",
    (date) => {
      open(date, {}, { launchPending: true });

      expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    },
  );

  it("an engine that has not shipped says Coming soon at every date", () => {
    for (const date of [PAST, TODAY, FUTURE]) {
      open(date, { launchable: false });
      expect(
        screen.getByRole("button", { name: "Coming soon" }),
      ).toBeDisabled();
      cleanup();
    }
  });
});

describe("§12.2's editing lock is untouched by R-08-34", () => {
  // The distinction the date gate blurred, and the one most at risk of being removed with it:
  // a past block is now WORKABLE and still not EDITABLE. `locked` and the launch guard were
  // one condition; separating them is the whole of Step 1, and this is what holds it apart.
  it("a past block offers Start but NOT Remove", () => {
    open(PAST);

    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("a future block offers both, because a future day is editable", () => {
    open(FUTURE);

    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Remove/ })).not.toBeNull();
  });

  it("a STARTED block is protected state, whatever its date", () => {
    open(FUTURE, { started: true });

    expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });
});

describe("§12.6 — Do it now survives, beside Start rather than instead of it", () => {
  it("an unfinished past block offers BOTH", () => {
    open(PAST);

    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Do it now" })).toBeEnabled();
  });

  it("a FINISHED past block offers neither — there is nothing to bring forward", () => {
    open(PAST, { actual: 20, status: "completed", progress: 1 });

    expect(screen.queryByRole("button", { name: "Do it now" })).toBeNull();
  });

  it.each([
    ["today", TODAY],
    ["future", FUTURE],
  ])("a %s block does not offer it — it is not behind", (_label, date) => {
    open(date);

    expect(screen.queryByRole("button", { name: "Do it now" })).toBeNull();
  });
});

describe("§16 — a guardian gets no control at any date", () => {
  it.each([PAST, TODAY, FUTURE])("no launch control on %s", (date) => {
    // `actions` undefined is the guardian branch, and R-08-34 must not have opened a path
    // around it: the date is now irrelevant to launching, so the ONLY thing still withholding
    // the control from a guardian is this prop.
    open(date, {}, null);

    for (const name of [
      "Start",
      "Resume",
      "Done",
      "Do it now",
      "Coming soon",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.getByText(/Only the student can change it/)).not.toBeNull();
  });
});

describe("QA 2026-10-07 item 11(b) — the modal dialog is the student's; the guardian's sheet is unchanged", () => {
  it("without `modal` (the guardian page) the sheet is the labelled aside it was: no dialog role, no Close", () => {
    open(TODAY, {}, null);
    const sheet = screen.getByTestId("calendar-block-sheet");
    // Presence: the sheet drew its title.
    expect(sheet.querySelector("h3")?.textContent).toBe("Math · 20 questions");
    expect(sheet.getAttribute("aria-label")).toBe("Block details");
    expect(sheet.getAttribute("role")).toBeNull();
    expect(sheet.getAttribute("aria-modal")).toBeNull();
    expect(sheet.querySelector("h3")?.id).toBe("");
    expect(screen.queryByTestId("calendar-block-sheet-close")).toBeNull();
  });
});

/**
 * QA2-G (Karl, production re-test 2026-10-08): "Calendar block panel: disable 'Items to clear'
 * while the block is in progress." In progress is `started` (the server's §13 status) and not
 * finished; the control is then disabled, `aria-disabled`, and described by a short note.
 */
describe("QA2-G — Items to clear while the review block is in progress", () => {
  const REVIEW_PLAN: PlanBlock = {
    block_id: BLOCK_ID,
    scheduled_date: TODAY,
    source: "auto",
    derived_from_block_id: null,
    explanation_key: "review_due",
    display_ordinal: 1,
    membership_type: "created",
    block_type: "review",
    section: null,
    scope: { mode: "queue" },
    target_count: 15,
  };
  const review = (over: Partial<ViewBlock> = {}): Partial<ViewBlock> => ({
    tone: "review",
    title: "Review · 15 items",
    target: 15,
    plan: REVIEW_PLAN,
    ...over,
  });

  it("an in-progress block: the control is disabled, aria-disabled, and described by the note", () => {
    open(
      TODAY,
      review({
        started: true,
        status: "in_progress",
        actual: 4,
        progress: 4 / 15,
      }),
    );
    const select = screen.getByRole("combobox", { name: "Items to clear" });
    expect(select).toBeDisabled();
    expect(select.getAttribute("aria-disabled")).toBe("true");
    const note = screen.getByTestId("calendar-items-locked-note");
    expect(note.textContent).toBe(
      "You can't change this while the block is in progress.",
    );
    expect(select.getAttribute("aria-describedby")).toBe(note.id);
    expect(note.id).not.toBe("");
  });

  it("a block launched with no answers yet is in progress too (status, not `actual`)", () => {
    open(TODAY, review({ started: true, status: "in_progress", actual: 0 }));
    const select = screen.getByRole("combobox", { name: "Items to clear" });
    expect(select).toBeDisabled();
    expect(screen.getByTestId("calendar-items-locked-note")).toBeTruthy();
  });

  it("a block not yet started: the control is enabled, with no aria-disabled and no note", () => {
    open(TODAY, review());
    const select = screen.getByRole("combobox", { name: "Items to clear" });
    expect(select).toBeEnabled();
    expect(select.getAttribute("aria-disabled")).toBeNull();
    expect(select.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByTestId("calendar-items-locked-note")).toBeNull();
  });

  it("a finished block stays locked (§12.2) but is not called in progress", () => {
    open(
      TODAY,
      review({ started: true, status: "completed", actual: 15, progress: 1 }),
    );
    const select = screen.getByRole("combobox", { name: "Items to clear" });
    expect(select).toBeDisabled();
    expect(screen.queryByTestId("calendar-items-locked-note")).toBeNull();
  });
});
