// @vitest-environment jsdom
/**
 * §17.5 — nothing is required, nothing blocks.
 *
 * @spec [Doc 05F §17.5, §8.1; SCL-130] | @implemented [2026-09-24]
 *
 * The case that matters most is the FIRST one: a student who answers nothing and presses
 * straight through must end up with a real profile. Production is the reason — 104 students
 * and one profile, because the only surface collecting this had a required field in it.
 */
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarSetupDefaults } from "@lyceon/shared/calendar";
import { SetupPopup, type SetupAnswers } from "./SetupPopup";

afterEach(cleanup);

const DEFAULTS: CalendarSetupDefaults = {
  timezone: "America/Chicago",
  daily_minutes_presets: [15, 30, 45, 60, 90, 120],
  daily_minutes_min: 15,
  daily_minutes_max: 180,
  target_exam_date_max_days: 365,
};

const TODAY = "2026-09-24";

function open(over: Partial<React.ComponentProps<typeof SetupPopup>> = {}): {
  submitted: SetupAnswers[];
  dismissed: () => number;
} {
  const submitted: SetupAnswers[] = [];
  const onDismiss = vi.fn();
  render(
    <SetupPopup
      defaults={DEFAULTS}
      today={TODAY}
      entitled
      onSubmit={(a) => submitted.push(a)}
      onDismiss={onDismiss}
      onUpgrade={vi.fn()}
      pending={false}
      error={null}
      {...over}
    />,
  );
  return { submitted, dismissed: () => onDismiss.mock.calls.length };
}

describe("pressing straight through", () => {
  it("writes a REAL profile without the student answering anything", () => {
    const { submitted } = open();

    fireEvent.click(screen.getByTestId("calendar-setup-continue"));
    fireEvent.click(screen.getByTestId("calendar-setup-done"));

    expect(submitted).toHaveLength(1);
    const body = submitted[0]!;
    // The schedule fields carry the selections the student SAW, so the profile describes
    // a real week rather than an empty one.
    expect(body.study_days_mask).toBeGreaterThan(0);
    expect(body.daily_minutes).toBe(60);
    expect(body.full_length_weekday).toBe(6);
    expect(body.timezone.length).toBeGreaterThan(0);
  });

  it("no control is ever disabled or required — there is nothing to fail", () => {
    open();
    const cont = screen.getByTestId(
      "calendar-setup-continue",
    ) as HTMLButtonElement;
    expect(cont.disabled).toBe(false);
    for (const el of Array.from(
      document.querySelectorAll<HTMLInputElement>("input"),
    )) {
      expect(el.required).toBe(false);
    }
  });
});

describe("the test date is optional", () => {
  it('"I haven\'t picked a date yet" stores NULL, not the placeholder in the input', () => {
    const { submitted } = open();

    fireEvent.click(screen.getByTestId("calendar-setup-no-date"));
    fireEvent.click(screen.getByTestId("calendar-setup-continue"));
    fireEvent.click(screen.getByTestId("calendar-setup-done"));

    expect(submitted[0]!.target_exam_date).toBeNull();
  });

  it("disables the date input when the opt-out is checked", () => {
    open();
    const date = screen.getByTestId(
      "calendar-setup-exam-date",
    ) as HTMLInputElement;
    expect(date.disabled).toBe(false);
    fireEvent.click(screen.getByTestId("calendar-setup-no-date"));
    expect(date.disabled).toBe(true);
  });

  it("a chosen date IS stored", () => {
    const { submitted } = open();
    fireEvent.change(screen.getByTestId("calendar-setup-exam-date"), {
      target: { value: "2026-11-07" },
    });
    fireEvent.click(screen.getByTestId("calendar-setup-continue"));
    fireEvent.click(screen.getByTestId("calendar-setup-done"));
    expect(submitted[0]!.target_exam_date).toBe("2026-11-07");
  });
});

describe("the live countdown on the score step", () => {
  it('reads "N days to go" from the chosen date', () => {
    open();
    fireEvent.change(screen.getByTestId("calendar-setup-exam-date"), {
      target: { value: "2026-10-24" },
    });
    // 2026-09-24 → 2026-10-24 is 30 days. Asserted as arithmetic, not as a literal.
    expect(screen.getByTestId("calendar-setup-score-note").textContent).toBe(
      `out of 1600 · ${30} days to go`,
    );
  });

  it("drops the countdown — not to zero — when there is no date", () => {
    open();
    fireEvent.click(screen.getByTestId("calendar-setup-no-date"));
    const note = screen.getByTestId("calendar-setup-score-note").textContent;
    expect(note).toBe("out of 1600");
    expect(note).not.toMatch(/\b0 days\b/);
  });

  it("the slider moves the readout", () => {
    open();
    fireEvent.change(screen.getByTestId("calendar-setup-score"), {
      target: { value: "1200" },
    });
    expect(screen.getByTestId("calendar-setup-score-out").textContent).toBe(
      "1200",
    );
  });
});

describe("skipping", () => {
  it("Skip on step 1 sends BOTH target fields as null", () => {
    const { submitted } = open();

    fireEvent.click(screen.getByTestId("calendar-setup-skip-1"));
    fireEvent.click(screen.getByTestId("calendar-setup-done"));

    // Skip means "no answer from me" — so the slider's resting position is not stored as
    // if the student had chosen it.
    expect(submitted[0]!.target_score).toBeNull();
    expect(submitted[0]!.target_exam_date).toBeNull();
    // …and the schedule half is still real, so there is still a plan to build.
    expect(submitted[0]!.study_days_mask).toBeGreaterThan(0);
  });

  it("moving the slider after Skip counts as an answer again", () => {
    const { submitted } = open();
    fireEvent.click(screen.getByTestId("calendar-setup-skip-1"));
    fireEvent.click(screen.getByTestId("calendar-setup-back"));
    fireEvent.change(screen.getByTestId("calendar-setup-score"), {
      target: { value: "1500" },
    });
    fireEvent.click(screen.getByTestId("calendar-setup-continue"));
    fireEvent.click(screen.getByTestId("calendar-setup-done"));
    expect(submitted[0]!.target_score).toBe(1500);
  });
});

describe("dismissing", () => {
  it("the × dismisses and saves nothing", () => {
    const { submitted, dismissed } = open();
    fireEvent.click(screen.getByTestId("calendar-setup-dismiss"));
    expect(dismissed()).toBe(1);
    expect(submitted).toHaveLength(0);
  });

  it("Escape dismisses", () => {
    const { dismissed } = open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(dismissed()).toBe(1);
  });

  it("clicking the backdrop dismisses; clicking the card does not", () => {
    const { dismissed } = open();
    fireEvent.click(screen.getByTestId("calendar-setup-popup"));
    expect(dismissed()).toBe(1);
    fireEvent.click(
      screen.getByTestId("calendar-setup-popup").querySelector(".card")!,
    );
    expect(dismissed()).toBe(1);
  });
});

describe("a free student — Step 3's third panel", () => {
  it("saves first, THEN shows what they would get", () => {
    const { submitted } = open({ entitled: false });

    fireEvent.click(screen.getByTestId("calendar-setup-continue"));
    fireEvent.click(screen.getByTestId("calendar-setup-done"));

    // The order is the claim: the write already happened, so the panel's "saved either
    // way" is a fact rather than a promise.
    expect(submitted).toHaveLength(1);
    expect(screen.getByTestId("calendar-setup-upgrade")).toBeTruthy();
  });

  it("labels the last press for what it does", () => {
    open({ entitled: false });
    fireEvent.click(screen.getByTestId("calendar-setup-continue"));
    expect(screen.getByTestId("calendar-setup-done").textContent).toBe(
      "See what I'd get",
    );
  });

  it("an entitled student builds the plan and never sees the panel", () => {
    open({ entitled: true });
    fireEvent.click(screen.getByTestId("calendar-setup-continue"));
    expect(screen.getByTestId("calendar-setup-done").textContent).toBe(
      "Build my plan",
    );
    fireEvent.click(screen.getByTestId("calendar-setup-done"));
    expect(screen.queryByTestId("calendar-setup-upgrade")).toBeNull();
  });
});

describe("the schedule step keeps at least one study day", () => {
  it("declines to unselect the last one rather than saving a mask of 0", () => {
    const { submitted } = open();
    fireEvent.click(screen.getByTestId("calendar-setup-continue"));

    const chips = screen
      .getByTestId("calendar-setup-days")
      .querySelectorAll("button");
    // Turn every day off; the control should refuse the final one.
    for (const chip of Array.from(chips)) fireEvent.click(chip);
    for (const chip of Array.from(chips)) fireEvent.click(chip);

    fireEvent.click(screen.getByTestId("calendar-setup-done"));
    expect(submitted[0]!.study_days_mask).toBeGreaterThan(0);
  });
});
