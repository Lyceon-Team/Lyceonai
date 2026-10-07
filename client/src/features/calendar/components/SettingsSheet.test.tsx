// @vitest-environment jsdom
/**
 * §17.3's settings sheet: the schedule can be changed after setup.
 *
 * @spec [Doc_05F_Study_Calendar, §17.3 settings sheet, §8.1 bounds, §12.1 `profile_change`,
 *        §7.1 mask convention]
 * | @implemented [2026-09-22]
 *
 * WHY THIS FILE EXISTS. `PUT /api/calendar/profile` shipped with the route, the schema and
 * the service all complete, and no caller after setup. A student who picked five days and
 * an hour in their first week had no way to change it. Nothing was broken, so nothing was
 * red.
 *
 * THE BOUNDS ASSERTION IS THE ONE THAT MATTERS MOST. The minute chips must come from the
 * payload's `bounds`, not from a list in the component. The test therefore passes DELIBERATELY
 * UNUSUAL presets — 25 and 55, numbers no one would type as a default — so a component that
 * fell back to a hard-coded [15,30,45,60,90,120] fails here instead of passing by coincidence.
 */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  PlanningEstimates,
  StudyProfile,
  StudyProfileBounds,
} from "@lyceon/shared/calendar";
import { SettingsSheet } from "./SettingsSheet";

const ESTIMATES: PlanningEstimates = {
  practice_seconds_per_unit: 90,
  review_seconds_per_unit: 120,
};

/** §8.1's readout constants, as the ready payload serves them. */
const EXAM_PLANNING = {
  final_exam_lead_days: 7,
  default_full_length_interval_weeks: 2,
  default_full_length_weekday: 6,
};

/** Presets chosen to be unmistakable: no default list contains 25 or 55. */
const BOUNDS: StudyProfileBounds = {
  daily_minutes_min: 15,
  daily_minutes_max: 180,
  daily_minutes_presets: [25, 55, 120],
  target_exam_date_max_days: 400,
};

/** Mon–Sat (bits 1..6 = 126), 60 minutes, Saturday tests — the production shape. */
const PROFILE: StudyProfile = {
  timezone: "America/Chicago",
  target_exam_date: "2026-11-07",
  target_score: 1400,
  study_days_mask: 126,
  daily_minutes: 55,
  full_length_weekday: 6,
  full_length_interval_weeks: 2,
  planner_mode: "auto",
  setup_completed_at: "2026-09-01T18:00:00Z",
};

function renderSheet(
  overrides: Partial<React.ComponentProps<typeof SettingsSheet>> = {},
) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <SettingsSheet
      profile={PROFILE}
      bounds={BOUNDS}
      estimates={ESTIMATES}
      examPlanning={EXAM_PLANNING}
      today="2026-09-22"
      onSave={onSave}
      onClose={onClose}
      pending={false}
      error={null}
      replanOffer={null}
      {...overrides}
    />,
  );
  return { ...utils, onSave, onClose };
}

const chip = (group: string, label: string): HTMLElement =>
  within(screen.getByTestId(group)).getByRole("button", { name: label });

describe("OQ-62 (b) (Karl, 2026-10-05): the two exam rows say 'Full-length test'", () => {
  it("labels the day and frequency rows 'Full-length test …', never 'Practice test …'", () => {
    renderSheet();
    // Presence: both groups are drawn and carry the ruled wording as their names.
    expect(screen.getByTestId("settings-full-length")).toHaveAttribute(
      "aria-label",
      "Full-length test day",
    );
    expect(
      screen.getByTestId("settings-full-length-frequency"),
    ).toHaveAttribute("aria-label", "Full-length test frequency");
    expect(screen.getByText("Full-length test day")).toBeTruthy();
    expect(screen.getByText("Full-length test frequency")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bpractice tests?\b/i);
  });
});

describe("the sheet opens on the student's CURRENT schedule", () => {
  it("pre-selects the stored days, minutes and test day", () => {
    renderSheet();
    // Mon–Sat on, Sunday off.
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      expect(chip("settings-study-days", day)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
    expect(chip("settings-study-days", "Sun")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(chip("settings-minutes", "55 min")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(chip("settings-full-length", "Sat")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("offers the SERVED presets, not a list of its own (§8.1)", () => {
    renderSheet();
    const group = within(screen.getByTestId("settings-minutes"));
    // 25 and 55 exist only because the payload said so.
    expect(group.getByRole("button", { name: "25 min" })).toBeTruthy();
    expect(group.getByRole("button", { name: "55 min" })).toBeTruthy();
    expect(group.getByRole("button", { name: "2 hr" })).toBeTruthy();
    // A preset the payload did NOT offer must not appear, or the component is falling back.
    expect(group.queryByRole("button", { name: "45 min" })).toBeNull();
    expect(group.queryByRole("button", { name: "1 hr" })).toBeNull();
  });

  it("bounds the SAT date by the served window, not by a literal", () => {
    renderSheet();
    const input = screen.getByLabelText("SAT date");
    expect(input.getAttribute("min")).toBe("2026-09-22");
    // 2026-09-22 + 400 days.
    expect(input.getAttribute("max")).toBe("2027-10-27");
  });
});

describe("the live readout describes the DRAFT, not the saved profile", () => {
  /**
   * THE COUNT IS DERIVED BY HAND, and it is the whole reason the readout changed: the exam
   * half used to say only WHICH DAY, which a student cannot plan against. With today
   * 2026-09-22, a target of 2026-11-07, Saturdays, a fortnightly cadence and a 7-day lead:
   *
   *   rehearsal  11-07 − 7 = 10-31, already a Saturday   -> counts
   *   cadence    09-22 + 14 = 10-06 (Tue) -> snap 10-10  -> counts
   *              10-24 (Sat)                            -> counts
   *              11-07                — inside the lead -> stop
   *
   * Three. `fullLengthsBeforeTarget` is shared with the generator's own steps, so this is
   * the number the plan will actually hold rather than a second estimate of it.
   */
  it("is derived, and moves when a chip moves", () => {
    renderSheet();
    expect(screen.getByTestId("settings-summary").textContent).toBe(
      "6 study days a week · about 35 questions a day · about 3 full-length tests before November 7, on Saturdays",
    );

    fireEvent.click(chip("settings-minutes", "2 hr"));
    expect(screen.getByTestId("settings-summary").textContent).toBe(
      "6 study days a week · about 80 questions a day · about 3 full-length tests before November 7, on Saturdays",
    );
  });

  it("says so plainly when there is no test day", () => {
    renderSheet();
    fireEvent.click(chip("settings-full-length", "None"));
    expect(screen.getByTestId("settings-summary").textContent).toContain(
      "no automatic full-length tests",
    );
  });

  it("rounds questions DOWN to the five-question granule the allocator works in", () => {
    // 55 min = 3300s; 3300/90 = 36.67 -> 35, not 36 and not 37. A figure the plan cannot
    // contain would be a number the student could never see on their calendar.
    // Read through the sheet's own readout (the only place the sentence is drawn since the
    // panel's "Your schedule" left, QA 2026-10-07 item 11(e)).
    renderSheet({
      // No target date here: this test is about the QUESTION count, and the exam half is
      // deliberately the rate rather than a count so it cannot drift into the assertion.
      profile: { ...PROFILE, daily_minutes: 55, target_exam_date: null },
    });
    expect(screen.getByTestId("settings-summary").textContent).toContain(
      "about 35 questions a day",
    );
  });
});

describe("the practice-test day is INDEPENDENT of the study days (§7.1)", () => {
  it("dropping Saturday as a study day leaves the Saturday test alone", () => {
    const { onSave } = renderSheet();
    fireEvent.click(chip("settings-study-days", "Sat"));
    fireEvent.click(screen.getByTestId("settings-save"));

    const draft = onSave.mock.calls[0]?.[0];
    // Saturday is out of the mask (bit 6 clear)…
    expect((draft.study_days_mask >> 6) & 1).toBe(0);
    // …and the test day is untouched. Coupling these would silently cancel a student's
    // practice test because they took a Saturday off.
    expect(draft.full_length_weekday).toBe(6);
  });

  it("only None removes the test day", () => {
    const { onSave } = renderSheet();
    fireEvent.click(chip("settings-full-length", "None"));
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(onSave.mock.calls[0]?.[0].full_length_weekday).toBeNull();
  });
});

describe("guard rails", () => {
  it("refuses to remove the LAST study day, with the reason on screen", () => {
    const { onSave } = renderSheet({
      profile: { ...PROFILE, study_days_mask: 1 << 3 },
    });
    fireEvent.click(chip("settings-study-days", "Wed"));

    expect(screen.getByText("Keep at least one study day.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("settings-save"));
    // The mask that would have been a 400 (study_days_mask is CHECKed 1..127) never leaves.
    expect(onSave.mock.calls[0]?.[0].study_days_mask).toBe(1 << 3);
  });

  it("writes NOTHING on Cancel", () => {
    const { onSave, onClose } = renderSheet();
    fireEvent.click(chip("settings-minutes", "25 min"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps an unusual stored timezone in the list rather than reassigning it", () => {
    renderSheet({
      profile: { ...PROFILE, timezone: "Europe/Lisbon" },
    });
    const select = screen.getByLabelText("Timezone") as HTMLSelectElement;
    expect(select.value).toBe("Europe/Lisbon");
  });

  it("sends every field the upsert accepts, so a save is one round trip", () => {
    const { onSave } = renderSheet();
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(Object.keys(onSave.mock.calls[0]?.[0]).sort()).toEqual([
      "daily_minutes",
      "full_length_interval_weeks",
      "full_length_weekday",
      "planner_mode",
      "study_days_mask",
      "target_exam_date",
      "target_score",
      "timezone",
    ]);
  });
});

describe("custom mode asks before re-planning (§12.1)", () => {
  it("toggling Auto plan off is a draft change like any other", () => {
    const { onSave } = renderSheet();
    fireEvent.click(screen.getByTestId("settings-auto-plan"));
    expect(screen.getByTestId("settings-auto-plan")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(onSave.mock.calls[0]?.[0].planner_mode).toBe("custom");
  });

  it("shows the offer only when the page says the save planned nothing", () => {
    const onConfirm = vi.fn();
    const { rerender } = renderSheet();
    expect(screen.queryByTestId("settings-replan-offer")).toBeNull();

    rerender(
      <SettingsSheet
        profile={PROFILE}
        bounds={BOUNDS}
        estimates={ESTIMATES}
        examPlanning={EXAM_PLANNING}
        today="2026-09-22"
        onSave={vi.fn()}
        onClose={vi.fn()}
        pending={false}
        error={null}
        replanOffer={{ onConfirm, onDismiss: vi.fn() }}
      />,
    );
    expect(screen.getByTestId("settings-replan-offer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Re-plan open days" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("dismissing leaves the plan alone", () => {
    const onDismiss = vi.fn();
    const onConfirm = vi.fn();
    renderSheet({ replanOffer: { onConfirm, onDismiss } });
    fireEvent.click(screen.getByRole("button", { name: "Leave it" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

/**
 * §8.1's frequency control. The cadence is the STUDENT'S — that is the whole change — so
 * these tests are about the four choices being expressible and the pair being unbreakable
 * through the interaction, not merely refused by the schema afterwards.
 */
describe("practice test frequency (§8.1)", () => {
  const FREQ = "settings-full-length-frequency";

  it("offers exactly the four cadences and None, and pre-selects the stored one", () => {
    renderSheet();
    for (const label of [
      "Weekly",
      "Every 2 weeks",
      "Every 3 weeks",
      "Monthly",
      "None",
    ]) {
      expect(chip(FREQ, label)).toBeTruthy();
    }
    // The fixture stores 2.
    expect(chip(FREQ, "Every 2 weeks")).toHaveAttribute("aria-pressed", "true");
    expect(chip(FREQ, "Weekly")).toHaveAttribute("aria-pressed", "false");
  });

  it.each([
    ["Weekly", 1],
    ["Every 2 weeks", 2],
    ["Every 3 weeks", 3],
    ["Monthly", 4],
  ])(
    "saves %s as %i weeks — the label is copy, the value is weeks",
    (label, weeks) => {
      const { onSave } = renderSheet();
      fireEvent.click(chip(FREQ, label as string));
      fireEvent.click(screen.getByTestId("settings-save"));
      expect(onSave.mock.calls[0]?.[0].full_length_interval_weeks).toBe(weeks);
      // The day is untouched by a frequency pick.
      expect(onSave.mock.calls[0]?.[0].full_length_weekday).toBe(6);
    },
  );

  it("None on the frequency clears BOTH halves", () => {
    const { onSave } = renderSheet();
    fireEvent.click(chip(FREQ, "None"));
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(onSave.mock.calls[0]?.[0].full_length_interval_weeks).toBeNull();
    expect(onSave.mock.calls[0]?.[0].full_length_weekday).toBeNull();
  });

  it("None on the DAY clears both too — either control is the whole decision", () => {
    const { onSave } = renderSheet();
    fireEvent.click(chip("settings-full-length", "None"));
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(onSave.mock.calls[0]?.[0].full_length_weekday).toBeNull();
    expect(onSave.mock.calls[0]?.[0].full_length_interval_weeks).toBeNull();
  });

  it("picking a day with no cadence adopts the SERVED default, not a literal", () => {
    const { onSave } = renderSheet({
      profile: {
        ...PROFILE,
        full_length_weekday: null,
        full_length_interval_weeks: null,
      },
      examPlanning: { ...EXAM_PLANNING, default_full_length_interval_weeks: 3 },
    });
    fireEvent.click(chip("settings-full-length", "Sun"));
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(onSave.mock.calls[0]?.[0].full_length_weekday).toBe(0);
    // 3, from the payload — not the 2 a literal would have hardcoded.
    expect(onSave.mock.calls[0]?.[0].full_length_interval_weeks).toBe(3);
  });

  // REWRITTEN, not bent: this test asserted that Save went DISABLED when a student picked a
  // cadence with no day, which is what this sheet did before the setup form existed. Setup has
  // no Save to disable, so it had to complete the pair itself — and two surfaces answering the
  // same question two ways is the divergence the working rules call a defect. The sheet now
  // completes the pair too, and a dead Save button was never the better of the two answers.
  it("a cadence with no day yet COMPLETES the pair rather than disabling Save", () => {
    const { onSave } = renderSheet({
      profile: {
        ...PROFILE,
        full_length_weekday: null,
        full_length_interval_weeks: null,
      },
    });
    fireEvent.click(chip(FREQ, "Weekly"));

    // Saturday is pressed by the act of choosing a cadence — visible, so the student can see
    // what they now have and move it, rather than discovering it on the calendar.
    expect(chip("settings-full-length", "Sat")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const save = screen.getByTestId("settings-save");
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    expect(onSave.mock.calls[0]?.[0].full_length_interval_weeks).toBe(1);
    expect(onSave.mock.calls[0]?.[0].full_length_weekday).toBe(6);
  });

  // The guard behind the interaction. Half a pair is unreachable by tapping now that both
  // chip rows move both halves — which is exactly when a guard stops being tested and starts
  // rotting. The draft opens from the `profile` prop, so the sheet is rendered over a half
  // pair no chip can produce, and the Save button is what is asserted.
  it("still refuses to SAVE half a pair, if a draft ever holds one", () => {
    const saveFor = (
      full_length_weekday: number | null,
      full_length_interval_weeks: number | null,
    ): { save: HTMLElement; onSave: ReturnType<typeof vi.fn> } => {
      cleanup();
      const { onSave } = renderSheet({
        profile: {
          ...PROFILE,
          full_length_weekday,
          full_length_interval_weeks,
        },
      });
      return { save: screen.getByTestId("settings-save"), onSave };
    };

    for (const [weekday, interval] of [
      [null, 2],
      [6, null],
    ] as const) {
      const { save, onSave } = saveFor(weekday, interval);
      expect(save).toBeDisabled();
      fireEvent.click(save);
      expect(onSave).not.toHaveBeenCalled();
    }
    // And the two legitimate states are not refused, so the assertions above are about the
    // PAIR and not about the button being disabled for everything.
    for (const [weekday, interval] of [
      [6, 2],
      [null, null],
    ] as const) {
      const { save, onSave } = saveFor(weekday, interval);
      expect(save).toBeEnabled();
      fireEvent.click(save);
      expect(onSave).toHaveBeenCalledTimes(1);
    }
  });

  it("states the RATE, not a count, when there is no target date to count toward", () => {
    renderSheet({ profile: { ...PROFILE, target_exam_date: null } });
    expect(screen.getByTestId("settings-summary").textContent).toContain(
      "a full-length test every 2 weeks, on Saturdays",
    );
  });
});
