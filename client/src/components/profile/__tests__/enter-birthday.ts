/**
 * The ONE way a test enters a birthday on the profile step.
 *
 * @spec [owner brief "birthday input" (Karl, 2026-11-04); CLAUDE.md "One scenario, shared"]
 *       | @implemented [2026-11-04]
 *
 * plain English: the date of birth used to be one `<input type="date">`, so thirteen tests each
 * did `fireEvent.change(getByTestId("input-date-of-birth"), { target: { value: iso } })`. It is
 * now three fields. Thirteen hand-rolled three-field helpers would be thirteen chances to drift
 * from what the component actually does — the fixture hazard CLAUDE.md names — so there is one
 * helper, here, and every test calls it.
 *
 * It takes the ISO date the old tests already used, so each call site changed from one line to
 * one line and no test's INTENT moved.
 */
import { fireEvent, screen } from "@testing-library/react";

/** Enter `YYYY-MM-DD` through the three real fields, as a person would. */
export function enterBirthday(iso: string): void {
  const [year, month, day] = iso.split("-") as [string, string, string];
  // Month is a native <select>; its value is the 1-based month with no leading zero.
  fireEvent.change(screen.getByTestId("select-birth-month"), {
    target: { value: String(Number(month)) },
  });
  fireEvent.change(screen.getByTestId("input-birth-day"), {
    target: { value: String(Number(day)) },
  });
  fireEvent.change(screen.getByTestId("input-birth-year"), {
    target: { value: year },
  });
}

/** The three fields, for a test that asserts on them directly. */
export function birthdayFields(): {
  month: HTMLSelectElement;
  day: HTMLInputElement;
  year: HTMLInputElement;
} {
  return {
    month: screen.getByTestId("select-birth-month") as HTMLSelectElement,
    day: screen.getByTestId("input-birth-day") as HTMLInputElement,
    year: screen.getByTestId("input-birth-year") as HTMLInputElement,
  };
}
