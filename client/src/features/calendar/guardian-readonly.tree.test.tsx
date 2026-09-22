// @vitest-environment jsdom
/**
 * @spec [Doc_05F_Study_Calendar, §16 guardian read (R-08-22), §17.6 guardian renders no info icons]
 * @implemented [2026-09-23]
 *
 * WHAT THIS TEST IS FOR. §16 gives a guardian a view-only surface: no Start, Resume, Do it
 * now, Remove, Move, edit field, Refresh, Regenerate, drag handle or explanation copy, and
 * no target score anywhere. Asserting that by listing the controls we expect to be ABSENT
 * would pass forever while a new one was added — so this WALKS THE WHOLE RENDERED TREE and
 * asserts that nothing writable exists in it, by kind rather than by name.
 *
 * It is the negative half of the guarantee. The positive half is `studentTree`, rendered
 * from the same component with the same data: every control this test requires to be absent
 * is asserted PRESENT there, so a version of the page that rendered nothing at all could
 * not pass both.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  CalendarReadyResponse,
  GuardianCalendarReadyResponse,
} from "@lyceon/shared/calendar";
import { CalendarView } from "./CalendarView";
import { guardianViewModel, studentViewModel } from "./lib/view-model";

const TODAY = "2026-09-21";

const ESTIMATES = {
  practice_seconds_per_unit: 90,
  review_seconds_per_unit: 120,
};

const FACTS = {
  blocks_total: 3,
  blocks_completed: 1,
  blocks_partial: 1,
  blocks_missed: 0,
  blocks_in_progress: 1,
  blocks_scheduled: 1,
  questions_completed: 20,
  full_lengths_completed: 0,
  extra_questions: 0,
};

const STREAK = { current: 6, longest: null, history_complete: false };

const PRACTICE_BLOCK = {
  block_id: "11111111-1111-4111-8111-111111111111",
  scheduled_date: TODAY,
  source: "auto" as const,
  derived_from_block_id: null,
  explanation_key: "weighted",
  display_ordinal: 1,
  membership_type: "created" as const,
  block_type: "practice" as const,
  section: "M" as const,
  scope: {
    level: "domain" as const,
    mix: [
      { domain: "Algebra" as const, count: 10, explanation_key: "weak" },
      {
        domain: "Advanced Math" as const,
        count: 5,
        explanation_key: "balanced",
      },
    ],
  },
  target_count: 15,
};

const STUDENT_DAY = {
  local_date: TODAY,
  timezone: "America/Chicago",
  is_user_override: false,
  is_study_day: true,
  version_no: 1,
  status: "today" as const,
  blocks: [
    {
      block: PRACTICE_BLOCK,
      actual: 0,
      progress: 0,
      status: "scheduled" as const,
    },
  ],
  extra_work: [],
  planned_count: 15,
  actual_count: 0,
  extra_count: 0,
};

const STUDENT_RESPONSE: CalendarReadyResponse = {
  status: "ready",
  profile: {
    timezone: "America/Chicago",
    target_exam_date: "2026-11-07",
    target_score: 1400,
    study_days_mask: 127,
    daily_minutes: 60,
    full_length_weekday: 6,
    planner_mode: "auto",
    setup_completed_at: "2026-09-01T00:00:00Z",
  },
  estimates: ESTIMATES,
  days: [STUDENT_DAY],
  facts: FACTS,
  streak: STREAK,
  latest_unacknowledged_nonstudent_change: {
    version_no: 2,
    trigger: "weekly",
    created_at: "2026-09-21T09:00:00Z",
  },
  diagnostic_state: "baseline_ready",
};

/** The guardian payload as the SERVER builds it — sanitised, with no explanation keys. */
const GUARDIAN_RESPONSE: GuardianCalendarReadyResponse = {
  status: "ready",
  // Owner ruling 2026-09-22: minutes are NOT among §16's exclusions, so the guardian
  // payload carries the same estimates the student's does.
  estimates: ESTIMATES,
  days: [
    {
      local_date: TODAY,
      timezone: "America/Chicago",
      is_study_day: true,
      status: "today",
      blocks: [
        {
          block: {
            block_id: PRACTICE_BLOCK.block_id,
            scheduled_date: TODAY,
            display_ordinal: 1,
            block_type: "practice",
            section: "M",
            scope: {
              level: "domain",
              mix: [
                { domain: "Algebra", count: 10 },
                { domain: "Advanced Math", count: 5 },
              ],
            },
            target_count: 15,
          },
          actual: 0,
          progress: 0,
          status: "scheduled",
        },
      ],
      extra_work: [],
      planned_count: 15,
      actual_count: 0,
      extra_count: 0,
    },
  ],
  facts: FACTS,
  streak: STREAK,
};

function renderGuardian(): HTMLElement {
  const { container } = render(
    <CalendarView
      model={guardianViewModel(GUARDIAN_RESPONSE)}
      today={TODAY}
      viewerName="Study plan"
      targetExamDate={null}
      streak={STREAK}
      planUpdate={null}
      onRangeChange={() => {}}
    />,
  );
  return container;
}

function renderStudent(): HTMLElement {
  const { container } = render(
    <CalendarView
      model={studentViewModel(STUDENT_RESPONSE)}
      today={TODAY}
      viewerName="Karl"
      targetExamDate="2026-11-07"
      streak={STREAK}
      planUpdate={{ versionNo: 2, trigger: "weekly" }}
      onRangeChange={() => {}}
      mutations={{
        editDay: () => {},
        moveBlock: () => {},
        regeneratePlan: () => {},
        regenerateDay: () => {},
        resetDay: () => {},
        doItNow: () => {},
        launch: () => {},
        acknowledge: () => {},
        refreshPending: false,
        launchPending: false,
      }}
    />,
  );
  return container;
}

/** Every word that would betray a write control if it appeared on the guardian surface. */
const FORBIDDEN_TEXT = [
  "Start",
  "Resume",
  "Do it now",
  "Remove",
  "Move to",
  "Refresh plan",
  "Regenerate day",
  "Reset to auto",
  "Add block",
  "Add a domain",
  "Coming soon",
  // §17.2's day menu and §17.3's settings sheet, added 2026-09-22. Every one of these is
  // a write, so none of them may appear on a guardian's screen.
  "Block out this day",
  "Undo day off",
  "Edit schedule",
  "Change schedule",
  "Save changes",
];

/**
 * Opens the first block's side sheet and returns the WHOLE document body.
 *
 * THE SHEET MUST BE IN THE WALK. It renders only once a block is clicked, so a tree walk
 * over the un-opened page cannot see anything inside it — a plant that rendered a Start
 * button in the guardian sheet passed a version of this file that only scanned the closed
 * page. The sheet is also portalled outside `container` in effect, so the assertions run
 * against `document.body`.
 */
function renderGuardianWithSheetOpen(): HTMLElement {
  renderGuardian();
  screen.getByTestId(`calendar-block-${PRACTICE_BLOCK.block_id}`).click();
  return document.body;
}

describe("guardian calendar is read-only (§16, R-08-22)", () => {
  it("renders NO control bearing any write-action label", () => {
    const container = renderGuardian();
    const text = container.textContent ?? "";
    for (const label of FORBIDDEN_TEXT) {
      expect(text).not.toContain(label);
    }
  });

  it("renders no write-action label INSIDE the opened block sheet either", async () => {
    const body = renderGuardianWithSheetOpen();
    const sheet = await screen.findByTestId("calendar-block-sheet");
    const text = sheet.textContent ?? "";
    for (const label of FORBIDDEN_TEXT) {
      expect(text).not.toContain(label);
    }
    // And the sheet DID open, so the loop above is not scanning an empty string.
    expect(text).toContain("Math · 15 questions");
    expect(body.textContent).toContain("Only the student can change it.");
  });

  it("renders no button in the opened sheet that could submit a change", async () => {
    renderGuardianWithSheetOpen();
    const sheet = await screen.findByTestId("calendar-block-sheet");
    // The sheet's whole footer on this surface is a sentence, so the only interactive
    // elements it may contain are none at all.
    expect(sheet.querySelectorAll("button")).toHaveLength(0);
    expect(sheet.querySelectorAll("select")).toHaveLength(0);
    expect(sheet.querySelectorAll("input")).toHaveLength(0);
  });

  it("renders no form field of any kind — no select, input, textarea or checkbox for a block", () => {
    const container = renderGuardian();
    void container;
    // The type filters are view controls and write nothing, so they are the ONE permitted
    // input kind; every other field would be an editor.
    const inputs = [...container.querySelectorAll("input")];
    for (const input of inputs) {
      expect(input.type).toBe("checkbox");
    }
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(0);
  });

  it("marks every block undraggable, so no drag handle exists anywhere", () => {
    const container = renderGuardian();
    const draggables = container.querySelectorAll('[data-draggable="true"]');
    expect(draggables).toHaveLength(0);
    // And there IS a block rendered, so the assertion above is not vacuous.
    expect(
      container.querySelectorAll('[data-draggable="false"]').length,
    ).toBeGreaterThan(0);
  });

  it("renders no explanation copy — §17.6 gives a guardian no info icons", () => {
    const container = renderGuardian();
    expect(
      container.querySelector('[data-testid="calendar-block-why"]'),
    ).toBeNull();
    // The copy itself, not just the container: the student fixture's keys are `weak` and
    // `balanced`, whose sentences must not appear anywhere on this surface.
    const text = container.textContent ?? "";
    expect(text).not.toContain("One of your weaker areas");
    expect(text).not.toContain("Keeping this one moving");
  });

  it("renders no target score and no exam countdown (R-08-22)", () => {
    const container = renderGuardian();
    const text = container.textContent ?? "";
    expect(text).not.toContain("1400");
    expect(text).not.toContain("days to test");
  });

  it("renders no day ⋯ menu and no day-off Undo on any date (§17.2)", () => {
    const container = renderGuardian();
    // By TESTID, not by label: the menu button's text is a glyph, so a text sweep would
    // miss it entirely. This is the control that opens every day-scoped write, so its
    // absence is the whole §16 boundary for the grid.
    expect(
      container.querySelectorAll('[data-testid^="day-menu-"]'),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll('[data-testid^="day-off-undo-"]'),
    ).toHaveLength(0);
  });

  it("renders no schedule card and no Edit schedule button (§17.3)", () => {
    const container = renderGuardian();
    expect(
      container.querySelector('[data-testid="rail-schedule-card"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="topbar-edit-schedule"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="calendar-settings-sheet"]'),
    ).toBeNull();
  });

  it("renders no plan-updated banner, so there is nothing for a guardian to acknowledge", () => {
    const container = renderGuardian();
    expect(
      container.querySelector('[data-testid="calendar-plan-banner"]'),
    ).toBeNull();
  });

  it("still renders the plan itself — the assertions above are not passing on an empty page", () => {
    const container = renderGuardian();
    expect(
      container.querySelector('[data-testid="calendar-week-grid"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Math · 15 questions");
    expect(
      container.querySelector('[data-testid="calendar-facts"]'),
    ).not.toBeNull();
  });
});

describe("the student surface DOES render what the guardian surface must not", () => {
  it("renders the block sheet's controls when a block is opened", async () => {
    renderStudent();
    const card = screen.getByTestId(
      `calendar-block-${PRACTICE_BLOCK.block_id}`,
    );
    card.click();
    const sheet = await screen.findByTestId("calendar-block-sheet");
    // Start, the mix editor and Remove — each absent from the guardian tree above.
    expect(within(sheet).getByRole("button", { name: "Start" })).toBeTruthy();
    expect(within(sheet).getByLabelText("Domain 1")).toBeTruthy();
    expect(within(sheet).getByText("Remove")).toBeTruthy();
  });

  it("renders Refresh plan, the plan banner and draggable blocks", () => {
    const container = renderStudent();
    expect(container.textContent).toContain("Refresh plan");
    expect(
      container.querySelector('[data-testid="calendar-plan-banner"]'),
    ).not.toBeNull();
    expect(
      container.querySelectorAll('[data-draggable="true"]').length,
    ).toBeGreaterThan(0);
  });

  it("renders the §17.6 explanation copy the guardian surface withholds", async () => {
    renderStudent();
    screen.getByTestId(`calendar-block-${PRACTICE_BLOCK.block_id}`).click();
    const why = await screen.findByTestId("calendar-block-why");
    expect(why.textContent).toContain("One of your weaker areas right now.");
  });
});

/**
 * §12.2: a started block is protected state. `calendar_move_block` refuses to move one, so
 * the client must not offer the drag — an illegal drag that leaves the pointer and is then
 * rejected is worse than one that never starts.
 */
describe("a started block is not draggable (§12.2)", () => {
  const STARTED_BLOCK_ID = "22222222-2222-4222-8222-222222222222";

  function withStartedBlock(): CalendarReadyResponse {
    return {
      ...STUDENT_RESPONSE,
      days: [
        {
          ...STUDENT_DAY,
          blocks: [
            ...STUDENT_DAY.blocks,
            {
              block: {
                ...PRACTICE_BLOCK,
                block_id: STARTED_BLOCK_ID,
                display_ordinal: 2,
              },
              actual: 5,
              progress: 5 / 15,
              status: "in_progress" as const,
            },
          ],
        },
      ],
    };
  }

  function renderWithStarted(): HTMLElement {
    const { container } = render(
      <CalendarView
        model={studentViewModel(withStartedBlock())}
        today={TODAY}
        viewerName="Karl"
        targetExamDate="2026-11-07"
        streak={STREAK}
        planUpdate={null}
        onRangeChange={() => {}}
        mutations={{
          editDay: () => {},
          moveBlock: () => {},
          regeneratePlan: () => {},
          regenerateDay: () => {},
          resetDay: () => {},
          doItNow: () => {},
          launch: () => {},
          acknowledge: () => {},
          refreshPending: false,
          launchPending: false,
        }}
      />,
    );
    return container;
  }

  it("marks the started block undraggable while its unstarted sibling stays draggable", () => {
    const container = renderWithStarted();
    const started = container.querySelector(
      `[data-testid="calendar-block-${STARTED_BLOCK_ID}"]`,
    );
    const unstarted = container.querySelector(
      `[data-testid="calendar-block-${PRACTICE_BLOCK.block_id}"]`,
    );
    expect(started?.getAttribute("data-draggable")).toBe("false");
    // The control: same day, same type, not started — so the assertion above is about
    // STARTEDNESS and not about the day being undraggable as a whole.
    expect(unstarted?.getAttribute("data-draggable")).toBe("true");
  });

  it("tells the student WHY it will not move, rather than silently refusing", async () => {
    renderWithStarted();
    screen.getByTestId(`calendar-block-${STARTED_BLOCK_ID}`).click();
    const sheet = await screen.findByTestId("calendar-block-sheet");
    expect(sheet.textContent).toContain(
      "This block stays put until it's finished",
    );
    // And no Move field, because §12.2 would refuse it.
    expect(sheet.querySelector('input[type="date"]')).toBeNull();
  });
});

/**
 * A1, owner ruling 2026-09-22. Minutes are NOT among §16's exclusions (controls,
 * explanation copy, target score), so the guardian sees them. This is the POSITIVE
 * assertion for that ruling, and it is also the regression guard for the "Full sitting"
 * bug: with no estimate the card fell back to that label for every block type, so a
 * guardian reading a 15-question Math set was told it was a full sitting.
 */
describe("the guardian sees the minute estimate (§17.1, owner ruling)", () => {
  it("renders `~N min` on a practice block, the same figure the student sees", () => {
    const guardian = render(
      <CalendarView
        model={guardianViewModel(GUARDIAN_RESPONSE)}
        today={TODAY}
        viewerName="Study plan"
        targetExamDate={null}
        streak={STREAK}
        planUpdate={null}
        onRangeChange={() => {}}
      />,
    ).container;

    // 15 questions x 90s = 1350s = 23 min, from the payload's own estimates.
    expect(guardian.textContent).toContain("~23 min");
    // And NEVER the old fallback, which is what the bug looked like.
    expect(guardian.textContent).not.toContain("Full sitting");
  });

  it("agrees with the student surface block for block", () => {
    const guardian = render(
      <CalendarView
        model={guardianViewModel(GUARDIAN_RESPONSE)}
        today={TODAY}
        viewerName="Study plan"
        targetExamDate={null}
        streak={STREAK}
        planUpdate={null}
        onRangeChange={() => {}}
      />,
    ).container;
    const guardianMinutes = [
      ...(guardian.textContent ?? "").matchAll(/~(\d+) min/g),
    ].map((match) => match[1]);

    cleanup();

    const student = renderStudent();
    const studentMinutes = [
      ...(student.textContent ?? "").matchAll(/~(\d+) min/g),
    ].map((match) => match[1]);

    expect(guardianMinutes.length).toBeGreaterThan(0);
    expect(guardianMinutes).toEqual(studentMinutes);
  });
});
