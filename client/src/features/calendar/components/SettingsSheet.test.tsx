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
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  PlanningEstimates,
  StudyProfile,
  StudyProfileBounds,
} from "@lyceon/shared/calendar";
import { SettingsSheet, scheduleSummary } from "./SettingsSheet";

const ESTIMATES: PlanningEstimates = {
  practice_seconds_per_unit: 90,
  review_seconds_per_unit: 120,
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
  it("is derived, and moves when a chip moves", () => {
    renderSheet();
    expect(screen.getByTestId("settings-summary").textContent).toBe(
      "6 study days a week · about 35 questions a day · practice tests on Saturdays",
    );

    fireEvent.click(chip("settings-minutes", "2 hr"));
    expect(screen.getByTestId("settings-summary").textContent).toBe(
      "6 study days a week · about 80 questions a day · practice tests on Saturdays",
    );
  });

  it("says so plainly when there is no test day", () => {
    renderSheet();
    fireEvent.click(chip("settings-full-length", "None"));
    expect(screen.getByTestId("settings-summary").textContent).toContain(
      "no automatic practice tests",
    );
  });

  it("rounds questions DOWN to the five-question granule the allocator works in", () => {
    // 55 min = 3300s; 3300/90 = 36.67 -> 35, not 36 and not 37. A figure the plan cannot
    // contain would be a number the student could never see on their calendar.
    expect(
      scheduleSummary(
        {
          study_days_mask: 126,
          daily_minutes: 55,
          full_length_weekday: 6,
        },
        ESTIMATES,
      ),
    ).toContain("about 35 questions a day");
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
